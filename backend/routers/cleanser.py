from pathlib import Path
from tempfile import TemporaryDirectory
import pandas as pd

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from routers.validate import generate_dynamic_rules, GenerateRulesRequest
from agents.cleanser_agent import run_cleanser
from services.supabase_client import supabase_service

router = APIRouter()

class FlowRequest(BaseModel):
    project_id: str
    target_object: str
    custom_prompts: list[str] | None = None
    standard_rules_config: list[dict] | None = None
    excluded_validation_rules: list[str] | None = None

class SaveRequest(BaseModel):
    project_id: str
    target_object: str
    payload: list

def parse_cleaned_csv(csv_path: Path):
    df = pd.read_csv(csv_path, dtype=str, keep_default_na=False)
    df = df.fillna("")
    return df.to_dict(orient="records")

@router.get("/validation-rules")
async def get_validation_report_rules(project_id: str, target_object: str):
    client = supabase_service.get_client()
    res_obj = client.table("sf_objects").select("id").ilike("name", target_object).execute()
    if not res_obj.data:
        return {"rules": []}
    object_id = res_obj.data[0]["id"]
    res_val = client.table("validation_report").select("payload").eq("project_id", project_id).eq("object_id", object_id).order("created_at", desc=True).limit(1).execute()
    validation_payload = res_val.data[0]["payload"] if res_val.data else []

    rules_map = {}
    issues = validation_payload.get("issues", []) if isinstance(validation_payload, dict) else (validation_payload if isinstance(validation_payload, list) else [])
    for issue in issues:
        if isinstance(issue, dict):
            rule_code = issue.get("rule_code") or issue.get("rule") or "UNKNOWN"
            if rule_code not in rules_map:
                rules_map[rule_code] = {
                    "rule_code": rule_code,
                    "field": issue.get("field") or "MULTIPLE",
                    "message": issue.get("message") or issue.get("reason") or "Validation issue",
                    "count": 0,
                    "enabled": True,
                }
            rules_map[rule_code]["count"] += 1

    return {"rules": list(rules_map.values())}

@router.post("/flow")
async def cleanser_flow(req: FlowRequest):
    client = supabase_service.get_client()
    
    # 1. Fetch Object ID
    res_obj = client.table("sf_objects").select("id").ilike("name", req.target_object).execute()
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

    # 4. Fetch Dynamic Rules from Supabase
    res_rules = client.table("dynamic_rules").select("payload").eq("project_id", req.project_id).eq("object_id", object_id).order("created_at", desc=True).limit(1).execute()
    all_dynamic_rules = list(res_rules.data[0]["payload"]) if res_rules.data else []

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

    if all_dynamic_rules and req.project_id:
        try:
            client.table("dynamic_rules").delete().eq("project_id", req.project_id).eq("object_id", object_id).execute()
            client.table("dynamic_rules").insert({
                "project_id": req.project_id,
                "object_id": object_id,
                "payload": all_dynamic_rules
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
            raise HTTPException(status_code=500, detail=f"Cleanser failed: {exc}") from exc

    return {
        "success": True,
        "summary": summary,
        "cleaned": cleaned_data,
    }


@router.post("/upload-csv")
async def cleanser_upload_csv(
    harmonization_csv: UploadFile = File(...),
    validation_report_csv: UploadFile | None = File(None),
):
    if not harmonization_csv.filename:
        raise HTTPException(status_code=400, detail="harmonization_csv is required")

    with TemporaryDirectory(prefix="sf_cleanser_") as tmp_dir:
        tmp_path = Path(tmp_dir)
        input_csv_path = tmp_path / "harmonization.csv"
        validation_csv_path = tmp_path / "validation_report.csv"
        output_csv_path = tmp_path / "cleaned.csv"

        input_csv_path.write_bytes(await harmonization_csv.read())

        report_path: Path | None = None
        if validation_report_csv and validation_report_csv.filename:
            suffix = Path(validation_report_csv.filename).suffix.lower()
            validation_csv_path = tmp_path / ("validation_report.json" if suffix == ".json" else "validation_report.csv")
            validation_csv_path.write_bytes(await validation_report_csv.read())
            report_path = validation_csv_path

        try:
            summary = run_cleanser(
                dataset_csv_path=input_csv_path,
                validation_report_csv_path=report_path,
                output_csv_path=output_csv_path,
            )
            cleaned_data = parse_cleaned_csv(output_csv_path)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Cleanser failed: {exc}") from exc

    return {
        "success": True,
        "summary": summary,
        "cleaned": cleaned_data,
    }


@router.post("/save")
async def cleanser_save(req: SaveRequest):
    client = supabase_service.get_client()
    try:
        # Fetch Object ID
        res_obj = client.table("sf_objects").select("id").ilike("name", req.target_object).execute()
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
