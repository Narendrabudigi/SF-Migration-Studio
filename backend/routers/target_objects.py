import io
import re
import difflib
import logging
from typing import List, Optional, Dict, Any, Tuple
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
# Helper functions for dynamic semantic concept resolution
VALID_DATA_TYPES = {
    "string", "str", "text", "varchar", "char", "character", "nvarchar",
    "int", "integer", "long", "number", "numeric", "decimal", "float", "double", "bigint", "smallint",
    "date", "datetime", "timestamp", "time",
    "boolean", "bool",
    "binary", "blob", "clob", "byte", "raw",
    "picklist", "enum", "lookup", "array", "object"
}


def _normalize_header(header: Any) -> str:
    """Strips non-alphanumeric characters and lowercases the header string."""
    if header is None:
        return ""
    return re.sub(r"[^a-z0-9]", "", str(header).lower())


def _header_tokens(header: Any) -> List[str]:
    """Splits header into word tokens by non-alphanumeric delimiters."""
    if header is None:
        return []
    return [t for t in re.split(r"[^a-zA-Z0-9]+", str(header).lower()) if t]


def _humanize_identifier(s: str) -> str:
    """Converts camelCase, PascalCase, or snake_case identifiers into human readable labels."""
    if not s or str(s).lower() in ["nan", "none", "null"]:
        return ""
    clean = re.sub(r"[_\-]+", " ", str(s)).strip()
    clean = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", clean)
    return clean.title()


def _is_valid_technical_identifier(val: Any) -> bool:
    """
    Validates whether a value is a genuine technical field identifier (e.g. 'userId',
    'costCenter', 'addressAddress1', 'KUNNR') vs data records (dates, numbers, sentences).
    """
    if val is None or pd.isna(val):
        return False
    s = str(val).strip()
    if not s or len(s) > 65:
        return False

    # Dates are data records, not field identifiers (e.g. 2024-09-10, 10/05/2017)
    if re.match(r"^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}", s) or re.match(r"^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}", s):
        return False

    # Pure numbers / currencies / percentages are data records (e.g. 12345, 500.00, $100)
    if re.match(r"^[+-]?\$?\d+([.,]\d+)?%?$", s):
        return False

    # Multi-word sentences or phrases are data descriptions/records, not technical field names
    if " " in s and len(s.split()) > 2:
        return False

    # Emails are data records
    if "@" in s and "." in s:
        return False

    # Technical field identifiers must start with a letter or underscore and be alphanumeric
    # Examples: addressAddress1, cust_dept, BUKRS, emp_id, field1
    return bool(re.match(r"^[a-zA-Z_][a-zA-Z0-9_\-\.]{0,64}$", s))


def _is_valid_data_type(val: Any) -> bool:
    """Checks whether a value is a recognized schema data type."""
    if val is None or pd.isna(val):
        return False
    clean = re.sub(r"[^a-z]", "", str(val).lower())
    return clean in VALID_DATA_TYPES or any(clean.startswith(dt) for dt in ["varchar", "char", "num", "dec", "int", "date"])


def _score_column_for_concept(col_name: str, concept: str) -> float:
    """
    Returns a dynamic match confidence score (0.0 to 1.0) for a column header
    matching a semantic concept. Uses token matching, substring matching, and
    fuzzy SequenceMatcher distance with strict precision.
    """
    norm = _normalize_header(col_name)
    if not norm or norm.startswith("unnamed"):
        return 0.0

    tokens = _header_tokens(col_name)

    concept_specs: Dict[str, Dict[str, List[str]]] = {
        "field": {
            "exact": [
                "fieldname", "technicalname", "targetfield", "columnname",
                "sapfield", "targetfieldname", "techname", "technicalfieldname",
                "field", "column", "technical", "attributename"
            ],
            "keywords": ["fieldname", "technical", "targetfield", "sapfield", "column"]
        },
        "table": {
            "exact": [
                "tablename", "structure", "sfstructure", "entity", "object",
                "table", "targetobject", "entityname", "sapstructure", "structurename"
            ],
            "keywords": ["tablename", "structure", "entity", "object"]
        },
        "label": {
            "exact": [
                "label", "fieldlabel", "description", "fielddescription",
                "displayname", "title", "caption", "targetlabel"
            ],
            "keywords": ["label", "description", "caption", "display"]
        },
        "type": {
            "exact": [
                "type", "datatype", "fieldtype", "format", "dataformat",
                "domain", "class"
            ],
            "keywords": ["datatype", "fieldtype", "format", "type"]
        },
        "req": {
            "exact": [
                "saprequired", "required", "mandatory", "ismandatory", "isrequired",
                "sapreq", "importance", "nullable", "notnull", "obligatory"
            ],
            "keywords": ["required", "mandatory", "importance", "nullable", "obligatory"]
        },
        "enabled": {
            "exact": [
                "enabled", "active", "status", "isenabled", "included"
            ],
            "keywords": ["enabled", "active", "included"]
        }
    }

    spec = concept_specs.get(concept)
    if not spec:
        return 0.0

    # 1. Exact match on normalized header
    if norm in spec["exact"]:
        return 1.0

    # 2. Token matches
    for token in tokens:
        if token in spec["exact"]:
            return 0.95
        for kw in spec["keywords"]:
            if token == kw:
                return 0.90

    # 3. Substring match on normalized string (minimum keyword length 5 to avoid false positives)
    for kw in spec["keywords"]:
        if len(kw) >= 5 and kw in norm:
            return 0.85

    # 4. Fuzzy SequenceMatcher similarity against exact aliases (threshold >= 0.85)
    # Catches typos like 'SAP:RQUIRED' -> 'saprequired' (0.952), but rejects unrelated words
    best_fuzzy = 0.0
    for alias in spec["exact"]:
        if len(alias) >= 5 and len(norm) >= 5:
            ratio = difflib.SequenceMatcher(None, norm, alias).ratio()
            if ratio > best_fuzzy:
                best_fuzzy = ratio

    # Also fuzzy match individual tokens against keywords (e.g. 'rquired' vs 'required')
    for token in tokens:
        if len(token) >= 5:
            for kw in spec["keywords"]:
                if len(kw) >= 5:
                    ratio = difflib.SequenceMatcher(None, token, kw).ratio()
                    if ratio > best_fuzzy:
                        best_fuzzy = ratio

    if best_fuzzy >= 0.85:
        return best_fuzzy

    return 0.0


def _parse_mandatory_value(raw_val: Any, col_name: str) -> bool:
    """Dynamically parses truthiness of a mandatory/requirement column."""
    if pd.isna(raw_val) or raw_val is None:
        return False
    val_str = str(raw_val).strip().lower()
    norm_col = _normalize_header(col_name)

    # Inverted logic for 'nullable' or 'optional' columns
    if "nullable" in norm_col or "optional" in norm_col:
        return val_str in ["false", "0", "no", "n"]

    return val_str in ["true", "1", "yes", "y", "mandatory", "required", "x", "m", "req", "t"]


# ══════════════════════════════════════════════════════════════════
# 2. Validate Uploaded Target Object Fields Excel Sheet
# ══════════════════════════════════════════════════════════════════
@router.post("/validate-sheet")
async def validate_target_object_sheet(file: UploadFile = File(...)):
    """
    Intelligently validates and ingests any standard SuccessFactors or SAP
    target object specification sheet.
    
    Features:
    - Dynamic semantic concept matching with fuzzy typo tolerance (e.g. SAP:RQUIRED -> Required).
    - Multi-sheet and multi-row header auto-discovery.
    - Intelligent fallbacks:
      * Table Name derived from column, sheet name, or file name.
      * Label auto-generated from Field Name if absent.
      * Type defaults to 'string' if absent.
      * Mandatory defaults to False if absent.
    - Only requires a detectable technical field identifier.
    """
    filename = file.filename or ""
    lower_fname = filename.lower()
    if not (lower_fname.endswith((".xlsx", ".xls", ".csv"))):
        return JSONResponse(
            status_code=400,
            content={
                "valid": False,
                "error": "Invalid file format. Please upload an Excel spreadsheet (.xlsx, .xls) or CSV file."
            }
        )

    try:
        content = await file.read()
        if not content:
            return JSONResponse(
                status_code=400,
                content={"valid": False, "error": "The uploaded file is empty (0 bytes)."}
            )

        # 1. Load sheets from Excel workbook or CSV
        sheet_dict: Dict[str, Tuple[str, int, pd.DataFrame]] = {}
        try:
            xl = pd.ExcelFile(io.BytesIO(content))
            for s in xl.sheet_names:
                for h_r in range(12):  # Scan candidate header rows 0 to 11
                    try:
                        c_df = pd.read_excel(io.BytesIO(content), sheet_name=s, header=h_r)
                        if not c_df.empty and len(c_df.columns) >= 1:
                            c_df.columns = [str(c).strip() for c in c_df.columns]
                            sheet_dict[f"{s}__row{h_r}"] = (s, h_r, c_df)
                    except Exception:
                        continue
        except Exception as read_err:
            logger.warning(f"pd.ExcelFile read failed: {read_err}. Trying CSV fallback.")
            try:
                c_df = pd.read_csv(io.BytesIO(content))
                if not c_df.empty and len(c_df.columns) >= 1:
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
                        "Unable to read spreadsheet content. If this file is currently open in "
                        "Microsoft Excel in 'PROTECTED VIEW', please click 'Enable Editing', "
                        "save the file (Ctrl+S), and upload it again."
                    )
                }
            )

        # 2. Dynamic Semantic Concept Matching across candidate sheets & header rows
        concepts = ["field", "table", "label", "type", "req", "enabled"]

        best_score = -1.0
        best_df: Optional[pd.DataFrame] = None
        best_sheet = ""
        best_header_row = 0
        best_col_mapping: Dict[str, str] = {}
        detected_all_cols: List[str] = []

        for (s_name, h_row, candidate_df) in sheet_dict.values():
            cols = [c for c in candidate_df.columns if not str(c).startswith("Unnamed")]
            if not cols:
                continue

            found_mapping: Dict[str, str] = {}
            used_cols = set()
            total_concept_score = 0.0

            # Prioritize matching concepts
            for concept in concepts:
                best_c_score = 0.0
                best_c_col = None
                for c in cols:
                    if c in used_cols:
                        continue
                    score = _score_column_for_concept(c, concept)
                    if score > best_c_score:
                        best_c_score = score
                        best_c_col = c

                if best_c_col and best_c_score >= 0.85:
                    found_mapping[concept] = best_c_col
                    used_cols.add(best_c_col)
                    total_concept_score += best_c_score

            # The anchor requirement: must identify field technical identifier
            field_col = found_mapping.get("field")
            if not field_col:
                continue

            # Candidate evaluation score:
            # - High weight on finding field column
            # - Extra weight for label, type, req, table
            # - Verify that rows under field_col contain actual identifier data (not blank/NaN/dates)
            sample_vals = [
                str(v).strip() for v in candidate_df[field_col].dropna().head(15).tolist()
                if str(v).strip() and str(v).lower() not in ["nan", "none", "null", "field name", "fieldname"]
            ]

            if not sample_vals:
                continue

            # Check how many sample values look like genuine technical identifiers vs data records (dates, numbers)
            valid_id_count = sum(1 for v in sample_vals if _is_valid_technical_identifier(v))
            if valid_id_count / len(sample_vals) < 0.60:
                # Column contains dates, numbers, or records, NOT technical field names
                continue

            eval_score = 20.0 + total_concept_score * 8.0 + (valid_id_count * 2.0)

            if eval_score > best_score:
                best_score = eval_score
                best_df = candidate_df
                best_sheet = s_name
                best_header_row = h_row
                best_col_mapping = found_mapping
                detected_all_cols = cols

        # 3. Check if technical field column was identified
        if best_df is None or "field" not in best_col_mapping:
            all_found = list(sheet_dict.values())[0][2].columns.tolist() if sheet_dict else []
            clean_found = [c for c in all_found if not str(c).startswith("Unnamed")]
            return JSONResponse(
                status_code=400,
                content={
                    "valid": False,
                    "error": (
                        "Unable to identify a valid Technical Field Name column in the uploaded spreadsheet. "
                        "Please ensure the file is a Target Object Specification Sheet containing schema field definitions "
                        "(e.g. 'Field Name', 'Technical Name', or 'Target Field'), rather than an instance data file."
                    ),
                    "missing_columns": ["Technical Field Name Column"],
                    "found_columns": clean_found,
                    "required_columns": ["Field Name (Schema Definition)"]
                }
            )

        # 3b. Verify that the candidate sheet is a genuine schema metadata dictionary, NOT an instance data file
        col_field = best_col_mapping["field"]
        sample_field_values = [
            str(v).strip() for v in best_df[col_field].dropna().head(30).tolist()
            if str(v).strip() and str(v).lower() not in ["nan", "none", "null", "field name", "fieldname"]
        ]

        if not sample_field_values:
            return JSONResponse(
                status_code=400,
                content={
                    "valid": False,
                    "error": f"The column '{col_field}' was identified for field names, but contains no valid data rows.",
                    "missing_columns": ["Field Values"],
                    "found_columns": detected_all_cols,
                    "required_columns": ["Field Name"]
                }
            )

        valid_identifier_count = sum(1 for v in sample_field_values if _is_valid_technical_identifier(v))
        valid_ratio = valid_identifier_count / len(sample_field_values)

        if valid_ratio < 0.65:
            sample_bad = [v for v in sample_field_values if not _is_valid_technical_identifier(v)][:4]
            return JSONResponse(
                status_code=400,
                content={
                    "valid": False,
                    "error": (
                        f"The uploaded spreadsheet appears to be an instance data file (records containing values like "
                        f"'{', '.join(sample_bad)}') rather than a Target Object Specification Sheet. "
                        "Target Object sheets define field schemas (e.g. 'userId', 'company', 'costCenter', 'addressAddress1'), "
                        "not employee or transactional data records."
                    ),
                    "missing_columns": ["Valid Field Names (Schema Metadata)"],
                    "found_columns": detected_all_cols,
                    "required_columns": ["Field Name (Schema Definitions, not data rows)"]
                }
            )

        # Check: If a column was mapped to 'type', verify whether its values are actual schema data types
        col_type = best_col_mapping.get("type")
        if col_type:
            sample_type_values = [
                str(v).strip() for v in best_df[col_type].dropna().head(20).tolist()
                if str(v).strip() and str(v).lower() not in ["nan", "none", "null", "type", "data type"]
            ]
            if sample_type_values:
                valid_types = sum(1 for v in sample_type_values if _is_valid_data_type(v))
                if valid_types / len(sample_type_values) < 0.40:
                    # The column is an employee category (e.g. 'Permanent', 'Intern', 'Temporary'), not a technical data type!
                    best_col_mapping.pop("type", None)
                    col_type = None

        # Check: A target specification sheet must have at least one other metadata concept
        other_concepts = [k for k in best_col_mapping.keys() if k != "field"]
        if not other_concepts and len(best_df) > 50:
            return JSONResponse(
                status_code=400,
                content={
                    "valid": False,
                    "error": (
                        "The uploaded file does not contain standard Target Object field metadata columns "
                        "(e.g. Label, Type, Required, or Table Name). Please use a valid specification sheet."
                    ),
                    "missing_columns": ["Label, Type, or Required"],
                    "found_columns": detected_all_cols,
                    "required_columns": ["Field Name", "Label", "Type", "Required"]
                }
            )

        # 4. Extract data rows with dynamic concept mappings and fallbacks
        df = best_df
        col_field = best_col_mapping["field"]
        col_table = best_col_mapping.get("table")
        col_label = best_col_mapping.get("label")
        col_type = best_col_mapping.get("type")
        col_req = best_col_mapping.get("req")
        col_enabled = best_col_mapping.get("enabled")

        # Fallback table name from sheet name or filename
        fallback_table_name = re.sub(r"[_\-]+", " ", str(best_sheet)).strip()
        if fallback_table_name.lower().startswith("sheet") or fallback_table_name.lower() in ["table 1", "csv data"]:
            clean_file_stem = re.sub(r"\.[^.]+$", "", filename)
            clean_file_stem = re.sub(r"[_\-]+", " ", clean_file_stem).strip()
            fallback_table_name = clean_file_stem or "Target Object"

        parsed_fields = []
        table_counts: Dict[str, int] = {}

        for idx, row in df.iterrows():
            raw_field = row.get(col_field)
            if pd.isna(raw_field):
                continue
            f_name = str(raw_field).strip()
            if not f_name or f_name.lower() in ["nan", "null", "none", "field name", "fieldname", "technical name"]:
                continue

            # Table name resolution
            tbl_name = fallback_table_name
            if col_table:
                raw_tbl = row.get(col_table)
                if not pd.isna(raw_tbl) and str(raw_tbl).strip():
                    val_tbl = str(raw_tbl).strip()
                    if val_tbl.lower() not in ["nan", "null", "none", "table name", "tablename"]:
                        tbl_name = val_tbl
            table_counts[tbl_name] = table_counts.get(tbl_name, 0) + 1

            # Label resolution
            if col_label:
                raw_lbl = row.get(col_label)
                lbl = str(raw_lbl).strip() if not pd.isna(raw_lbl) else ""
                if not lbl or lbl.lower() in ["nan", "null", "none"]:
                    lbl = _humanize_identifier(f_name)
            else:
                lbl = _humanize_identifier(f_name)

            # Type resolution
            if col_type:
                raw_type = row.get(col_type)
                t_val = str(raw_type).strip() if not pd.isna(raw_type) else "string"
                if not t_val or t_val.lower() in ["nan", "null", "none"]:
                    t_val = "string"
            else:
                t_val = "string"

            # Mandatory / Required resolution
            if col_req:
                is_mand = _parse_mandatory_value(row.get(col_req), col_req)
            else:
                is_mand = False

            # Enabled resolution
            if col_enabled:
                raw_en = str(row.get(col_enabled, "yes")).strip()
                en_val = "No" if raw_en.lower() in ["no", "n", "false", "0", "disabled"] else "Yes"
            else:
                en_val = "Yes"

            parsed_fields.append({
                "table_name": tbl_name,
                "field_name": f_name,
                "label": lbl,
                "type": t_val,
                "is_mandatory": is_mand,
                "enabled": en_val
            })

        if not parsed_fields:
            return JSONResponse(
                status_code=400,
                content={
                    "valid": False,
                    "error": f"Header row detected in sheet '{best_sheet}', but no valid field rows were found below it.",
                    "missing_columns": [],
                    "found_columns": detected_all_cols,
                    "required_columns": ["Field Name"]
                }
            )

        detected_table = max(table_counts.items(), key=lambda x: x[1])[0] if table_counts else fallback_table_name

        logger.info(
            f"Successfully validated {len(parsed_fields)} fields from sheet '{best_sheet}' "
            f"(header row {best_header_row}) for table '{detected_table}'."
        )

        return {
            "valid": True,
            "detected_sheet": best_sheet,
            "detected_header_row": best_header_row,
            "detected_table_name": detected_table,
            "suggested_object_name": detected_table,
            "total_fields": len(parsed_fields),
            "mandatory_count": sum(1 for f in parsed_fields if f["is_mandatory"]),
            "preview": parsed_fields[:15],
            "fields": parsed_fields,
            "detected_mappings": {
                "table_source": f"Column '{col_table}'" if col_table else f"Derived from Sheet '{best_sheet}'",
                "field_column": col_field,
                "label_column": col_label if col_label else "(Auto-generated from field)",
                "type_column": col_type if col_type else "(Default: string)",
                "required_column": col_req if col_req else "(Default: optional)",
                "enabled_column": col_enabled if col_enabled else "(Default: Yes)"
            },
            "found_columns": detected_all_cols
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
