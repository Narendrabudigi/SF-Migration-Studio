import io
import re
import logging
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
import pandas as pd
from services.supabase_client import supabase_service

logger = logging.getLogger(__name__)

router = APIRouter()

class ConfirmImportRequest(BaseModel):
    object_name: str
    description: Optional[str] = ""
    fields: List[Dict[str, Any]]

# ══════════════════════════════════════════════════════════════════
# 1. Download Standard Sample Template Excel File
# ══════════════════════════════════════════════════════════════════
@router.get("/template")
def download_sample_template():
    """
    Generates and downloads the official standard Excel template for SuccessFactors
    target object field definitions, matching the required columns:
    Table Name | Field Name | LABEL | TYPE | SAP REQUIRED | Enabled
    """
    try:
        sample_rows = [
            {
                "Table Name": "EmpJob",
                "Field Name": "assedicCertInitialStateNum",
                "LABEL": "Number of Initial Pôle Emploi (Employment Centre) Statement",
                "TYPE": "long",
                "SAP REQUIRED": "FALSE",
                "Enabled": "No"
            },
            {
                "Table Name": "EmpJob",
                "Field Name": "company",
                "LABEL": "Company",
                "TYPE": "string",
                "SAP REQUIRED": "TRUE",
                "Enabled": "Yes"
            },
            {
                "Table Name": "EmpJob",
                "Field Name": "costCenter",
                "LABEL": "Cost Centre",
                "TYPE": "string",
                "SAP REQUIRED": "TRUE",
                "Enabled": "Yes"
            },
            {
                "Table Name": "EmpJob",
                "Field Name": "businessUnit",
                "LABEL": "Business Unit",
                "TYPE": "string",
                "SAP REQUIRED": "TRUE",
                "Enabled": "Yes"
            },
            {
                "Table Name": "EmpJob",
                "Field Name": "startDate",
                "LABEL": "Start Date",
                "TYPE": "datetime",
                "SAP REQUIRED": "TRUE",
                "Enabled": "Yes"
            },
            {
                "Table Name": "EmpJob",
                "Field Name": "department",
                "LABEL": "Department",
                "TYPE": "string",
                "SAP REQUIRED": "FALSE",
                "Enabled": "Yes"
            },
            {
                "Table Name": "EmpJob",
                "Field Name": "division",
                "LABEL": "Division",
                "TYPE": "string",
                "SAP REQUIRED": "FALSE",
                "Enabled": "Yes"
            },
            {
                "Table Name": "EmpJob",
                "Field Name": "location",
                "LABEL": "Location",
                "TYPE": "string",
                "SAP REQUIRED": "FALSE",
                "Enabled": "Yes"
            },
            {
                "Table Name": "EmpJob",
                "Field Name": "attachment",
                "LABEL": "Attachment Content",
                "TYPE": "binary",
                "SAP REQUIRED": "FALSE",
                "Enabled": "No"
            },
            {
                "Table Name": "EmpJob",
                "Field Name": "attachmentFileName",
                "LABEL": "Attachment File Name",
                "TYPE": "string",
                "SAP REQUIRED": "FALSE",
                "Enabled": "No"
            }
        ]

        df = pd.DataFrame(sample_rows)
        output = io.BytesIO()
        with pd.ExcelWriter(output, engine="openpyxl") as writer:
            df.to_excel(writer, index=False, sheet_name="Sheet1")
            # Auto-adjust column widths for premium readability
            ws = writer.sheets["Sheet1"]
            for col in ws.columns:
                max_len = max(len(str(cell.value or "")) for cell in col)
                col_letter = col[0].column_letter
                ws.column_dimensions[col_letter].width = max(max_len + 4, 14)

        output.seek(0)
        filename = "SuccessFactors_Target_Object_Template.xlsx"
        return StreamingResponse(
            output,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )
    except Exception as e:
        logger.error(f"Error generating template Excel: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate template: {str(e)}")


# ══════════════════════════════════════════════════════════════════
# 2. Validate Uploaded Target Object Fields Excel Sheet
# ══════════════════════════════════════════════════════════════════
@router.post("/validate-sheet")
async def validate_target_object_sheet(file: UploadFile = File(...)):
    """
    Validates that the uploaded file is a valid Excel spreadsheet and contains
    SuccessFactors field template columns:
    - Table Name (or Structure / Entity)
    - Field Name (or Technical Name / Target Field)
    - LABEL (or Description / Field Label)
    - TYPE (or Data Type)
    - SAP REQUIRED (or SAP:REQUIRED / Required / Mandatory)
    - Enabled (optional)

    Intelligently scans all worksheets, auto-detects the header row if offset,
    and supports flexible column naming.
    """
    filename = file.filename or ""
    if not filename.lower().endswith((".xlsx", ".xls")):
        return JSONResponse(
            status_code=400,
            content={
                "valid": False,
                "error": "Invalid file format. Please upload an Excel spreadsheet (.xlsx or .xls).",
                "required_columns": ["Table Name", "Field Name", "Label", "Type", "SAP:REQUIRED", "Enabled"]
            }
        )

    try:
        content = await file.read()
        if not content:
            return JSONResponse(
                status_code=400,
                content={"valid": False, "error": "The uploaded file is empty (0 bytes)."}
            )

        # 1. Attempt reading Excel workbook (with fallbacks for HTML/CSV web exports)
        sheet_dict = {}
        try:
            xl = pd.ExcelFile(io.BytesIO(content))
            for s in xl.sheet_names:
                for h_r in range(6):
                    try:
                        c_df = pd.read_excel(io.BytesIO(content), sheet_name=s, header=h_r)
                        if not c_df.empty and len(c_df.columns) >= 4:
                            # Strip whitespace directly on DataFrame columns
                            c_df.columns = [str(c).strip() for c in c_df.columns]
                            sheet_dict[f"{s}__row{h_r}"] = (s, h_r, c_df)
                    except Exception:
                        continue
        except Exception as read_err:
            logger.warning(f"pd.ExcelFile failed: {read_err}. Attempting HTML and CSV fallbacks.")
            # Fallback 1: HTML tables
            try:
                html_tables = pd.read_html(io.BytesIO(content))
                for i, h_df in enumerate(html_tables):
                    if not h_df.empty and len(h_df.columns) >= 4:
                        h_df.columns = [str(c).strip() for c in h_df.columns]
                        sheet_dict[f"HTML_Table_{i}__row0"] = (f"Table {i+1}", 0, h_df)
            except Exception:
                pass

            # Fallback 2: CSV
            if not sheet_dict:
                try:
                    c_df = pd.read_csv(io.BytesIO(content))
                    if not c_df.empty and len(c_df.columns) >= 4:
                        c_df.columns = [str(c).strip() for c in c_df.columns]
                        sheet_dict["CSV__row0"] = ("CSV Data", 0, c_df)
                except Exception:
                    pass

            if not sheet_dict:
                return JSONResponse(
                    status_code=400,
                    content={
                        "valid": False,
                        "error": (
                            f"Unable to read Excel file: {str(read_err)}. "
                            "Notice: If this file is currently open in Microsoft Excel in 'PROTECTED VIEW', "
                            "Excel locks the file. Please click 'Enable Editing' in Excel, save the file (Ctrl+S), "
                            "and upload it again."
                        )
                    }
                )

        # 2. Required standard columns specification (NO hardcoding, dynamic matching)
        standard_column_specs = {
            "table": {
                "display": "Table Name",
                "aliases": ["tablename", "table", "structure", "sfstructure", "entity", "object"]
            },
            "field": {
                "display": "Field Name",
                "aliases": ["fieldname", "field", "technicalname", "technical", "targetfield"]
            },
            "label": {
                "display": "Label",
                "aliases": ["label", "fieldlabel", "description", "fielddescription", "displayname"]
            },
            "type": {
                "display": "Type",
                "aliases": ["type", "datatype"]
            },
            "req": {
                "display": "SAP:REQUIRED",
                "aliases": ["saprequired", "sapreq", "required", "ismandatory", "mandatory", "importance"]
            }
        }

        optional_column_specs = {
            "enabled": {
                "display": "Enabled",
                "aliases": ["enabled", "active", "status"]
            }
        }

        all_specs = {**standard_column_specs, **optional_column_specs}

        best_df = None
        best_sheet = None
        best_header_row = 0
        best_col_mapping = {}
        best_score = 0
        detected_all_cols = []

        for (s_name, h_row, candidate_df) in sheet_dict.values():
            cols = list(candidate_df.columns)
            norm_cols = {c: re.sub(r"[^a-z0-9]", "", c.lower()) for c in cols}

            found_mapping = {}
            used_cols = set()

            # Pass 1: EXACT ALIAS MATCH
            for field_key, spec in all_specs.items():
                for orig, norm in norm_cols.items():
                    if not norm or norm.startswith("unnamed") or orig in used_cols:
                        continue
                    if norm in spec["aliases"]:
                        found_mapping[field_key] = orig
                        used_cols.add(orig)
                        break

            # Pass 2: SUBSTRING MATCH for remaining unmatched keys
            for field_key, spec in all_specs.items():
                if field_key in found_mapping:
                    continue
                for orig, norm in norm_cols.items():
                    if not norm or norm.startswith("unnamed") or orig in used_cols:
                        continue
                    long_aliases = [a for a in spec["aliases"] if len(a) >= 4]
                    if any(a in norm or norm in a for a in long_aliases):
                        found_mapping[field_key] = orig
                        used_cols.add(orig)
                        break

            # Count how many of the 5 REQUIRED standard columns were matched
            matched_req_count = sum(1 for k in standard_column_specs if k in found_mapping)

            if matched_req_count > best_score:
                best_score = matched_req_count
                best_df = candidate_df
                best_sheet = s_name
                best_header_row = h_row
                best_col_mapping = found_mapping
                detected_all_cols = [c for c in cols if not str(c).startswith("Unnamed")]

                # If all 5 required standard columns are matched, we found the optimal header row
                if matched_req_count == len(standard_column_specs):
                    break

        # 3. STRICT STANDARD FORMAT CHECK
        # Must contain ALL 5 required standard columns: Table Name, Field Name, Label, Type, SAP:REQUIRED
        missing_columns = []
        for k, spec in standard_column_specs.items():
            if k not in best_col_mapping:
                missing_columns.append(spec["display"])

        if missing_columns or best_df is None:
            first_cols = detected_all_cols
            if not first_cols and best_df is not None:
                first_cols = [c for c in best_df.columns if not str(c).startswith("Unnamed")]
            return JSONResponse(
                status_code=400,
                content={
                    "valid": False,
                    "error": (
                        f"The uploaded file is not in standard format. "
                        f"Missing required columns: {', '.join(missing_columns)}. "
                        "Please verify your spreadsheet matches the required SuccessFactors field template."
                    ),
                    "missing_columns": missing_columns,
                    "found_columns": first_cols,
                    "required_columns": ["Table Name", "Field Name", "Label", "Type", "SAP:REQUIRED", "Enabled"]
                }
            )

        # 4. Extract data rows
        df = best_df
        col_field = best_col_mapping["field"]
        col_table = best_col_mapping["table"]
        col_label = best_col_mapping["label"]
        col_type = best_col_mapping["type"]
        col_req = best_col_mapping["req"]
        col_enabled = best_col_mapping.get("enabled")

        parsed_fields = []
        table_counts: Dict[str, int] = {}
        fallback_table_name = re.sub(r"[_\-]+", " ", str(best_sheet)).strip()
        if fallback_table_name.lower().startswith("sheet"):
            clean_file_stem = re.sub(r"\.[^.]+$", "", filename).replace("_", " ").strip()
            fallback_table_name = clean_file_stem or "Target Object"

        for idx, row in df.iterrows():
            raw_field = row.get(col_field)
            if pd.isna(raw_field):
                continue
            f_name = str(raw_field).strip()
            if not f_name or f_name.lower() in ["nan", "null", "none", "field name", "fieldname"]:
                continue

            raw_tbl = row.get(col_table)
            tbl_name = str(raw_tbl).strip() if not pd.isna(raw_tbl) else ""
            if not tbl_name or tbl_name.lower() in ["nan", "null", "none", "table name", "tablename"]:
                tbl_name = fallback_table_name

            table_counts[tbl_name] = table_counts.get(tbl_name, 0) + 1

            raw_lbl = row.get(col_label)
            lbl = str(raw_lbl).strip() if not pd.isna(raw_lbl) else f_name
            if not lbl or lbl.lower() in ["nan", "null", "none"]:
                lbl = f_name

            raw_type = row.get(col_type)
            t_val = str(raw_type).strip() if not pd.isna(raw_type) else "string"
            if not t_val or t_val.lower() in ["nan", "null", "none"]:
                t_val = "string"

            raw_req = str(row.get(col_req, "false")).strip().lower() if not pd.isna(row.get(col_req)) else "false"
            is_mand = raw_req in ["true", "1", "yes", "mandatory", "required", "y"]

            raw_en = str(row.get(col_enabled, "yes")).strip() if col_enabled and not pd.isna(row.get(col_enabled)) else "Yes"
            if raw_en.lower() in ["nan", "null", "none", ""]:
                raw_en = "Yes"

            parsed_fields.append({
                "table_name": tbl_name,
                "field_name": f_name,
                "label": lbl,
                "type": t_val,
                "is_mandatory": is_mand,
                "enabled": raw_en
            })

        if not parsed_fields:
            return JSONResponse(
                status_code=400,
                content={
                    "valid": False,
                    "error": f"Found standard header row in sheet '{best_sheet}', but no valid data rows were detected below it.",
                    "missing_columns": [],
                    "found_columns": detected_all_cols,
                    "required_columns": ["Table Name", "Field Name", "Label", "Type", "SAP:REQUIRED", "Enabled"]
                }
            )

        detected_table = max(table_counts.items(), key=lambda x: x[1])[0] if table_counts else fallback_table_name

        logger.info(f"Successfully validated {len(parsed_fields)} fields from sheet '{best_sheet}' (header row: {best_header_row}) for table '{detected_table}'")

        return {
            "valid": True,
            "detected_sheet": best_sheet,
            "detected_header_row": best_header_row,
            "detected_table_name": detected_table,
            "suggested_object_name": detected_table,
            "total_fields": len(parsed_fields),
            "mandatory_count": sum(1 for f in parsed_fields if f["is_mandatory"]),
            "preview": parsed_fields[:12],
            "fields": parsed_fields
        }

    except Exception as e:
        logger.error(f"Error parsing uploaded target object sheet: {e}", exc_info=True)
        return JSONResponse(
            status_code=500,
            content={"valid": False, "error": f"Failed to process sheet: {str(e)}"}
        )


# ══════════════════════════════════════════════════════════════════
# 3. Confirm & Import Target Object & Fields into Supabase
# ══════════════════════════════════════════════════════════════════
@router.post("/confirm-import")
def confirm_import_target_object(req: ConfirmImportRequest):
    """
    Creates/updates the target object in `sf_objects` and batch upserts all its
    field specifications into `sf_fields`.
    """
    if not req.object_name or not req.object_name.strip():
        raise HTTPException(status_code=400, detail="Target Object Name is required.")

    if not req.fields:
        raise HTTPException(status_code=400, detail="No field definitions provided for import.")

    clean_obj_name = req.object_name.strip()
    client = supabase_service.get_client()

    try:
        # 1. Get or Create sf_objects entry
        clean_desc = req.description.strip() if req.description and req.description.strip() else clean_obj_name
        res_obj = client.table("sf_objects").select("id, name").ilike("name", clean_obj_name).execute()
        if res_obj.data and len(res_obj.data) > 0:
            obj_id = res_obj.data[0]["id"]
            try:
                client.table("sf_objects").update({"description": clean_desc}).eq("id", obj_id).execute()
            except Exception as e:
                logger.warning(f"Could not update object description: {e}")
        else:
            ins_obj = client.table("sf_objects").insert({"name": clean_obj_name, "description": clean_desc}).execute()
            if not ins_obj.data:
                raise HTTPException(status_code=500, detail="Failed to create target object record in database.")
            obj_id = ins_obj.data[0]["id"]

        # 2. Deduplicate and format fields for sf_fields
        seen_keys = set()
        fields_to_insert = []

        for f in req.fields:
            sf_struct = (f.get("table_name") or clean_obj_name).strip()
            field_name = (f.get("field_name") or "").strip()
            if not field_name:
                continue

            dedup_key = (obj_id, sf_struct, field_name)
            if dedup_key in seen_keys:
                continue
            seen_keys.add(dedup_key)

            fields_to_insert.append({
                "object_id": obj_id,
                "sheet_name": "Sheet1",
                "group_name": clean_obj_name,
                "sf_structure": sf_struct,
                "field_name": field_name,
                "field_description": f.get("label") or field_name,
                "type": f.get("type") or "STRING",
                "length": "",
                "decimals": "",
                "is_mandatory": bool(f.get("is_mandatory", False))
            })

        # 3. Batch upsert into sf_fields on conflict (object_id, sf_structure, field_name)
        BATCH_SIZE = 50
        inserted_count = 0

        for i in range(0, len(fields_to_insert), BATCH_SIZE):
            batch = fields_to_insert[i : i + BATCH_SIZE]
            try:
                client.table("sf_fields").upsert(batch, on_conflict="object_id,sf_structure,field_name").execute()
                inserted_count += len(batch)
            except Exception as batch_err:
                logger.error(f"Error upserting batch {i} to {i+BATCH_SIZE} in sf_fields: {batch_err}")
                # If on_conflict constraint isn't set, try standard insert
                try:
                    client.table("sf_fields").insert(batch).execute()
                    inserted_count += len(batch)
                except Exception as ins_err:
                    logger.error(f"Insert fallback also failed: {ins_err}")

        logger.info(f"Successfully imported {inserted_count} fields into sf_fields for '{clean_obj_name}' (ID: {obj_id})")

        return {
            "status": "success",
            "message": f"Successfully imported {inserted_count} fields for target object '{clean_obj_name}'.",
            "object_id": obj_id,
            "object_name": clean_obj_name,
            "fields_imported": inserted_count,
            "mandatory_count": sum(1 for f in fields_to_insert if f["is_mandatory"])
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to confirm target object import: {e}")
        raise HTTPException(status_code=500, detail=f"Database import failed: {str(e)}")
