"""
FastAPI Router for the Harmonization Agent.

Provides endpoints to:
  - POST /harmonize       : Upload files and run harmonization (Single & Multi Upload Mode)
  - POST /harmonize/flow  : Flow mode (data from DB)
  - POST /harmonize/multi-flow : Multi-source (primary from DB + secondary upload)
  - POST /harmonize/generate-dynamic-rules : LLM-generate dynamic transform rules (1 call)
  - GET  /harmonize/download/<id> : Download the final CSV result
"""

import io
import os
import json
import uuid
import logging
import re
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, File, Form, UploadFile, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import pandas as pd

from services.supabase_client import supabase_service
from agents.harmonization_agent import (
    HarmonizationAgent,
    HarmonizationConfig,
    parse_data_from_upload,
    parse_mapping_from_upload,
    MappingEntry
)

logger = logging.getLogger(__name__)

router = APIRouter()

# In-memory session store for download results (simple approach)
_session_store: dict = {}


def _collect_custom_prompts(rule_config: Optional[Dict[str, Any]], custom_prompts: Optional[List[str]]) -> List[str]:
    """Collect custom instructions from rule_config and combine with custom_prompts."""
    prompts = list(custom_prompts) if custom_prompts else []
    if rule_config:
        for rule_key, cfg in rule_config.items():
            if isinstance(cfg, dict) and cfg.get("enabled", True):
                cust_inst = cfg.get("custom_instruction")
                if cust_inst and str(cust_inst).strip():
                    prompts.append(f"Rule [{rule_key}]: {str(cust_inst).strip()}")
    return prompts


@router.post("/harmonize")
async def run_harmonization(
    mode: str = Form(...),
    sap_object: str = Form("Biographical Info"),
    company_code: str = Form("1000"),
    sales_org: str = Form("1000"),
    purch_org: str = Form("1000"),
    plant: str = Form("1000"),
    dist_channel: str = Form("10"),
    division: str = Form("00"),
    currency: str = Form("INR"),
    primary_source: str = Form("SAP_ECC"),
    secondary_source: str = Form("ORACLE_EBS"),
    primary_file: UploadFile = File(...),
    secondary_file: Optional[UploadFile] = File(None),
    primary_mapping_file: Optional[UploadFile] = File(None),
    secondary_mapping_file: Optional[UploadFile] = File(None),
    preview: str = Form("false"),
    rule_config_json: str = Form(""),
    custom_prompts_json: str = Form(""),
):
    try:
        config = HarmonizationConfig(
            sap_object=sap_object.upper(),
            company_code=company_code,
        )
        agent = HarmonizationAgent(config)

        is_preview = preview.lower() == "true"

        rule_config = None
        if rule_config_json:
            try:
                rule_config = json.loads(rule_config_json)
            except Exception:
                pass

        custom_prompts = None
        if custom_prompts_json:
            try:
                custom_prompts = json.loads(custom_prompts_json)
            except Exception:
                pass

        primary_content = await primary_file.read()
        primary_df = parse_data_from_upload(primary_content, primary_file.filename or "data.csv")

        # Collect custom instructions for fallback LLM generator
        all_prompts = _collect_custom_prompts(rule_config, custom_prompts)
        dynamic_rules = None
        if all_prompts:
            actual_columns = list(primary_df.columns)
            dynamic_rules = _generate_dynamic_rules_internal(all_prompts, sap_object, actual_columns)

        if mode == "single":
            primary_mappings = None
            if primary_mapping_file and primary_mapping_file.filename:
                pm_content = await primary_mapping_file.read()
                primary_mappings = parse_mapping_from_upload(
                    pm_content, primary_mapping_file.filename or "mapping.csv"
                )
            result = agent.run_single_source(
                primary_df, primary_mappings,
                primary_source=primary_source,
                preview_only=is_preview,
                rule_config=rule_config,
                dynamic_rules=dynamic_rules,
            )

        elif mode == "multi":
            if not secondary_file or not secondary_file.filename:
                raise HTTPException(400, "Secondary file is required for multi mode")
            secondary_content = await secondary_file.read()
            secondary_df = parse_data_from_upload(
                secondary_content, secondary_file.filename or "data.csv"
            )

            if not primary_mapping_file or not primary_mapping_file.filename:
                raise HTTPException(400, "Primary mapping file is required for multi mode")
            pm_content = await primary_mapping_file.read()
            primary_mappings = parse_mapping_from_upload(
                pm_content, primary_mapping_file.filename or "mapping.csv"
            )

            if not secondary_mapping_file or not secondary_mapping_file.filename:
                raise HTTPException(400, "Secondary mapping file is required for multi mode")
            sm_content = await secondary_mapping_file.read()
            secondary_mappings = parse_mapping_from_upload(
                sm_content, secondary_mapping_file.filename or "mapping.csv"
            )

            result = agent.run_multi_source(
                primary_df, secondary_df, primary_mappings, secondary_mappings,
                primary_source=primary_source, secondary_source=secondary_source,
                preview_only=is_preview,
                rule_config=rule_config,
                dynamic_rules=dynamic_rules,
            )
        else:
            raise HTTPException(400, f"Invalid mode: {mode}. Must be 'single' or 'multi'")

        session_id = str(uuid.uuid4())
        if not result.final_table.empty:
            _session_store[session_id] = result.final_table

        final_rows = result.final_table.fillna("").to_dict(orient="records") if not result.final_table.empty else []
        columns = list(result.final_table.columns) if not result.final_table.empty else []

        return {
            "session_id": session_id,
            "final_table": final_rows,
            "columns": columns,
            "stats": result.stats,
            "fix_log": result.fix_log,
            "is_preview": is_preview,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Harmonization failed")
        raise HTTPException(500, f"Harmonization failed: {str(e)}")


class HarmonizeFlowRequest(BaseModel):
    project_id: str
    sap_object: str = "Biographical Info"
    company_code: str = "1000"
    sales_org: str = "1000"
    purch_org: str = "1000"
    plant: str = "1000"
    dist_channel: str = "10"
    division: str = "00"
    currency: str = "INR"
    primary_source: str = "SAP_ECC"
    preview: bool = False
    rule_config: Optional[Dict[str, Any]] = None
    custom_prompts: Optional[List[str]] = None

@router.post("/harmonize/flow")
def run_harmonization_flow(req: HarmonizeFlowRequest):
    try:
        client = supabase_service.get_client()
        config = HarmonizationConfig(
            sap_object=req.sap_object.upper(),
            company_code=req.company_code,
        )
        agent = HarmonizationAgent(config)

        # Get object_id
        res_obj = client.table("sf_objects").select("id").ilike("name", req.sap_object).execute()
        if not res_obj.data:
            res_obj = client.table("sf_objects").select("id").ilike("name", "Biographical Info").execute()
        if not res_obj.data:
            raise HTTPException(400, f"SuccessFactors object '{req.sap_object}' not found")
        object_id = res_obj.data[0]["id"]

        # 1. Fetch Extracted Data from DB
        res_data = client.table("extracted_data").select("payload").eq("project_id", req.project_id).eq("object_id", object_id).execute()
        if not res_data.data:
            raise HTTPException(400, "No extracted data found for this project and object in the database.")
        
        extracted_payload = res_data.data[0]["payload"]
        if not extracted_payload:
            raise HTTPException(400, "Extracted data payload is empty.")
            
        if isinstance(extracted_payload, dict):
            extracted_rows = extracted_payload.get("rows", [])
            extracted_tables = extracted_payload.get("tables", [])
        elif isinstance(extracted_payload, list):
            extracted_rows = extracted_payload
            extracted_tables = []
        else:
            raise HTTPException(400, "Invalid extracted data format in database.")
            
        if not extracted_rows:
            raise HTTPException(400, "Extracted data records are empty.")

        primary_df = pd.DataFrame(extracted_rows)

        # 2. Fetch User Corrected Mappings from DB
        res_map = client.table("user_corrected_mappings").select("source_field_name, transform_rule, confidence, sf_fields(sf_structure, field_name)").eq("project_id", req.project_id).execute()
        if not res_map.data:
            raise HTTPException(400, "No user corrected mappings found in the database for this project.")

        primary_mappings = []
        for m in res_map.data:
            sf_field = m.get("sf_fields")
            if not sf_field:
                continue
            sf_str = f"{sf_field.get('sf_structure', '')}.{sf_field.get('field_name', '')}" if sf_field.get('sf_structure') else sf_field.get('field_name', '')
            raw_src = m.get("source_field_name", "")
            clean_src = re.sub(r"^\[\d+\]", "", raw_src)
            primary_mappings.append(MappingEntry(
                src=clean_src,
                sap=sf_str,
                transform=m.get("transform_rule", "none"),
                confidence=int(m.get("confidence", 100))
            ))

        if not primary_mappings:
            raise HTTPException(400, "No valid mappings could be constructed from the database.")

        # 3. Generate dynamic rules from custom prompts / custom instructions (single LLM call fallback)
        all_prompts = _collect_custom_prompts(req.rule_config, req.custom_prompts)
        dynamic_rules = None
        if all_prompts:
            actual_columns = list(primary_df.columns)
            dynamic_rules = _generate_dynamic_rules_internal(all_prompts, req.sap_object, actual_columns)

        # Query stored active dynamic rules from DB if project_id and object specified
        stored_rules = []
        try:
            res_obj = client.table("sf_objects").select("id").ilike("name", req.sap_object).execute()
            if res_obj.data:
                object_id = res_obj.data[0]["id"]
                res_rules = client.table("dynamic_rules").select("payload").eq("project_id", req.project_id).eq("object_id", object_id).order("created_at", desc=True).limit(1).execute()
                if res_rules.data and isinstance(res_rules.data[0].get("payload"), list):
                    stored_rules = [r for r in res_rules.data[0]["payload"] if isinstance(r, dict) and r.get("enabled", True) is not False]
        except Exception:
            pass

        if stored_rules:
            if dynamic_rules is None:
                dynamic_rules = stored_rules
            else:
                dynamic_rules.extend(stored_rules)

        # 4. Run Agent
        result = agent.run_single_source(
            primary_df, primary_mappings,
            primary_source=req.primary_source,
            preview_only=req.preview,
            rule_config=req.rule_config,
            dynamic_rules=dynamic_rules,
        )

        # Store result for download
        session_id = str(uuid.uuid4())
        if not result.final_table.empty:
            _session_store[session_id] = result.final_table

        final_rows = result.final_table.fillna("").to_dict(orient="records") if not result.final_table.empty else []
        columns = list(result.final_table.columns) if not result.final_table.empty else []

        return {
            "session_id": session_id,
            "final_table": final_rows,
            "columns": columns,
            "tables": extracted_tables,
            "stats": result.stats,
            "fix_log": result.fix_log,
            "is_preview": req.preview,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Harmonization flow failed")
        raise HTTPException(500, f"Harmonization flow failed: {str(e)}")


@router.post("/harmonize/multi-flow")
async def run_harmonization_multi_flow(
    project_id: str = Form(...),
    sap_object: str = Form("Biographical Info"),
    company_code: str = Form("1000"),
    sales_org: str = Form("1000"),
    purch_org: str = Form("1000"),
    plant: str = Form("1000"),
    dist_channel: str = Form("10"),
    division: str = Form("00"),
    currency: str = Form("INR"),
    primary_source: str = Form("SAP_ECC"),
    secondary_source: str = Form("ORACLE_EBS"),
    secondary_file: UploadFile = File(...),
    secondary_mapping_file: UploadFile = File(...),
    preview: str = Form("false"),
    rule_config_json: str = Form(""),
    custom_prompts_json: str = Form(""),
):
    """
    Multi-source harmonization with primary data from DB and secondary data uploaded.
    Supports preview mode, editable rule config, and dynamic AI rules.
    """
    try:
        client = supabase_service.get_client()

        config = HarmonizationConfig(
            sap_object=sap_object.upper(),
            company_code=company_code,
        )
        agent = HarmonizationAgent(config)

        is_preview = preview.lower() == "true"

        rule_config = None
        if rule_config_json:
            try:
                rule_config = json.loads(rule_config_json)
            except Exception:
                pass

        custom_prompts = None
        if custom_prompts_json:
            try:
                custom_prompts = json.loads(custom_prompts_json)
            except Exception:
                pass

        # Get object_id
        res_obj = client.table("sf_objects").select("id").ilike("name", sap_object).execute()
        if not res_obj.data:
            res_obj = client.table("sf_objects").select("id").ilike("name", "Biographical Info").execute()
        if not res_obj.data:
            raise HTTPException(400, f"SuccessFactors object '{sap_object}' not found")
        object_id = res_obj.data[0]["id"]

        # 1. Fetch Primary Data from DB
        res_data = client.table("extracted_data").select("payload").eq("project_id", project_id).eq("object_id", object_id).execute()
        if not res_data.data:
            raise HTTPException(400, "No extracted data found. Please extract and save data in Step 3 first.")

        extracted_payload = res_data.data[0]["payload"]
        if not extracted_payload:
            raise HTTPException(400, "Extracted data payload is empty.")

        if isinstance(extracted_payload, dict):
            extracted_rows = extracted_payload.get("rows", [])
            extracted_tables = extracted_payload.get("tables", [])
        elif isinstance(extracted_payload, list):
            extracted_rows = extracted_payload
            extracted_tables = []
        else:
            raise HTTPException(400, "Invalid extracted data format in database.")

        if not extracted_rows:
            raise HTTPException(400, "Extracted data records are empty.")

        primary_df = pd.DataFrame(extracted_rows)

        # 2. Fetch Primary Mappings from DB
        res_map = client.table("user_corrected_mappings").select(
            "source_field_name, transform_rule, confidence, sf_fields(sf_structure, field_name)"
        ).eq("project_id", project_id).execute()
        if not res_map.data:
            raise HTTPException(400, "No user corrected mappings found in the database for this project.")

        primary_mappings = []
        for m in res_map.data:
            sf_field = m.get("sf_fields")
            if not sf_field:
                continue
            sf_str = f"{sf_field.get('sf_structure', '')}.{sf_field.get('field_name', '')}" if sf_field.get('sf_structure') else sf_field.get('field_name', '')
            raw_src = m.get("source_field_name", "")
            clean_src = re.sub(r"^\[\d+\]", "", raw_src)
            primary_mappings.append(MappingEntry(
                src=clean_src,
                sap=sf_str,
                transform=m.get("transform_rule", "none"),
                confidence=int(m.get("confidence", 100))
            ))

        if not primary_mappings:
            raise HTTPException(400, "No valid mappings could be constructed from the database.")

        # 3. Parse Secondary file + mapping from uploads
        if not secondary_file or not secondary_file.filename:
            raise HTTPException(400, "Secondary data file is required for multi mode")
        secondary_content = await secondary_file.read()
        secondary_df = parse_data_from_upload(secondary_content, secondary_file.filename or "data.csv")

        if not secondary_mapping_file or not secondary_mapping_file.filename:
            raise HTTPException(400, "Secondary mapping file is required for multi mode")
        sm_content = await secondary_mapping_file.read()
        secondary_mappings = parse_mapping_from_upload(sm_content, secondary_mapping_file.filename or "mapping.csv")

        # 4. Generate dynamic rules from custom prompts / custom instructions (single LLM call)
        all_prompts = _collect_custom_prompts(rule_config, custom_prompts)
        dynamic_rules = None
        if all_prompts:
            actual_columns = list(primary_df.columns)
            dynamic_rules = _generate_dynamic_rules_internal(all_prompts, sap_object, actual_columns)

        # 5. Run Multi-Source Agent
        result = agent.run_multi_source(
            primary_df, secondary_df, primary_mappings, secondary_mappings,
            primary_source=primary_source, secondary_source=secondary_source,
            preview_only=is_preview,
            rule_config=rule_config,
            dynamic_rules=dynamic_rules,
        )

        # Store result for download
        session_id = str(uuid.uuid4())
        if not result.final_table.empty:
            _session_store[session_id] = result.final_table

        final_rows = result.final_table.fillna("").to_dict(orient="records") if not result.final_table.empty else []
        columns = list(result.final_table.columns) if not result.final_table.empty else []

        return {
            "session_id": session_id,
            "final_table": final_rows,
            "columns": columns,
            "tables": extracted_tables,
            "stats": result.stats,
            "fix_log": result.fix_log,
            "is_preview": is_preview,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Multi-flow harmonization failed")
        raise HTTPException(500, f"Multi-flow harmonization failed: {str(e)}")


# ══════════════════════════════════════════════════════════
# Dynamic AI Harmonization Rules — LLM Generation (Single Call)
# ══════════════════════════════════════════════════════════

def _generate_dynamic_rules_internal(
    prompts: List[str],
    target_object: str,
    actual_columns: List[str],
) -> List[Dict[str, Any]]:
    """
    Generate dynamic harmonization transform rules from natural language prompts.
    Uses LLMOrchestrator (Gemini / Groq / OpenRouter fallback chain).
    Single LLM call for all prompts → returns a JSON array of rules.
    """
    from services.llm_orchestrator import llm_orchestrator

    system_prompt = f"""You are a Python code generator for SuccessFactors data harmonization transforms.

The dataset has ONLY these exact columns: {actual_columns}
SuccessFactors Object: {target_object}

For each user rule prompt:
1. First, check if the rule prompt applies to any of the actual dataset columns listed above.
2. CRITICAL: If the concept, field, or data type described in the rule prompt (e.g. quantity, weight, price, tax number, etc.) DOES NOT exist in the dataset columns ({actual_columns}), DO NOT generate a transform. Set `target_field: ""` and `python_code: ""`.
3. NEVER map quantity/weight rules to currency (WAERS), country (LAND1), name, or phone columns.
4. IF a matching column exists in the dataset, generate a Python transform function: `def transform(value, row): -> str`
   - `value`: the current cell value (string) of the target field
   - `row`: a dict of ALL columns for the current row (all values are strings)
   - Returns: the new value (string)

Return a JSON array where each element has:
{{
  "id": "DYNAMIC_HARM_<N>",
  "label": "<short title>",
  "description": "<what it does>",
  "target_field": "<EXACT column name from the dataset columns listed above, or empty string if no relevant column exists>",
  "python_code": "def transform(value, row):\\n    ..."
}}

CRITICAL RULES:
1. target_field MUST be an EXACT column name from: {actual_columns}.
2. If no column in {actual_columns} matches the rule intent (e.g. quantity rule when no quantity/UOM columns exist), set `target_field: ""` and `python_code: ""`.
3. `python_code` must be a COMPLETE function definition starting with `def transform(value, row):`.
4. Return ONLY the JSON array, no markdown, no explanation."""

    user_msg = "Generate transform functions for these rules:\n"
    for i, p in enumerate(prompts, 1):
        user_msg += f"{i}. {p}\n"

    try:
        rules = llm_orchestrator.execute_json_prompt(system_prompt, user_msg)
        if not isinstance(rules, list):
            rules = [rules]

        logger.info(f"Generated {len(rules)} dynamic harmonization rules from {len(prompts)} prompts via LLMOrchestrator")
        return rules

    except Exception as e:
        logger.exception(f"Failed to generate dynamic harmonization rules: {e}")
        return []


class GenerateHarmonizationRulesRequest(BaseModel):
    prompts: List[str]
    target_object: str = "Biographical Info"
    actual_columns: Optional[List[str]] = None

@router.post("/harmonize/generate-dynamic-rules")
def generate_dynamic_rules(req: GenerateHarmonizationRulesRequest):
    """Generate dynamic harmonization rules from natural language prompts (1 LLM call for all)."""
    if not req.prompts:
        raise HTTPException(400, "No prompts provided")

    actual_cols = req.actual_columns or []
    rules = _generate_dynamic_rules_internal(req.prompts, req.target_object, actual_cols)

    return {"rules": rules, "count": len(rules)}


@router.get("/harmonize/download/{session_id}")
async def download_result(session_id: str):
    """Download the harmonized result as a CSV file."""
    if session_id not in _session_store:
        raise HTTPException(404, "Session not found. Please run harmonization again.")

    df = _session_store[session_id]
    csv_buffer = io.StringIO()
    df.to_csv(csv_buffer, index=False)
    csv_buffer.seek(0)

    return StreamingResponse(
        io.BytesIO(csv_buffer.getvalue().encode("utf-8")),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=harmonized_output.csv"},
    )


class SaveHarmonizedRequest(BaseModel):
    project_id: str
    target_object: str
    payload: list
    tables: Optional[list] = None

@router.post("/harmonize/save")
def save_harmonized_data(req: SaveHarmonizedRequest):
    try:
        client = supabase_service.get_client()
        res_obj = client.table("sf_objects").select("id").ilike("name", req.target_object).execute()
        if not res_obj.data:
            res_obj = client.table("sf_objects").select("id").ilike("name", "Biographical Info").execute()
            if not res_obj.data:
                raise HTTPException(400, f"SuccessFactors object '{req.target_object}' not found")
        
        obj_id = res_obj.data[0]["id"]
        
        # Delete old harmonized data if any
        client.table("harmonized_data") \
            .delete() \
            .eq("project_id", req.project_id) \
            .eq("object_id", obj_id) \
            .execute()
        
        stored_payload = {
            "rows": req.payload,
            "tables": req.tables or []
        } if req.tables else req.payload

        client.table("harmonized_data").insert({
            "project_id": req.project_id,
            "object_id": obj_id,
            "payload": stored_payload
        }).execute()
        
        return {"status": "success"}
    except Exception as e:
        logger.exception("Save harmonized data failed")
        raise HTTPException(500, f"Failed to save data: {str(e)}")
