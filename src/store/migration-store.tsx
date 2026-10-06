// ═══════════════════════════════════════════════════════
// MIGRATION STORE — Global state (ported from S{})
// ═══════════════════════════════════════════════════════

import React, { createContext, useContext, useReducer, useEffect, useState, type ReactNode } from 'react';
import localforage from 'localforage';

localforage.config({
  name: 'SF-DMS',
  storeName: 'migration_store',
  description: 'Stores massive data tables for the migration app'
});
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
  activeMock: 'mock-0' | 'mock-1' | 'mock-2';
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
  uploadedFileName: string;
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
  harmonizeDynamicRules: any[];
  harmonizeCustomPrompts: string[];
  validationDynamicRules: any[];
  validationCustomPrompts: string[];
  cleanserDynamicRules: any[];
  cleanserCustomPrompts: string[];
  transformDynamicRules: any[];
  transformCustomPrompts: string[];
  isCleansedSaved: boolean;
  cleansingSummary: any;
  transformSummary: any;
  isTransformedSaved: boolean;
  techDocId?: string;
  isTechDocsSaved: boolean;
  isMock1Completed: boolean;
}

const defaultState: MigrationState = {
  activeMock: 'mock-0',
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
  uploadedFileName: '',
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
  harmonizeDynamicRules: [],
  harmonizeCustomPrompts: [],
  validationDynamicRules: [],
  validationCustomPrompts: [],
  cleanserDynamicRules: [],
  cleanserCustomPrompts: [],
  transformDynamicRules: [],
  transformCustomPrompts: [],
  isCleansedSaved: false,
  cleansingSummary: null,
  transformSummary: null,
  isTransformedSaved: false,
  isTechDocsSaved: false,
  isMock1Completed: false,
};

const getInitialState = (): MigrationState => {
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
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    localforage.getItem<Partial<MigrationState>>('migration_state')
      .then((saved) => {
        if (saved) {
          dispatch({ type: 'BATCH_UPDATE', updates: saved });
        }
      })
      .catch((e) => {
        console.warn('Failed to load state from localforage', e);
      })
      .finally(() => {
        setIsReady(true);
      });
  }, []);

  useEffect(() => {
    if (!isReady) return;
    
    const timeoutId = setTimeout(() => {
      // Strip out massive arrays before saving to prevent structured clone freezing
      const {
        rawData,
        uploadedData,
        extracted,
        extractedTables,
        harmonized,
        validated,
        cleaned,
        transformed,
        dmcRows,
        ...lightweightState
      } = state;

      localforage.setItem('migration_state', lightweightState)
        .catch((e) => {
          console.warn('Failed to save state to localforage.', e);
        });
    }, 500);
    
    return () => clearTimeout(timeoutId);
  }, [state, isReady]);

  if (!isReady) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900 text-white font-mono text-sm">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
          <span>Loading Migration Workspace...</span>
        </div>
      </div>
    );
  }

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

export function isMock0Completed(state: MigrationState) {
  return state.isMappingSaved && state.isDataSaved && state.isHarmonizedSaved && state.isValidatedSaved && state.isCleansedSaved && state.isTransformedSaved;
}

export function isMock1Completed(state: MigrationState) {
  return state.isMock1Completed;
}

