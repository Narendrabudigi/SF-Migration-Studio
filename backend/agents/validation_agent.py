import re
import random
from typing import Dict, List, Any, Optional

# SuccessFactors & SAP schemas
OBJS: Dict[str, List[Dict[str, Any]]] = {
    "BIOGRAPHICAL INFO": [
        {"n": "person-id-external", "l": "Person ID External", "t": "CHAR", "len": 100, "req": True},
        {"n": "date-of-birth", "l": "Date of Birth", "t": "DATS", "len": 8, "req": False},
        {"n": "country-of-birth", "l": "Country of Birth", "t": "CHAR", "len": 3, "req": False},
    ],
    "PERSONAL INFO": [
        {"n": "person-id-external", "l": "Person ID External", "t": "CHAR", "len": 100, "req": True},
        {"n": "first-name", "l": "First Name", "t": "CHAR", "len": 100, "req": True},
        {"n": "last-name", "l": "Last Name", "t": "CHAR", "len": 100, "req": True},
        {"n": "gender", "l": "Gender", "t": "CHAR", "len": 1, "req": False},
        {"n": "marital-status", "l": "Marital Status", "t": "CHAR", "len": 10, "req": False},
    ],
    "EMPLOYMENT DETAILS": [
        {"n": "user-id", "l": "User ID", "t": "CHAR", "len": 100, "req": True},
        {"n": "person-id-external", "l": "Person ID External", "t": "CHAR", "len": 100, "req": True},
        {"n": "hire-date", "l": "Hire Date", "t": "DATS", "len": 8, "req": False},
    ],
    "JOB INFO": [
        {"n": "user-id", "l": "User ID", "t": "CHAR", "len": 100, "req": True},
        {"n": "start-date", "l": "Start Date", "t": "DATS", "len": 8, "req": True},
        {"n": "company", "l": "Company", "t": "CHAR", "len": 32, "req": False},
        {"n": "business-unit", "l": "Business Unit", "t": "CHAR", "len": 32, "req": False},
        {"n": "division", "l": "Division", "t": "CHAR", "len": 32, "req": False},
        {"n": "department", "l": "Department", "t": "CHAR", "len": 32, "req": False},
        {"n": "job-code", "l": "Job Code", "t": "CHAR", "len": 32, "req": False},
        {"n": "location", "l": "Location", "t": "CHAR", "len": 32, "req": False},
    ],
    "COMPENSATION INFO": [
        {"n": "user-id", "l": "User ID", "t": "CHAR", "len": 100, "req": True},
        {"n": "start-date", "l": "Start Date", "t": "DATS", "len": 8, "req": True},
        {"n": "pay-group", "l": "Pay Group", "t": "CHAR", "len": 32, "req": False},
        {"n": "currency", "l": "Currency", "t": "CUKY", "len": 5, "req": False},
    ],
    "PAY COMPONENT RECURRING": [
        {"n": "user-id", "l": "User ID", "t": "CHAR", "len": 100, "req": True},
        {"n": "pay-component", "l": "Pay Component", "t": "CHAR", "len": 32, "req": True},
        {"n": "start-date", "l": "Start Date", "t": "DATS", "len": 8, "req": True},
    ],
    "PAY COMPONENT NON RECURRING": [
        {"n": "user-id", "l": "User ID", "t": "CHAR", "len": 100, "req": True},
        {"n": "pay-component", "l": "Pay Component", "t": "CHAR", "len": 32, "req": True},
        {"n": "pay-date", "l": "Pay Date", "t": "DATS", "len": 8, "req": True},
    ],
    "CUSTOMER": [
        {"n": "KUNNR", "l": "Customer Number", "t": "CHAR", "len": 10, "req": True},
        {"n": "KTOKD", "l": "Account Group", "t": "CHAR", "len": 4, "req": True},
        {"n": "NAME1", "l": "Name 1", "t": "CHAR", "len": 35, "req": True},
        {"n": "NAME2", "l": "Name 2", "t": "CHAR", "len": 35, "req": False},
        {"n": "LAND1", "l": "Country Key", "t": "CHAR", "len": 3, "req": True},
        {"n": "ORT01", "l": "City", "t": "CHAR", "len": 35, "req": False},
        {"n": "PSTLZ", "l": "Postal Code", "t": "CHAR", "len": 10, "req": False},
        {"n": "REGIO", "l": "Region", "t": "CHAR", "len": 3, "req": False},
        {"n": "STRAS", "l": "Street", "t": "CHAR", "len": 35, "req": False},
        {"n": "TELF1", "l": "Telephone", "t": "CHAR", "len": 16, "req": False},
        {"n": "SMTP_ADDR", "l": "Email", "t": "CHAR", "len": 241, "req": False},
        {"n": "BUKRS", "l": "Company Code", "t": "CHAR", "len": 4, "req": True},
        {"n": "VKORG", "l": "Sales Org", "t": "CHAR", "len": 4, "req": True},
        {"n": "VTWEG", "l": "Dist. Channel", "t": "CHAR", "len": 2, "req": True},
        {"n": "SPART", "l": "Division", "t": "CHAR", "len": 2, "req": True},
        {"n": "WAERS", "l": "Currency", "t": "CUKY", "len": 5, "req": False},
        {"n": "ZTERM", "l": "Payment Terms", "t": "CHAR", "len": 4, "req": False},
        {"n": "STCD1", "l": "Tax Number 1", "t": "CHAR", "len": 16, "req": False},
        {"n": "TAXKD", "l": "Tax Class.", "t": "CHAR", "len": 1, "req": False},
        {"n": "ERDAT", "l": "Created On", "t": "DATS", "len": 8, "req": False},
    ],
    "VENDOR": [
        {"n": "LIFNR", "l": "Vendor Number", "t": "CHAR", "len": 10, "req": True},
        {"n": "KTOKK", "l": "Account Group", "t": "CHAR", "len": 4, "req": True},
        {"n": "NAME1", "l": "Vendor Name", "t": "CHAR", "len": 35, "req": True},
        {"n": "LAND1", "l": "Country", "t": "CHAR", "len": 3, "req": True},
        {"n": "ORT01", "l": "City", "t": "CHAR", "len": 35, "req": False},
        {"n": "PSTLZ", "l": "Postal Code", "t": "CHAR", "len": 10, "req": False},
        {"n": "REGIO", "l": "Region", "t": "CHAR", "len": 3, "req": False},
        {"n": "STRAS", "l": "Street", "t": "CHAR", "len": 35, "req": False},
        {"n": "TELF1", "l": "Telephone", "t": "CHAR", "len": 16, "req": False},
        {"n": "SMTP_ADDR", "l": "Email", "t": "CHAR", "len": 241, "req": False},
        {"n": "BUKRS", "l": "Company Code", "t": "CHAR", "len": 4, "req": True},
        {"n": "EKORG", "l": "Purchasing Org", "t": "CHAR", "len": 4, "req": True},
        {"n": "WAERS", "l": "Currency", "t": "CUKY", "len": 5, "req": False},
        {"n": "ZTERM", "l": "Payment Terms", "t": "CHAR", "len": 4, "req": False},
        {"n": "STCD1", "l": "Tax Number", "t": "CHAR", "len": 16, "req": False},
        {"n": "BANKS", "l": "Bank Country", "t": "CHAR", "len": 3, "req": False},
        {"n": "BANKN", "l": "Bank Account", "t": "CHAR", "len": 18, "req": False},
        {"n": "ERDAT", "l": "Created On", "t": "DATS", "len": 8, "req": False},
    ],
    "MATERIAL": [
        {"n": "MATNR", "l": "Material Number", "t": "CHAR", "len": 40, "req": True},
        {"n": "MBRSH", "l": "Industry Sector", "t": "CHAR", "len": 1, "req": True},
        {"n": "MTART", "l": "Material Type", "t": "CHAR", "len": 4, "req": True},
        {"n": "MAKTX", "l": "Description", "t": "CHAR", "len": 40, "req": True},
        {"n": "MEINS", "l": "Base UoM", "t": "UNIT", "len": 3, "req": True},
        {"n": "MATKL", "l": "Material Group", "t": "CHAR", "len": 9, "req": False},
        {"n": "WERKS", "l": "Plant", "t": "CHAR", "len": 4, "req": True},
        {"n": "LGORT", "l": "Storage Loc.", "t": "CHAR", "len": 4, "req": False},
        {"n": "BRGEW", "l": "Gross Weight", "t": "DEC", "len": 15, "req": False},
        {"n": "NTGEW", "l": "Net Weight", "t": "DEC", "len": 15, "req": False},
        {"n": "GEWEI", "l": "Weight Unit", "t": "UNIT", "len": 3, "req": False},
        {"n": "EKGRP", "l": "Purchasing Grp", "t": "CHAR", "len": 3, "req": False},
        {"n": "BKLAS", "l": "Valuation Class", "t": "CHAR", "len": 4, "req": False},
    ],
}

RULES = [
    {"id": "REQUIRED_FIELDS", "label": "Required Fields", "description": "Must not be empty"},
    {"id": "FIELD_LENGTH", "label": "Field Length", "description": "Max char enforcement"},
    {"id": "COUNTRY_ISO", "label": "Country ISO", "description": "2-3 letter format"},
    {"id": "CURRENCY_ISO", "label": "Currency ISO", "description": "3-letter ISO 4217"},
    {"id": "NUMERIC_ID", "label": "Numeric IDs", "description": "KUNNR/LIFNR/ID digits"},
    {"id": "EMAIL_FORMAT", "label": "Email Format", "description": "Valid @ format"},
    {"id": "DATE_FORMAT", "label": "Date Format", "description": "YYYYMMDD 8 digits"},
    {"id": "PAYMENT_TERMS", "label": "Payment Terms", "description": "Standard terms format"},
]

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
COUNTRY_RE = re.compile(r"^[A-Z]{2,3}$")
CURRENCY_RE = re.compile(r"^[A-Z]{3}$")
NUMERIC_ID_RE = re.compile(r"^\d{1,10}$")
DATE_RE = re.compile(r"^\d{8}$")
PAYMENT_TERM_RE = re.compile(r"^[A-Z]{2}\d{2}$")


class SmartRow:
    """
    Smart dictionary wrapper for row data supporting case-insensitive lookups,
    spaces/underscores flexibility, SuccessFactors & SAP field alias mapping, and fuzzy stem matching.
    """
    ALIASES = {
        "person-id-external": ["person-id-external", "person_id_external", "personIdExternal", "PERSON_ID", "PERSONID", "PER_PERSON_ID"],
        "user-id": ["user-id", "user_id", "userId", "USER_ID", "USERID", "EMP_ID", "EMPLOYEE_ID"],
        "first-name": ["first-name", "first_name", "firstName", "FIRST_NAME", "FIRSTNAME"],
        "last-name": ["last-name", "last_name", "lastName", "LAST_NAME", "LASTNAME"],
        "hire-date": ["hire-date", "hire_date", "hireDate", "HIRE_DATE"],
        "start-date": ["start-date", "start_date", "startDate", "START_DATE", "EFFECTIVE_DATE"],
        "date-of-birth": ["date-of-birth", "date_of_birth", "dateOfBirth", "BIRTH_DATE", "DOB"],
        "country-of-birth": ["country-of-birth", "country_of_birth", "countryOfBirth", "BIRTH_COUNTRY"],
        "PSTLZ": ["PSTLZ", "POSTALCODE", "POSTCODE", "ZIP", "ZIPCODE", "POSTAL_CODE", "POST_CODE1", "POSTCODE1", "POST_CODE", "PSTLZ_CODE", "zip-code"],
        "LAND1": ["LAND1", "COUNTRYKEY", "COUNTRY_KEY", "LAND", "COUNTRY", "COUNTRY_NAME", "country-of-birth", "nationality"],
        "SMTP_ADDR": ["SMTP_ADDR", "EMAIL", "EMAILADDRESS", "SMTP", "EMAIL_ADDR", "email-address"],
        "KUNNR": ["KUNNR", "CUSTOMER", "CUSTOMERNUMBER", "CUSTOMER_ID", "CUSTOMER_NO", "BPEXT", "PARTNER"],
        "LIFNR": ["LIFNR", "VENDOR", "VENDORNUMBER", "VENDOR_ID", "VENDOR_NO"],
        "NAME1": ["NAME1", "NAME", "CUSTOMERNAME", "VENDORNAME", "NAMORG1", "ORGANIZATIONNAME"],
        "ORT01": ["ORT01", "CITY", "CITY2", "CITY1", "TOWN"],
        "REGIO": ["REGIO", "STATE", "REGION", "PROVINCE", "UF"],
        "STRAS": ["STRAS", "STREET", "ADDRESS", "STREET1", "ADDRESS1"],
        "TELF1": ["TELF1", "PHONE", "TELEPHONE", "MOBILE", "TELNR_LONG", "TELNR", "phone-number"],
        "WAERS": ["WAERS", "CURRENCY", "CUKY", "currency-code"],
        "ZTERM": ["ZTERM", "PAYMENT_TERMS", "PAYTERMS", "PAYMENTTERMS"],
        "BUKRS": ["BUKRS", "COMPANY_CODE", "COMPANYCODE", "COMPANY"],
        "MATNR": ["MATNR", "MATERIAL", "MATERIAL_NUMBER"],
    }

    def __init__(self, data: Dict[str, Any]):
        self._data = data or {}
        self._norm_map = {}
        for k in self._data.keys():
            nk = str(k).upper().replace(" ", "").replace("_", "")
            self._norm_map[nk] = k

    def get_actual_key(self, key: str) -> str:
        """
        Return the exact key present in original row dictionary matching the alias/normalized name.
        """
        if not key:
            return ""
        if key in self._data:
            return key
        target_norm = str(key).upper().replace(" ", "").replace("_", "")
        if target_norm in self._norm_map:
            return self._norm_map[target_norm]
        target_stem = re.sub(r'\d+$', '', target_norm)
        for std_key, alias_list in self.ALIASES.items():
            all_candidates = [std_key] + alias_list
            all_stems = [re.sub(r'\d+$', '', c) for c in all_candidates]
            if target_norm in all_candidates or target_stem in all_stems:
                for candidate in all_candidates:
                    if candidate in self._norm_map:
                        return self._norm_map[candidate]
                    cand_stem = re.sub(r'\d+$', '', candidate)
                    for k_norm, original_key in self._norm_map.items():
                        if re.sub(r'\d+$', '', k_norm) == cand_stem:
                            return original_key
        for k_norm, original_key in self._norm_map.items():
            if target_stem and target_stem in k_norm:
                return original_key
        return key

    def get(self, key: str, default: Any = "") -> Any:
        if not key:
            return default
        
        # 1. Direct match
        if key in self._data:
            val = self._data[key]
            return val if val is not None else default

        target_norm = str(key).upper().replace(" ", "").replace("_", "")
        # 2. Normalized key match
        if target_norm in self._norm_map:
            val = self._data[self._norm_map[target_norm]]
            return val if val is not None else default

        # Stem matching (e.g. POSTCODE1 -> POSTCODE)
        target_stem = re.sub(r'\d+$', '', target_norm)

        # 3. SAP Alias match
        for std_key, alias_list in self.ALIASES.items():
            all_candidates = [std_key] + alias_list
            all_stems = [re.sub(r'\d+$', '', c) for c in all_candidates]
            
            if target_norm in all_candidates or target_stem in all_stems:
                for candidate in all_candidates:
                    if candidate in self._norm_map:
                        val = self._data[self._norm_map[candidate]]
                        return val if val is not None else default
                    cand_stem = re.sub(r'\d+$', '', candidate)
                    for k_norm, original_key in self._norm_map.items():
                        if re.sub(r'\d+$', '', k_norm) == cand_stem:
                            val = self._data[original_key]
                            return val if val is not None else default

        # 4. Substring match fallback
        for k_norm, original_key in self._norm_map.items():
            if target_stem and target_stem in k_norm:
                val = self._data[original_key]
                return val if val is not None else default

        return default

    def __getitem__(self, item):
        return self.get(item)

    def __contains__(self, item):
        return self.get(item, None) is not None


class ValidationAgent:
    def __init__(self):
        pass

    def _eval_dynamic_rule(self, code: str, row: Dict[str, Any]) -> bool:
        """
        Safely evaluate a compiled Python rule condition against a row dictionary.
        Returns True if rule condition is violated (i.e. validation fails).
        """
        try:
            allowed_globals = {
                "__builtins__": None,
                "str": str,
                "len": len,
                "int": int,
                "float": float,
                "bool": bool,
                "re": re,
                "abs": abs,
                "isinstance": isinstance,
            }
            smart_row = row if isinstance(row, SmartRow) else SmartRow(row)
            allowed_locals = {"row": smart_row}
            return bool(eval(code, allowed_globals, allowed_locals))
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Dynamic rule evaluation error for code: {code} -> {e}")
            return False

    def validate_row(
        self,
        row: Dict[str, Any],
        fields: List[Dict[str, Any]],
        dynamic_rules: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        errs: List[Dict[str, str]] = []
        warns: List[Dict[str, str]] = []
        smart_row = row if isinstance(row, SmartRow) else SmartRow(row)

        # Collect fields explicitly overridden by dynamic AI rules
        overridden_fields: set = set()

        # 1. Custom Dynamic AI Rules (Evaluated FIRST with Highest Priority)
        if dynamic_rules:
            for rule in dynamic_rules:
                rule_id = rule.get("id")
                code = rule.get("python_code")
                if not rule_id or not code:
                    continue
                
                # Mark target field as overridden
                field = rule.get("field") or ""
                if field and field != "GENERAL":
                    actual_field = smart_row.get_actual_key(field) or field
                    overridden_fields.add(field.upper())
                    overridden_fields.add(actual_field.upper())

                is_violation = self._eval_dynamic_rule(code, smart_row)
                if is_violation:
                    field = rule.get("field") or "GENERAL"
                    actual_field = smart_row.get_actual_key(field) or field
                    msg = rule.get("error_message") or rule.get("label") or "Dynamic rule violation"
                    sev = rule.get("severity", "ERROR").upper()
                    issue = {"f": actual_field, "m": msg, "sev": sev, "rule": rule_id}
                    if sev == "ERROR":
                        errs.append(issue)
                    else:
                        warns.append(issue)

        # 2. Standard SAP field rules (Skipped if field is overridden by a Dynamic AI Rule)
        for f in fields:
            std_field_name = f["n"]
            actual_field_name = smart_row.get_actual_key(std_field_name) or std_field_name
            if actual_field_name not in smart_row:
                continue

            # SKIP standard SAP field check if an AI Dynamic Rule is active on this field!
            if std_field_name.upper() in overridden_fields or actual_field_name.upper() in overridden_fields:
                continue

            raw = smart_row.get(std_field_name, None)
            sv = str(raw).strip() if raw is not None else ""

            if f["req"] and not sv:
                errs.append({"f": actual_field_name, "m": "Required field empty", "sev": "ERROR", "rule": "REQUIRED_FIELDS"})
                continue
            if not sv:
                continue

            if f["len"] and len(sv) > f["len"]:
                errs.append({"f": actual_field_name, "m": f"Exceeds max length {f['len']} (actual {len(sv)})", "sev": "ERROR", "rule": "FIELD_LENGTH"})

            if std_field_name == "LAND1" and not COUNTRY_RE.match(sv):
                errs.append({"f": actual_field_name, "m": "Country must be ISO 2-3 chars", "sev": "ERROR", "rule": "COUNTRY_ISO"})

            if f["t"] == "CUKY" and not CURRENCY_RE.match(sv):
                warns.append({"f": actual_field_name, "m": "Must be 3-letter ISO currency", "sev": "WARN", "rule": "CURRENCY_ISO"})

            if std_field_name in ("KUNNR", "LIFNR") and not NUMERIC_ID_RE.match(sv):
                errs.append({"f": actual_field_name, "m": "Must be numeric ≤10 digits", "sev": "ERROR", "rule": "NUMERIC_ID"})

            if std_field_name == "SMTP_ADDR" and not EMAIL_RE.match(sv):
                warns.append({"f": actual_field_name, "m": "Invalid email format", "sev": "WARN", "rule": "EMAIL_FORMAT"})

            if f["t"] == "DATS" and not DATE_RE.match(sv):
                warns.append({"f": actual_field_name, "m": "Must be YYYYMMDD", "sev": "WARN", "rule": "DATE_FORMAT"})

            if std_field_name == "ZTERM" and not PAYMENT_TERM_RE.match(sv):
                warns.append({"f": actual_field_name, "m": "Must match SAP terms format e.g. NT30", "sev": "WARN", "rule": "PAYMENT_TERMS"})

        st = "ERROR" if errs else ("WARN" if warns else "PASS")
        return {"errs": errs, "warns": warns, "st": st}
    def _primary_key_field(self, obj: str) -> str:
        key_map = {
            "BIOGRAPHICAL INFO": "person-id-external",
            "PERSONAL INFO": "person-id-external",
            "EMPLOYMENT DETAILS": "user-id",
            "JOB INFO": "user-id",
            "COMPENSATION INFO": "user-id",
            "PAY COMPONENT RECURRING": "user-id",
            "PAY COMPONENT NON RECURRING": "user-id",
            "CUSTOMER": "KUNNR",
            "VENDOR": "LIFNR",
            "MATERIAL": "MATNR",
        }
        return key_map.get(obj.upper(), "person-id-external")

    def _primary_key_value(self, row: Dict[str, Any], obj: str) -> str:
        pk_field = self._primary_key_field(obj)
        if not pk_field:
            return ""
        smart_row = row if isinstance(row, SmartRow) else SmartRow(row)
        value = smart_row.get(pk_field, "")
        return str(value).strip() if value is not None else ""

    def run_validation(
        self,
        obj: str,
        rows: List[Dict[str, Any]],
        dynamic_rules: Optional[List[Dict[str, Any]]] = None,
        selected_standard_rules: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        obj_upper = str(obj).upper()
        fields = OBJS.get(obj_upper)
        if not fields:
            try:
                from services.supabase_client import supabase_service
                client = supabase_service.get_client()
                res_obj = client.table("sf_objects").select("id").ilike("name", obj).execute()
                if res_obj.data:
                    obj_id = res_obj.data[0]["id"]
                    res_f = client.table("sf_fields").select("*").eq("object_id", obj_id).execute()
                    if res_f.data:
                        fields = [
                            {
                                "n": sf.get("field_name"),
                                "l": sf.get("field_description") or sf.get("field_name"),
                                "t": sf.get("data_type", "CHAR"),
                                "len": int(sf.get("max_length")) if sf.get("max_length") and str(sf.get("max_length")).isdigit() else None,
                                "req": sf.get("is_mandatory", False)
                            }
                            for sf in res_f.data
                        ]
            except Exception:
                pass

        if not fields and rows:
            sample_keys = list(rows[0].keys()) if isinstance(rows[0], dict) else []
            fields = [{"n": k, "l": k, "t": "CHAR", "len": None, "req": False} for k in sample_keys]

        if not fields:
            fields = OBJS["BIOGRAPHICAL INFO"]

        # Determine which standard rules are overridden by AI Dynamic Rules
        # ONLY override a standard rule if the AI rule's PRIMARY TARGET FIELD matches that standard rule's field!
        overridden_rule_ids: set = set()
        if dynamic_rules:
            for dr in dynamic_rules:
                f_name = (dr.get("field") or "").upper()
                f_label = (dr.get("label") or "").lower()
                
                # Match strictly against the primary target field name or explicit label prefix
                if f_name in ("LAND1", "COUNTRY", "COUNTRYKEY", "COUNTRY_KEY") or f_label.startswith("country iso"):
                    overridden_rule_ids.add("COUNTRY_ISO")
                elif f_name in ("WAERS", "CURRENCY", "CUKY") or f_label.startswith("currency iso"):
                    overridden_rule_ids.add("CURRENCY_ISO")
                elif f_name in ("SMTP_ADDR", "EMAIL", "EMAIL_ADDR") or f_label.startswith("email"):
                    overridden_rule_ids.add("EMAIL_FORMAT")
                elif f_name in ("KUNNR", "LIFNR", "CUSTOMER", "VENDOR") and f_label.startswith("numeric"):
                    overridden_rule_ids.add("NUMERIC_ID")
                elif f_name in ("ZTERM", "PAYMENT_TERMS", "PAYTERMS") or f_label.startswith("payment"):
                    overridden_rule_ids.add("PAYMENT_TERMS")

        present_field_keys = set()
        for row in rows:
            if not isinstance(row, dict):
                continue
            for key in row.keys():
                present_field_keys.add(str(key).upper().replace(" ", "").replace("_", ""))

        def normalize_field_name(name: str) -> str:
            return str(name).upper().replace(" ", "").replace("_", "")

        def has_field(*candidates: str) -> bool:
            target_keys = {normalize_field_name(c) for c in candidates if c}
            if not target_keys:
                return False
            for normalized in target_keys:
                if normalized in present_field_keys:
                    return True
                for present in present_field_keys:
                    if present.endswith(normalized) or normalized.endswith(present):
                        return True
            return False

        def applies_to_standard_rule(rule_id: str) -> bool:
            if rule_id == "REQUIRED_FIELDS":
                return any(f.get("req") is True for f in fields) and any(has_field(f["n"]) for f in fields if f.get("req") is True)
            if rule_id == "FIELD_LENGTH":
                return any(f.get("len") for f in fields) and any(has_field(f["n"]) for f in fields if f.get("len"))
            if rule_id == "COUNTRY_ISO":
                return has_field("LAND1", "COUNTRY", "COUNTRYKEY", "COUNTRY_KEY")
            if rule_id == "CURRENCY_ISO":
                return has_field("WAERS", "CURRENCY", "CUKY")
            if rule_id == "NUMERIC_ID":
                return has_field("KUNNR", "LIFNR", "CUSTOMER", "VENDOR")
            if rule_id == "EMAIL_FORMAT":
                return has_field("SMTP_ADDR", "EMAIL", "EMAILADDRESS")
            if rule_id == "DATE_FORMAT":
                return any(f.get("t") == "DATS" for f in fields) and any(has_field(f["n"]) for f in fields if f.get("t") == "DATS")
            if rule_id == "PAYMENT_TERMS":
                return has_field("ZTERM", "PAYMENT_TERMS", "PAYTERMS")
            return True

        # Place dynamic rules at TOP, and EXCLUDE overridden default rules from report
        all_rules = []
        if dynamic_rules:
            for dr in dynamic_rules:
                all_rules.append({
                    "id": dr["id"],
                    "label": dr.get("label", dr["id"]),
                    "description": dr.get("description", "Custom AI Dynamic Rule"),
                    "is_dynamic": True
                })
        
        for r in RULES:
            if not applies_to_standard_rule(r["id"]):
                continue
            # Only include standard rule when not overridden and when selected by user (if provided)
            if r["id"] in overridden_rule_ids:
                continue
            if selected_standard_rules is not None and r["id"] not in selected_standard_rules:
                continue
            all_rules.append(r)

        validated = []
        rule_failures: Dict[str, List[Dict[str, Any]]] = {r["id"]: [] for r in all_rules}

        for idx, row in enumerate(rows):
            smart_row = SmartRow(row)
            result = self.validate_row(smart_row, fields, dynamic_rules)
            # Filter row-level issues so only those for active (included) rules are kept
            active_errs = [issue for issue in result.get("errs", []) if issue.get("rule") in rule_failures]
            active_warns = [issue for issue in result.get("warns", []) if issue.get("rule") in rule_failures]
            # Recompute overall row status after filtering
            if active_errs:
                st = "ERROR"
            elif active_warns:
                st = "WARN"
            else:
                st = "PASS"

            validated.append({
                "idx": idx,
                "row": row,
                "primary_key": self._primary_key_value(row, obj),
                "errs": active_errs,
                "warns": active_warns,
                "st": st,
            })

            for issue in active_errs + active_warns:
                actual_f = issue["f"]
                val = smart_row.get(actual_f, "")
                rule_failures[issue["rule"]].append({
                    "idx": idx,
                    "field": actual_f,
                    "value": val,
                    "message": issue["m"],
                    "severity": issue["sev"],
                })

        total = len(rows)
        report = []
        for r in all_rules:
            fails = rule_failures.get(r["id"], [])
            fail_row_count = len({f["idx"] for f in fails})
            report.append({
                "rule": r["id"],
                "label": r["label"],
                "description": r["description"],
                "is_dynamic": r.get("is_dynamic", False),
                "totalChecked": total,
                "failCount": fail_row_count,
                "passCount": total - fail_row_count,
                "failures": fails,
            })

        stats = {
            "total": total,
            "errors": sum(1 for v in validated if v["st"] == "ERROR"),
            "warns": sum(1 for v in validated if v["st"] == "WARN"),
            "passed": sum(1 for v in validated if v["st"] == "PASS"),
            "overridden_rules": list(overridden_rule_ids)
        }

        applied_standard = [r["id"] for r in all_rules if not r.get("is_dynamic")]
        return {"validated": validated, "report": report, "stats": stats, "applied_standard_rules": applied_standard}

# Generator for Sample CSV
_VALID_COUNTRIES = ["IN", "US", "DE", "GB", "FR", "SG", "AU", "CA", "JP", "AE"]
_VALID_CURRENCIES = ["INR", "USD", "EUR", "GBP", "SGD", "AUD", "CAD", "JPY", "AED"]
_VALID_ZTERMS = ["NT30", "NT45", "NT60", "NT90"]
_ACCOUNT_GROUPS = ["KUNA", "EXPU"]
_CITIES = ["Bengaluru", "Chicago", "Berlin", "London", "Paris", "Singapore", "Sydney", "Toronto", "Tokyo", "Dubai"]
_COMPANY_PREFIXES = ["Acme", "Global", "Summit", "Pioneer", "Nova", "Orion", "Vertex", "Alpine", "Cobalt", "Meridian"]
_COMPANY_SUFFIXES = ["Trading Co", "Industries", "Enterprises", "Logistics", "Holdings", "Manufacturing", "Solutions", "Traders", "Group", "Corp"]

def gen_customer_rows(count: int) -> List[Dict[str, str]]:
    random.seed(42)  # deterministic sample, reproducible downloads
    rows: List[Dict[str, str]] = []

    for i in range(count):
        country = random.choice(_VALID_COUNTRIES)
        row = {
            "KUNNR": str(1000000000 + i).zfill(10),
            "KTOKD": random.choice(_ACCOUNT_GROUPS),
            "NAME1": f"{random.choice(_COMPANY_PREFIXES)} {random.choice(_COMPANY_SUFFIXES)} {i}",
            "NAME2": "",
            "LAND1": country,
            "ORT01": random.choice(_CITIES),
            "PSTLZ": str(random.randint(10000, 99999)),
            "REGIO": "",
            "STRAS": f"{random.randint(1, 999)} Main Street",
            "TELF1": f"+1-555-{random.randint(1000, 9999)}",
            "SMTP_ADDR": f"contact{i}@example.com",
            "BUKRS": "1000",
            "VKORG": "1000",
            "VTWEG": "10",
            "SPART": "00",
            "WAERS": random.choice(_VALID_CURRENCIES),
            "ZTERM": random.choice(_VALID_ZTERMS),
            "STCD1": f"TAX{random.randint(100000, 999999)}",
            "TAXKD": random.choice(["0", "1"]),
            "ERDAT": "20240115",
        }

        # Deterministically seed violations
        if i % 13 == 0:
            row[random.choice(["NAME1", "LAND1", "BUKRS"])] = ""
        if i % 17 == 3:
            row["NAME1"] = row["NAME1"] + " " + "Extended Legal Entity Name Overflow Text"
        if i % 11 == 5:
            row["LAND1"] = random.choice(["USA1", "de", "XXXX", "1"])
        if i % 9 == 2:
            row["WAERS"] = random.choice(["Rupees", "inr", "12", "DOLLAR"])
        if i % 14 == 7:
            row["KUNNR"] = random.choice(["ABCDEFGHIJ", "12345678901", "12AB56"])
        if i % 10 == 4:
            row["SMTP_ADDR"] = random.choice(["invalid-email", "user@@example.com", "user@nodomain", "plaintext"])
        if i % 12 == 6:
            row["ERDAT"] = random.choice(["2024-01-15", "15012024", "2024131", "01/15/2024"])
        if i % 15 == 8:
            row["ZTERM"] = random.choice(["NET30", "30", "Immediate", "N30"])

        rows.append(row)

    return rows
