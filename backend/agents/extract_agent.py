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
        """
        Dynamically partitions records into pure schema tables (e.g. PerPerson, PerPersonal, EmpEmployment)
        based on the target schemas and field names defined in AI Mapping.
        Strictly isolates columns belonging to each schema and includes the single parent join key in child tables.
        """
        if not harmonized_results:
            return []

        all_cols = list(harmonized_results[0].keys())
        tgt_clean = str(target_object or "").replace(" Data", "").strip() or "Biographical Info"

        # Dynamically fetch mandatory fields from DB sf_fields for target object
        db_mandatory_targets = set()
        try:
            client = supabase_service.get_client()
            clean_obj = str(target_object or "").replace(" Data", "").strip()
            res_obj = client.table("sf_objects").select("id").ilike("name", f"%{clean_obj}%").limit(1).execute()
            if res_obj.data:
                obj_id = res_obj.data[0]["id"]
                res_fields = client.table("sf_fields").select("field_name, sf_structure, is_mandatory").eq("object_id", obj_id).eq("is_mandatory", True).execute()
                for sf in (res_fields.data or []):
                    fn = sf.get("field_name")
                    st = sf.get("sf_structure")
                    if fn:
                        db_mandatory_targets.add(fn.lower())
                        if st:
                            db_mandatory_targets.add(f"{st}.{fn}".lower())
        except Exception as e:
            logger.warning(f"Could not load sf_fields mandatory status: {e}")

        # 1. Parse mappings to group fields strictly by their pure schema prefix
        schema_fields = {}   # schema -> list of dicts {src, target, full_sap}
        schema_order = []

        for m in (mappings or []):
            if isinstance(m, dict):
                m_src = str(m.get("src", "")).strip()
                m_sap = str(m.get("sap", "")).strip()
            else:
                m_src = str(getattr(m, "src", "")).strip()
                m_sap = str(getattr(m, "sap", "")).strip()

            if not m_src or not m_sap:
                continue

            src_clean = re.sub(r"^\[\d+\]\s*", "", m_src).strip()
            sap_clean = re.sub(r"^\[\d+\]\s*", "", m_sap).strip()

            if "." in sap_clean:
                parts = sap_clean.split(".", 1)
                schema = parts[0].strip()
                target_field = parts[1].strip()
            else:
                schema = tgt_clean
                target_field = sap_clean.strip()

            if schema not in schema_fields:
                schema_fields[schema] = []
                schema_order.append(schema)

            schema_fields[schema].append({
                "src": src_clean,
                "target": target_field,
                "full_sap": sap_clean
            })

        # If no schema mappings were detected, fallback to single clean table
        if not schema_fields:
            meta_keywords = ["hris element", "business key:", "effective-dated:", "entity perperson", "technical name"]
            clean_cols = [c for c in all_cols if not any(kw in str(c).lower() for kw in meta_keywords) and str(c).upper() != "SOURCE"]
            return [{
                "table_name": tgt_clean,
                "columns": clean_cols if clean_cols else all_cols,
                "key_columns": [],
                "row_count": len(harmonized_results)
            }]

        tables_list = []
        all_cols_norm = {re.sub(r'[^a-zA-Z0-9]', '', str(c)).lower() for c in all_cols}

        for schema in schema_order:
            fields = schema_fields.get(schema, [])
            if not fields:
                continue

            # Pure mapped columns for this schema - no arbitrary synthetic key injections
            cols = [f["target"] for f in fields]
            unique_cols = list(dict.fromkeys(cols))

            # Dynamically identify key columns strictly if mandatory in DB or mapping
            key_cols = []
            for f in fields:
                tgt = f["target"]
                full_sap = f["full_sap"]
                is_mand = (
                    tgt.lower() in db_mandatory_targets or
                    full_sap.lower() in db_mandatory_targets or
                    any(
                        (m.get("req") is True or m.get("is_mandatory") is True)
                        for m in (mappings or [])
                        if isinstance(m, dict) and (
                            str(m.get("sap", "")).lower() == full_sap.lower() or
                            str(m.get("sap", "")).lower() == tgt.lower() or
                            str(m.get("src", "")).lower() == f["src"].lower()
                        )
                    )
                )
                if is_mand and tgt not in key_cols:
                    key_cols.append(tgt)

            # If multiple schemas exist, check if this schema has any fields present in harmonized_results
            if len(schema_order) > 1 and harmonized_results:
                schema_fields_norm = {
                    re.sub(r'[^a-zA-Z0-9]', '', str(f["target"])).lower()
                    for f in fields
                } | {
                    re.sub(r'[^a-zA-Z0-9]', '', str(f["src"])).lower()
                    for f in fields
                }
                matching_cols = schema_fields_norm.intersection(all_cols_norm)
                # If zero columns match harmonized_results, prune this empty phantom schema
                if not matching_cols:
                    has_data = any(
                        any(str(row.get(f["target"], "")).strip() or str(row.get(f["src"], "")).strip() for f in fields)
                        for row in harmonized_results[:10]
                    )
                    if not has_data:
                        continue

            tables_list.append({
                "table_name": schema,  # Pure Schema Name (e.g., EmpJob, PerPerson, PerPersonal)
                "columns": unique_cols,
                "key_columns": key_cols,
                "row_count": len(harmonized_results)
            })

        # Fallback: if all schemas were pruned, retain first schema
        if not tables_list and schema_order:
            first_schema = schema_order[0]
            fields = schema_fields.get(first_schema, [])
            unique_cols = list(dict.fromkeys([f["target"] for f in fields]))
            key_cols = [
                f["target"] for f in fields
                if f["target"].lower() in db_mandatory_targets or f["full_sap"].lower() in db_mandatory_targets
            ]
            tables_list.append({
                "table_name": first_schema,
                "columns": unique_cols if unique_cols else all_cols,
                "key_columns": key_cols,
                "row_count": len(harmonized_results)
            })

        return tables_list

    group_records_by_sf_structure = group_records_by_sap_structure


