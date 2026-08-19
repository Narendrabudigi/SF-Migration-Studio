// ═══════════════════════════════════════════════════════
// MIGRATION STORE — Global state (ported from S{})
// ═══════════════════════════════════════════════════════

import React, { createContext, useContext, useReducer, useEffect, type ReactNode } from 'react';

export interface MappingEntry {
  src: string;
  sap: string;
  sapLabel: string;
  conf: number;
  tr: string;
  note: string;
  req: boolean;
  srcType?: string;
}

export interface ValidationEntry {
  row: Record<string, unknown>;
  idx: number;
  primary_key?: string;
  errs: { f: string; m: string; sev: string; rule: string }[];
  warns: { f: string; m: string; sev: string; rule: string }[];
  st: 'ERROR' | 'WARN' | 'PASS';
}

export interface MigrationState {
  projectId: string | null;
  projectName: string | null;
  connUrl: string;
  connClient: string;
  connUser: string;
  connPass: string;
  src: string;
  obj: string;
  cc: string;
  so: string;
  po: string;
  plant: string;
  curr: string;
  distch: string;
  spart: string;
  rawData: Record<string, string>[];
  uploadedData: Record<string, any>[];
  headers: string[];
  mapping: MappingEntry[];
  extracted: Record<string, string>[];
  extractedTables: any[];
  harmonized: Record<string, string>[];
  validated: ValidationEntry[];
  cleaned: Record<string, string>[];
  transformed: Record<string, string>[];
  dmcRows: Record<string, string>[];
  aiLog: { ts: string; p: string; r: string }[];
  fixLog: string[];
  stats: { fixes: number; errors: number; warns: number; passed: number };
  theme: 'light' | 'dark';
  isMappingSaved: boolean;
  isDataSaved: boolean;
  aiReport: any;
  edaStats: any[];
  reportMetrics: any;
  complianceData: any[];
  isHarmonizedSaved: boolean;
  harmonizationResult: any;
  isValidatedSaved: boolean;
  validationReport: any[];
  dynamicRules: any[];
  customPrompts: string[];
  isCleansedSaved: boolean;
  cleansingSummary: any;
  transformSummary: any;
  isTransformedSaved: boolean;
}

const defaultState: MigrationState = {
  projectId: null,
  projectName: null,
  connUrl: '',
  connClient: '100',
  connUser: '',
  connPass: '',
  src: 'EXCEL_CSV',
  obj: 'Biographical Info',
  cc: '1000',
  so: '1000',
  po: '1000',
  plant: '1000',
  curr: 'USD',
  distch: '10',
  spart: '00',
  rawData: [],
  uploadedData: [],
  headers: [],
  mapping: [],
  extracted: [],
  extractedTables: [],
  harmonized: [],
  validated: [],
  cleaned: [],
  transformed: [],
  dmcRows: [],
  aiLog: [],
  fixLog: [],
  stats: { fixes: 0, errors: 0, warns: 0, passed: 0 },
  theme: 'light',
  isMappingSaved: false,
  isDataSaved: false,
  aiReport: null,
  edaStats: [],
  reportMetrics: null,
  complianceData: [],
  isHarmonizedSaved: false,
  harmonizationResult: null,
  isValidatedSaved: false,
  validationReport: [],
  dynamicRules: [],
  customPrompts: [],
  isCleansedSaved: false,
  cleansingSummary: null,
  transformSummary: null,
  isTransformedSaved: false,
};

const getInitialState = (): MigrationState => {
  if (typeof window !== 'undefined') {
    try {
      const saved = sessionStorage.getItem('migration_state');
      if (saved) {
        return { ...defaultState, ...JSON.parse(saved) };
      }
    } catch (e) {
      console.warn('Failed to load state from session storage', e);
    }
  }
  return defaultState;
};

type Action =
  | { type: 'SET_FIELD'; field: keyof MigrationState; value: unknown }
  | { type: 'SET_THEME'; theme: 'light' | 'dark' }
  | { type: 'BATCH_UPDATE'; updates: Partial<MigrationState> };

function reducer(state: MigrationState, action: Action): MigrationState {
  switch (action.type) {
    case 'SET_FIELD':
      return { ...state, [action.field]: action.value };
    case 'SET_THEME':
      localStorage.setItem('theme', action.theme);
      return { ...state, theme: action.theme };
    case 'BATCH_UPDATE':
      return { ...state, ...action.updates };
    default:
      return state;
  }
}

const MigrationContext = createContext<{
  state: MigrationState;
  dispatch: React.Dispatch<Action>;
} | null>(null);

export function MigrationProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, defaultState, getInitialState);

  useEffect(() => {
    try {
      sessionStorage.setItem('migration_state', JSON.stringify(state));
    } catch (e) {
      console.warn('Failed to save state to session storage. It might be too large.', e);
    }
  }, [state]);

  return (
    <MigrationContext.Provider value={{ state, dispatch }}>
      {children}
    </MigrationContext.Provider>
  );
}

export function useMigration() {
  const ctx = useContext(MigrationContext);
  if (!ctx) throw new Error('useMigration must be used within MigrationProvider');
  return ctx;
}
