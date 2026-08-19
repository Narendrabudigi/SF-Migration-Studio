import json
import logging
import requests
import pandas as pd
import re
import urllib3
from services.llm_orchestrator import llm_orchestrator
from services.supabase_client import supabase_service
from agents.validation_agent import ValidationAgent

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

logger = logging.getLogger(__name__)

def norm_str(s: str) -> str:
    if not s:
        return ""
    return re.sub(r'[^a-z0-9]', '', str(s).lower())

def get_val_from_row(row: dict, src_key: str) -> str:
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

class ExtractAgent:
    def perform_extraction(self, base_url, client, username, password, target_object, mappings, dynamic_rules: list = None):
        # 1. Build dynamic $select OData query
        source_fields = set()
        for m in mappings:
            if m.get('src'):
                parts = m['src'].split('.')
                field = parts[-1] if len(parts) > 1 else m['src']
                source_fields.add(field)

        if not source_fields:
            raise ValueError("No valid source fields found in mapping.")

        select_query = ",".join(source_fields)
        
        base_url = base_url.rstrip('/')
        if target_object in ['CUSTOMER', 'VENDOR', 'Customer', 'Vendor']:
            api_path = f"/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_BusinessPartner?$select={select_query}&$top=1000"
        elif target_object in ['MATERIAL', 'Material']:
            api_path = f"/sap/opu/odata/sap/API_PRODUCT_SRV/A_Product?$select={select_query}&$top=1000"
        else:
            raise ValueError(f"Unsupported target object: {target_object}")

        fetch_url = f"{base_url}{api_path}"
        if client:
            fetch_url += f"&sap-client={client}"

        # 2. Fetch Live Data
        session = requests.Session()
        session.trust_env = False
        
        print(f"Executing extraction: {fetch_url}")
        res = session.get(
            fetch_url,
            auth=(username, password),
            headers={"Accept": "application/json"},
            timeout=30,
            verify=False
        )

        if res.status_code != 200:
            raise Exception(f"Failed to fetch data from SAP: {res.status_code} {res.text[:200]}")

        data = res.json()
        results = data.get("d", {}).get("results", [])

        # 3. Apply Transformations and Dynamic Rule Evaluation
        val_agent = ValidationAgent()

        harmonized_results = []
        for row in results:
            harmonized_row = {}
            for m in mappings:
                src_full = m.get('src')
                if not src_full:
                    continue
                
                sap_key = m.get('sap')
                transform = m.get('tr', 'none')
                
                raw_val = get_val_from_row(row, src_full)

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
            
            # Evaluate active dynamic rules during extraction if provided
            if dynamic_rules:
                for drule in dynamic_rules:
                    dcode = drule.get("python_code")
                    if dcode:
                        is_viol = val_agent._eval_dynamic_rule(dcode, harmonized_row)
                        if is_viol:
                            dfield = drule.get("field") or "GENERAL"
                            harmonized_row[f"_rule_violation_{drule.get('id', 'DYNAMIC')}"] = f"Violation on {dfield}: {drule.get('error_message', 'Invalid value')}"

            harmonized_results.append(harmonized_row)

        return harmonized_results

    def generate_eda_quality_report(self, harmonized_results, target_object, mappings=None):
        if not harmonized_results:
            return {
                "eda_stats": [],
                "compliance_data": [],
                "summary_metrics": {
                    "total_records": 0,
                    "total_fields": 0,
                    "healthy_count": 0,
                    "warning_count": 0,
                    "critical_count": 0,
                    "total_anomalies": 0,
                    "score": 100,
                    "grade": "A",
                    "warnings": [],
                    "recommendations": []
                },
                "ai_report": {
                    "report_title": f"Executive Data Quality Report: {target_object} Master Data",
                    "overall_score": 100,
                    "health_grade": "A",
                    "executive_summary": "No data extracted for analysis.",
                    "critical_warnings": [],
                    "recommendations": []
                }
            }
            
        # 1. Python EDA Analysis using pandas
        df = pd.DataFrame(harmonized_results)
        total_rows = len(df)
        
        # Load SuccessFactors field metadata from Supabase if available
        sf_fields = []
        obj_name = str(target_object) if target_object else "Biographical Info"
        try:
            from services.supabase_client import supabase_service
            client = supabase_service.get_client()
            res_obj = client.table("sf_objects").select("id").ilike("name", obj_name).execute()
            if not res_obj.data:
                res_obj = client.table("sf_objects").select("id").ilike("name", "Biographical Info").execute()
            if res_obj.data:
                obj_id = res_obj.data[0]["id"]
                res_fields = client.table("sf_fields").select("*").eq("object_id", obj_id).execute()
                sf_fields = res_fields.data or []
        except Exception as e:
            logger.warning(f"Could not load sf_fields for EDA mapping: {e}")

        # Build mapping lookup
        mapping_dict = {}
        for m in (mappings or []):
            if m.get("src"):
                mapping_dict[str(m["src"])] = m
                mapping_dict[str(m["src"]).split(".")[-1]] = m

        eda_stats = []
        total_null_pct = 0.0
        healthy_count = 0
        warning_count = 0
        critical_count = 0
        total_anomalies_count = 0
        
        deterministic_warnings = []
        deterministic_recommendations = []

        for col in df.columns:
            series = df[col]
            clean_series = series.replace(r'^\s*$', pd.NA, regex=True)
            
            null_count = int(clean_series.isna().sum())
            populated_count = total_rows - null_count
            null_pct = round((null_count / total_rows) * 100, 1) if total_rows > 0 else 0.0
            completeness_pct = round(100.0 - null_pct, 1)
            unique_count = int(clean_series.nunique())
            
            non_na_str = series.dropna().astype(str)
            lengths = non_na_str.map(len)
            max_len = int(lengths.max()) if not lengths.empty else 0
            min_len = int(lengths.min()) if not lengths.empty else 0
            
            # Format Anomalies Detection
            ws_count = int(non_na_str.apply(lambda x: x != x.strip()).sum()) if not non_na_str.empty else 0
            len_over_40_count = int(non_na_str.apply(lambda x: len(x) > 40).sum()) if not non_na_str.empty else 0
            
            # Check mixed alphanumeric vs numeric types
            is_num = non_na_str.apply(lambda x: x.replace('.', '', 1).isdigit() or (x.startswith('-') and x[1:].replace('.', '', 1).isdigit()))
            num_rows = int(is_num.sum())
            non_num_rows = len(non_na_str) - num_rows
            is_mixed_type = bool(num_rows > 0 and non_num_rows > 0)
            mixed_type_count = min(num_rows, non_num_rows) if is_mixed_type else 0
            
            # Combined format anomaly count
            def is_anomaly(val):
                if pd.isna(val) or val == "":
                    return False
                s = str(val)
                return bool(s != s.strip() or len(s) > 40)
            
            format_anomaly_count = int(series.apply(is_anomaly).sum())
            if is_mixed_type and format_anomaly_count == 0:
                format_anomaly_count = mixed_type_count
            
            total_anomalies_count += format_anomaly_count

            # Determine mandatory status from mapping / sf_fields
            is_mandatory = False
            m_entry = mapping_dict.get(col) or mapping_dict.get(col.split(".")[-1])
            if m_entry:
                if m_entry.get("req") is True:
                    is_mandatory = True
                sap_val = str(m_entry.get("sap", ""))
                sap_field_clean = sap_val.split(".")[-1]
                for sf in sf_fields:
                    if sf.get("field_name") == sap_field_clean and sf.get("is_mandatory"):
                        is_mandatory = True
                        break

            is_constant = bool(unique_count == 1 and populated_count > 0)
            
            if is_mandatory and null_count > 0:
                status = "CRITICAL"
            elif null_pct > 50:
                status = "CRITICAL"
            elif ws_count > 0 or is_mixed_type or (not is_mandatory and null_count == total_rows) or null_pct > 10:
                status = "WARNING"
            else:
                status = "HEALTHY"
                
            if status == "HEALTHY":
                healthy_count += 1
            elif status == "WARNING":
                warning_count += 1
            else:
                critical_count += 1
                
            total_null_pct += null_pct

            # Anomaly tags
            anomaly_badges = []
            if ws_count > 0:
                anomaly_badges.append(f"Whitespace ({ws_count})")
            if is_mixed_type:
                anomaly_badges.append(f"Mixed Type ({mixed_type_count})")
            if len_over_40_count > 0:
                anomaly_badges.append(f"Len > 40 ({len_over_40_count})")
            if is_constant:
                anomaly_badges.append("Constant")

            eda_stats.append({
                "field": col,
                "is_mandatory": is_mandatory,
                "null_count": null_count,
                "populated_count": populated_count,
                "null_percentage": null_pct,
                "completeness_pct": completeness_pct,
                "unique_count": unique_count,
                "max_length": max_len,
                "min_length": min_len,
                "ws_count": ws_count,
                "mixed_type_count": mixed_type_count,
                "length_anomaly_count": len_over_40_count,
                "format_anomaly_count": format_anomaly_count,
                "anomalies": anomaly_badges,
                "is_constant": is_constant,
                "is_mixed_type": is_mixed_type,
                "status": status
            })

            # Rules
            if is_mandatory and null_count > 0:
                deterministic_warnings.append(f"Mandatory field [{col}] has {null_count} missing values.")
            if len_over_40_count > 0:
                deterministic_warnings.append(f"Field [{col}] has {len_over_40_count} records exceeding standard 40-char limit (Max: {max_len}).")
            if ws_count > 0:
                deterministic_recommendations.append(f"Apply TRIM transform on [{col}]: {ws_count} records contain leading/trailing whitespaces.")
            if is_constant:
                deterministic_recommendations.append(f"[{col}] has constant value across all rows. Consider default configuration in SAP.")
            if is_mixed_type:
                deterministic_recommendations.append(f"[{col}] contains mixed alphanumeric data types. Verify data type conversion.")

        num_fields = max(len(eda_stats), 1)
        mandatory_fields = [f for f in eda_stats if f["is_mandatory"]]
        
        # Calculate Score
        if mandatory_fields:
            mand_errors = sum(f["null_count"] for f in mandatory_fields)
            total_mand_cells = len(mandatory_fields) * total_rows
            calculated_score = max(0, min(100, int(round(((total_mand_cells - mand_errors) / total_mand_cells) * 100))))
        else:
            all_errors = sum(f["null_count"] for f in eda_stats)
            total_cells = num_fields * total_rows
            calculated_score = max(0, min(100, int(round(((total_cells - all_errors) / total_cells) * 100))))

        if calculated_score >= 95:
            calculated_grade = "A"
        elif calculated_score >= 80:
            calculated_grade = "B"
        elif calculated_score >= 65:
            calculated_grade = "C"
        else:
            calculated_grade = "D"

        if not deterministic_warnings and not deterministic_recommendations:
            deterministic_recommendations.append("Data quality looks excellent. Ready to proceed to harmonization.")

        # Compliance Data (Mandatory vs Optional)
        mandatory_healthy = sum(1 for f in mandatory_fields if f["status"] == "HEALTHY")
        mandatory_critical = sum(1 for f in mandatory_fields if f["status"] == "CRITICAL")
        mandatory_warning = sum(1 for f in mandatory_fields if f["status"] == "WARNING")
        
        optional_fields = [f for f in eda_stats if not f["is_mandatory"]]
        optional_healthy = sum(1 for f in optional_fields if f["status"] == "HEALTHY")
        optional_warning = sum(1 for f in optional_fields if f["status"] == "WARNING")
        optional_critical = sum(1 for f in optional_fields if f["status"] == "CRITICAL")

        compliance_data = [
            {
                "name": "Mandatory",
                "Healthy": mandatory_healthy,
                "Warning": mandatory_warning,
                "Critical": mandatory_critical,
                "Total": len(mandatory_fields)
            },
            {
                "name": "Optional",
                "Healthy": optional_healthy,
                "Warning": optional_warning,
                "Critical": optional_critical,
                "Total": len(optional_fields)
            }
        ]

        summary_metrics = {
            "title": f"Deterministic Data Quality Report: {target_object} Master Data",
            "summary": f"Automated quality scan completed across {total_rows} records and {num_fields} fields with readiness score {calculated_score}/100.",
            "score": calculated_score,
            "grade": calculated_grade,
            "healthy": healthy_count,
            "warning": warning_count,
            "critical": critical_count,
            "total_anomalies": total_anomalies_count,
            "totalFields": num_fields,
            "totalRecords": total_rows,
            "warnings": deterministic_warnings,
            "recommendations": deterministic_recommendations
        }

        # 2. AI Executive Summary Generation
        eda_summary_json = json.dumps({
            "total_records": total_rows,
            "total_fields": num_fields,
            "calculated_score": calculated_score,
            "grade": calculated_grade,
            "health_distribution": {
                "healthy_fields": healthy_count,
                "warning_fields": warning_count,
                "critical_fields": critical_count,
                "total_anomalies": total_anomalies_count
            },
            "critical_fields_sample": [f["field"] for f in eda_stats if f["status"] == "CRITICAL"][:10],
            "field_statistics": [{
                "field": f["field"],
                "null_pct": f["null_percentage"],
                "unique_count": f["unique_count"],
                "format_anomalies": f["format_anomaly_count"],
                "status": f["status"]
            } for f in eda_stats[:30]]
        }, indent=2)
        
        prompt = f"""You are a Lead Data Migration Architect for SAP S/4HANA.
I have run an Exploratory Data Analysis (EDA) on an extracted payload for {target_object}.
Here are the mathematical statistics computed via Python Pandas:

{eda_summary_json}

Based on these statistics, generate a highly professional 'Executive Data Quality Report'.
You MUST return the output as a valid JSON object matching this exact schema:
{{
  "report_title": "Executive Data Quality Report: {target_object} Master Data for S/4HANA Migration",
  "overall_score": {calculated_score},
  "health_grade": "{calculated_grade}",
  "executive_summary": "String (1-2 clear, executive-ready paragraphs analyzing overall health and migration readiness)",
  "critical_warnings": ["String array of 2-4 major issues with specific field names and percentages"],
  "recommendations": ["String array of 3-5 concrete action items formatted as 'Title: Description'"]
}}
"""
        try:
            report_str = llm_orchestrator.generate_generic(system_prompt="You are a SAP Data Migration Architect Expert. Always return valid JSON.", user_prompt=prompt)
            if report_str.startswith("```json"):
                report_str = report_str[7:].rstrip("`\n")
            elif report_str.startswith("```"):
                report_str = report_str[3:].rstrip("`\n")
                
            report_json = json.loads(report_str)
            if "overall_score" not in report_json:
                report_json["overall_score"] = calculated_score
            if "health_grade" not in report_json:
                report_json["health_grade"] = calculated_grade
            
            return {
                "eda_stats": eda_stats,
                "compliance_data": compliance_data,
                "summary_metrics": summary_metrics,
                "ai_report": report_json
            }
        except Exception as e:
            logger.error(f"Failed to generate LLM report: {e}")
            return {
                "eda_stats": eda_stats,
                "compliance_data": compliance_data,
                "summary_metrics": summary_metrics,
                "ai_report": {
                    "report_title": f"Executive Data Quality Report: {target_object} Master Data",
                    "overall_score": calculated_score,
                    "health_grade": calculated_grade,
                    "executive_summary": f"Exploratory Data Analysis completed across {total_rows} records and {num_fields} fields with an overall completeness score of {calculated_score}%.",
                    "critical_warnings": deterministic_warnings[:4] if deterministic_warnings else [f"{critical_count} field(s) have critical quality issues."],
                    "recommendations": deterministic_recommendations[:4] if deterministic_recommendations else ["Review unpopulated mandatory fields before starting harmonization."]
                }
            }

    def group_records_by_sap_structure(self, harmonized_results: list, target_object: str, mappings: list) -> list:
        if not harmonized_results:
            return []

        all_cols = list(harmonized_results[0].keys())
        tgt_upper = str(target_object).upper()
        
        # Determine target SuccessFactors object category
        if "BIOGRAPHICAL" in tgt_upper:
            obj_name = "Biographical Info"
        elif "PERSONAL" in tgt_upper:
            obj_name = "Personal Info"
        elif "EMPLOYMENT" in tgt_upper:
            obj_name = "Employment Details"
        elif "JOB" in tgt_upper:
            obj_name = "Job Info"
        elif "COMPENSATION" in tgt_upper:
            obj_name = "Compensation Info"
        elif "RECURRING" in tgt_upper:
            obj_name = "Pay Component Recurring"
        elif "NON RECURRING" in tgt_upper or "NON-RECURRING" in tgt_upper:
            obj_name = "Pay Component Non Recurring"
        else:
            obj_name = target_object or "Biographical Info"

        # 1. Fetch SuccessFactors Schema metadata from database
        sf_fields = []
        try:
            from services.supabase_client import supabase_service
            client = supabase_service.get_client()
            res_obj = client.table("sf_objects").select("id").ilike("name", str(target_object)).execute()
            if not res_obj.data:
                res_obj = client.table("sf_objects").select("id").ilike("name", obj_name).execute()
            if res_obj.data:
                obj_id = res_obj.data[0]["id"]
                res_fields = client.table("sf_fields").select("*").eq("object_id", obj_id).execute()
                sf_fields = res_fields.data or []
        except Exception as e:
            logger.warning(f"Could not load sf_fields for grouping: {e}")

        # Helper to get all sheets a column belongs to
        def get_col_sheets(col_name: str) -> list:
            clean_col = re.sub(r"^\[\d+\]", "", col_name)
            
            # Find in mappings
            m_found = None
            sap_full = ""
            for m in (mappings or []):
                if isinstance(m, dict):
                    m_src = str(m.get("src", ""))
                    m_sap = str(m.get("sap", ""))
                else:
                    m_src = str(getattr(m, "src", ""))
                    m_sap = str(getattr(m, "sap", ""))

                m_clean = re.sub(r"^\[\d+\]", "", m_src)
                if (m_src == col_name or m_clean == clean_col or 
                    m_src.split(".")[-1] == clean_col or clean_col.split(".")[-1] == m_src or
                    m_sap == col_name or m_sap.split(".")[-1] == col_name or m_sap.split(".")[-1] == clean_col):
                    m_found = m
                    sap_full = m_sap
                    break
            
            if not sap_full and "." in col_name:
                sap_full = col_name
            elif not sap_full and m_found:
                sap_full = str(m_found.get("sap", "")) if isinstance(m_found, dict) else str(getattr(m_found, "sap", ""))
            
            sap_struct = sap_full.split(".")[0] if "." in sap_full else ""
            sap_field = sap_full.split(".")[-1] if "." in sap_full else (col_name.split(".")[-1] if "." in col_name else col_name)
            sap_field_upper = sap_field.upper()

            sheets_found = []
            if sf_fields:
                for sf in sf_fields:
                    sf_name = str(sf.get("field_name", "")).upper()
                    if sf_name == sap_field_upper:
                        sheet = sf.get("sheet_name") or sf.get("group_name") or sf.get("sf_structure") or sf.get("sap_structure") or f"{obj_name} Data"
                        if not sheet.lower().endswith("data"):
                            sheet = f"{sheet} Data"
                        if sheet not in sheets_found:
                            sheets_found.append(sheet)

            if not sheets_found:
                if sap_struct:
                    st_upper = sap_struct.upper()
                    if any(k in st_upper for k in ["PERPERSON", "BIOGRAPHICAL", "KNA1", "LFA1", "MARA"]):
                        sheet = "Biographical Info Data"
                    elif any(k in st_upper for k in ["PERPERSONAL", "PERSONAL"]):
                        sheet = "Personal Info Data"
                    elif any(k in st_upper for k in ["EMPEMPLOYMENT", "EMPLOYMENT"]):
                        sheet = "Employment Details Data"
                    elif any(k in st_upper for k in ["EMPJOB", "JOB", "SALES"]):
                        sheet = "Job Info Data"
                    elif any(k in st_upper for k in ["EMPCOMPENSATION", "COMPENSATION", "COMP", "PAY"]):
                        sheet = "Compensation Info Data"
                    else:
                        sheet = f"{sap_struct} Data"
                    sheets_found.append(sheet)
                else:
                    cn_upper = clean_col.upper()
                    if any(k in cn_upper for k in ["PERSON_ID", "PERSONID", "BIOGRAPHICAL", "BIRTH"]):
                        sheet = "Biographical Info Data"
                    elif any(k in cn_upper for k in ["FIRST_NAME", "LAST_NAME", "GENDER", "MARITAL"]):
                        sheet = "Personal Info Data"
                    elif any(k in cn_upper for k in ["USER_ID", "USERID", "HIRE_DATE", "EMPLOYMENT"]):
                        sheet = "Employment Details Data"
                    elif any(k in cn_upper for k in ["JOB_CODE", "DEPARTMENT", "LOCATION", "DIVISION", "COMPANY"]):
                        sheet = "Job Info Data"
                    elif any(k in cn_upper for k in ["PAY", "COMPENSATION", "SALARY", "CURRENCY"]):
                        sheet = "Compensation Info Data"
                    else:
                        sheet = f"{obj_name} Data"
                    sheets_found.append(sheet)

            return sheets_found

        # Helper to determine if column is a key column
        def is_column_key(col_name: str) -> bool:
            clean_col = re.sub(r"^\[\d+\]", "", col_name).upper()
            if any(k in clean_col for k in [
                "PERSON_ID_EXTERNAL", "PERSONIDEXTERNAL", "USER_ID", "USERID",
                "SEQ_NUMBER", "SEQNUMBER", "START_DATE", "STARTDATE", "CODE",
                "CUSTOMER_NUMBER", "LIFNR", "KUNNR", "MATNR", "PARTNER"
            ]):
                return True
            
            sap_full = ""
            for m in (mappings or []):
                if isinstance(m, dict):
                    m_src = str(m.get("src", ""))
                    m_sap = str(m.get("sap", ""))
                else:
                    m_src = str(getattr(m, "src", ""))
                    m_sap = str(getattr(m, "sap", ""))
                m_clean = re.sub(r"^\[\d+\]", "", m_src)
                if m_src == col_name or m_clean == clean_col or m_src.split(".")[-1] == clean_col:
                    sap_full = m_sap
                    break
            
            if sap_full:
                sap_field = sap_full.split(".")[-1].upper()
                if sap_field in ["PERSON-ID-EXTERNAL", "USER-ID", "START-DATE", "SEQ-NUMBER", "KUNNR", "LIFNR", "MATNR"] or "NUM" in sap_field or "ID" in sap_field:
                    return True
            return False

        # 2. Group columns by sheet dynamically
        cols_by_table = {}
        for col in all_cols:
            sheets = get_col_sheets(col)
            for sheet in sheets:
                if sheet not in cols_by_table:
                    cols_by_table[sheet] = []
                if col not in cols_by_table[sheet]:
                    cols_by_table[sheet].append(col)

        # 3. Sort key columns first for each table, and ensure main primary key is present in all sheets
        main_keys = []
        for c in all_cols:
            c_clean = re.sub(r"^\[\d+\]", "", c).upper().replace("_", "-")
            if any(k == c_clean or k in c_clean for k in ["PERSON-ID-EXTERNAL", "USER-ID", "KUNNR", "LIFNR", "MATNR", "ACCOUNT-NUMBER", "PARTY-NUMBER"]):
                if c not in main_keys:
                    main_keys.append(c)

        result_tables = []
        for sheet, cols in cols_by_table.items():
            if not cols:
                continue
            sheet_cols = list(cols)
            for mk in reversed(main_keys):
                if mk not in sheet_cols:
                    sheet_cols.insert(0, mk)

            key_cols = [c for c in sheet_cols if is_column_key(c)]
            non_key_cols = [c for c in sheet_cols if c not in key_cols]
            final_cols = key_cols + non_key_cols
            
            result_tables.append({
                "table_name": sheet,
                "columns": final_cols,
                "row_count": len(harmonized_results)
            })

        return result_tables

    group_records_by_sf_structure = group_records_by_sap_structure

