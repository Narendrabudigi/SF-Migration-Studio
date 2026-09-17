import os
import sys
from pathlib import Path

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parent.parent
sys.path.append(str(backend_dir))

from services.supabase_client import supabase_service

def main():
    try:
        client = supabase_service.get_client()
        print("Checking if 'Global SF Object' exists in sf_objects...")
        res = client.table("sf_objects").select("id").eq("name", "Global SF Object").execute()
        
        if res.data:
            print(f"Global SF Object already exists with ID: {res.data[0]['id']}")
        else:
            print("Inserting 'Global SF Object'...")
            ins_res = client.table("sf_objects").insert({
                "name": "Global SF Object",
                "description": "Virtual combined object containing fields from all SuccessFactors objects"
            }).execute()
            if ins_res.data:
                print(f"Successfully inserted Global SF Object with ID: {ins_res.data[0]['id']}")
            else:
                print("Failed to insert Global SF Object.")
                
    except Exception as e:
        print(f"Error during execution: {e}")

if __name__ == "__main__":
    main()
