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

    # 1. Get Object ID from sf_objects
    res_obj = client.table("sf_objects").select("id").ilike("name", req.target_object).execute()
    if not res_obj.data:
        raise HTTPException(status_code=400, detail="Target object not found")
    object_id = res_obj.data[0]["id"]

    # 2. Fetch Cleansed Data
    res_cleansed = client.table("cleansed_data").select("payload").eq("project_id", req.project_id).eq("object_id", object_id).order("created_at", desc=True).limit(1).execute()
    
    if not res_cleansed.data:
        raise HTTPException(status_code=400, detail="No cleansed data found to transform. Run step 6 first.")
    
    cleansed_payload = res_cleansed.data[0]["payload"]
    if isinstance(cleansed_payload, dict) and "rows" in cleansed_payload:
        cleansed_rows = cleansed_payload["rows"]
    elif isinstance(cleansed_payload, list):
        cleansed_rows = cleansed_payload
    else:
        raise HTTPException(400, "Invalid cleansed data format.")

    if not cleansed_rows:
        raise HTTPException(400, "Cleansed data is empty.")

    available_columns = list(cleansed_rows[0].keys())

    llm = LLMOrchestrator()
    system_prompt = f"""
    You are a SuccessFactors migration transformation assistant. 
    The user wants to transform a Pandas DataFrame based on a natural language instruction.
    The valid columns in the dataset are: {available_columns}
    
    Your task is to write a Python function `transform_data(df)` that applies the user's instructions to the DataFrame `df`.
    - `df` is a Pandas DataFrame where all columns are of string type.
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

    agent = TransformationAgent()
    transformed_rows, summary = agent.apply_ai_script(cleansed_rows, python_code)

    return {
        "status": "success",
        "data": transformed_rows,
        "summary": summary,
        "ai_rules": [{"Source_Field": "Python Script", "Source_Data": "", "Target_Data": python_code}]
    }
