import uuid
import pandas as pd

class TransformationAgent:
    def __init__(self):
        pass

    def apply_mappings(self, cleansed_rows: list[dict], mapping_rules: list[dict]):
        """
        Applies find-and-replace mappings to the cleansed rows based on the mapping rules.
        mapping_rules should be a list of dicts with Source_Field, Source_Data, Target_Data.
        Returns a tuple: (transformed_rows, summary_stats)
        """
        audit_log = []
        rule_lookup = {}
        
        # Build fast lookup dict from the mapping rules
        # { "FIELD_NAME": { "OLD_VAL": "NEW_VAL", ... } }
        for rule in mapping_rules:
            field = str(rule.get("Source_Field", "")).strip()
            src_data = str(rule.get("Source_Data", "")).strip()
            tgt_data = str(rule.get("Target_Data", "")).strip()
            
            if not field:
                continue
            
            if field not in rule_lookup:
                rule_lookup[field] = {}
            rule_lookup[field][src_data] = tgt_data

        modified_rows_count = set()
        total_modifications = 0
        
        # Deep copy to avoid mutating the original input if it's referenced elsewhere
        transformed_rows = [dict(row) for row in cleansed_rows]

        for row_idx, row in enumerate(transformed_rows):
            row_modified = False
            for field, current_val in row.items():
                if field in rule_lookup:
                    # Match string value (case-insensitive & trimmed)
                    str_val = str(current_val).strip() if current_val is not None else ""
                    
                    matched_rule = None
                    if str_val in rule_lookup[field]:
                        matched_rule = rule_lookup[field][str_val]
                    else:
                        # Try case-insensitive lookup
                        for src_k, tgt_v in rule_lookup[field].items():
                            if str_val.lower() == str(src_k).strip().lower():
                                matched_rule = tgt_v
                                break
                    
                    if matched_rule is not None and str_val != matched_rule:
                        audit_log.append({
                            "id": str(uuid.uuid4()),
                            "row": row_idx + 1,
                            "phase": "Transform Mapping",
                            "rule_code": "FIND_REPLACE",
                            "field": field,
                            "old_value": str_val,
                            "new_value": matched_rule,
                            "status": "APPLIED"
                        })
                        row[field] = matched_rule
                        row_modified = True
                        total_modifications += 1

            if row_modified:
                modified_rows_count.add(row_idx)

        summary_stats = {
            "rows_loaded": len(transformed_rows),
            "rows_modified": len(modified_rows_count),
            "total_modifications": total_modifications,
            "audit_log": audit_log,
            "mapping_rules_parsed": len(mapping_rules)
        }

        return transformed_rows, summary_stats

    def apply_ai_script(self, cleansed_rows: list[dict], python_code: str):
        """
        Executes AI-generated Python script on the cleansed rows using Pandas.
        """
        df = pd.DataFrame(cleansed_rows)
        # We ensure string type for consistent diffing since cleansed data should be strings
        df = df.astype(str)
        # Treat "None" and "nan" from string conversion as empty string
        df = df.replace(["None", "nan"], "")
        
        original_df = df.copy()

        local_vars = {}
        code_to_exec = python_code.replace("```python", "").replace("```", "").strip()
        
        try:
            exec(code_to_exec, {}, local_vars)
            if "transform_data" not in local_vars:
                raise ValueError("The AI script must define a function named 'transform_data(df)'.")
                
            transformed_df = local_vars["transform_data"](df)
            
            if not isinstance(transformed_df, pd.DataFrame):
                raise ValueError("The 'transform_data(df)' function must return a Pandas DataFrame.")
        except Exception as e:
            raise RuntimeError(f"Error executing AI python script: {str(e)}")

        # Convert back to strings and handle NAs created by the script
        transformed_df = transformed_df.astype(str).replace(["None", "nan", "<NA>"], "")
        original_df = original_df.astype(str).replace(["None", "nan", "<NA>"], "")
        
        audit_log = []
        modified_rows_count = set()
        total_modifications = 0
        
        # Iterating and comparing values
        for row_idx in range(len(original_df)):
            if row_idx >= len(transformed_df):
                break
            
            orig_row = original_df.iloc[row_idx]
            new_row = transformed_df.iloc[row_idx]
            
            for col in original_df.columns:
                if col in transformed_df.columns:
                    orig_val = str(orig_row[col]).strip() if orig_row[col] is not None else ""
                    new_val = str(new_row[col]).strip() if new_row[col] is not None else ""
                    
                    if orig_val != new_val:
                        audit_log.append({
                            "id": str(uuid.uuid4()),
                            "row": row_idx + 1,
                            "phase": "AI Python Transform",
                            "rule_code": "DYNAMIC_SCRIPT",
                            "field": col,
                            "old_value": orig_val,
                            "new_value": new_val,
                            "status": "APPLIED"
                        })
                        modified_rows_count.add(row_idx)
                        total_modifications += 1

        summary_stats = {
            "rows_loaded": len(cleansed_rows),
            "rows_modified": len(modified_rows_count),
            "total_modifications": total_modifications,
            "audit_log": audit_log,
            "mapping_rules_parsed": 1
        }

        final_rows = transformed_df.to_dict(orient="records")
        return final_rows, summary_stats
