import pandas as pd
import requests
import json
import argparse
import sys
import math
from concurrent.futures import ThreadPoolExecutor, as_completed
import datetime
import os

# ============================================================================
# SUCCESSFACTORS CREDENTIALS & CONFIGURATION
# (Hardcoded for testing as requested - do not use in production!)
# ============================================================================
SF_API_URL = "https://api10preview.sapsf.com/odata/v2/" # Replace with your actual base URL
SF_COMPANY_ID = "rainindustT1"
SF_USERNAME = "ADMINAPI"
SF_PASSWORD = "Welcome@432124$"
ENTITY_NAME = "PerPerson" # e.g., 'User', 'PerPerson', 'EmpEmployment', etc.

def get_auth_credentials():
    """
    SuccessFactors typically uses Basic Auth formatted as username@company_id.
    Update this if your authentication mechanism is different (e.g., OAuth).
    """
    auth_user = f"{SF_USERNAME}@{SF_COMPANY_ID}"
    return auth_user, SF_PASSWORD

def push_to_sf(payload):
    """
    Sends a POST request to the SuccessFactors OData API.
    """
    endpoint = f"{SF_API_URL}/{ENTITY_NAME}"
    auth_user, auth_pass = get_auth_credentials()
    
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json"
    }
    
    try:
        response = requests.post(
            endpoint,
            auth=(auth_user, auth_pass),
            headers=headers,
            json=payload
        )
        # Raise an exception for HTTP error codes
        response.raise_for_status()
        
        # If successful, SF usually returns JSON with the created entity
        return True, response.json()
        
    except requests.exceptions.RequestException as e:
        error_code = "UnknownError"
        error_message = f"HTTP {e.response.status_code}" if hasattr(e, 'response') and e.response is not None else str(e)
        suggestion = "Check your connection, credentials, and payload data."
        
        if hasattr(e, 'response') and e.response is not None:
            try:
                resp_json = e.response.json()
                if "error" in resp_json:
                    error_code = resp_json["error"].get("code", "Unknown Error")
                    error_message = resp_json["error"].get("message", {}).get("value", "No message provided.")
                    
                    # Generate smart suggestions based on common SuccessFactors errors
                    if "navigation property" in error_message.lower():
                        suggestion = "Your Excel file contains a 'Nav' column (like countryOfBirthNav). SuccessFactors does not accept text for these columns. Please delete this column from your Excel file."
                    elif "datetimeoffset" in error_message.lower():
                        suggestion = "A date column has an invalid format. Ensure your Excel dates are recognized as proper Date objects, not plain text."
                    elif "required" in error_message.lower():
                        suggestion = "A mandatory column is missing or empty in your Excel file for this record."
                    else:
                        suggestion = "Verify the data in this row matches what SuccessFactors expects for this field."
            except Exception:
                error_message += f" - {e.response.text[:200]}..."
                
        return False, {"code": error_code, "message": error_message, "suggestion": suggestion}

def clean_payload(payload_dict):
    """
    Cleans the pandas row dictionary. Removes NaN values which break JSON serialization.
    Formats datetime fields to Microsoft JSON Date format required by SuccessFactors.
    """
    clean_dict = {}
    for key, value in payload_dict.items():
        if pd.isna(value):
            continue # Skip null values or you can map them to None
            
        # SuccessFactors cannot accept primitive values for navigation properties or metadata
        if str(key).endswith('Nav') or key == '__metadata' or str(key).upper() == 'STATUS':
            continue
        
        is_date_col = "date" in str(key).lower()
        
        # If the value is a date/time object, format it to /Date(ticks)/
        if isinstance(value, (pd.Timestamp, datetime.datetime)):
            ticks = int(value.timestamp() * 1000)
            clean_dict[key] = f"/Date({ticks})/"
        elif (isinstance(value, str) and "-" in value and ":" in value) or is_date_col:
            # Attempt to convert string dates or any column that has 'date' in its name
            try:
                dt = pd.to_datetime(str(value))
                ticks = int(dt.timestamp() * 1000)
                clean_dict[key] = f"/Date({ticks})/"
            except Exception:
                clean_dict[key] = value
        else:
            clean_dict[key] = value
            
    return clean_dict

def process_single_row(index, row_dict):
    payload = clean_payload(row_dict)
    success, result = push_to_sf(payload)
    return index, success, result

def process_excel(file_path, sheet_name=0, max_workers=5):
    sheet_display = sheet_name if sheet_name != 0 else "Default (First Sheet)"
    print(f"Reading Excel file: {file_path}, Sheet: {sheet_display}")
    try:
        # Read the excel file
        ext = os.path.splitext(file_path)[1].lower()
        if ext == '.csv':
            try:
                df = pd.read_csv(file_path, encoding='utf-8')
            except UnicodeDecodeError:
                # Fallback for CSVs exported from Excel on Windows
                df = pd.read_csv(file_path, encoding='cp1252')
        else:
            engine = 'xlrd' if ext == '.xls' else 'openpyxl'
            df = pd.read_excel(file_path, sheet_name=sheet_name, engine=engine)
        
        success_count = 0
        error_count = 0
        
        print(f"Found {len(df)} records. Starting CONCURRENT upload to {ENTITY_NAME} with {max_workers} threads...\n")
        
        futures = []
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            # Submit all tasks
            for index, row in df.iterrows():
                futures.append(executor.submit(process_single_row, index, row.to_dict()))
                
            # Wait for them to complete as they finish
            for future in as_completed(futures):
                index, success, result = future.result()
                if success:
                    print(f"✅ Row {index + 1} -> Successfully uploaded!")
                    success_count += 1
                else:
                    print(f"\n❌ [ROW {index + 1} FAILED]")
                    print(f"   🛑 Error Code : {result.get('code', 'Error')}")
                    print(f"   💬 Message    : {result.get('message', 'Unknown error occurred')}")
                    print(f"   💡 How to fix : {result.get('suggestion', 'Check the row data.')}\n")
                    error_count += 1
                
        print("\n" + "="*30)
        print("UPLOAD SUMMARY")
        print("="*30)
        print(f"Total Processed : {len(df)}")
        print(f"Successful      : {success_count}")
        print(f"Failed          : {error_count}")
        print("="*30)
        
    except FileNotFoundError:
        print(f"Error: The file '{file_path}' was not found.")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Push data from Excel to SuccessFactors API')
    parser.add_argument('excel_file', help='Path to the Excel file to upload (e.g., data.xlsx)')
    parser.add_argument('--sheet', default=0, help='Name of the sheet to read (default: first sheet)')
    parser.add_argument('--workers', type=int, default=5, help='Number of parallel workers (default: 5)')
    
    args = parser.parse_args()
    process_excel(args.excel_file, sheet_name=args.sheet, max_workers=args.workers)
