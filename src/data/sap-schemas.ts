// ═══════════════════════════════════════════════════════
// SUCCESSFACTORS TARGET OBJECT SCHEMAS
// ═══════════════════════════════════════════════════════

export interface SAPField {
  n: string;
  l: string;
  t: string;
  len: number;
  req: boolean;
  key: boolean;
  s: string;
  d: string;
}

export interface SAPObject {
  label: string;
  icon: string;
  module: string;
  tcode: string;
  dmc: string;
  fields: SAPField[];
}

const BIOGRAPHICAL_INFO: SAPObject = {
  label: 'Biographical Info (PerPerson)',
  icon: 'user',
  module: 'Employee Central',
  tcode: 'PerPerson',
  dmc: 'SF_BIOGRAPHICAL_INFO',
  fields: [
    { n: 'person-id-external', l: 'Person ID External', t: 'STRING', len: 32, req: true, key: true, s: 'General', d: 'External ID of the person' },
    { n: 'date-of-birth', l: 'Date of Birth', t: 'DATE', len: 10, req: false, key: false, s: 'Personal', d: 'Date of birth (YYYY-MM-DD)' },
    { n: 'country-of-birth', l: 'Country of Birth', t: 'STRING', len: 100, req: false, key: false, s: 'Personal', d: 'Country of birth code' },
    { n: 'region-of-birth', l: 'Region of Birth', t: 'STRING', len: 100, req: false, key: false, s: 'Personal', d: 'Region/State of birth' },
    { n: 'place-of-birth', l: 'Place of Birth', t: 'STRING', len: 100, req: false, key: false, s: 'Personal', d: 'City/Place of birth' },
  ],
};

const PERSONAL_INFO: SAPObject = {
  label: 'Personal Info (PerPersonal)',
  icon: 'users',
  module: 'Employee Central',
  tcode: 'PerPersonal',
  dmc: 'SF_PERSONAL_INFO',
  fields: [
    { n: 'person-id-external', l: 'Person ID External', t: 'STRING', len: 32, req: true, key: true, s: 'General', d: 'External ID of the person' },
    { n: 'first-name', l: 'First Name', t: 'STRING', len: 128, req: true, key: false, s: 'Name', d: 'First name' },
    { n: 'last-name', l: 'Last Name', t: 'STRING', len: 128, req: true, key: false, s: 'Name', d: 'Last name' },
    { n: 'middle-name', l: 'Middle Name', t: 'STRING', len: 128, req: false, key: false, s: 'Name', d: 'Middle name' },
    { n: 'salutation', l: 'Salutation', t: 'STRING', len: 32, req: false, key: false, s: 'Name', d: 'Title/Salutation' },
    { n: 'gender', l: 'Gender', t: 'STRING', len: 2, req: false, key: false, s: 'Personal', d: 'Gender code (M/F/U)' },
    { n: 'marital-status', l: 'Marital Status', t: 'STRING', len: 32, req: false, key: false, s: 'Personal', d: 'Marital status key' },
    { n: 'nationality', l: 'Nationality', t: 'STRING', len: 100, req: false, key: false, s: 'Personal', d: 'Nationality country code' },
  ],
};

const EMPLOYMENT_DETAILS: SAPObject = {
  label: 'Employment Details (EmpEmployment)',
  icon: 'briefcase',
  module: 'Employee Central',
  tcode: 'EmpEmployment',
  dmc: 'SF_EMPLOYMENT_DETAILS',
  fields: [
    { n: 'person-id-external', l: 'Person ID External', t: 'STRING', len: 32, req: true, key: true, s: 'General', d: 'External ID of the person' },
    { n: 'user-id', l: 'User ID', t: 'STRING', len: 100, req: true, key: true, s: 'General', d: 'System User ID' },
    { n: 'hire-date', l: 'Hire Date', t: 'DATE', len: 10, req: true, key: false, s: 'Employment', d: 'Original hire date (YYYY-MM-DD)' },
    { n: 'original-start-date', l: 'Original Start Date', t: 'DATE', len: 10, req: false, key: false, s: 'Employment', d: 'Company start date' },
  ],
};

const JOB_INFO: SAPObject = {
  label: 'Job Info (EmpJob)',
  icon: 'award',
  module: 'Employee Central',
  tcode: 'EmpJob',
  dmc: 'SF_JOB_INFO',
  fields: [
    { n: 'user-id', l: 'User ID', t: 'STRING', len: 100, req: true, key: true, s: 'General', d: 'System User ID' },
    { n: 'start-date', l: 'Start Date', t: 'DATE', len: 10, req: true, key: true, s: 'Effective', d: 'Effective start date' },
    { n: 'job-code', l: 'Job Code', t: 'STRING', len: 32, req: true, key: false, s: 'Job', d: 'Classification job code' },
    { n: 'job-title', l: 'Job Title', t: 'STRING', len: 256, req: false, key: false, s: 'Job', d: 'Position / Job title' },
    { n: 'department', l: 'Department', t: 'STRING', len: 128, req: false, key: false, s: 'Org', d: 'Department code' },
    { n: 'division', l: 'Division', t: 'STRING', len: 128, req: false, key: false, s: 'Org', d: 'Division code' },
    { n: 'location', l: 'Location', t: 'STRING', len: 128, req: false, key: false, s: 'Org', d: 'Location code' },
    { n: 'company', l: 'Legal Entity', t: 'STRING', len: 128, req: true, key: false, s: 'Org', d: 'Company / Legal Entity code' },
  ],
};

const COMPENSATION_INFO: SAPObject = {
  label: 'Compensation Info (EmpCompensation)',
  icon: 'dollar-sign',
  module: 'Employee Central',
  tcode: 'EmpCompensation',
  dmc: 'SF_COMPENSATION_INFO',
  fields: [
    { n: 'user-id', l: 'User ID', t: 'STRING', len: 100, req: true, key: true, s: 'General', d: 'System User ID' },
    { n: 'start-date', l: 'Start Date', t: 'DATE', len: 10, req: true, key: true, s: 'Effective', d: 'Effective start date' },
    { n: 'pay-group', l: 'Pay Group', t: 'STRING', len: 32, req: false, key: false, s: 'Pay', d: 'Payroll group code' },
    { n: 'is-fulltime-employee', l: 'Is Fulltime Employee', t: 'BOOLEAN', len: 5, req: false, key: false, s: 'Pay', d: 'Fulltime indicator' },
  ],
};

const PAY_COMPONENT_RECURRING: SAPObject = {
  label: 'Pay Component Recurring',
  icon: 'credit-card',
  module: 'Employee Central',
  tcode: 'PayComponentRecurring',
  dmc: 'SF_PAY_COMPONENT_RECURRING',
  fields: [
    { n: 'user-id', l: 'User ID', t: 'STRING', len: 100, req: true, key: true, s: 'General', d: 'System User ID' },
    { n: 'pay-component', l: 'Pay Component', t: 'STRING', len: 32, req: true, key: true, s: 'Pay', d: 'Recurring pay component code' },
    { n: 'paycompvalue', l: 'Amount', t: 'DECIMAL', len: 15, req: true, key: false, s: 'Pay', d: 'Pay component value' },
    { n: 'currency-code', l: 'Currency', t: 'STRING', len: 5, req: true, key: false, s: 'Pay', d: 'Currency ISO code' },
    { n: 'start-date', l: 'Start Date', t: 'DATE', len: 10, req: true, key: true, s: 'Effective', d: 'Effective start date' },
  ],
};

const PAY_COMPONENT_NON_RECURRING: SAPObject = {
  label: 'Pay Component Non Recurring',
  icon: 'coins',
  module: 'Employee Central',
  tcode: 'PayComponentNonRecurring',
  dmc: 'SF_PAY_COMPONENT_NON_RECURRING',
  fields: [
    { n: 'user-id', l: 'User ID', t: 'STRING', len: 100, req: true, key: true, s: 'General', d: 'System User ID' },
    { n: 'pay-component', l: 'Pay Component', t: 'STRING', len: 32, req: true, key: true, s: 'Pay', d: 'One-time pay component code' },
    { n: 'value', l: 'Amount', t: 'DECIMAL', len: 15, req: true, key: false, s: 'Pay', d: 'One-time payment amount' },
    { n: 'currency-code', l: 'Currency', t: 'STRING', len: 5, req: true, key: false, s: 'Pay', d: 'Currency ISO code' },
    { n: 'pay-date', l: 'Pay Date', t: 'DATE', len: 10, req: true, key: false, s: 'Pay', d: 'Payment date' },
  ],
};

export const OBJS: Record<string, SAPObject> = {
  'Biographical Info': BIOGRAPHICAL_INFO,
  'Employment Details': EMPLOYMENT_DETAILS,
  'Personal Info': PERSONAL_INFO,
  'Job Info': JOB_INFO,
  'Compensation Info': COMPENSATION_INFO,
  'Pay Component Recurring': PAY_COMPONENT_RECURRING,
  'Pay Component Non Recurring': PAY_COMPONENT_NON_RECURRING,

  // Uppercase / underscore aliases for compatibility
  'BIOGRAPHICAL INFO': BIOGRAPHICAL_INFO,
  'EMPLOYMENT DETAILS': EMPLOYMENT_DETAILS,
  'PERSONAL INFO': PERSONAL_INFO,
  'JOB INFO': JOB_INFO,
  'COMPENSATION INFO': COMPENSATION_INFO,
  'PAY COMPONENT RECURRING': PAY_COMPONENT_RECURRING,
  'PAY COMPONENT NON RECURRING': PAY_COMPONENT_NON_RECURRING,
};

export const DMC_COLS: Record<string, string[]> = {
  'Biographical Info': ['person-id-external', 'date-of-birth', 'country-of-birth', 'region-of-birth', 'place-of-birth'],
  'Personal Info': ['person-id-external', 'first-name', 'last-name', 'middle-name', 'salutation', 'gender', 'marital-status', 'nationality'],
  'Employment Details': ['person-id-external', 'user-id', 'hire-date', 'original-start-date'],
  'Job Info': ['user-id', 'start-date', 'job-code', 'job-title', 'department', 'division', 'location', 'company'],
  'Compensation Info': ['user-id', 'start-date', 'pay-group', 'is-fulltime-employee'],
  'Pay Component Recurring': ['user-id', 'pay-component', 'paycompvalue', 'currency-code', 'start-date'],
  'Pay Component Non Recurring': ['user-id', 'pay-component', 'value', 'currency-code', 'pay-date'],
};
