import os
import sys
import warnings

# Suppress Pyarrow / Pandas Deprecation warnings
warnings.filterwarnings("ignore")

import pandas as pd
import numpy as np

# Add parent directory to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from services.supabase_client import supabase_service

def import_sf_fields():
    client = supabase_service.get_client()
    
    data_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
    
    files_to_process = [
        {
            "candidates": [
                "SuccessFactors_Biographical_Info_100_Target_Field_Candidates.xlsx",
                "SuccessFactors_Biographical_Info_Mapping_Template.xlsx"
            ],
            "object_name": "Biographical Info",
            "desc": "SuccessFactors Biographical Info (PerPerson)"
        },
        {
            "candidates": [
                "SuccessFactors_Employment_Details_100_Target_Field_Candidates.xlsx",
                "SuccessFactors_Employment_Details_Mapping_Template.xlsx"
            ],
            "object_name": "Employment Details",
            "desc": "SuccessFactors Employment Details (EmpEmployment)"
        },
        {
            "candidates": [
                "SuccessFactors_Personal_Info_100_Target_Field_Candidates.xlsx",
                "SuccessFactors_Personal_Info_Mapping_Template.xlsx"
            ],
            "object_name": "Personal Info",
            "desc": "SuccessFactors Personal Info (PerPersonal)"
        },
        {
            "candidates": [
                "SuccessFactors_Job_Info_100_Target_Field_Candidates.xlsx",
                "SuccessFactors_Job_Info_Mapping_Template.xlsx"
            ],
            "object_name": "Job Info",
            "desc": "SuccessFactors Job Info (EmpJob)"
        },
        {
            "candidates": [
                "SuccessFactors_Compensation_Info_100_Target_Field_Candidates.xlsx",
                "SuccessFactors_Compensation_Info_Mapping_Template.xlsx"
            ],
            "object_name": "Compensation Info",
            "desc": "SuccessFactors Compensation Info (EmpCompensation)"
        },
        {
            "candidates": [
                "SuccessFactors_Pay_Component_Recurring_100_Target_Field_Candidates.xlsx",
                "SuccessFactors_Pay_Component_Recurring_Mapping_Template.xlsx"
            ],
            "object_name": "Pay Component Recurring",
            "desc": "SuccessFactors Pay Component Recurring"
        },
        {
            "candidates": [
                "SuccessFactors_Pay_Component_Non_Recurring_100_Target_Field_Candidates.xlsx",
                "SuccessFactors_Pay_Component_Non_Recurring_Mapping_Template.xlsx"
            ],
            "object_name": "Pay Component Non Recurring",
            "desc": "SuccessFactors Pay Component Non Recurring"
        }
    ]
    
    for file_info in files_to_process:
        found_file = None
        for filename in file_info["candidates"]:
            candidate_path = os.path.join(data_dir, filename)
            if os.path.exists(candidate_path):
                found_file = filename
                filepath = candidate_path
                break

        if not found_file:
            print(f"Skipping {file_info['object_name']} - No candidate Excel file found in {data_dir}.")
            continue

        print(f"\n--- Processing {found_file} for sf_object '{file_info['object_name']}' ---")

        # 1. Get or create sf_object ID
        res_obj = client.table("sf_objects").select("id").ilike("name", file_info["object_name"]).execute()
        if not res_obj.data:
            print(f"Creating sf_object '{file_info['object_name']}'...")
            client.table("sf_objects").insert({"name": file_info["object_name"], "description": file_info["desc"]}).execute()
            res_obj = client.table("sf_objects").select("id").ilike("name", file_info["object_name"]).execute()
            
        obj_id = res_obj.data[0]["id"]
        
        # 2. Read Excel file
        xl = pd.ExcelFile(filepath)
        fields_to_insert = []
        seen_keys = set()
        
        for sheet_name in xl.sheet_names:
            df = pd.read_excel(filepath, sheet_name=sheet_name)
            if df.empty:
                continue
                
            # Clean column names
            df.columns = [str(c).strip() for c in df.columns]
            
            # Map column names flexibly
            col_field = next((c for c in df.columns if any(k in c.lower() for k in ["field", "technical", "column", "target"])), None)
            col_desc = next((c for c in df.columns if any(k in c.lower() for k in ["description", "label", "name"])), None)
            col_type = next((c for c in df.columns if "type" in c.lower() or "data" in c.lower()), None)
            col_length = next((c for c in df.columns if "length" in c.lower() or "len" in c.lower()), None)
            col_importance = next((c for c in df.columns if "importance" in c.lower() or "mandatory" in c.lower() or "required" in c.lower()), None)
            col_structure = next((c for c in df.columns if "structure" in c.lower() or "entity" in c.lower()), None)
            
            if not col_field:
                col_field = df.columns[0]
                
            for idx, row in df.iterrows():
                f_name = str(row.get(col_field, "")).strip()
                if not f_name or f_name.lower() == "nan":
                    continue
                    
                f_desc = str(row.get(col_desc, "")) if col_desc else ""
                f_type = str(row.get(col_type, "")) if col_type else "STRING"
                f_len = str(row.get(col_length, "")) if col_length else ""
                f_imp = str(row.get(col_importance, "")) if col_importance else ""
                f_struct = str(row.get(col_structure, "")) if col_structure else file_info["object_name"].replace(" ", "")
                
                f_desc = "" if f_desc.lower() == "nan" else f_desc
                f_type = "STRING" if f_type.lower() == "nan" or not f_type else f_type
                f_len = "" if f_len.lower() == "nan" else f_len
                f_struct = file_info["object_name"].replace(" ", "") if f_struct.lower() == "nan" or not f_struct else f_struct
                
                # Deduplicate unique constraint key: (object_id, sf_structure, field_name)
                dedup_key = (obj_id, f_struct, f_name)
                if dedup_key in seen_keys:
                    continue
                seen_keys.add(dedup_key)
                
                is_mandatory = "mandatory" in f_imp.lower() or "yes" in f_imp.lower() or "true" in f_imp.lower() or "required" in f_imp.lower()
                
                fields_to_insert.append({
                    "object_id": obj_id,
                    "sheet_name": sheet_name,
                    "group_name": file_info["object_name"],
                    "field_description": f_desc,
                    "type": f_type,
                    "length": f_len,
                    "decimals": "",
                    "sf_structure": f_struct,
                    "field_name": f_name,
                    "is_mandatory": is_mandatory
                })
        
        print(f"Found {len(fields_to_insert)} unique target fields for '{file_info['object_name']}'. Upserting into sf_fields...")
        
        # Batch upsert with on_conflict handling
        batch_size = 50
        inserted_count = 0
        for i in range(0, len(fields_to_insert), batch_size):
            batch = fields_to_insert[i:i+batch_size]
            try:
                client.table("sf_fields").upsert(batch, on_conflict="object_id,sf_structure,field_name").execute()
                inserted_count += len(batch)
            except Exception as e:
                print(f"Error upserting batch: {e}")
                
        print(f"Successfully imported {inserted_count} fields into sf_fields for '{file_info['object_name']}'!")
        
    print("\nAll SuccessFactors field imports completed successfully!")

if __name__ == "__main__":
    import_sf_fields()
