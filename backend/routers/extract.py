from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import requests
import xml.etree.ElementTree as ET
import pandas as pd
import os
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

def _parse_file_to_df(filename: str, contents: bytes, nrows: Optional[int] = None) -> pd.DataFrame:
    clean_name = os.path.basename(filename)
    if clean_name.endswith('.csv'):
        try:
            df = pd.read_csv(io.BytesIO(contents), nrows=nrows, encoding='utf-8', encoding_errors='replace')
        except Exception:
            try:
                df = pd.read_csv(io.BytesIO(contents), nrows=nrows, encoding='utf-8-sig', encoding_errors='replace')
            except Exception:
                df = pd.read_csv(io.BytesIO(contents), nrows=nrows, encoding='latin-1', encoding_errors='replace')
    elif clean_name.endswith(('.xls', '.xlsx')):
        df = pd.read_excel(io.BytesIO(contents), nrows=nrows)
    else:
        try:
            df = pd.read_csv(io.BytesIO(contents), nrows=nrows, encoding_errors='replace')
        except Exception:
            df = pd.read_excel(io.BytesIO(contents), nrows=nrows)
    
    df = df.fillna("")
    meta_keywords = ["hris element", "business key:", "effective-dated:", "entity perperson", "technical name"]

    # Check if df.columns itself contains template metadata header description text
    cols_str = " ".join([str(c) for c in df.columns]).lower()
    if any(kw in cols_str for kw in meta_keywords):
        if not df.empty and len(df) > 0:
            df.columns = [str(v).strip() for v in df.iloc[0].values]
            df = df.iloc[1:].reset_index(drop=True)

    # Check for 2-header row structure (e.g. Table Names in row 0, Field Names in row 1)
    if not df.empty and len(df) > 0:
        first_row_vals = [str(v).strip() for v in df.iloc[0].values]
        col_bases = [str(col).split('.')[0] for col in df.columns]
        if (len(col_bases) != len(set(col_bases)) or any("Unnamed" in str(c) for c in df.columns)) and len(set(first_row_vals)) == len(first_row_vals) and all(v != "" for v in first_row_vals):
            df.columns = first_row_vals
            df = df.iloc[1:].reset_index(drop=True)

    # Filter out metadata header rows from data body
    if not df.empty and len(df) > 0:
        drop_indices = []
        for idx in range(min(5, len(df))):
            row_str = " ".join([str(v) for v in df.iloc[idx].values if v is not None]).lower()
            if any(kw in row_str for kw in meta_keywords):
                drop_indices.append(idx)
        if drop_indices:
            df = df.drop(index=drop_indices).reset_index(drop=True)

    return df

@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    try:
        contents = await file.read()
        df = _parse_file_to_df(file.filename or "data.csv", contents)
        headers = [str(c) for c in df.columns]
        data = df.to_dict(orient="records")
        return {"status": "success", "headers": headers, "data": data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process file: {str(e)}")

@router.post("/upload-preview")
async def upload_preview(files: List[UploadFile] = File(...)):
    results = []
    try:
        for file in files:
            contents = await file.read()
            clean_fn = os.path.basename(file.filename or "data.csv")
            df = _parse_file_to_df(clean_fn, contents)
            headers = [str(c) for c in df.columns]
            sample_rows = df.head(5).to_dict(orient="records")
            results.append({
                "filename": clean_fn,
                "headers": headers,
                "sample_rows": sample_rows,
                "row_count": len(df),
                "columns_count": len(headers)
            })
        return {"status": "success", "files": results}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to preview files: {str(e)}")

@router.post("/upload-merge")
async def upload_merge(
    files: List[UploadFile] = File(...),
    join_config_json: str = Form(...),
    base_file: Optional[str] = Form(None)
):
    try:
        join_configs = json.loads(join_config_json) if join_config_json else []
        file_map: Dict[str, pd.DataFrame] = {}
        for file in files:
            contents = await file.read()
            clean_fn = os.path.basename(file.filename or "data.csv")
            df = _parse_file_to_df(clean_fn, contents)
            file_map[clean_fn] = df

        if not file_map:
            raise HTTPException(status_code=400, detail="No files uploaded to merge")

        # Determine base file
        clean_base = os.path.basename(base_file or "")
        base_filename = None
        for k in file_map.keys():
            if k == clean_base or os.path.basename(k) == clean_base:
                base_filename = k
                break
        if not base_filename:
            base_filename = list(file_map.keys())[0]

        # Topological sort based on join_with
        cfg_map = {os.path.basename(cfg.get("file_name", "")): cfg for cfg in join_configs if cfg.get("file_name")}
        parent_map = {os.path.basename(cfg.get("file_name", "")): os.path.basename(cfg.get("join_with") or base_filename) for cfg in join_configs if cfg.get("file_name")}

        resolved = [base_filename]
        remaining = [k for k in file_map.keys() if k != base_filename]

        max_iters = len(remaining) + 2
        for _ in range(max_iters):
            if not remaining:
                break
            added_this_round = []
            for t in remaining:
                p = parent_map.get(t, base_filename)
                if p in resolved:
                    resolved.append(t)
                    added_this_round.append(t)
            for t in added_this_round:
                if t in remaining:
                    remaining.remove(t)
        if remaining:
            resolved.extend(remaining)

        merged_df = file_map[base_filename].copy().astype(str)

        for sec_name in resolved:
            if sec_name == base_filename or sec_name not in file_map:
                continue

            sec_df = file_map[sec_name].copy().astype(str)
            cfg = cfg_map.get(sec_name, {})

            key_conditions = cfg.get("key_conditions", [])
            if not key_conditions:
                bk = cfg.get("base_key")
                jk = cfg.get("join_key")
                if bk and jk:
                    key_conditions = [{"left_key": bk, "right_key": jk}]

            def _find_df_col(df: pd.DataFrame, col_name: str):
                if not col_name:
                    return None
                if col_name in df.columns:
                    return col_name
                for c in df.columns:
                    if str(c).strip().lower() == str(col_name).strip().lower():
                        return c
                for c in df.columns:
                    if str(c).strip().lower().replace('_', '').replace(' ', '') == str(col_name).strip().lower().replace('_', '').replace(' ', ''):
                        return c
                return None

            valid_conditions = []
            for c in key_conditions:
                lk = (c.get("left_key") or "").strip()
                rk = (c.get("right_key") or "").strip()
                if not lk or not rk:
                    continue
                actual_lk = _find_df_col(merged_df, lk)
                actual_rk = _find_df_col(sec_df, rk)
                if actual_lk and actual_rk:
                    valid_conditions.append({"left_key": actual_lk, "right_key": actual_rk})

            file_tag = re.sub(r'[^a-zA-Z0-9]', '', sec_name.split('.')[0])[:8]

            if valid_conditions:
                left_keys = [c["left_key"] for c in valid_conditions]
                right_keys = [c["right_key"] for c in valid_conditions]

                # Strip keys and reset index
                temp_merged = merged_df.reset_index(drop=True)
                temp_sec = sec_df.reset_index(drop=True)

                for lk in left_keys:
                    if lk in temp_merged.columns:
                        temp_merged[lk] = temp_merged[lk].astype(str).str.strip()
                for rk in right_keys:
                    if rk in temp_sec.columns:
                        temp_sec[rk] = temp_sec[rk].astype(str).str.strip()

                # Prevent Cartesian explosion on empty/blank keys
                blank_vals = {"", "nan", "None", "null", "undefined", "NaN", "none"}
                for idx, (lk, rk) in enumerate(zip(left_keys, right_keys)):
                    if lk in temp_merged.columns and rk in temp_sec.columns:
                        l_blank = temp_merged[lk].isin(blank_vals)
                        r_blank = temp_sec[rk].isin(blank_vals)
                        if l_blank.any():
                            temp_merged.loc[l_blank, lk] = [f"__BLANK_L_{i}_{idx}__" for i in range(l_blank.sum())]
                        if r_blank.any():
                            temp_sec.loc[r_blank, rk] = [f"__BLANK_R_{i}_{idx}__" for i in range(r_blank.sum())]

                # CRITICAL: Deduplicate right side on join keys to prevent M×N explosion
                # Keep only the first occurrence of each key combination in the secondary table
                temp_sec_deduped = temp_sec.drop_duplicates(subset=right_keys, keep='first')
                logger.info(f"Merge {sec_name}: left={len(temp_merged)} rows, right={len(temp_sec_deduped)} rows (deduped from {len(temp_sec)}), keys={list(zip(left_keys, right_keys))}")

                merged_df = pd.merge(
                    temp_merged,
                    temp_sec_deduped,
                    left_on=left_keys,
                    right_on=right_keys,
                    how='left',
                    suffixes=('', f'_{file_tag}')
                )

                logger.info(f"After merge with {sec_name}: {len(merged_df)} rows")

                # Safety cap: if merge produced more than 5x the original rows, something went wrong
                max_allowed = max(len(temp_merged), 50000)
                if len(merged_df) > max_allowed:
                    logger.warning(f"Merge with {sec_name} produced {len(merged_df)} rows (cap={max_allowed}), trimming to original size")
                    merged_df = merged_df.head(len(temp_merged))

                # Restore blank keys
                for lk in left_keys:
                    if lk in merged_df.columns:
                        merged_df[lk] = merged_df[lk].astype(str).apply(lambda v: "" if str(v).startswith("__BLANK_") else v)

                for lk, rk in zip(left_keys, right_keys):
                    if rk != lk and rk in merged_df.columns:
                        merged_df.drop(columns=[rk], inplace=True, errors='ignore')
                    suffixed_rk = f"{rk}_{file_tag}"
                    if suffixed_rk in merged_df.columns:
                        merged_df.drop(columns=[suffixed_rk], inplace=True, errors='ignore')
            else:
                sec_reindexed = sec_df.reset_index(drop=True)
                for col in sec_reindexed.columns:
                    target_col = col if col not in merged_df.columns else f"{col}_{file_tag}"
                    s_vals = sec_reindexed[col].tolist()
                    if len(s_vals) < len(merged_df):
                        s_vals = s_vals + [""] * (len(merged_df) - len(s_vals))
                    else:
                        s_vals = s_vals[:len(merged_df)]
                    merged_df[target_col] = s_vals

        merged_df = merged_df.fillna("")

        # Guarantee unique column names for records orientation
        seen_cols: Dict[str, int] = {}
        unique_cols: List[str] = []
        for c in merged_df.columns:
            c_str = str(c).strip()
            if c_str in seen_cols:
                seen_cols[c_str] += 1
                unique_cols.append(f"{c_str}_{seen_cols[c_str]}")
            else:
                seen_cols[c_str] = 0
                unique_cols.append(c_str)
        merged_df.columns = unique_cols

        headers = [str(c) for c in merged_df.columns]
        data = merged_df.to_dict(orient="records")

        return {
            "status": "success",
            "headers": headers,
            "data": data,
            "total_rows": len(merged_df),
            "columns_count": len(headers),
            "base_file": base_filename,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Merge failed")
        raise HTTPException(status_code=500, detail=f"Failed to merge files: {str(e)}")

class ExecuteFileRequest(BaseModel):
    target_object: str
    mappings: list
    raw_data: list
    source_name: Optional[str] = "EXCEL_CSV"

def norm_str(s: str) -> str:
    if not s:
        return ""
    return re.sub(r'[^a-z0-9]', '', str(s).lower())

def extract_value_from_row(row: dict, src_key: str) -> str:
    if not row or not src_key:
        return ""
    if src_key in row and row[src_key] is not None and str(row[src_key]).strip() != "":
        return str(row[src_key])
    clean_src = re.sub(r"^\[\d+\]\s*", "", str(src_key)).strip()
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

    # Fallback substring match
    if len(norm_base) >= 3:
        for r_k, r_v in row.items():
            if r_v is None or str(r_v).strip() == "":
                continue
            r_norm = norm_str(str(r_k).split(".")[-1])
            if r_norm == norm_base or (len(r_norm) >= 3 and (r_norm in norm_base or norm_base in r_norm)):
                return str(r_v)

    return ""

def is_metadata_row(row: dict) -> bool:
    if not row or not isinstance(row, dict):
        return False
    row_text = " ".join([str(v) for v in row.values() if v is not None]).lower()
    meta_keywords = [
        "hris element", "business key:", "effective-dated:", 
        "entity perperson", "technical name", "field id:", "element id"
    ]
    return any(kw in row_text for kw in meta_keywords)

@router.post("/execute_file")
def execute_file_extraction(req: ExecuteFileRequest):
    try:
        agent = ExtractAgent()
        
        # 1. Filter out metadata rows
        raw_data = [r for r in (req.raw_data or []) if isinstance(r, dict) and not is_metadata_row(r)]

        # 2. Filter row if it duplicates mapping source fields
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

        # 3. Project mapped fields strictly under source field names for Step 3 Extract display
        harmonized_results = []
        for row in raw_data:
            harmonized_row = {}
            for m in req.mappings:
                src_full = m.get('src')
                if not src_full:
                    continue
                
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
                
                # Display under clean source field name
                clean_src_key = re.sub(r"^\[\d+\]\s*", "", str(src_full)).strip()
                harmonized_row[clean_src_key] = val
                
            # Always populate SOURCE column with valid source name
            src_val = row.get("SOURCE") or row.get("source") or row.get("_source") or row.get("SOURCE_FILE") or row.get("source_file") or req.source_name or "EXCEL_CSV"
            harmonized_row["SOURCE"] = str(src_val)

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


class EDAReportRequest(BaseModel):
    target_object: str
    mappings: list
    records: list

@router.post("/eda_report")
def generate_eda_report(req: EDAReportRequest):
    try:
        agent = ExtractAgent()
        quality_report = agent.generate_eda_quality_report(
            harmonized_results=req.records,
            target_object=req.target_object,
            mappings=req.mappings
        )
        tables = agent.group_records_by_sap_structure(
            harmonized_results=req.records,
            target_object=req.target_object,
            mappings=req.mappings
        )
        return {
            "status": "success",
            "eda_stats": quality_report.get("eda_stats", []),
            "compliance_data": quality_report.get("compliance_data", []),
            "summary_metrics": quality_report.get("summary_metrics", {}),
            "tables": tables,
            "aiAnalysis": {
                "report": quality_report.get("ai_report", {})
            }
        }
    except Exception as e:
        logger.error(f"Failed to generate EDA report: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
