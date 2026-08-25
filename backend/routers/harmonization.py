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
from agents.extract_agent import ExtractAgent
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
    secondary_files: List[UploadFile] = File(default=[]),
    secondary_mapping_files: List[UploadFile] = File(default=[]),
    secondary_file: Optional[UploadFile] = File(None),
    primary_mapping_file: Optional[UploadFile] = File(None),
    secondary_mapping_file: Optional[UploadFile] = File(None),
    join_configs_json: str = Form("[]"),
    base_table_name: Optional[str] = Form(None),
    preview: str = Form("false"),
    rule_config_json: str = Form(""),
    custom_prompts_json: str = Form(""),
    dynamic_rules_json: str = Form(""),
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

        dynamic_rules_list = []
        if dynamic_rules_json:
            try:
                dynamic_rules_list = json.loads(dynamic_rules_json)
                if not isinstance(dynamic_rules_list, list):
                    dynamic_rules_list = [dynamic_rules_list]
            except Exception:
                pass

        primary_content = await primary_file.read()
        primary_df = parse_data_from_upload(primary_content, primary_file.filename or "data.csv")

        # Collect custom instructions for fallback LLM generator
        all_prompts = _collect_custom_prompts(rule_config, custom_prompts)

        if mode == "single":
            primary_mappings = None
            if primary_mapping_file and primary_mapping_file.filename:
                pm_content = await primary_mapping_file.read()
                primary_mappings = parse_mapping_from_upload(
                    pm_content, primary_mapping_file.filename or "mapping.csv"
                )

            mapped_df_preview = agent._apply_mapping(primary_df.head(2), primary_mappings or [])
            actual_columns = list(mapped_df_preview.columns)

            dynamic_rules = list(dynamic_rules_list) if dynamic_rules_list else []
            if all_prompts:
                compiled = _generate_dynamic_rules_internal(all_prompts, sap_object, actual_columns)
                dynamic_rules.extend(compiled)

            result = agent.run_single_source(
                primary_df, primary_mappings,
                primary_source=primary_source,
                preview_only=is_preview,
                rule_config=rule_config,
                dynamic_rules=dynamic_rules,
            )

        elif mode == "multi":
            primary_mappings = None
            if primary_mapping_file and primary_mapping_file.filename:
                pm_content = await primary_mapping_file.read()
                primary_mappings = parse_mapping_from_upload(
                    pm_content, primary_mapping_file.filename or "mapping.csv"
                )

            # Collect all secondary files
            all_sec_files = list(secondary_files) if secondary_files else []
            if secondary_file and secondary_file.filename and secondary_file not in all_sec_files:
                all_sec_files.append(secondary_file)

            if not all_sec_files:
                raise HTTPException(400, "At least one secondary file is required for multi mode")

            # Collect secondary mapping files
            all_map_files = list(secondary_mapping_files) if secondary_mapping_files else []
            if secondary_mapping_file and secondary_mapping_file.filename and secondary_mapping_file not in all_map_files:
                all_map_files.append(secondary_mapping_file)

            mapping_by_target: Dict[str, List[MappingEntry]] = {}
            for mf in all_map_files:
                if not mf.filename:
                    continue
                mf_content = await mf.read()
                m_entries = parse_mapping_from_upload(mf_content, mf.filename)
                mapping_by_target[mf.filename] = m_entries
                stem = mf.filename.replace("_mapping.csv", "").replace("_map.csv", "").replace(".csv", "")
                mapping_by_target[stem] = m_entries

            # Join configs
            join_configs = []
            if join_configs_json:
                try:
                    join_configs = json.loads(join_configs_json)
                    if not isinstance(join_configs, list):
                        join_configs = [join_configs]
                except Exception:
                    pass

            secondary_tables = []
            for sf in all_sec_files:
                if not sf.filename:
                    continue
                sf_content = await sf.read()
                sf_df = parse_data_from_upload(sf_content, sf.filename)
                sf_stem = sf.filename.replace(".csv", "").replace(".xlsx", "").replace(".xls", "")
                matched_mapping = (
                    mapping_by_target.get(sf.filename)
                    or mapping_by_target.get(sf_stem)
                    or (all_map_files and len(all_map_files) == 1 and mapping_by_target.get(all_map_files[0].filename, []))
                    or []
                )
                for cfg in join_configs:
                    if cfg.get("file_name") == sf.filename and cfg.get("mapping_file"):
                        m_name = cfg["mapping_file"]
                        if m_name in mapping_by_target:
                            matched_mapping = mapping_by_target[m_name]

                secondary_tables.append({
                    "name": sf.filename,
                    "df": sf_df,
                    "mappings": matched_mapping,
                    "source": secondary_source,
                })

            mapped_df_preview = agent._apply_mapping(primary_df.head(2), primary_mappings or [])
            actual_columns = list(mapped_df_preview.columns)

            dynamic_rules = list(dynamic_rules_list) if dynamic_rules_list else []
            if all_prompts:
                compiled = _generate_dynamic_rules_internal(all_prompts, sap_object, actual_columns)
                dynamic_rules.extend(compiled)

            result = agent.run_multi_source(
                primary_df=primary_df,
                primary_mappings=primary_mappings,
                primary_source=primary_source,
                secondary_tables=secondary_tables,
                join_configs=join_configs,
                base_table_name=base_table_name or primary_file.filename,
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

        # Build Harmonized Table Structure with SuccessFactors Column Names
        try:
            extract_agent = ExtractAgent()
            sample_for_grouping = final_rows if final_rows else (mapped_df_preview.fillna("").to_dict(orient="records") if not mapped_df_preview.empty else [])
            harmonized_tables = extract_agent.group_records_by_sap_structure(
                harmonized_results=sample_for_grouping,
                target_object=sap_object,
                mappings=primary_mappings or []
            )
        except Exception as e:
            logger.warning(f"Could not group harmonized records into SF tables: {e}")
            harmonized_tables = []

        if not harmonized_tables:
            harmonized_tables = [{
                "table_name": f"{sap_object} Data",
                "columns": columns if columns else actual_columns,
                "row_count": len(final_rows)
            }]

        return {
            "session_id": session_id,
            "final_table": final_rows,
            "columns": columns,
            "tables": harmonized_tables,
            "stats": result.stats,
            "fix_log": result.fix_log,
            "dynamic_rules": dynamic_rules or [],
            "custom_prompts": all_prompts or [],
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
    dynamic_rules: Optional[List[Dict[str, Any]]] = None

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

        # 3. Determine dynamic rules to execute
        mapped_df_preview = agent._apply_mapping(primary_df.head(2), primary_mappings)
        actual_columns = list(mapped_df_preview.columns)

        # 1. Start with the client-supplied dynamic rules (which are the selected/checked rules)
        dynamic_rules = list(req.dynamic_rules) if req.dynamic_rules else []

        # 2. Compile any custom prompts or inline custom instructions if provided
        all_prompts = _collect_custom_prompts(req.rule_config, req.custom_prompts)
        if all_prompts:
            compiled = _generate_dynamic_rules_internal(all_prompts, req.sap_object, actual_columns)
            dynamic_rules.extend(compiled)

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

        # 5. Build Harmonized Table Structure with SuccessFactors Column Names
        try:
            extract_agent = ExtractAgent()
            sample_for_grouping = final_rows if final_rows else (mapped_df_preview.fillna("").to_dict(orient="records") if not mapped_df_preview.empty else [])
            harmonized_tables = extract_agent.group_records_by_sap_structure(
                harmonized_results=sample_for_grouping,
                target_object=req.sap_object,
                mappings=primary_mappings
            )
        except Exception as e:
            logger.warning(f"Could not group harmonized records into SF tables: {e}")
            harmonized_tables = []

        if not harmonized_tables:
            harmonized_tables = [{
                "table_name": f"{req.sap_object} Data",
                "columns": columns if columns else actual_columns,
                "row_count": len(final_rows)
            }]

        return {
            "session_id": session_id,
            "final_table": final_rows,
            "columns": columns,
            "tables": harmonized_tables,
            "stats": result.stats,
            "fix_log": result.fix_log,
            "dynamic_rules": dynamic_rules or [],
            "custom_prompts": all_prompts or [],
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
    secondary_files: List[UploadFile] = File(default=[]),
    secondary_mapping_files: List[UploadFile] = File(default=[]),
    secondary_file: Optional[UploadFile] = File(None),
    secondary_mapping_file: Optional[UploadFile] = File(None),
    join_configs_json: str = Form("[]"),
    base_table_name: Optional[str] = Form(None),
    preview: str = Form("false"),
    rule_config_json: str = Form(""),
    custom_prompts_json: str = Form(""),
    dynamic_rules_json: str = Form(""),
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

        dynamic_rules_list = []
        if dynamic_rules_json:
            try:
                dynamic_rules_list = json.loads(dynamic_rules_json)
                if not isinstance(dynamic_rules_list, list):
                    dynamic_rules_list = [dynamic_rules_list]
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

        # 3. Parse Secondary files & mapping files from uploads
        all_sec_files = list(secondary_files) if secondary_files else []
        if secondary_file and secondary_file.filename and secondary_file not in all_sec_files:
            all_sec_files.append(secondary_file)

        if not all_sec_files:
            raise HTTPException(400, "At least one secondary data file is required for multi mode")

        all_map_files = list(secondary_mapping_files) if secondary_mapping_files else []
        if secondary_mapping_file and secondary_mapping_file.filename and secondary_mapping_file not in all_map_files:
            all_map_files.append(secondary_mapping_file)

        mapping_by_target: Dict[str, List[MappingEntry]] = {}
        for mf in all_map_files:
            if not mf.filename:
                continue
            mf_content = await mf.read()
            m_entries = parse_mapping_from_upload(mf_content, mf.filename)
            mapping_by_target[mf.filename] = m_entries
            stem = mf.filename.replace("_mapping.csv", "").replace("_map.csv", "").replace(".csv", "")
            mapping_by_target[stem] = m_entries

        join_configs = []
        if join_configs_json:
            try:
                join_configs = json.loads(join_configs_json)
                if not isinstance(join_configs, list):
                    join_configs = [join_configs]
            except Exception:
                pass

        secondary_tables = []
        for sf in all_sec_files:
            if not sf.filename:
                continue
            sf_content = await sf.read()
            sf_df = parse_data_from_upload(sf_content, sf.filename)
            sf_stem = sf.filename.replace(".csv", "").replace(".xlsx", "").replace(".xls", "")
            matched_mapping = (
                mapping_by_target.get(sf.filename)
                or mapping_by_target.get(sf_stem)
                or (all_map_files and len(all_map_files) == 1 and mapping_by_target.get(all_map_files[0].filename, []))
                or []
            )
            for cfg in join_configs:
                if cfg.get("file_name") == sf.filename and cfg.get("mapping_file"):
                    m_name = cfg["mapping_file"]
                    if m_name in mapping_by_target:
                        matched_mapping = mapping_by_target[m_name]

            secondary_tables.append({
                "name": sf.filename,
                "df": sf_df,
                "mappings": matched_mapping,
                "source": secondary_source,
            })

        # 4. Determine post-mapping SF columns for dynamic rules
        mapped_df_preview = agent._apply_mapping(primary_df.head(2), primary_mappings)
        actual_columns = list(mapped_df_preview.columns)

        # 1. Start with the client-supplied dynamic rules (which are the selected/checked rules)
        dynamic_rules = list(dynamic_rules_list) if dynamic_rules_list else []

        # 2. Compile any custom prompts or inline custom instructions if provided
        all_prompts = _collect_custom_prompts(rule_config, custom_prompts)
        if all_prompts:
            compiled = _generate_dynamic_rules_internal(all_prompts, sap_object, actual_columns)
            dynamic_rules.extend(compiled)

        # 5. Run Multi-Source Agent with Relational Merge
        result = agent.run_multi_source(
            primary_df=primary_df,
            primary_mappings=primary_mappings,
            primary_source=primary_source,
            secondary_tables=secondary_tables,
            join_configs=join_configs,
            base_table_name=base_table_name or "Primary Data",
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

        # Build Harmonized Table Structure with SuccessFactors Column Names
        try:
            extract_agent = ExtractAgent()
            sample_for_grouping = final_rows if final_rows else (mapped_df_preview.fillna("").to_dict(orient="records") if not mapped_df_preview.empty else [])
            harmonized_tables = extract_agent.group_records_by_sap_structure(
                harmonized_results=sample_for_grouping,
                target_object=sap_object,
                mappings=primary_mappings
            )
        except Exception as e:
            logger.warning(f"Could not group harmonized records into SF tables: {e}")
            harmonized_tables = []

        if not harmonized_tables:
            harmonized_tables = [{
                "table_name": f"{sap_object} Data",
                "columns": columns if columns else actual_columns,
                "row_count": len(final_rows)
            }]

        return {
            "session_id": session_id,
            "final_table": final_rows,
            "columns": columns,
            "tables": harmonized_tables,
            "stats": result.stats,
            "fix_log": result.fix_log,
            "dynamic_rules": dynamic_rules or [],
            "custom_prompts": all_prompts or [],
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

    cols_hint = f"Exact columns in dataset: {actual_columns}" if actual_columns else f"Target Object: {target_object}"

    system_prompt = f"""You are an AI code generator for SuccessFactors data harmonization transforms.

{cols_hint}
SuccessFactors Target Object: {target_object}

For each user rule prompt:
Generate a Python transform function: `def transform(value, row): -> str`
- `value`: the current cell value (string) of the target field
- `row`: a dict of ALL columns for the current row (all values are strings)
- Returns: the new value (string)

Return a JSON array where each element has:
{{
  "id": "DYNAMIC_HARM_<N>",
  "label": "<short descriptive title of the rule>",
  "description": "<detailed rule description>",
  "target_field": "<target column name from the dataset or object>",
  "python_code": "def transform(value, row):\\n    ..."
}}

CRITICAL RULES:
1. `target_field` MUST be a relevant field name from the dataset columns or target object.
2. `python_code` must be a COMPLETE, VALID Python function starting with `def transform(value, row):`.
3. Return ONLY the JSON array, no markdown wrappers."""

    user_msg = "Generate transform functions for these rules:\n"
    for i, p in enumerate(prompts, 1):
        user_msg += f"{i}. {p}\n"

    import uuid
    try:
        rules = llm_orchestrator.execute_json_prompt(system_prompt, user_msg)
        if not isinstance(rules, list):
            rules = [rules] if isinstance(rules, dict) else []

        cleaned_rules = []
        for idx, r in enumerate(rules, 1):
            if not isinstance(r, dict):
                continue
            rule_id = r.get("id")
            if not rule_id or "DYNAMIC" not in str(rule_id):
                rule_id = f"DYNAMIC_HARM_{uuid.uuid4().hex[:8]}"
            prompt_str = prompts[min(idx - 1, len(prompts) - 1)] if prompts else ""

            tf = str(r.get("target_field") or "").strip()
            if not tf and actual_columns:
                tf = actual_columns[0]
            elif not tf:
                tf = target_object

            py_code = str(r.get("python_code") or "").strip()
            if not py_code:
                py_code = "def transform(value, row):\n    return value"

            cleaned_rules.append({
                "id": rule_id,
                "label": r.get("label") or f"Rule: {prompt_str[:30]}",
                "description": r.get("description") or prompt_str,
                "target_field": tf,
                "python_code": py_code,
                "enabled": r.get("enabled", True),
            })

        logger.info(f"Generated {len(cleaned_rules)} dynamic harmonization rules from {len(prompts)} prompts via LLMOrchestrator")
        return cleaned_rules

    except Exception as e:
        logger.exception(f"Failed to generate dynamic harmonization rules: {e}")
        # Fallback: create basic rule placeholders so prompts are not lost
        fallback_rules = []
        import uuid
        for p in prompts:
            fallback_rules.append({
                "id": f"DYNAMIC_HARM_{uuid.uuid4().hex[:8]}",
                "label": f"Rule: {p[:30]}",
                "description": p,
                "target_field": actual_columns[0] if actual_columns else target_object,
                "python_code": "def transform(value, row):\n    return value",
                "enabled": True,
            })
        return fallback_rules


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


class SaveHarmonizationDynamicRulesRequest(BaseModel):
    project_id: str
    target_object: str
    rules: Optional[List[Dict[str, Any]]] = None

@router.post("/harmonize/rules/save")
def save_harmonization_dynamic_rules(req: SaveHarmonizationDynamicRulesRequest):
    try:
        client = supabase_service.get_client()
        res_obj = client.table("sf_objects").select("id").ilike("name", req.target_object).execute()
        if not res_obj.data:
            res_obj = client.table("sf_objects").select("id").ilike("name", "Biographical Info").execute()
        if not res_obj.data:
            raise HTTPException(400, f"SuccessFactors object '{req.target_object}' not found")
        object_id = res_obj.data[0]["id"]

        # Delete old dynamic rules for this project/object
        del_res = client.table("dynamic_rules") \
            .delete() \
            .eq("project_id", req.project_id) \
            .eq("object_id", object_id) \
            .execute()

        insert_resp = None
        if req.rules:
            insert_resp = client.table("dynamic_rules").insert({
                "project_id": req.project_id,
                "object_id": object_id,
                "payload": req.rules
            }).execute()

        # Also persist to local store if available
        try:
            from services.cleanser_dynamic_rules import replace_rules_for_object
            replace_rules_for_object(req.rules or [], project_id=req.project_id, target_object=req.target_object, source="harmonization_dynamic_rule")
        except Exception:
            pass

        return {"status": "success", "message": "Harmonization dynamic rules saved to database."}
    except Exception as e:
        logger.error(f"Failed to save dynamic rules in harmonization: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to save dynamic rules: {str(e)}")


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
    dynamic_rules: Optional[list] = None
    custom_prompts: Optional[list] = None

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
        
        tagged_dynamic_rules = [
            {
                **r,
                "source": "harmonization_dynamic_rule",
                "phase": "harmonize",
                "id": r.get("id") if (r.get("id") and str(r.get("id")).startswith("DYNAMIC_HARM_")) else f"DYNAMIC_HARM_{r.get('id', uuid.uuid4().hex[:8])}"
            } if isinstance(r, dict) else r
            for r in (req.dynamic_rules or [])
        ]

        stored_payload = {
            "rows": req.payload,
            "tables": req.tables or [],
            "custom_prompts": req.custom_prompts or [],
            "dynamic_rules": tagged_dynamic_rules,
        } if (req.tables or req.custom_prompts or req.dynamic_rules is not None) else req.payload

        client.table("harmonized_data").insert({
            "project_id": req.project_id,
            "object_id": obj_id,
            "payload": stored_payload
        }).execute()

        # Update dynamic_rules table preserving other phase rules (validate/cleanser)
        if req.dynamic_rules is not None:
            try:
                res_dr = client.table("dynamic_rules").select("payload").eq("project_id", req.project_id).eq("object_id", obj_id).order("created_at", desc=True).limit(1).execute()
                existing_rules = res_dr.data[0]["payload"] if (res_dr.data and isinstance(res_dr.data[0].get("payload"), list)) else []
                other_rules = [
                    r for r in existing_rules
                    if isinstance(r, dict) and r.get("source") != "harmonization_dynamic_rule" and r.get("phase") != "harmonize" and not str(r.get("id", "")).startswith("DYNAMIC_HARM_")
                ]
                combined_rules = other_rules + tagged_dynamic_rules

                client.table("dynamic_rules").delete().eq("project_id", req.project_id).eq("object_id", obj_id).execute()
                if combined_rules:
                    client.table("dynamic_rules").insert({
                        "project_id": req.project_id,
                        "object_id": obj_id,
                        "payload": combined_rules
                    }).execute()
            except Exception as de:
                logger.warning(f"Could not persist dynamic_rules in database: {de}")
        
        return {"status": "success", "message": "Harmonized data and dynamic rules saved successfully"}
    except Exception as e:
        logger.exception("Save harmonized data failed")
        raise HTTPException(500, f"Failed to save data: {str(e)}")


class SaveHarmonizeRulesRequest(BaseModel):
    project_id: str
    target_object: str
    rules: Optional[List[Dict[str, Any]]] = None


@router.post("/harmonize/rules/save")
def save_harmonize_dynamic_rules(req: SaveHarmonizeRulesRequest):
    try:
        client = supabase_service.get_client()
        res_obj = client.table("sf_objects").select("id").ilike("name", req.target_object).execute()
        if not res_obj.data:
            res_obj = client.table("sf_objects").select("id").ilike("name", "Biographical Info").execute()
        if not res_obj.data:
            raise HTTPException(400, detail=f"SuccessFactors object '{req.target_object}' not found.")
        object_id = res_obj.data[0]["id"]

        tagged_rules = [
            {
                **r,
                "source": "harmonization_dynamic_rule",
                "phase": "harmonize",
                "id": r.get("id") if (r.get("id") and str(r.get("id")).startswith("DYNAMIC_HARM_")) else f"DYNAMIC_HARM_{r.get('id', uuid.uuid4().hex[:8])}"
            } if isinstance(r, dict) else r
            for r in (req.rules or [])
        ]

        # Update harmonized_data table payload if present so reload fetches the latest rules
        res_harm = client.table("harmonized_data").select("id, payload").eq("project_id", req.project_id).eq("object_id", object_id).order("created_at", desc=True).limit(1).execute()
        if res_harm.data:
            row_id = res_harm.data[0]["id"]
            raw_payload = res_harm.data[0].get("payload") or {}
            if isinstance(raw_payload, dict):
                raw_payload["dynamic_rules"] = tagged_rules
                client.table("harmonized_data").update({"payload": raw_payload}).eq("id", row_id).execute()
            elif isinstance(raw_payload, list):
                new_payload = {"rows": raw_payload, "dynamic_rules": tagged_rules}
                client.table("harmonized_data").update({"payload": new_payload}).eq("id", row_id).execute()

        # Update dynamic_rules table preserving other phase rules (validate/cleanser)
        res_dr = client.table("dynamic_rules").select("payload").eq("project_id", req.project_id).eq("object_id", object_id).order("created_at", desc=True).limit(1).execute()
        existing_rules = res_dr.data[0]["payload"] if (res_dr.data and isinstance(res_dr.data[0].get("payload"), list)) else []
        other_rules = [
            r for r in existing_rules
            if isinstance(r, dict) and (
                r.get("source") in ("validation_dynamic_rule", "cleanser_dynamic_rule")
                or r.get("phase") in ("validate", "cleanser")
                or str(r.get("id", "")).startswith("DYNAMIC_VAL_")
                or str(r.get("id", "")).startswith("DYNAMIC_CLS_")
            )
        ]
        combined_rules = other_rules + tagged_rules

        client.table("dynamic_rules").delete().eq("project_id", req.project_id).eq("object_id", object_id).execute()
        if combined_rules:
            client.table("dynamic_rules").insert({
                "project_id": req.project_id,
                "object_id": object_id,
                "payload": combined_rules
            }).execute()

        return {"status": "success", "message": "Harmonization dynamic rules saved successfully."}
    except Exception as e:
        logger.error(f"Failed to save dynamic rules in harmonize: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to save dynamic rules: {str(e)}")


@router.get("/harmonize/load/{project_id}")
def load_harmonized_data(project_id: str, target_object: Optional[str] = None):
    try:
        client = supabase_service.get_client()
        query = client.table("harmonized_data").select("*, sf_objects(name)").eq("project_id", project_id)
        if target_object:
            res_obj = client.table("sf_objects").select("id").ilike("name", target_object).execute()
            if res_obj.data:
                query = query.eq("object_id", res_obj.data[0]["id"])
                
        res = query.order("created_at", desc=True).limit(1).execute()
        if not res.data:
            return {"status": "not_found", "data": [], "tables": [], "dynamic_rules": [], "custom_prompts": []}
            
        raw_payload = res.data[0].get("payload")
        rows = []
        tables = []
        custom_prompts = []
        dynamic_rules = None
        if isinstance(raw_payload, dict):
            rows = raw_payload.get("rows", [])
            tables = raw_payload.get("tables", [])
            custom_prompts = raw_payload.get("custom_prompts", [])
            dynamic_rules = raw_payload.get("dynamic_rules")
        elif isinstance(raw_payload, list):
            rows = raw_payload

        # Only fallback to dynamic_rules table if not explicitly present in harmonized_data payload
        if dynamic_rules is None:
            try:
                obj_id = res.data[0].get("object_id")
                if obj_id:
                    res_dr = client.table("dynamic_rules").select("payload").eq("project_id", project_id).eq("object_id", obj_id).order("created_at", desc=True).limit(1).execute()
                    if res_dr.data and isinstance(res_dr.data[0].get("payload"), list):
                        dynamic_rules = res_dr.data[0]["payload"]
            except Exception:
                pass

        if not dynamic_rules:
            dynamic_rules = []

        # Filter strictly for harmonization dynamic rules
        harmonize_rules = [
            r for r in dynamic_rules
            if isinstance(r, dict) and (
                r.get("source") == "harmonization_dynamic_rule"
                or r.get("phase") == "harmonize"
                or str(r.get("id", "")).startswith("DYNAMIC_HARM_")
            )
        ]

        return {
            "status": "success",
            "data": rows,
            "tables": tables,
            "custom_prompts": custom_prompts,
            "dynamic_rules": harmonize_rules,
            "object_name": res.data[0].get("sf_objects", {}).get("name", target_object) if res.data[0].get("sf_objects") else target_object
        }
    except Exception as e:
        logger.error(f"Failed to load harmonized data: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to load harmonized data: {str(e)}")
