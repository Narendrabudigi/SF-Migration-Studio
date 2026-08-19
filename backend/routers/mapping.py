from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import List, Optional, Any
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
    src: Optional[str] = ""
    sap: Optional[str] = ""
    tr: Optional[str] = "trim"
    conf: Optional[Any] = 100
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

import re

def norm_field(s: str) -> str:
    if not s:
        return ""
    return re.sub(r'[^a-z0-9]', '', str(s).lower())

SYNONYM_MAP = {
    'person-id-external': ['personidexternal', 'personid', 'empid', 'employeeid', 'pernr', 'id', 'employeeno', 'userid', 'partynumber'],
    'user-id': ['userid', 'empid', 'pernr', 'id', 'username', 'user'],
    'first-name': ['firstname', 'givenname', 'name1', 'name', 'fname', 'customername', 'vendorname', 'given'],
    'last-name': ['lastname', 'familyname', 'surname', 'name2', 'lname', 'family'],
    'middle-name': ['middlename', 'mname'],
    'salutation': ['salutation', 'title'],
    'gender': ['gender', 'genderdescription', 'sex', 'gesch'],
    'marital-status': ['maritalstatus', 'famst', 'marital'],
    'nationality': ['nationality', 'citizenship', 'citizen', 'countryofcitizenship'],
    'date-of-birth': ['dateofbirth', 'birthdate', 'dob', 'gbdat', 'birthd'],
    'country-of-birth': ['countryofbirth', 'birthcountry', 'land1', 'countrybirth'],
    'region-of-birth': ['regionofbirth', 'birthregion', 'stateofbirth'],
    'place-of-birth': ['placeofbirth', 'birthplace', 'cityofbirth'],
    'hire-date': ['hiredate', 'startdate', 'entrydate', 'originalstartdate'],
    'start-date': ['startdate', 'hiredate', 'begda', 'effectivedate'],
    'job-code': ['jobcode', 'position', 'jobtitle', 'job'],
    'job-title': ['jobtitle', 'title', 'position'],
    'department': ['department', 'dept', 'orgunit'],
    'division': ['division', 'div'],
    'location': ['location', 'loc', 'site', 'office'],
    'company': ['company', 'companycode', 'legalentity', 'bukrs'],
    'email-address': ['emailaddress', 'email', 'mail', 'smtpaddr'],
    'phone-number': ['phonenumber', 'phone', 'tel', 'telf1', 'mobile', 'cellphone'],
    'zip-code': ['zipcode', 'zip', 'postalcode', 'pstlz'],
    'city': ['city', 'town', 'ort01'],
    'country': ['country', 'land1', 'countrycode'],
    'address1': ['address1', 'street', 'stras', 'addressline1'],
    'currency': ['currency', 'waers', 'curr'],
    'pay-group': ['paygroup', 'payrollgroup'],
    'KUNNR': ['kunnr', 'partynumber', 'custid', 'id', 'customerno', 'accountnum'],
    'NAME1': ['name1', 'partyname', 'customername', 'vendorname', 'name', 'description'],
    'LAND1': ['land1', 'countrycode', 'country', 'land'],
    'ORT01': ['ort01', 'city', 'town'],
    'PSTLZ': ['pstlz', 'postalcode', 'zip', 'postcode'],
    'TELF1': ['telf1', 'phone', 'telephone'],
    'SMTP_ADDR': ['smtpaddr', 'email', 'mail'],
}

ALL_DEFAULT_TARGET_FIELDS = [
    {"sap_field": "PerPerson.person-id-external", "description": "Person ID External"},
    {"sap_field": "PerPerson.date-of-birth", "description": "Date of Birth (YYYY-MM-DD)"},
    {"sap_field": "PerPerson.country-of-birth", "description": "Country of Birth"},
    {"sap_field": "PerPersonal.first-name", "description": "First Name / Given Name"},
    {"sap_field": "PerPersonal.last-name", "description": "Last Name / Family Name"},
    {"sap_field": "PerPersonal.middle-name", "description": "Middle Name"},
    {"sap_field": "PerPersonal.salutation", "description": "Salutation / Title"},
    {"sap_field": "PerPersonal.gender", "description": "Gender / Sex"},
    {"sap_field": "PerPersonal.marital-status", "description": "Marital Status"},
    {"sap_field": "PerPersonal.nationality", "description": "Nationality / Citizenship"},
    {"sap_field": "EmpEmployment.hire-date", "description": "Hire Date"},
    {"sap_field": "EmpEmployment.user-id", "description": "User ID"},
    {"sap_field": "EmpJob.start-date", "description": "Effective Start Date"},
    {"sap_field": "EmpJob.job-title", "description": "Job Title"},
    {"sap_field": "EmpJob.department", "description": "Department"},
    {"sap_field": "EmpJob.company", "description": "Company / Legal Entity"},
    {"sap_field": "PerEmail.email-address", "description": "Email Address"},
    {"sap_field": "PerPhone.phone-number", "description": "Phone Number"},
    {"sap_field": "PerAddress.zip-code", "description": "Zip Code / Postal Code"},
    {"sap_field": "PerAddress.city", "description": "City"},
    {"sap_field": "PerAddress.country", "description": "Country"},
]

@router.post("/map")
def generate_mapping(req: MapRequest):
    client = supabase_service.get_client()
    
    res_obj = client.table("sf_objects").select("id").ilike("name", req.targetObject).execute()
    obj_id = res_obj.data[0]["id"] if res_obj.data else None
    
    target_fields = []
    if obj_id:
        res_fields = client.table("sf_fields").select("*").eq("object_id", obj_id).execute()
        target_fields = res_fields.data or []
    
    minimal_target_fields = []
    for f in target_fields:
        struct = f.get('sf_structure') or ''
        fname = f.get('field_name') or ''
        full_f = f"{struct}.{fname}" if struct else fname
        minimal_target_fields.append({
            "sap_field": full_f,
            "description": f.get("field_description", "")
        })
    
    # Merge default rich target fields so cross-object fields (First Name, Gender, Citizenship, etc.) can be matched
    target_fields_to_pass = list(minimal_target_fields)
    existing_sap_names = {tf["sap_field"] for tf in target_fields_to_pass}
    for def_tf in ALL_DEFAULT_TARGET_FIELDS:
        if def_tf["sap_field"] not in existing_sap_names:
            target_fields_to_pass.append(def_tf)
            existing_sap_names.add(def_tf["sap_field"])
    
    db_mappings = []
    unmapped_fields = req.sourceFields.copy()
    
    if obj_id and req.sourceSystem.upper() not in ['SAP_HCM', 'WORKDAY']:
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
    try:
        raw_mappings = ai_mapping_agent.map_source_to_target(
            source_system=req.sourceSystem,
            target_object=req.targetObject,
            known_source_fields=unmapped_fields,
            target_fields=target_fields_to_pass
        )
    except Exception as e:
        logger.warning(f"AI Mapping Agent call failed: {e}")
        raw_mappings = []
    
    # Normalized Fuzzy Semantic Matcher to ensure ALL unmapped source fields get matched
    already_mapped_srcs = {m.get("source_field") for m in raw_mappings if m.get("source_field")}
    already_mapped_targets = {m.get("target_field") for m in raw_mappings if m.get("target_field")}

    if unmapped_fields:
        for sf in unmapped_fields:
            if sf in already_mapped_srcs:
                continue
            
            sf_norm = norm_field(sf)
            best_target = None
            best_score = 0
            
            for tf in target_fields_to_pass:
                sap_f = tf["sap_field"]
                if sap_f in already_mapped_targets:
                    continue
                    
                sap_clean = sap_f.split('.')[-1] if '.' in sap_f else sap_f
                sap_norm = norm_field(sap_clean)
                
                score = 0
                if sf_norm == sap_norm:
                    score = 98
                else:
                    syns = SYNONYM_MAP.get(sap_clean, [sap_norm])
                    for syn in syns:
                        if sf_norm == syn:
                            score = 95
                            break
                        elif syn in sf_norm or sf_norm in syn:
                            if len(sf_norm) >= 3 and len(syn) >= 3:
                                score = max(score, 80)
                
                if score > best_score:
                    best_score = score
                    best_target = sap_f
                    
            if best_target and best_score >= 50:
                raw_mappings.append({
                    "source_field": sf,
                    "target_field": best_target,
                    "transform_rule": "trim",
                    "confidence": best_score
                })
                already_mapped_srcs.add(sf)
                already_mapped_targets.add(best_target)
    else:
        # If source fields was empty, infer standard technical source fields for target fields
        for tf in target_fields_to_pass[:10]:
            sap_f = tf["sap_field"]
            sap_clean = sap_f.split('.')[-1] if '.' in sap_f else sap_f
            default_src = SYNONYM_MAP.get(sap_clean, [sap_clean.replace('-', '_')])[0]
            raw_mappings.append({
                "source_field": default_src,
                "target_field": sap_f,
                "transform_rule": "trim",
                "confidence": 85
            })

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
    
    # 1. Fetch all fields across all objects in sf_fields
    fields_res = client.table("sf_fields").select("id, field_name, sf_structure, object_id").execute()
    
    primary_field_map = {}
    global_field_map = {}
    
    for f in fields_res.data:
        struct = f.get('sf_structure') or ''
        fname = f.get('field_name') or ''
        full_name = f"{struct}.{fname}" if struct else fname
        fid = f["id"]
        f_obj_id = f.get("object_id")
        
        keys_to_index = [
            full_name,
            fname,
            norm_field(full_name),
            norm_field(fname),
            norm_field(fname.replace("-", "")),
            norm_field(fname.replace("_", ""))
        ]
        for k in keys_to_index:
            if k:
                if f_obj_id == obj_id and k not in primary_field_map:
                    primary_field_map[k] = fid
                if k not in global_field_map:
                    global_field_map[k] = fid
        
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
        if not m.src or not m.sap:
            continue
            
        target_key = m.sap.strip()
        target_norm = norm_field(target_key)
        target_base = target_key.split(".")[-1]
        target_base_norm = norm_field(target_base)

        # Lookup order: primary object fields -> global cross-object fields
        fid = (
            primary_field_map.get(target_key)
            or primary_field_map.get(target_norm)
            or primary_field_map.get(target_base)
            or primary_field_map.get(target_base_norm)
            or global_field_map.get(target_key)
            or global_field_map.get(target_norm)
            or global_field_map.get(target_base)
            or global_field_map.get(target_base_norm)
        )

        # Query DB by ilike on field_name if not found in memory map
        if not fid:
            res_find = client.table("sf_fields").select("id").ilike("field_name", target_base).limit(1).execute()
            if res_find.data:
                fid = res_find.data[0]["id"]

        # Fallback: if custom field not in sf_fields at all, auto-create or reuse existing
        if not fid:
            struct = target_key.split(".")[0] if "." in target_key else ""
            fname = target_key.split(".")[-1] if "." in target_key else target_key
            try:
                res_exist = client.table("sf_fields").select("id").eq("object_id", obj_id).ilike("field_name", fname).limit(1).execute()
                if res_exist.data:
                    fid = res_exist.data[0]["id"]
                else:
                    ins_res = client.table("sf_fields").insert({
                        "object_id": obj_id,
                        "sf_structure": struct,
                        "field_name": fname,
                        "field_description": f"Custom field {target_key}",
                        "data_type": "STRING",
                        "is_mandatory": False
                    }).execute()
                    if ins_res.data:
                        fid = ins_res.data[0]["id"]
            except Exception as e:
                logger.warning(f"Could not auto-create sf_field for '{target_key}': {e}")
                # Secondary lookup fallback
                res_any = client.table("sf_fields").select("id").limit(1).execute()
                if res_any.data:
                    fid = res_any.data[0]["id"]

        if fid:
            try:
                conf_val = int(m.conf) if m.conf is not None else 100
            except (ValueError, TypeError):
                conf_val = 100

            inserts.append({
                "project_id": req.projectId,
                "source_system_id": sys_id,
                "source_field_name": f"[{i}]{m.src}",
                "sf_field_id": fid,
                "transform_rule": m.tr or "trim",
                "confidence": conf_val
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
