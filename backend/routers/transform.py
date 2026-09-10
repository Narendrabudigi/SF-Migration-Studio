from fastapi import APIRouter, File, Form, UploadFile, HTTPException
from pydantic import BaseModel
from typing import Annotated, Optional
from io import BytesIO
import pandas as pd

from services.supabase_client import supabase_service
from services.llm_orchestrator import LLMOrchestrator
from agents.transformation_agent import TransformationAgent
import json

router = APIRouter()

class SaveTransformRequest(BaseModel):
    project_id: str
    target_object: str
    payload: list

class AITransformRequest(BaseModel):
    project_id: str
    target_object: str
    prompt: str
    fallback_data: Optional[list] = None

@router.post("/apply-mappings")
async def apply_transform_mappings(
    project_id: Annotated[str, Form()],
    target_object: Annotated[str, Form()],
    file: UploadFile = File(...)
):
    try:
        contents = await file.read()
        if file.filename.endswith(".csv"):
            mapping_df = pd.read_csv(BytesIO(contents), dtype=str)
        elif file.filename.endswith(".xlsx") or file.filename.endswith(".xls"):
            mapping_df = pd.read_excel(BytesIO(contents), dtype=str)
        else:
            raise HTTPException(400, "Only CSV and Excel files are supported.")
        
        mapping_df.columns = mapping_df.columns.str.strip()
        
        required_cols = {"Source_Field", "Source_Data", "Target_Data"}
        if not required_cols.issubset(set(mapping_df.columns)):
            raise HTTPException(400, f"Uploaded file must contain exactly these columns: {required_cols}")
            
        mapping_rules = mapping_df.fillna("").to_dict(orient="records")
    except Exception as e:
        raise HTTPException(400, f"Error processing file: {str(e)}")

    client = supabase_service.get_client()

    # 2. Get Object ID from sf_objects
    res_obj = client.table("sf_objects").select("id").ilike("name", target_object).execute()
    if not res_obj.data:
        raise HTTPException(status_code=400, detail="Target object not found")
    object_id = res_obj.data[0]["id"]

    # 3. Fetch Cleansed Data
    res_cleansed = client.table("cleansed_data").select("payload").eq("project_id", project_id).eq("object_id", object_id).order("created_at", desc=True).limit(1).execute()
    
    if not res_cleansed.data:
        raise HTTPException(status_code=400, detail="No cleansed data found to transform. Run step 6 first.")
    
    cleansed_payload = res_cleansed.data[0]["payload"]
    if isinstance(cleansed_payload, dict) and "rows" in cleansed_payload:
        cleansed_rows = cleansed_payload["rows"]
    elif isinstance(cleansed_payload, list):
        cleansed_rows = cleansed_payload
    else:
        raise HTTPException(400, "Invalid cleansed data format.")

    # 4. Delegate transformation to the Agent
    agent = TransformationAgent()
    transformed_rows, summary = agent.apply_mappings(cleansed_rows, mapping_rules)

    return {
        "status": "success",
        "data": transformed_rows,
        "summary": summary
    }


@router.post("/save")
def save_transformed_data(req: SaveTransformRequest):
    try:
        client = supabase_service.get_client()
        res_obj = client.table("sf_objects").select("id").ilike("name", req.target_object).execute()
        
        if not res_obj.data:
            raise HTTPException(400, f"SuccessFactors object '{req.target_object}' not found")
        
        obj_id = res_obj.data[0]["id"]
        
        # 1. Clear previous records for this object and project
        client.table("transformed_data") \
            .delete() \
            .eq("project_id", req.project_id) \
            .eq("object_id", obj_id) \
            .execute()
        
        # 2. Insert new payload
        client.table("transformed_data").insert({
            "project_id": req.project_id,
            "object_id": obj_id,
            "payload": req.payload
        }).execute()
        
        return {"status": "success", "message": "Transformed data saved successfully."}
    except Exception as e:
        raise HTTPException(500, f"Failed to save transformed data: {str(e)}")

@router.post("/ai-apply-mappings")
def apply_ai_transform_mappings(req: AITransformRequest):
    client = supabase_service.get_client()

    cleansed_rows = []
    if req.fallback_data and len(req.fallback_data) > 0:
        cleansed_rows = req.fallback_data
    else:
        try:
            res_obj = client.table("sf_objects").select("id").ilike("name", req.target_object).execute()
            if not res_obj.data:
                res_obj = client.table("sf_objects").select("id").ilike("name", "Biographical Info").execute()
            if res_obj.data:
                object_id = res_obj.data[0]["id"]
                res_cleansed = client.table("cleansed_data").select("payload").eq("project_id", req.project_id).eq("object_id", object_id).order("created_at", desc=True).limit(1).execute()
                if res_cleansed.data:
                    cleansed_payload = res_cleansed.data[0]["payload"]
                    if isinstance(cleansed_payload, dict) and "rows" in cleansed_payload:
                        cleansed_rows = cleansed_payload["rows"]
                    elif isinstance(cleansed_payload, list):
                        cleansed_rows = cleansed_payload
        except Exception:
            pass

    if not cleansed_rows:
        raise HTTPException(status_code=400, detail="No cleansed data found to transform. Run step 6 first.")

    available_columns = list(cleansed_rows[0].keys())

    llm = LLMOrchestrator()
    system_prompt = f"""
    You are a SuccessFactors migration transformation assistant. 
    The user wants to transform a Pandas DataFrame based on a natural language instruction.
    The valid columns in the dataset are: {available_columns}
    
    Your task is to write a Python function `transform_data(df)` that applies the user's instructions to the DataFrame `df`.
    - `df` is a Pandas DataFrame where all columns are of string type.
    - Standard modules pandas (`import pandas as pd`), numpy (`import numpy as np`), and re (`import re`) are available. Always include `import pandas as pd` if using `pd`.
    - Match columns flexibly: identify which column from {available_columns} corresponds to the target field.
    - Treat empty cells as empty strings `""` or `NaN`. Use `.fillna("")` or `.replace("", ...)` where appropriate.
    - Return the modified DataFrame.
    
    You MUST respond with ONLY a raw JSON object containing a "python_code" string key.
    """

    llm_response = None
    try:
        llm_response = llm.execute_json_prompt(system_prompt, req.prompt)
        
        if isinstance(llm_response, dict):
            python_code = llm_response.get("python_code", "")
        else:
            raise ValueError(f"Unexpected response type from LLM: {type(llm_response)}")
            
        if not python_code:
            raise ValueError("'python_code' is missing or empty")
    except Exception as e:
        raise HTTPException(500, f"Failed to parse AI response: {str(e)}\nRaw Response: {llm_response}")

    try:
        agent = TransformationAgent()
        transformed_rows, summary = agent.apply_ai_script(cleansed_rows, python_code)
    except Exception as e:
        transformed_rows = cleansed_rows
        summary = {
            "rows_loaded": len(cleansed_rows),
            "rows_modified": 0,
            "total_modifications": 0,
            "audit_log": [{
                "id": "ERR_AI_SCRIPT",
                "row": 0,
                "phase": "AI Python Transform",
                "rule_code": "AI_SCRIPT_ERROR",
                "field": "General",
                "old_value": "AI Script",
                "new_value": f"Execution error: {str(e)}",
                "status": "FAILED"
            }]
        }

    return {
        "status": "success",
        "data": transformed_rows,
        "summary": summary,
        "ai_rules": [{"Source_Field": "Python Script", "Source_Data": "", "Target_Data": python_code}]
    }

class BatchTransformRequest(BaseModel):
    project_id: str
    target_object: str
    rules: list
    fallback_data: Optional[list] = None

@router.post("/apply-batch-rules")
def apply_batch_transform_rules(req: BatchTransformRequest):
    client = supabase_service.get_client()

    cleansed_rows = []

    # Prioritize fallback_data from active browser state if provided
    if req.fallback_data and len(req.fallback_data) > 0:
        cleansed_rows = req.fallback_data
    else:
        try:
            res_obj = client.table("sf_objects").select("id").ilike("name", req.target_object).execute()
            if not res_obj.data:
                res_obj = client.table("sf_objects").select("id").ilike("name", "Biographical Info").execute()
            if res_obj.data:
                object_id = res_obj.data[0]["id"]
                res_cleansed = client.table("cleansed_data").select("payload").eq("project_id", req.project_id).eq("object_id", object_id).order("created_at", desc=True).limit(1).execute()
                if res_cleansed.data:
                    cleansed_payload = res_cleansed.data[0]["payload"]
                    if isinstance(cleansed_payload, dict) and "rows" in cleansed_payload:
                        cleansed_rows = cleansed_payload["rows"]
                    elif isinstance(cleansed_payload, list):
                        cleansed_rows = cleansed_payload
        except Exception:
            pass

    if not cleansed_rows:
        raise HTTPException(status_code=400, detail="No cleansed data found to transform. Run step 6 first.")

    agent = TransformationAgent()
    transformed_rows, summary = agent.apply_rule_batch(cleansed_rows, req.rules)

    return {
        "status": "success",
        "data": transformed_rows,
        "summary": summary
    }


class SaveTransformRulesRequest(BaseModel):
    project_id: str
    target_object: str
    rules: list


@router.post("/rules/save")
def save_transform_rules(req: SaveTransformRulesRequest):
    try:
        client = supabase_service.get_client()
        res_obj = client.table("sf_objects").select("id").ilike("name", req.target_object).execute()
        if not res_obj.data:
            res_obj = client.table("sf_objects").select("id").ilike("name", "Biographical Info").execute()
        if not res_obj.data:
            raise HTTPException(400, f"SuccessFactors object '{req.target_object}' not found")
        object_id = res_obj.data[0]["id"]

        tagged_rules = []
        for r in req.rules:
            if isinstance(r, dict):
                r_copy = dict(r)
                orig_source = r_copy.get("source") or "dynamic"
                r_copy["rule_source"] = orig_source
                r_copy["source"] = "transform_dynamic_rule"
                r_copy["phase"] = "transform"
                if not r_copy.get("id"):
                    import uuid
                    r_copy["id"] = f"DYNAMIC_TRF_{uuid.uuid4().hex[:8]}"
                if r_copy.get("pythonCode") and not r_copy.get("python_code"):
                    r_copy["python_code"] = r_copy["pythonCode"]
                if r_copy.get("python_code") and not r_copy.get("pythonCode"):
                    r_copy["pythonCode"] = r_copy["python_code"]
                tagged_rules.append(r_copy)
            else:
                tagged_rules.append(r)

        existing_rules = []
        try:
            res_dr = client.table("dynamic_rules").select("payload").eq("project_id", req.project_id).eq("object_id", object_id).order("created_at", desc=True).limit(1).execute()
            if res_dr.data and isinstance(res_dr.data[0].get("payload"), list):
                existing_rules = res_dr.data[0]["payload"]
        except Exception:
            pass

        other_rules = [
            r for r in existing_rules
            if isinstance(r, dict) and (
                r.get("source") in ("validation_dynamic_rule", "cleanser_dynamic_rule", "harmonization_dynamic_rule")
                or r.get("phase") in ("validate", "cleanser", "harmonize")
                or str(r.get("id", "")).startswith("DYNAMIC_VAL_")
                or str(r.get("id", "")).startswith("DYNAMIC_CLS_")
                or str(r.get("id", "")).startswith("DYNAMIC_HARM_")
            )
        ]

        combined = other_rules + tagged_rules
        client.table("dynamic_rules").delete().eq("project_id", req.project_id).eq("object_id", object_id).execute()
        if combined:
            client.table("dynamic_rules").insert({
                "project_id": req.project_id,
                "object_id": object_id,
                "payload": combined
            }).execute()

        return {"status": "success", "message": "Transform dynamic rules saved successfully."}
    except Exception as e:
        raise HTTPException(500, f"Failed to save transform rules: {e}")


@router.get("/load/{project_id}")
def load_saved_transform(project_id: str, target_object: Optional[str] = None):
    try:
        client = supabase_service.get_client()
        res_obj = None
        if target_object:
            res_obj = client.table("sf_objects").select("id").ilike("name", target_object).execute()
            
        object_id = res_obj.data[0]["id"] if (res_obj and res_obj.data) else None

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

        trf_rules = []
        for r in dynamic_rules:
            if isinstance(r, dict) and (
                r.get("source") in ("transform_dynamic_rule", "transform")
                or r.get("phase") == "transform"
                or str(r.get("id", "")).startswith("DYNAMIC_TRF_")
            ):
                r_copy = dict(r)
                if r_copy.get("rule_source"):
                    r_copy["source"] = r_copy["rule_source"]
                trf_rules.append(r_copy)

        return {
            "status": "success",
            "dynamic_rules": trf_rules,
        }
    except Exception as e:
        raise HTTPException(500, f"Failed to load transform rules: {e}")


