import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from services.supabase_client import supabase_service

def seed():
    client = supabase_service.get_client()
    
    # 1. Insert sap_objects
    print("Inserting SAP Objects...")
    objects = [
        {"name": "Customer", "description": "Customer Master (KNA1)"},
        {"name": "Vendor", "description": "Vendor Master (LFA1)"},
        {"name": "Material", "description": "Material Master (MARA)"}
    ]
    for obj in objects:
        try:
            client.table("sap_objects").upsert(obj, on_conflict="name").execute()
        except Exception as e:
            print(f"Error inserting {obj['name']}: {e}")
            
    # 2. Insert source_systems
    print("Inserting Source Systems...")
    systems = [
        {"name": "SAP_ECC"},
        {"name": "ORACLE_EBS"},
        {"name": "EXCEL_CSV"},
        {"name": "DYNAMICS"},
        {"name": "SALESFORCE"},
        {"name": "LEGACY"}
    ]
    for sys in systems:
        try:
            client.table("source_systems").upsert(sys, on_conflict="name").execute()
        except Exception as e:
            print(f"Error inserting {sys['name']}: {e}")

    print("Seeded database successfully!")

if __name__ == "__main__":
    seed()
