import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from services.supabase_client import supabase_service

def seed():
    client = supabase_service.get_client()
    
    # 1. Insert sf_objects (7 SuccessFactors entities)
    print("Inserting SuccessFactors Objects into sf_objects...")
    objects = [
        {"name": "Biographical Info", "description": "SuccessFactors Employee Central Biographical Info (PerPerson)"},
        {"name": "Employment Details", "description": "SuccessFactors Employee Central Employment Details (EmpEmployment)"},
        {"name": "Personal Info", "description": "SuccessFactors Employee Central Personal Info (PerPersonal)"},
        {"name": "Job Info", "description": "SuccessFactors Employee Central Job Info (EmpJob)"},
        {"name": "Compensation Info", "description": "SuccessFactors Employee Central Compensation Info (EmpCompensation)"},
        {"name": "Pay Component Recurring", "description": "SuccessFactors Employee Central Pay Component Recurring (PayComponentRecurring)"},
        {"name": "Pay Component Non Recurring", "description": "SuccessFactors Employee Central Pay Component Non Recurring (PayComponentNonRecurring)"}
    ]
    for obj in objects:
        try:
            client.table("sf_objects").upsert(obj, on_conflict="name").execute()
            print(f"  [+] Upserted sf_object: {obj['name']}")
        except Exception as e:
            print(f"  [-] Error inserting sf_object {obj['name']}: {e}")
            
    # 2. Insert source_systems (ONLY Excel/CSV)
    print("\nSetting Source Systems (ONLY EXCEL_CSV)...")
    try:
        # Delete old systems to keep only EXCEL_CSV
        existing = client.table("source_systems").select("id, name").execute()
        for s in existing.data or []:
            if s["name"] != "EXCEL_CSV":
                client.table("source_systems").delete().eq("id", s["id"]).execute()
    except Exception as e:
        print(f"  [-] Notice during source systems cleanup: {e}")

    systems = [
        {"name": "EXCEL_CSV"}
    ]
    for sys_obj in systems:
        try:
            client.table("source_systems").upsert(sys_obj, on_conflict="name").execute()
            print(f"  [+] Upserted source_system: {sys_obj['name']}")
        except Exception as e:
            print(f"  [-] Error inserting source_system {sys_obj['name']}: {e}")

    print("\nSeeded SuccessFactors database objects successfully!")

if __name__ == "__main__":
    seed()
