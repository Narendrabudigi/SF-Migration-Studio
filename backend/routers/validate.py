import io
import csv
import logging
from typing import Dict, List, Any, Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from pydantic import BaseModel
import pandas as pd

from services.supabase_client import supabase_service
from services.cleanser_dynamic_rules import save_rules, normalize_dynamic_rule
from agents.validation_agent import ValidationAgent, gen_customer_rows, OBJS, RULES

logger = logging.getLogger(__name__)

router = APIRouter()

agent = ValidationAgent()

class ValidateFlowRequest(BaseModel):
    project_id: str
    target_object: str
    custom_prompts: Optional[List[str]] = None
    dynamic_rules: Optional[List[Dict[str, Any]]] = None
    selected_rules: Optional[List[str]] = None

class GenerateRulesRequest(BaseModel):
    prompts: List[str]
    target_object: str = "Biographical Info"
    actual_columns: Optional[List[str]] = None

def sanitize_python_code(code: str, prompt: str) -> str:
    """
    Sanitize and ensure python_code strictly obeys the VIOLATION contract (returns True on failure).
    If LLM generated equality (==) for a "must be N" or "should be N" rule, invert to inequality (!=).
    """
    if not code:
        return "False"
    
    code = code.strip()
    prompt_lower = prompt.lower()
    import re

    # 1. Catch `len(...) == N` where prompt specifies a required length requirement (e.g. "should be 4 digits", "must be 2 digits")
    m_len_eq = re.search(r'len\(([^)]+)\)\s*==\s*(\d+)', code)
    if m_len_eq:
        num = m_len_eq.group(2)
        if any(kw in prompt_lower for kw in [f"be {num}", f"be of {num}", f"is {num}", f"equal {num}", f"{num} digit", f"{num} letter", f"{num} char", f"length {num}"]):
            code = re.sub(r'len\(([^)]+)\)\s*==\s*(\d+)', r'len(\1) != \2', code)

    # 2. Catch `row.get(...) == 'VAL'` where prompt requires value equality (e.g. "should be USD")
    m_val_eq = re.search(r'row\.get\(([^)]+)\)\s*==\s*([\'"][^\'"]+[\'"])', code)
    if m_val_eq and not any(kw in prompt_lower for kw in ["not ", "never", "no ", "invalid"]):
        val_str = m_val_eq.group(2).strip("'\"")
        if val_str.lower() in prompt_lower:
            code = re.sub(r'row\.get\(([^)]+)\)\s*==\s*', r'row.get(\1) != ', code)

    return code

@router.get("/validate/health")
def health():
    return {"status": "ok", "service": "validate", "objects": list(OBJS.keys()), "rules": [r["id"] for r in RULES]}

@router.post("/validate/generate-rules")
def generate_dynamic_rules(req: GenerateRulesRequest):
    """
    Generate executable Python validation rule expressions from natural language rule prompts.
    Triggers LLM ONCE for all requested rule prompts in batch.
    """
    if not req.prompts:
        raise HTTPException(400, "No rule prompts provided")

    fields_list = OBJS.get(req.target_object.upper(), [])
    fields_desc = ", ".join([f"{f['n']} ({f['l']})" for f in fields_list])

    actual_cols_desc = ""
    if req.actual_columns:
        actual_cols_desc = f"\nACTUAL DATASET COLUMNS PRESENT IN TABLE: {req.actual_columns}"

    system_prompt = f"""You are an Expert Data Quality Engineer for SuccessFactors target object: {req.target_object}.
Available Table Fields for this object: {fields_desc}.{actual_cols_desc}

YOUR MANDATE:
Convert EACH natural language custom business rule prompt into a single-line Python boolean condition `python_code`.

CRITICAL INSTRUCTIONS FOR `python_code`:
1. VIOLATION CONTRACT: `python_code` MUST evaluate to `True` when a row VIOLATES (FAILS) the rule. It MUST evaluate to `False` when the row IS VALID (PASSES).
2. POSITIVE/NEGATIVE PHRASING & LENGTH CONSTRAINTS:
   When user prompt states what a field "should be" or "must be" (e.g., "Country iso should be of 2 letters, not 4 digits", "Currency iso should be 4 digits", "Postal code must be 5 digits"):
   - Identify the VALID REQUIREMENT (e.g. valid length is 2, or valid length is 4).
   - Invert it in `python_code` so ANY non-compliant value evaluates to `True` (Violation)!
   - "should be 2 letters / digits" -> `len(str(row.get('LAND1', '')).strip()) != 2`
   - "should be 4 digits" -> `len(str(row.get('WAERS', '')).strip()) != 4`
   - "must be 5 digits" -> `len(str(row.get('PSTLZ', '')).strip()) != 5`
   - "must not be empty" -> `not str(row.get('SMTP_ADDR', '')).strip()`
3. COUNTRY ISO MAPPING:
   Country values in table are stored as 2-letter ISO codes (e.g., 'IN' for India, 'US' for USA/United States, 'DE' for Germany, 'GB' for UK, 'CA' for Canada, 'FR' for France, 'AU' for Australia).
   When user prompt mentions a country by name or code:
   - "when country is India" -> `str(row.get('LAND1', '')).strip().upper() in ['IN', 'INDIA']`
   - "when country is US" or "when country is USA" -> `str(row.get('LAND1', '')).strip().upper() in ['US', 'USA', 'UNITED STATES']`
4. CONDITIONAL CONSTRAINTS COMBINATION:
   Combine condition and violation with AND:
   e.g., "Postal code must be 2 digits when country is india":
   `str(row.get('LAND1', '')).strip().upper() in ['IN', 'INDIA'] and len(str(row.get('PSTLZ', '')).strip()) != 2`
5. DYNAMIC FIELD LOOKUP CONTRACT:
   If `ACTUAL DATASET COLUMNS PRESENT IN TABLE` is provided, ALWAYS match the user prompt concept to the EXACT column header present in that list!
   Examples based on actual table columns:
   - "country" -> use 'COUNTRY' (or 'LAND1')
   - "postal code" / "zip" -> use 'POST_CODE1' (or 'PSTLZ')
   - "phone" / "telephone" -> use 'TELNR_LONG' (or 'TELF1')
   - "email" -> use 'SMTP_ADDR'
   - "city" -> use 'CITY2' (or 'ORT01')
   - "state" / "region" -> use 'UF' (or 'REGIO')
   - "street" / "address" -> use 'STREET' (or 'STRAS')
   - "customer" / "bp" -> use 'BPEXT' or 'KUNNR'
   Set the `field` property of the JSON rule object to the exact column name present in the table (e.g. "COUNTRY", "POST_CODE1", "TELNR_LONG", "CITY2", "UF", "STREET", "SMTP_ADDR", "BPEXT", etc.).

Output MUST be a JSON object with key "rules" containing a list of rule objects:
{{
  "rules": [
    {{
      "id": "DYNAMIC_1",
      "label": "Short Title",
      "description": "Natural language rule description",
      "field": "Exact Table Column Header Name or GENERAL",
      "python_code": "Single line Python condition returning True on rule violation",
      "error_message": "Human readable error message describing the violation",
      "severity": "ERROR"
    }}
  ]
}}"""

    user_prompt = f"Target SuccessFactors Object: {req.target_object}\nPrompts to compile:\n"
    for i, p in enumerate(req.prompts, 1):
        user_prompt += f"{i}. {p}\n"

    try:
        from services.llm_orchestrator import llm_orchestrator
        res = llm_orchestrator.execute_json_prompt(system_prompt, user_prompt)
        rules = res.get("rules", []) if isinstance(res, dict) else (res if isinstance(res, list) else [])
        
        # Ensure rules have unique IDs, severities, and sanitized python_code
        cleaned_rules = []
        for idx, r in enumerate(rules, 1):
            prompt_str = req.prompts[min(idx - 1, len(req.prompts) - 1)]
            raw_code = r.get("python_code") or "False"
            sanitized_code = sanitize_python_code(raw_code, prompt_str)
            
            cleaned_rules.append({
                "id": r.get("id") or f"DYNAMIC_RULE_{idx}",
                "label": r.get("label") or f"Custom Rule {idx}",
                "description": r.get("description") or prompt_str,
                "field": r.get("field") or "GENERAL",
                "python_code": sanitized_code,
                "error_message": r.get("error_message") or r.get("label") or "Custom rule violation",
                "severity": (r.get("severity") or "ERROR").upper()
            })
        return {"rules": cleaned_rules}
    except Exception as e:
        logger.exception("Failed to generate dynamic rules via LLM")
        raise HTTPException(500, f"Failed to generate dynamic rules: {str(e)}")

@router.post("/validate/flow")
def validate_flow(req: ValidateFlowRequest):
    try:
        client = supabase_service.get_client()

        # Get object_id
        res_obj = client.table("sf_objects").select("id").ilike("name", req.target_object).execute()
        if not res_obj.data:
            res_obj = client.table("sf_objects").select("id").ilike("name", "Biographical Info").execute()
        if not res_obj.data:
            raise HTTPException(400, f"SuccessFactors object '{req.target_object}' not found")
        object_id = res_obj.data[0]["id"]

        # Fetch Harmonized Data from DB
        # Order by created_at desc, limit 1 to get the most recent harmonization result
        res_data = client.table("harmonized_data").select("payload").eq("project_id", req.project_id).eq("object_id", object_id).order("created_at", desc=True).limit(1).execute()
        if not res_data.data:
            raise HTTPException(400, "No harmonized data found for this project and object in the database.")
        
        harmonized_payload = res_data.data[0]["payload"]
        if isinstance(harmonized_payload, dict) and "rows" in harmonized_payload:
            harmonized_payload = harmonized_payload["rows"]
        if not harmonized_payload:
            raise HTTPException(400, "Harmonized data payload is empty.")

        # Compile custom AI rule prompts if provided
        dynamic_rules = list(req.dynamic_rules) if req.dynamic_rules else []
        if req.custom_prompts:
            actual_cols = list(harmonized_payload[0].keys()) if harmonized_payload and isinstance(harmonized_payload[0], dict) else None
            gen_res = generate_dynamic_rules(GenerateRulesRequest(prompts=req.custom_prompts, target_object=req.target_object, actual_columns=actual_cols))
            compiled = gen_res.get("rules", [])
            dynamic_rules.extend(compiled)

        normalized_rules = [
            normalize_dynamic_rule(r, project_id=req.project_id, target_object=req.target_object)
            for r in dynamic_rules
        ]

        logger.debug("validate_flow selected_rules=%s", req.selected_rules)
        result = agent.run_validation(req.target_object.upper(), harmonized_payload, dynamic_rules, req.selected_rules)
        result["dynamic_rules"] = normalized_rules
        # Echo what the server received for debugging client selection
        result["selected_rules_received"] = req.selected_rules
        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Validation flow failed")
        raise HTTPException(500, f"Validation flow failed: {str(e)}")

@router.post("/validate/upload-csv")
async def validate_upload(
    obj: str = Form(...),
    file: UploadFile = File(...),
    custom_prompts_json: Optional[str] = Form(None),
    dynamic_rules_json: Optional[str] = Form(None),
    selected_rules_json: Optional[str] = Form(None)
):
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files are supported.")

    content = await file.read()
    try:
        df = pd.read_csv(io.BytesIO(content), dtype=str, keep_default_na=False)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse CSV: {e}")

    rows = df.to_dict(orient="records")
    if not rows:
        raise HTTPException(status_code=400, detail="CSV file is empty.")

    import json
    dynamic_rules = json.loads(dynamic_rules_json) if dynamic_rules_json else []
    custom_prompts = json.loads(custom_prompts_json) if custom_prompts_json else []
    selected_rules = json.loads(selected_rules_json) if selected_rules_json is not None else None

    if custom_prompts:
        actual_cols = list(rows[0].keys()) if rows and isinstance(rows[0], dict) else None
        gen_res = generate_dynamic_rules(GenerateRulesRequest(prompts=custom_prompts, target_object=obj, actual_columns=actual_cols))
        compiled = gen_res.get("rules", [])
        dynamic_rules.extend(compiled)

    logger.debug("validate_upload selected_rules=%s", selected_rules)
    result = agent.run_validation(obj, rows, dynamic_rules, selected_rules)
    result["dynamic_rules"] = dynamic_rules
    result["selected_rules_received"] = selected_rules
    result["headers"] = list(df.columns)
    result["rows"] = rows
    result["filename"] = file.filename
    return result

def _rows_to_csv(rows: List[Dict[str, str]], cols: List[str]) -> str:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
    writer.writeheader()
    for r in rows:
        writer.writerow(r)
    return buf.getvalue()

@router.get("/validate/sample-csv")
def sample_csv(obj: str = "CUSTOMER", count: int = 200):
    if obj != "CUSTOMER":
        raise HTTPException(status_code=400, detail="Sample generation currently only supports obj=CUSTOMER.")
    if count < 1 or count > 5000:
        raise HTTPException(status_code=400, detail="count must be between 1 and 5000.")

    rows = gen_customer_rows(count)
    cols = [f["n"] for f in OBJS["CUSTOMER"]]
    csv_text = _rows_to_csv(rows, cols)
    filename = f"sample_customer_{count}_with_errors.csv"

    return Response(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )

class SaveValidationRequest(BaseModel):
    project_id: str
    target_object: str
    payload: list
    dynamic_rules: Optional[List[Dict[str, Any]]] = None

@router.post("/validate/save")
def save_validation(req: SaveValidationRequest):
    try:
        client = supabase_service.get_client()
        # Resolve target_object name to object_id
        res_obj = client.table("sf_objects").select("id").ilike("name", req.target_object).execute()
        if not res_obj.data:
            res_obj = client.table("sf_objects").select("id").ilike("name", "Biographical Info").execute()
        if not res_obj.data:
            raise HTTPException(status_code=400, detail=f"SuccessFactors object '{req.target_object}' not found.")
        object_id = res_obj.data[0]["id"]
        
        # Delete old validation if any
        client.table("validation_report") \
            .delete() \
            .eq("project_id", req.project_id) \
            .eq("object_id", object_id) \
            .execute()
            
        # Insert the new validation payload
        res = client.table("validation_report").insert({
            "project_id": req.project_id,
            "object_id": object_id,
            "payload": req.payload
        }).execute()

        # Save dynamic rules to database if provided
        if req.dynamic_rules is not None:
            client.table("dynamic_rules") \
                .delete() \
                .eq("project_id", req.project_id) \
                .eq("object_id", object_id) \
                .execute()

            if req.dynamic_rules:
                client.table("dynamic_rules").insert({
                    "project_id": req.project_id,
                    "object_id": object_id,
                    "payload": req.dynamic_rules
                }).execute()
        
        return {"status": "success", "message": "Validation and dynamic rules saved to database."}
    except Exception as e:
        logger.error(f"Failed to save validation: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to save validation: {str(e)}")


class SaveDynamicRulesRequest(BaseModel):
    project_id: str
    target_object: str
    rules: Optional[List[Dict[str, Any]]] = None


@router.post("/validate/rules/save")
def save_dynamic_rules(req: SaveDynamicRulesRequest):
    try:
        client = supabase_service.get_client()
        # Resolve target_object name to object_id
        res_obj = client.table("sf_objects").select("id").ilike("name", req.target_object).execute()
        if not res_obj.data:
            res_obj = client.table("sf_objects").select("id").ilike("name", "Biographical Info").execute()
        if not res_obj.data:
            raise HTTPException(status_code=400, detail=f"SuccessFactors object '{req.target_object}' not found.")
        object_id = res_obj.data[0]["id"]

        # Remove previous dynamic rules for this project/object
        del_res = client.table("dynamic_rules") \
            .delete() \
            .eq("project_id", req.project_id) \
            .eq("object_id", object_id) \
            .execute()

        insert_resp = None
        # Insert new rules if provided
        if req.rules:
            insert_resp = client.table("dynamic_rules").insert({
                "project_id": req.project_id,
                "object_id": object_id,
                "payload": req.rules
            }).execute()

        # ALSO persist to local JSON store and attempt to upload to Supabase Storage (if configured)
        storage_result = None
        try:
            from services.cleanser_dynamic_rules import upsert_rules, DEFAULT_STORE_PATH

            # Upsert into local file store (backend/output/cleanser_dynamic_rules.json by default)
            upserted = upsert_rules(req.rules or [], project_id=req.project_id, target_object=req.target_object)

            # Attempt upload to Supabase Storage bucket named 'dynamic_rules' (best-effort)
            try:
                path = DEFAULT_STORE_PATH
                with path.open('rb') as fh:
                    content = fh.read()
                # Use storage API if available
                if hasattr(client, 'storage'):
                    bucket = 'dynamic_rules'
                    remote_path = f"{req.project_id}_{req.target_object}_dynamic_rules.json"
                    try:
                        # upload might accept bytes or file-like object depending on client
                        storage_resp = client.storage.from_(bucket).upload(remote_path, content, {'upsert': True})
                        storage_result = getattr(storage_resp, 'data', storage_resp)
                    except Exception as e:
                        # some supabase client versions expect different args; try fallback upload via files API
                        try:
                            storage_resp = client.storage.from_(bucket).upload(remote_path, fh)
                            storage_result = getattr(storage_resp, 'data', storage_resp)
                        except Exception:
                            storage_result = {"error": str(e)}
                else:
                    storage_result = {"warning": "supabase client has no storage attribute"}
            except Exception as e:
                storage_result = {"error": f"local store write or upload failed: {str(e)}"}
        except Exception as e:
            storage_result = {"error": f"persist-to-local failed: {str(e)}"}

        # Provide diagnostic info to the client so frontend can show success/failure
        resp_payload = {"status": "success", "message": "Dynamic rules saved to database."}
        try:
            resp_payload["deleted"] = del_res.data if hasattr(del_res, 'data') else None
        except Exception:
            resp_payload["deleted"] = None
        try:
            resp_payload["inserted"] = insert_resp.data if insert_resp and hasattr(insert_resp, 'data') else None
        except Exception:
            resp_payload["inserted"] = None
        resp_payload["local_store"] = True
        resp_payload["storage_upload"] = storage_result

        return resp_payload
    except Exception as e:
        logger.exception("Failed to save dynamic rules")
        raise HTTPException(status_code=500, detail=f"Failed to save dynamic rules: {str(e)}")
