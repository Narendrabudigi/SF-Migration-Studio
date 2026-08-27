import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { OBJS } from '@/data/sap-schemas';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function esc(s: unknown): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function expCSV(data: Record<string, any>[]): string {
  if (!data.length) return '';
  const c = Object.keys(data[0]);
  return [
    c.join(','),
    ...data.map((r) =>
      c
        .map((k) => {
          const v = String(r[k] || '');
          return v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : '' + v;
        })
        .join(',')
    ),
  ].join('\n');
}

export function dl(content: string, name: string, type: string) {
  const b = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

const PRIMARY_KEY_EXACT = new Set([
  'ID', 'PK', 'KEY', 'REF', 'REFERENCE',
  'WORKER NUMBER', 'WORKER_NUMBER', 'WORKER_ID', 'WORKER ID', 'WORKER NO', 'WORKER_NO', 'WORKER REFERENCE', 'WORKER_REFERENCE',
  'PERSON ID EXTERNAL', 'PERSON_ID_EXTERNAL', 'PERSON-ID-EXTERNAL', 'PERSON_ID', 'PERSON ID', 'PER_PERSON_ID', 'PERSON REFERENCE', 'PERSON_REFERENCE',
  'USER ID', 'USER_ID', 'USER-ID', 'USERID', 'USER REFERENCE', 'USER_REFERENCE',
  'EMPLOYEE ID', 'EMPLOYEE_ID', 'EMPLOYEE NUMBER', 'EMPLOYEE_NUMBER', 'EMPLOYEE REFERENCE', 'EMPLOYEE_REFERENCE', 'EMPLOYEE REF', 'EMP ID', 'EMP_ID', 'EMPID', 'EMP REFERENCE', 'EMP REF',
  'EMPLOYMENT NUMBER', 'EMPLOYMENT_NUMBER', 'EMPLOYMENT ID', 'EMPLOYMENT_ID', 'EMPLOYMENT REFERENCE', 'EMPLOYMENT_REFERENCE',
  'ASSIGNMENT NUMBER', 'ASSIGNMENT_NUMBER', 'ASSIGNMENT ID', 'ASSIGNMENT_ID', 'ASSIGNMENT REFERENCE', 'ASSIGNMENT_REFERENCE',
  'KUNNR', 'LIFNR', 'MATNR', 'PARTNER', 'BP_NUMBER', 'BUSINESS_PARTNER',
  'CUSTOMER NUMBER', 'CUSTOMER_NUMBER', 'VENDOR NUMBER', 'VENDOR_NUMBER', 'MATERIAL NUMBER', 'MATERIAL_NUMBER',
  'PARTY NUMBER', 'PARTY_NUMBER', 'SYS_ID', 'ROW_ID', 'RECORD_ID'
]);

const NON_KEY_PATTERNS = [
  'PHONE', 'FAX', 'TAX', 'HOUSE', 'STREET', 'BUILDING', 'ROOM', 'PO_BOX', 'ZIP', 'POSTAL',
  'SERIAL', 'BATCH', 'ITEM', 'SEQ', 'SEQUENCE', 'LINE', 'STATUS', 'NAME', 'COUNTRY', 'DATE', 'GENDER', 'LANGUAGE', 'CITIZENSHIP', 'SOURCE'
];

export function isPrimaryKeyField(colName: string): boolean {
  if (!colName) return false;
  const clean = String(colName).trim();
  const upper = clean.toUpperCase().replace(/[\.-]/g, '_');
  const upperOriginal = clean.toUpperCase();

  // 1. Direct check in exact set or lower/upper versions
  if (PRIMARY_KEY_EXACT.has(upperOriginal) || PRIMARY_KEY_EXACT.has(upper)) return true;

  // 2. Check against SAP target object schemas (fields with key: true)
  const normCol = clean.toLowerCase().replace(/[\s_\-.]/g, '');
  if (OBJS) {
    for (const objKey in OBJS) {
      const obj = OBJS[objKey];
      if (obj?.fields) {
        for (const field of obj.fields) {
          if (field.key) {
            const normN = field.n.toLowerCase().replace(/[\s_\-.]/g, '');
            const normL = field.l.toLowerCase().replace(/[\s_\-.]/g, '');
            if (normCol === normN || normCol === normL) return true;
          }
        }
      }
    }
  }

  // 3. Exclude non-keys if they match NON_KEY_PATTERNS and don't explicitly end with ID/PK/KEY/REF/REFERENCE
  const hasIdWord = upper.endsWith('_ID') || upper.endsWith('_PK') || upper.endsWith('_KEY') || upper.endsWith('_REF') || upper.endsWith('_REFERENCE') || upperOriginal.endsWith(' ID') || upperOriginal.endsWith(' PK') || upperOriginal.endsWith(' REF') || upperOriginal.endsWith(' REFERENCE');
  if (!hasIdWord && NON_KEY_PATTERNS.some(nk => upper.includes(nk))) return false;

  // 4. Match common primary key naming conventions:
  if (hasIdWord) return true;
  if (upper.startsWith('ID_') || upper.startsWith('PK_') || upper.startsWith('KEY_') || upper.startsWith('REF_')) return true;

  // Worker / Person / Employee / User / Customer / Vendor / Material / Assignment / Employment + ID/Number/No/Code/Reference/Ref
  if (
    (upper.includes('WORKER') || upper.includes('PERSON') || upper.includes('EMP') || upper.includes('USER') || upper.includes('CUSTOMER') || upper.includes('VENDOR') || upper.includes('MATERIAL') || upper.includes('ASSIGNMENT') || upper.includes('EMPLOYMENT')) &&
    (upper.includes('ID') || upper.includes('NUMBER') || upper.includes('NO') || upper.includes('NUM') || upper.includes('CODE') || upper.includes('REFERENCE') || upper.includes('REF'))
  ) {
    return true;
  }

  return false;
}

