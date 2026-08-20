import json
import logging
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any, Dict, List, Optional
import pandas as pd

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from routers.validate import generate_dynamic_rules, GenerateRulesRequest
from agents.cleanser_agent import run_cleanser
from services.supabase_client import supabase_service
from services.cleanser_dynamic_rules import replace_rules_for_object, normalize_dynamic_rule, DEFAULT_STORE_PATH

logger = logging.getLogger(__name__)

router = APIRouter()

class FlowRequest(BaseModel):
    project_id: str
    target_object: str
    custom_prompts: list[str] | None = None
    dynamic_rules: list[dict[str, Any]] | None = None
    standard_rules_config: list[dict] | None = None
    excluded_validation_rules: list[str] | None = None

class SaveRequest(BaseModel):
    project_id: str
    target_object: str
    payload: list

class SaveDynamicRulesRequest(BaseModel):
    project_id: str
    target_object: str
    rules: Optional[List[Dict[str, Any]]] = None

def parse_cleaned_csv(csv_path: Path):
    df = pd.read_csv(csv_path, dtype=str, keep_default_na=False)
    df = df.fillna("")
    return df.to_dict(orient="records")

@router.get("/validation-rules")
async def get_validation_report_rules(project_id: str, target_object: str):
    client = supabase_service.get_client()
    res_obj = client.table("sf_objects").select("id").ilike("name", target_object).execute()
    if not res_obj.data:
        res_obj = client.table("sf_objects").select("id").ilike("name", "Biographical Info").execute()
    if not res_obj.data:
        return {"rules": []}
    object_id = res_obj.data[0]["id"]
    
    # 1. Fetch saved validation dynamic rules from Step 5
    val_dynamic_rules = []
    try:
        res_dr = client.table("dynamic_rules").select("payload").eq("project_id", project_id).eq("object_id", object_id).order("created_at", desc=True).limit(1).execute()
        if res_dr.data and isinstance(res_dr.data[0].get("payload"), list):
            val_dynamic_rules = [
                r for r in res_dr.data[0]["payload"]
                if isinstance(r, dict) and (
                    r.get("source") in ("validation_dynamic_rule", "validate")
                    or r.get("phase") == "validate"
                    or (
                        r.get("source") not in ("harmonization_dynamic_rule", "cleanser_dynamic_rule")
                        and r.get("phase") not in ("harmonize", "cleanser")
                        and not str(r.get("id", "")).startswith("DYNAMIC_HARM_")
                        and not str(r.get("id", "")).startswith("DYNAMIC_CLS_")
                    )
                )
            ]
    except Exception:
        pass

    rules_map = {}
    for r in val_dynamic_rules:
        code = str(r.get("id") or r.get("rule_code") or r.get("label") or "DYNAMIC_VAL_RULE")
        rules_map[code] = {
            "rule_code": code,
            "label": r.get("label") or r.get("name") or code,
            "field": r.get("field") or r.get("field_name") or "GENERAL",
            "message": r.get("description") or r.get("error_message") or r.get("prompt") or "Custom validation rule",
            "count": 0,
            "enabled": r.get("enabled", True),
            "is_dynamic": True,
        }

    # 2. Fetch complete Validation Report payload
    res_val = client.table("validation_report").select("payload").eq("project_id", project_id).eq("object_id", object_id).order("created_at", desc=True).limit(1).execute()
    validation_payload = res_val.data[0]["payload"] if res_val.data else []

    issues = validation_payload.get("issues", []) if isinstance(validation_payload, dict) else (validation_payload if isinstance(validation_payload, list) else [])
    for issue in issues:
        if isinstance(issue, dict):
            rule_code = str(issue.get("rule_code") or issue.get("rule") or "UNKNOWN")
            matched_key = None
            if rule_code in rules_map:
                matched_key = rule_code
            else:
                for k, v in rules_map.items():
                    if k == rule_code or v.get("label") == rule_code:
                        matched_key = k
                        break

            if matched_key:
                rules_map[matched_key]["count"] += 1
            else:
                rules_map[rule_code] = {
                    "rule_code": rule_code,
                    "label": issue.get("label") or rule_code,
                    "field": issue.get("field_name") or issue.get("field") or "MULTIPLE",
                    "message": issue.get("reason") or issue.get("message") or "Validation issue",
                    "count": 1,
                    "enabled": True,
                    "is_dynamic": False,
                }

    return {"rules": list(rules_map.values())}

@router.post("/flow")
async def cleanser_flow(req: FlowRequest):
    client = supabase_service.get_client()
    
    # 1. Fetch Object ID
    res_obj = client.table("sf_objects").select("id").ilike("name", req.target_object).execute()
    if not res_obj.data:
        res_obj = client.table("sf_objects").select("id").ilike("name", "Biographical Info").execute()
    if not res_obj.data:
        raise HTTPException(status_code=400, detail="Target object not found")
    object_id = res_obj.data[0]["id"]
    
    # 2. Fetch Harmonized Data
    res_harm = client.table("harmonized_data").select("payload").eq("project_id", req.project_id).eq("object_id", object_id).order("created_at", desc=True).limit(1).execute()
    if not res_harm.data:
        raise HTTPException(status_code=400, detail="No harmonized data found for this project/object")
    harmonized_data = res_harm.data[0]["payload"]
    if isinstance(harmonized_data, dict) and "rows" in harmonized_data:
        harmonized_data = harmonized_data["rows"]
    
    # 3. Fetch complete Validation Report payload.
    res_val = client.table("validation_report").select("payload").eq("project_id", req.project_id).eq("object_id", object_id).order("created_at", desc=True).limit(1).execute()
    validation_payload = res_val.data[0]["payload"] if res_val.data else []

    # 4. Determine Dynamic Rules: use client-supplied selected rules + any active Step 5 validation dynamic rules
    all_dynamic_rules = list(req.dynamic_rules) if req.dynamic_rules is not None else []
    try:
        res_rules = client.table("dynamic_rules").select("payload").eq("project_id", req.project_id).eq("object_id", object_id).order("created_at", desc=True).limit(1).execute()
        if res_rules.data and isinstance(res_rules.data[0].get("payload"), list):
            existing_ids = {str(r.get("id") or r.get("rule_code") or r.get("label")) for r in all_dynamic_rules if isinstance(r, dict)}
            excluded_set = set(req.excluded_validation_rules or [])
            for r in res_rules.data[0]["payload"]:
                if isinstance(r, dict):
                    rid = str(r.get("id") or r.get("rule_code") or r.get("label"))
                    is_val_dyn = (
                        r.get("source") in ("validation_dynamic_rule", "validate")
                        or r.get("phase") == "validate"
                        or rid.startswith("DYNAMIC_VAL_")
                    )
                    if is_val_dyn and rid not in existing_ids and rid not in excluded_set:
                        all_dynamic_rules.append(r)
    except Exception as de:
        logger.warning(f"Could not merge validation dynamic rules in cleanser_flow: {de}")

    # 5. Compile custom AI dynamic prompts if provided
    if req.custom_prompts:
        actual_cols = list(harmonized_data[0].keys()) if harmonized_data and isinstance(harmonized_data[0], dict) else None
        gen_res = generate_dynamic_rules(
            GenerateRulesRequest(
                prompts=req.custom_prompts,
                target_object=req.target_object,
                actual_columns=actual_cols,
            )
        )
        compiled = gen_res.get("rules", [])
        all_dynamic_rules.extend(compiled)

        if compiled and req.project_id:
            try:
                res_dr = client.table("dynamic_rules").select("payload").eq("project_id", req.project_id).eq("object_id", object_id).order("created_at", desc=True).limit(1).execute()
                existing_rules = res_dr.data[0]["payload"] if (res_dr.data and isinstance(res_dr.data[0].get("payload"), list)) else []
                other_rules = [
                    r for r in existing_rules
                    if isinstance(r, dict) and (
                        r.get("source") in ("harmonization_dynamic_rule", "validation_dynamic_rule")
                        or r.get("phase") in ("harmonize", "validate")
                        or str(r.get("id", "")).startswith("DYNAMIC_HARM_")
                        or str(r.get("id", "")).startswith("DYNAMIC_VAL_")
                    )
                ]
                tagged_compiled = [
                    {
                        **r,
                        "source": "cleanser_dynamic_rule",
                        "phase": "cleanser",
                        "id": r.get("id") or f"DYNAMIC_CLS_{uuid.uuid4().hex[:8]}"
                    } if isinstance(r, dict) else r
                    for r in compiled
                ]
                combined_rules = other_rules + tagged_compiled

                client.table("dynamic_rules").delete().eq("project_id", req.project_id).eq("object_id", object_id).execute()
                if combined_rules:
                    client.table("dynamic_rules").insert({
                        "project_id": req.project_id,
                        "object_id": object_id,
                        "payload": combined_rules
                    }).execute()
            except Exception as pe:
                logger.warning(f"Could not persist dynamic_rules in cleanser: {pe}")

    with TemporaryDirectory(prefix="sf_cleanser_") as tmp_dir:
        tmp_path = Path(tmp_dir)
        input_csv_path = tmp_path / "harmonization.csv"
        output_csv_path = tmp_path / "cleaned.csv"

        df = pd.DataFrame(harmonized_data)
        df.to_csv(input_csv_path, index=False)

        try:
            summary = run_cleanser(
                dataset_csv_path=input_csv_path,
                validation_report_payload=validation_payload,
                output_csv_path=output_csv_path,
                project_id=req.project_id,
                target_object=req.target_object,
                dynamic_rules=all_dynamic_rules,
                standard_rules_config=req.standard_rules_config,
                excluded_validation_rules=req.excluded_validation_rules,
            )
            cleaned_data = parse_cleaned_csv(output_csv_path)
        except Exception as exc:
            logger.exception("Cleanser run failed")
            raise HTTPException(status_code=500, detail=f"Cleanser failed: {exc}") from exc

    cleanser_only_rules = [
        r for r in all_dynamic_rules
        if isinstance(r, dict) and (
            r.get("source") in ("cleanser_dynamic_rule", "cleanser")
            or r.get("phase") == "cleanser"
            or str(r.get("id", "")).startswith("DYNAMIC_CLS_")
        )
    ]

    return {
        "success": True,
        "summary": summary,
        "cleaned": cleaned_data,
        "dynamic_rules": cleanser_only_rules,
    }


@router.post("/upload-csv")
async def cleanser_upload_csv(
    harmonization_csv: UploadFile = File(...),
    validation_report_csv: UploadFile | None = File(None),
    custom_prompts_json: Optional[str] = Form(None),
    dynamic_rules_json: Optional[str] = Form(None),
    standard_rules_config_json: Optional[str] = Form(None),
    excluded_validation_rules_json: Optional[str] = Form(None),
    target_object: str = Form("Biographical Info"),
):
    if not harmonization_csv.filename:
        raise HTTPException(status_code=400, detail="harmonization_csv is required")

    custom_prompts = json.loads(custom_prompts_json) if custom_prompts_json else []
    dynamic_rules = json.loads(dynamic_rules_json) if dynamic_rules_json else []
    standard_rules_config = json.loads(standard_rules_config_json) if standard_rules_config_json else None
    excluded_validation_rules = json.loads(excluded_validation_rules_json) if excluded_validation_rules_json else None

    with TemporaryDirectory(prefix="sf_cleanser_") as tmp_dir:
        tmp_path = Path(tmp_dir)
        input_csv_path = tmp_path / "harmonization.csv"
        output_csv_path = tmp_path / "cleaned.csv"

        content = await harmonization_csv.read()
        input_csv_path.write_bytes(content)

        report_path: Path | None = None
        if validation_report_csv and validation_report_csv.filename:
            suffix = Path(validation_report_csv.filename).suffix.lower()
            validation_csv_path = tmp_path / ("validation_report.json" if suffix == ".json" else "validation_report.csv")
            validation_csv_path.write_bytes(await validation_report_csv.read())
            report_path = validation_csv_path

        if custom_prompts:
            try:
                df_temp = pd.read_csv(input_csv_path, dtype=str, keep_default_na=False)
                actual_cols = list(df_temp.columns)
            except Exception:
                actual_cols = None
            gen_res = generate_dynamic_rules(
                GenerateRulesRequest(
                    prompts=custom_prompts,
                    target_object=target_object,
                    actual_columns=actual_cols,
                )
            )
            compiled = gen_res.get("rules", [])
            dynamic_rules.extend(compiled)

        try:
            summary = run_cleanser(
                dataset_csv_path=input_csv_path,
                validation_report_csv_path=report_path,
                output_csv_path=output_csv_path,
                target_object=target_object,
                dynamic_rules=dynamic_rules,
                standard_rules_config=standard_rules_config,
                excluded_validation_rules=excluded_validation_rules,
            )
            cleaned_data = parse_cleaned_csv(output_csv_path)
        except Exception as exc:
            logger.exception("Cleanser upload run failed")
            raise HTTPException(status_code=500, detail=f"Cleanser failed: {exc}") from exc

    return {
        "success": True,
        "summary": summary,
        "cleaned": cleaned_data,
        "dynamic_rules": dynamic_rules,
    }


@router.post("/rules/save")
def save_cleanser_dynamic_rules(req: SaveDynamicRulesRequest):
    try:
        client = supabase_service.get_client()
        # Resolve target_object name to object_id
        res_obj = client.table("sf_objects").select("id").ilike("name", req.target_object).execute()
        if not res_obj.data:
            res_obj = client.table("sf_objects").select("id").ilike("name", "Biographical Info").execute()
        if not res_obj.data:
            raise HTTPException(400, detail=f"SuccessFactors object '{req.target_object}' not found.")
        object_id = res_obj.data[0]["id"]

        # Tag cleanser rules
        tagged_rules = [
            {
                **r,
                "source": "cleanser_dynamic_rule",
                "phase": "cleanser",
                "id": r.get("id") or f"DYNAMIC_CLS_{uuid.uuid4().hex[:8]}"
            } if isinstance(r, dict) else r
            for r in (req.rules or [])
        ]

        # Preserve other phase rules (harmonize / validate) in dynamic_rules table
        res_dr = client.table("dynamic_rules").select("payload").eq("project_id", req.project_id).eq("object_id", object_id).order("created_at", desc=True).limit(1).execute()
        existing_rules = res_dr.data[0]["payload"] if (res_dr.data and isinstance(res_dr.data[0].get("payload"), list)) else []
        other_rules = [
            r for r in existing_rules
            if isinstance(r, dict) and (
                r.get("source") in ("harmonization_dynamic_rule", "validation_dynamic_rule")
                or r.get("phase") in ("harmonize", "validate")
                or str(r.get("id", "")).startswith("DYNAMIC_HARM_")
                or str(r.get("id", "")).startswith("DYNAMIC_VAL_")
            )
        ]
        combined_rules = other_rules + tagged_rules

        # Update dynamic_rules table
        client.table("dynamic_rules") \
            .delete() \
            .eq("project_id", req.project_id) \
            .eq("object_id", object_id) \
            .execute()

        if combined_rules:
            client.table("dynamic_rules").insert({
                "project_id": req.project_id,
                "object_id": object_id,
                "payload": combined_rules
            }).execute()

        # Also persist to local JSON store
        try:
            replace_rules_for_object(tagged_rules, project_id=req.project_id, target_object=req.target_object)
        except Exception as e:
            logger.warning(f"Could not persist to local JSON store: {e}")

        return {"status": "success", "message": "Cleanser dynamic rules saved successfully."}
    except Exception as e:
        logger.error(f"Failed to save dynamic rules in cleanser: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to save dynamic rules: {str(e)}")


@router.get("/load/{project_id}")
def load_saved_cleanser_data(project_id: str, target_object: Optional[str] = None):
    try:
        client = supabase_service.get_client()
        res_obj = None
        if target_object:
            res_obj = client.table("sf_objects").select("id").ilike("name", target_object).execute()
            if not res_obj.data:
                res_obj = client.table("sf_objects").select("id").ilike("name", "Biographical Info").execute()

        object_id = res_obj.data[0]["id"] if res_obj and res_obj.data else None

        # Load cleansed data
        cleaned_payload = []
        try:
            q_clean = client.table("cleansed_data").select("payload").eq("project_id", project_id)
            if object_id:
                q_clean = q_clean.eq("object_id", object_id)
            res_clean = q_clean.order("created_at", desc=True).limit(1).execute()
            if res_clean.data and isinstance(res_clean.data[0].get("payload"), list):
                cleaned_payload = res_clean.data[0]["payload"]
        except Exception:
            pass

        # Load dynamic rules from dynamic_rules table
        dynamic_rules = []
        try:
            dr_query = client.table("dynamic_rules").select("payload").eq("project_id", project_id)
            if object_id:
                dr_query = dr_query.eq("object_id", object_id)
            res_dr = dr_query.order("created_at", desc=True).limit(1).execute()
            if res_dr.data and isinstance(res_dr.data[0].get("payload"), list):
                dynamic_rules = res_dr.data[0]["payload"]
        except Exception:
            pass

        # Filter strictly for cleanser dynamic rules (exclude harmonize/validate rules)
        cleanser_rules = [
            r for r in dynamic_rules
            if isinstance(r, dict) and (
                r.get("source") in ("cleanser_dynamic_rule", "cleanser")
                or r.get("phase") == "cleanser"
                or str(r.get("id", "")).startswith("DYNAMIC_CLS_")
            )
        ]

        return {
            "status": "success",
            "cleaned": cleaned_payload,
            "dynamic_rules": cleanser_rules,
        }
    except Exception as e:
        logger.error(f"Failed to load cleanser data: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to load cleanser data: {str(e)}")


@router.post("/save")
async def cleanser_save(req: SaveRequest):
    client = supabase_service.get_client()
    try:
        # Fetch Object ID
        res_obj = client.table("sf_objects").select("id").ilike("name", req.target_object).execute()
        if not res_obj.data:
            res_obj = client.table("sf_objects").select("id").ilike("name", "Biographical Info").execute()
        if not res_obj.data:
            raise HTTPException(status_code=400, detail="Target object not found")
        object_id = res_obj.data[0]["id"]
        
        # Delete old
        client.table("cleansed_data") \
            .delete() \
            .eq("project_id", req.project_id) \
            .eq("object_id", object_id) \
            .execute()
            
        # Insert new
        res = client.table("cleansed_data").insert({
            "project_id": req.project_id,
            "object_id": object_id,
            "payload": req.payload
        }).execute()
        
        return {"success": True, "inserted": len(req.payload)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

