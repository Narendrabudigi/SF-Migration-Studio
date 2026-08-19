from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import requests
import xml.etree.ElementTree as ET
import pandas as pd
import io
import json
import logging
import re
# Suppress insecure request warnings for sandbox self-signed certs
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
from agents.extract_agent import ExtractAgent
from services.supabase_client import supabase_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sap/extract", tags=["Extract"])

class ConnectionRequest(BaseModel):
    base_url: str
    client: str
    username: str
    password: str
    system_type: str

class FetchSampleRequest(ConnectionRequest):
    target_object: str

@router.post("/fetch_sample")
def fetch_sample(req: FetchSampleRequest):
    if not req.base_url:
        raise HTTPException(status_code=400, detail="Base URL is required")
        
    try:
        base_url = req.base_url.rstrip('/')
        
        # Determine the OData URL based on target object
        if req.target_object in ['CUSTOMER', 'VENDOR']:
            api_path = "/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_BusinessPartner?$top=10"
        elif req.target_object == 'MATERIAL':
            api_path = "/sap/opu/odata/sap/API_PRODUCT_SRV/A_Product?$top=10"
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported target object for live extraction: {req.target_object}")
            
        fetch_url = f"{base_url}{api_path}"
        if req.client:
            fetch_url += f"&sap-client={req.client}"
            
        print(f"Fetching sample data from: {fetch_url}")
        
        session = requests.Session()
        session.trust_env = False
        
        res = session.get(
            fetch_url,
            auth=(req.username, req.password),
            headers={"Accept": "application/json"},
            timeout=30,
            verify=False
        )
        
        if res.status_code == 200:
            data = res.json()
            # S/4HANA OData v2 typically returns data inside d.results
            results = data.get("d", {}).get("results", [])
            
            # Clean up the metadata tags if present
            cleaned_results = []
            for row in results:
                if "__metadata" in row:
                    del row["__metadata"]
                # Flatten simple values, drop navigation links
                flat_row = {}
                for k, v in row.items():
                    if isinstance(v, dict):
                        continue # Skip deferred navigation properties
                    flat_row[k] = str(v) if v is not None else ""
                cleaned_results.append(flat_row)
                
            return {"status": "success", "data": cleaned_results}
        elif res.status_code in [401, 403]:
            raise HTTPException(status_code=401, detail="Authentication failed or user lacks permissions for this API.")
        elif res.status_code == 404:
            raise HTTPException(status_code=404, detail="The OData API for this object is not activated on the SAP server.")
        else:
            raise HTTPException(status_code=400, detail=f"SAP returned error {res.status_code}: {res.text[:200]}")
            
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=408, detail="Connection timed out while fetching data.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/fetch_schema")
def fetch_schema(req: FetchSampleRequest):
    if not req.base_url:
        raise HTTPException(status_code=400, detail="Base URL is required")
        
    try:
        base_url = req.base_url.rstrip('/')
        
        # Determine the OData Metadata URL based on target object
        if req.target_object in ['CUSTOMER', 'VENDOR']:
            api_path = "/sap/opu/odata/sap/API_BUSINESS_PARTNER/$metadata"
            entity_name = "A_BusinessPartnerType"
        elif req.target_object == 'MATERIAL':
            api_path = "/sap/opu/odata/sap/API_PRODUCT_SRV/$metadata"
            entity_name = "A_ProductType"
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported target object for schema fetch: {req.target_object}")
            
        fetch_url = f"{base_url}{api_path}"
        if req.client:
            fetch_url += f"?sap-client={req.client}"
            
        print(f"Fetching schema metadata from: {fetch_url}")
        
        session = requests.Session()
        session.trust_env = False
        
        res = session.get(
            fetch_url,
            auth=(req.username, req.password),
            timeout=30,
            verify=False
        )
        
        if res.status_code == 200:
            root = ET.fromstring(res.text)
            # OData XML namespaces usually look like {http://schemas.microsoft.com/ado/2008/09/edm}EntityType
            # To be safe, we can iterate and check ends with
            fields = []
            for elem in root.iter():
                if elem.tag.endswith('EntityType') and elem.attrib.get('Name') == entity_name:
                    for prop in elem.iter():
                        if prop.tag.endswith('Property'):
                            name = prop.attrib.get('Name')
                            if name:
                                fields.append(name)
                    break
                    
            if not fields:
                raise HTTPException(status_code=404, detail="Could not parse fields from metadata XML.")
                
            return {"status": "success", "fields": fields}
            
        elif res.status_code in [401, 403]:
            raise HTTPException(status_code=401, detail="Authentication failed.")
        else:
            raise HTTPException(status_code=400, detail=f"SAP returned error {res.status_code}")
            
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=408, detail="Connection timed out while fetching schema.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class ExecuteExtractionRequest(ConnectionRequest):
    target_object: str
    mappings: list

@router.post("/execute")
def execute_extraction(req: ExecuteExtractionRequest):
    if not req.base_url:
        raise HTTPException(status_code=400, detail="Base URL is required")
        
    try:
        agent = ExtractAgent()
        harmonized_data = agent.perform_extraction(
            base_url=req.base_url,
            client=req.client,
            username=req.username,
            password=req.password,
            target_object=req.target_object,
            mappings=req.mappings
        )
        
        quality_report = agent.generate_eda_quality_report(
            harmonized_results=harmonized_data,
            target_object=req.target_object,
            mappings=req.mappings
        )

        tables = agent.group_records_by_sap_structure(
            harmonized_results=harmonized_data,
            target_object=req.target_object,
            mappings=req.mappings
        )
        
        return {
            "status": "success", 
            "data": harmonized_data,
            "tables": tables,
            "eda_stats": quality_report.get("eda_stats", []),
            "compliance_data": quality_report.get("compliance_data", []),
            "summary_metrics": quality_report.get("summary_metrics", {}),
            "aiAnalysis": {
                "report": quality_report.get("ai_report", {})
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    try:
        contents = await file.read()
        if file.filename.endswith('.csv'):
            df = pd.read_csv(io.BytesIO(contents))
        elif file.filename.endswith(('.xls', '.xlsx')):
            df = pd.read_excel(io.BytesIO(contents))
        else:
            raise HTTPException(status_code=400, detail="Only CSV and Excel files are supported")
        
        # Replace NaN with empty string
        df = df.fillna("")
        
        # Check for 2-header row structure (e.g. Table Names in row 0, Field Names in row 1)
        if not df.empty and len(df) > 0:
            first_row_vals = [str(v).strip() for v in df.iloc[0].values]
            col_bases = [str(col).split('.')[0] for col in df.columns]
            if len(col_bases) != len(set(col_bases)) and len(set(first_row_vals)) == len(first_row_vals):
                df.columns = first_row_vals
                df = df.iloc[1:].reset_index(drop=True)

        headers = list(df.columns)
        data = df.to_dict(orient="records")
        
        return {"status": "success", "headers": headers, "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process file: {str(e)}")

class ExecuteFileRequest(BaseModel):
    target_object: str
    mappings: list
    raw_data: list

def norm_str(s: str) -> str:
    if not s:
        return ""
    return re.sub(r'[^a-z0-9]', '', str(s).lower())

def extract_value_from_row(row: dict, src_key: str) -> str:
    if not row or not src_key:
        return ""
    if src_key in row and row[src_key] is not None and str(row[src_key]).strip() != "":
        return str(row[src_key])
    clean_src = re.sub(r"^\[\d+\]\s*", "", src_key).strip()
    if clean_src in row and row[clean_src] is not None and str(row[clean_src]).strip() != "":
        return str(row[clean_src])
    base_src = clean_src.split(".")[-1].strip()
    if base_src in row and row[base_src] is not None and str(row[base_src]).strip() != "":
        return str(row[base_src])
    norm_target = norm_str(clean_src)
    norm_base = norm_str(base_src)
    for r_k, r_v in row.items():
        if r_v is None or str(r_v).strip() == "":
            continue
        r_clean = re.sub(r"^\[\d+\]\s*", "", str(r_k)).strip()
        r_norm = norm_str(r_clean)
        r_base_norm = norm_str(r_clean.split(".")[-1])
        if r_norm in (norm_target, norm_base) or r_base_norm in (norm_target, norm_base):
            return str(r_v)
    return ""

@router.post("/execute_file")
def execute_file_extraction(req: ExecuteFileRequest):
    try:
        agent = ExtractAgent()
        
        raw_data = req.raw_data
        mapping_src_fields = set(
            str(m.get('src', '')).split('.')[-1].lower() 
            for m in req.mappings if m.get('src')
        )
        if raw_data and len(raw_data) > 0:
            first_row_vals = set(
                str(v).strip().split('.')[-1].lower() 
                for v in raw_data[0].values() 
                if isinstance(v, (str, int)) and str(v).strip()
            )
            if len(first_row_vals.intersection(mapping_src_fields)) >= 2:
                raw_data = raw_data[1:]

        harmonized_results = []
        for row in raw_data:
            harmonized_row = {}
            for m in req.mappings:
                src_full = m.get('src')
                if not src_full:
                    continue
                
                sap_key = m.get('sap')
                transform = m.get('tr', 'none')
                
                raw_val = extract_value_from_row(row, src_full)

                if transform == 'trim':
                    val = raw_val.strip()
                elif transform == 'upper':
                    val = raw_val.upper()
                elif transform == 'pad10':
                    val = raw_val.zfill(10) if raw_val.isdigit() else raw_val
                elif transform == 'country' or transform == 'currency':
                    val = raw_val.strip().upper()
                else:
                    val = raw_val
                
                harmonized_row[src_full] = val
                
            harmonized_results.append(harmonized_row)
        
        quality_report = agent.generate_eda_quality_report(
            harmonized_results=harmonized_results,
            target_object=req.target_object,
            mappings=req.mappings
        )

        tables = agent.group_records_by_sap_structure(
            harmonized_results=harmonized_results,
            target_object=req.target_object,
            mappings=req.mappings
        )
        
        return {
            "status": "success", 
            "data": harmonized_results,
            "tables": tables,
            "eda_stats": quality_report.get("eda_stats", []),
            "compliance_data": quality_report.get("compliance_data", []),
            "summary_metrics": quality_report.get("summary_metrics", {}),
            "aiAnalysis": {
                "report": quality_report.get("ai_report", {})
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class SaveExtractionRequest(BaseModel):
    project_id: str
    target_object: str
    payload: list = []
    tables: Optional[list] = None

@router.post("/save")
def save_extraction(req: SaveExtractionRequest):
    try:
        client = supabase_service.get_client()
        # Resolve target_object name to object_id
        res_obj = client.table("sf_objects").select("id").ilike("name", req.target_object).execute()
        if not res_obj.data:
            res_obj = client.table("sf_objects").select("id").ilike("name", "Biographical Info").execute()

        if not res_obj.data:
            raise HTTPException(status_code=400, detail=f"SuccessFactors object '{req.target_object}' not found.")
        object_id = res_obj.data[0]["id"]
        
        # Delete old extraction if any
        client.table("extracted_data") \
            .delete() \
            .eq("project_id", req.project_id) \
            .eq("object_id", object_id) \
            .execute()
            
        # Store both flat rows and separated tables
        stored_payload = {
            "rows": req.payload,
            "tables": req.tables or []
        } if req.tables else req.payload

        # Insert the new payload
        res = client.table("extracted_data").insert({
            "project_id": req.project_id,
            "object_id": object_id,
            "payload": stored_payload
        }).execute()
        
        return {"status": "success", "message": "Extraction saved to database."}
    except Exception as e:
        logger.error(f"Failed to save extraction: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to save extraction: {str(e)}")

@router.get("/load/{project_id}")
def load_saved_extraction(project_id: str, target_object: Optional[str] = None):
    try:
        client = supabase_service.get_client()
        query = client.table("extracted_data").select("*, sf_objects(name)").eq("project_id", project_id)
        if target_object:
            res_obj = client.table("sf_objects").select("id").ilike("name", target_object).execute()
            if res_obj.data:
                query = query.eq("object_id", res_obj.data[0]["id"])
                
        res = query.order("created_at", desc=True).limit(1).execute()
        if not res.data:
            return {"status": "not_found", "data": [], "tables": []}
            
        raw_payload = res.data[0].get("payload")
        if isinstance(raw_payload, dict) and "tables" in raw_payload:
            return {
                "status": "success",
                "data": raw_payload.get("rows", []),
                "tables": raw_payload.get("tables", [])
            }
        elif isinstance(raw_payload, list):
            return {
                "status": "success",
                "data": raw_payload,
                "tables": []
            }
        return {"status": "success", "data": [], "tables": []}
    except Exception as e:
        logger.error(f"Failed to load extraction: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

class AISummaryRequest(BaseModel):
    stats: list
    score: int
    total_records: int
    target_object: str

@router.post("/ai_summary")
def generate_ai_summary(req: AISummaryRequest):
    try:
        from services.llm_orchestrator import llm_orchestrator
        import re
        
        system_prompt = "You are an expert SuccessFactors Data Migration Architect. Generate a professional summary from the exact algorithmic stats provided. Respond ONLY with valid JSON."
        user_prompt = f"""
        Algorithm Results for {req.target_object}:
        Records: {req.total_records}
        Score: {req.score}/100
        Field Analytics: {json.dumps(req.stats)}

        Based STRICTLY on the numbers provided, generate:
        {{
          "summary": "Executive summary paragraph...",
          "warnings": ["Critical warning 1", "Critical warning 2"],
          "recommendations": ["Action plan step 1", "Action plan step 2"]
        }}
        """
        
        result_str = llm_orchestrator.generate_generic(system_prompt, user_prompt)
        
        json_match = re.search(r"\{.*\}", result_str, re.DOTALL)
        if json_match:
            data = json.loads(json_match.group(0))
        else:
            data = json.loads(result_str)
            
        return {"status": "success", "aiAnalysis": data}
    except Exception as e:
        logger.error(f"Failed to generate AI summary: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
