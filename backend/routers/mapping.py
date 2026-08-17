from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import List, Optional
import logging

from services.supabase_client import supabase_service
from agents.ai_mapping_agent import ai_mapping_agent

logger = logging.getLogger(__name__)

router = APIRouter()

class MapRequest(BaseModel):
    sourceSystem: str
    targetObject: str
    sourceFields: List[str]

class MappingItem(BaseModel):
    src: str
    sap: str
    tr: str
    conf: int
    req: Optional[bool] = False
    sapLabel: Optional[str] = ""
    note: Optional[str] = ""
    srcType: Optional[str] = ""

class SaveAllRequest(BaseModel):
    projectId: str
    sourceSystem: str
    targetObject: str
    mappings: List[MappingItem]

class PromptRequest(BaseModel):
    prompt: str

class SourceFieldItem(BaseModel):
    sf_field_id: str
    oracle_ebs_table: Optional[str] = ""
    oracle_ebs_field_name: str

class SaveSourceFieldsRequest(BaseModel):
    sourceSystemId: str
    objectId: str
    fields: List[SourceFieldItem]

@router.get("/systems")
def get_systems():
    client = supabase_service.get_client()
    res = client.table("source_systems").select("*").execute()
    return {"systems": res.data}

@router.get("/objects")
def get_objects():
    client = supabase_service.get_client()
    res = client.table("sf_objects").select("*").execute()
    return {"objects": res.data}

@router.post("/source_fields")
def save_source_fields(req: SaveSourceFieldsRequest):
    client = supabase_service.get_client()
    payload = []
    for f in req.fields:
        payload.append({
            "source_system_id": req.sourceSystemId,
            "object_id": req.objectId,
            "sf_field_id": f.sf_field_id,
            "source_table": f.oracle_ebs_table,
            "source_field_name": f.oracle_ebs_field_name
        })
    if payload:
        try:
            client.table("source_fields").upsert(
                payload, 
                on_conflict="source_system_id,object_id,source_table,source_field_name"
            ).execute()
        except Exception as e:
            logger.error(f"Database error during source_fields insertion: {str(e)}")
            raise HTTPException(status_code=400, detail="Failed to save mappings. One or more entries might be invalid or conflicting.")
    return {"status": "success", "inserted": len(payload)}

@router.get("/schema")
def get_schema(object_name: str = "Biographical Info"):
    client = supabase_service.get_client()
    # 1. Fetch object ID
    res_obj = client.table("sf_objects").select("id").ilike("name", object_name).execute()
    if not res_obj.data:
        raise HTTPException(status_code=404, detail="SuccessFactors Object not found")
    
    obj_id = res_obj.data[0]["id"]
    
    # 2. Fetch fields
    res_fields = client.table("sf_fields").select("*").eq("object_id", obj_id).execute()
    return {"object_name": object_name, "fields": res_fields.data}

@router.post("/map")
def generate_mapping(req: MapRequest):
    client = supabase_service.get_client()
    
    res_obj = client.table("sf_objects").select("id").ilike("name", req.targetObject).execute()
    if not res_obj.data:
        raise HTTPException(status_code=404, detail="SuccessFactors Object not found in database.")
    
    obj_id = res_obj.data[0]["id"]
    res_fields = client.table("sf_fields").select("*").eq("object_id", obj_id).execute()
    target_fields = res_fields.data
    
    minimal_target_fields = []
    for f in target_fields:
        struct = f.get('sf_structure') or ''
        fname = f.get('field_name') or ''
        full_f = f"{struct}.{fname}" if struct else fname
        minimal_target_fields.append({
            "sap_field": full_f,
            "description": f.get("field_description", "")
        })
    target_fields_to_pass = minimal_target_fields
    
    db_mappings = []
    unmapped_fields = req.sourceFields.copy()
    
    if req.sourceSystem.upper() not in ['SAP_HCM', 'WORKDAY']:
        sys_res = client.table("source_systems").select("id").eq("name", req.sourceSystem.upper()).execute()
        if sys_res.data:
            sys_id = sys_res.data[0]["id"]
            
            res_sf = client.table("source_fields").select("source_field_name, sf_field_id").eq("source_system_id", sys_id).eq("object_id", obj_id).execute()
            
            if res_sf.data:
                sf_field_map = {f["id"]: f for f in target_fields}
                
                for row in res_sf.data:
                    src_field = row.get("source_field_name")
                    sf_id = row.get("sf_field_id")
                    
                    if src_field in unmapped_fields and sf_id and sf_id in sf_field_map:
                        sf_f = sf_field_map[sf_id]
                        struct = sf_f.get('sf_structure') or ''
                        target_name = f"{struct}.{sf_f['field_name']}" if struct else sf_f['field_name']
                        
                        db_mappings.append({
                            "src": src_field,
                            "sap": target_name,
                            "tr": "none",
                            "conf": 100
                        })
                        unmapped_fields.remove(src_field)
            
    raw_mappings = []
    if unmapped_fields:
        raw_mappings = ai_mapping_agent.map_source_to_target(
            source_system=req.sourceSystem,
            target_object=req.targetObject,
            known_source_fields=unmapped_fields,
            target_fields=target_fields_to_pass
        )
    
    formatted = []
    for m in raw_mappings:
        target_f = str(m.get("target_field", "")).strip()
        if not target_f or target_f.lower() in ["none", "n/a", "null"]:
            continue
            
        tr_rule = m.get("transform_rule", "none")
        if isinstance(tr_rule, str):
            if "Pad" in tr_rule:
                tr_rule = "pad10"
            elif "Country" in tr_rule:
                tr_rule = "country"
            elif "Currency" in tr_rule:
                tr_rule = "currency"
            else:
                tr_rule = "trim"
                
        formatted.append({
            "src": m.get("source_field"),
            "sap": target_f,
            "tr": tr_rule,
            "conf": m.get("confidence", 0)
        })
    
    final_mappings = db_mappings + formatted
    return {"mappings": final_mappings}

@router.post("/map/save_all")
def save_all_mappings(req: SaveAllRequest):
    client = supabase_service.get_client()
    
    sys_res = client.table("source_systems").select("id").eq("name", req.sourceSystem).execute()
    if not sys_res.data:
        raise HTTPException(404, "Source system not found")
    sys_id = sys_res.data[0]["id"]
    
    obj_res = client.table("sf_objects").select("id").ilike("name", req.targetObject).execute()
    if not obj_res.data:
        raise HTTPException(404, "Target object not found")
    obj_id = obj_res.data[0]["id"]
    
    fields_res = client.table("sf_fields").select("id, field_name, sf_structure").eq("object_id", obj_id).execute()
    field_map = {}
    for f in fields_res.data:
        struct = f.get('sf_structure') or ''
        full_name = f"{struct}.{f['field_name']}" if struct else f['field_name']
        
        if full_name not in field_map:
            field_map[full_name] = []
        field_map[full_name].append(f["id"])
        
        if f['field_name'] not in field_map:
            field_map[f['field_name']] = []
        field_map[f['field_name']].append(f["id"])
        
    existing = client.table("user_corrected_mappings") \
        .select("id, sf_fields!inner(object_id)") \
        .eq("project_id", req.projectId) \
        .eq("source_system_id", sys_id) \
        .eq("sf_fields.object_id", obj_id) \
        .execute()
        
    ids_to_delete = [row["id"] for row in existing.data]
    if ids_to_delete:
        client.table("user_corrected_mappings").delete().in_("id", ids_to_delete).execute()
        
    inserts = []
    for i, m in enumerate(req.mappings):
        if not m.src:
            continue
        if m.sap in field_map:
            fid = field_map[m.sap][0]
            inserts.append({
                "project_id": req.projectId,
                "source_system_id": sys_id,
                "source_field_name": f"[{i}]{m.src}",
                "sf_field_id": fid,
                "transform_rule": m.tr,
                "confidence": getattr(m, 'conf', 100)
            })
                
    if inserts:
        client.table("user_corrected_mappings").insert(inserts).execute()
        
    return {"status": "success", "inserted": len(inserts)}

@router.get("/map/history")
def get_mapping_history(project_id: str, source_system: str, target_object: str):
    client = supabase_service.get_client()
    
    sys_res = client.table("source_systems").select("id").eq("name", source_system).execute()
    if not sys_res.data:
        return {"mappings": []}
    sys_id = sys_res.data[0]["id"]
    
    obj_res = client.table("sf_objects").select("id").ilike("name", target_object).execute()
    if not obj_res.data:
        return {"mappings": []}
    obj_id = obj_res.data[0]["id"]
    
    res = client.table("user_corrected_mappings") \
        .select("source_field_name, transform_rule, confidence, sf_fields!inner(field_name, sf_structure, object_id)") \
        .eq("project_id", project_id) \
        .eq("source_system_id", sys_id) \
        .eq("sf_fields.object_id", obj_id) \
        .execute()
        
    import re
    mappings_with_order = []
    for r in res.data:
        raw_src = r["source_field_name"]
        match = re.match(r"^\[(\d+)\](.*)$", raw_src)
        if match:
            idx = int(match.group(1))
            src = match.group(2)
        else:
            idx = 99999
            src = raw_src
            
        struct = r['sf_fields'].get('sf_structure') or ''
        fname = r['sf_fields']['field_name']
        full_tgt = f"{struct}.{fname}" if struct else fname
        
        mappings_with_order.append({
            "idx": idx,
            "src": src,
            "sap": full_tgt,
            "tr": r["transform_rule"],
            "conf": r.get("confidence") if r.get("confidence") is not None else 100
        })
        
    mappings_with_order.sort(key=lambda x: x["idx"])
    final_mappings = [{"src": m["src"], "sap": m["sap"], "tr": m["tr"], "conf": m["conf"]} for m in mappings_with_order]
            
    return {"mappings": final_mappings}

@router.post("/prompt")
def generic_prompt(req: PromptRequest):
    system_prompt = "You are a senior SuccessFactors Employee Central migration consultant."
    from services.llm_orchestrator import llm_orchestrator
    result = llm_orchestrator.generate_generic(system_prompt, req.prompt)
    return {"content": result}
