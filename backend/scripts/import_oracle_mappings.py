import os
import sys
import warnings

warnings.filterwarnings("ignore", category=DeprecationWarning, message=".*Pyarrow.*")

import pandas as pd

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from services.supabase_client import supabase_service

def import_oracle_mappings():
    client = supabase_service.get_client()
    
    data_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
    filepath = os.path.join(data_dir, "SAP_To_Oracle_Customer.csv")
    
    if not os.path.exists(filepath):
        print(f"File not found: {filepath}")
        return
        
    print(f"--- Processing {filepath} ---")
    
    # Get Customer object ID
    res_obj = client.table("sap_objects").select("id").ilike("name", "Customer").execute()
    if not res_obj.data:
        print("Object 'Customer' not found. Please run seed_supabase.py first.")
        return
    obj_id = res_obj.data[0]["id"]
    
    # Get ORACLE_EBS source system ID
    res_sys = client.table("source_systems").select("id").ilike("name", "ORACLE_EBS").execute()
    if not res_sys.data:
        print("Source system 'ORACLE_EBS' not found. Please run seed_supabase.py first.")
        return
    sys_id = res_sys.data[0]["id"]
    
    # Fetch all SAP fields for Customer object to map structure/field to ID
    print("Fetching existing SAP fields for Customer object...")
    res_sap_fields = client.table("sap_fields").select("id, sap_structure, field_name").eq("object_id", obj_id).execute()
    
    # Create a lookup dictionary: (structure, field_name) -> id
    sap_field_lookup = {}
    for sf in res_sap_fields.data:
        struct = str(sf.get("sap_structure", "")).strip()
        fname = str(sf.get("field_name", "")).strip()
        sap_field_lookup[(struct, fname)] = sf["id"]
        
    # Read the CSV file
    df = pd.read_csv(filepath)
    # Strip column names
    df.columns = [str(c).strip() for c in df.columns]
    
    # Clear existing source fields for ORACLE_EBS Customer to prevent duplicates
    print("Clearing existing source fields for ORACLE_EBS Customer...")
    client.table("source_fields").delete().eq("source_system_id", sys_id).eq("object_id", obj_id).execute()
    
    source_fields_inserted = 0
    
    for idx, row in df.iterrows():
        sap_full_field = str(row.get("SAP Field", "")).strip()
        oracle_table = str(row.get("Oracle Table", "")).strip()
        oracle_field = str(row.get("Oracle Field Name", "")).strip()
        
        sap_struct = ""
        sap_field = ""
        if "." in sap_full_field:
            parts = sap_full_field.split(".", 1)
            sap_struct = parts[0]
            sap_field = parts[1]
        
        if not oracle_field or oracle_field == "nan":
            continue
            
        oracle_table = "" if oracle_table == "nan" else oracle_table
        
        # Find corresponding SAP field ID
        target_sap_id = None
        if sap_struct and sap_field and sap_struct != "nan" and sap_field != "nan":
            target_sap_id = sap_field_lookup.get((sap_struct, sap_field))
            
        # Check if row already exists
        res_sf = client.table("source_fields").select("id").eq("source_system_id", sys_id).eq("object_id", obj_id).eq("oracle_ebs_table", oracle_table).eq("oracle_ebs_field_name", oracle_field).execute()
        
        if not res_sf.data:
            payload = {
                "source_system_id": sys_id,
                "object_id": obj_id,
                "oracle_ebs_table": oracle_table,
                "oracle_ebs_field_name": oracle_field
            }
            if target_sap_id:
                payload["sap_field_id"] = target_sap_id
                
            client.table("source_fields").insert(payload).execute()
            source_fields_inserted += 1
            
    print(f"Successfully inserted {source_fields_inserted} distinct Oracle EBS source fields.")
    print("Done!")

if __name__ == "__main__":
    import_oracle_mappings()
