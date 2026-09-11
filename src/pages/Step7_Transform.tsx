import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMigration } from '@/store/migration-store';
import { useToast } from '@/components/ui/toast';
import { useLoading } from '@/components/ui/loading-overlay';
import { dl, expCSV, isPrimaryKeyField } from '@/lib/utils';
import { PageLayout, PageGrid, GridCol, Card, CardHeader, CardBody, Button, StatBox, StatsGrid, DataTable, PageHeader, EmptyState, DynamicTransformModal } from '@/components/shared';
import { ArrowLeft, ArrowRight, Cog, Download, Upload, FileText, Search, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, FileSpreadsheet, Save, Check, Bot, Sparkles, X, Key, Trash2, CheckSquare, Square, Plus, RotateCcw, ListFilter, Layers } from 'lucide-react';
import { TableFilterToolbar, filterRowsByKey, detectKeyColumns, getTableDisplayData } from '@/components/shared/TableFilterToolbar';
import type { TableInfo } from '@/components/shared/TableFilterToolbar';
import { TablePaginationFooter } from '@/components/shared/TablePaginationFooter';

const AUDIT_PAGE_SIZE = 15;

/* ─── Target Table Resolver (Returns ALL matching SAP structure tables for a field) ─── */
function resolveTargetTables(fieldName: string, extractedTables: TableInfo[] = [], targetObject?: string): string[] {
  if (!fieldName) return ['General'];
  const cleanField = fieldName.replace(/^\[\d+\]\s*/, '').trim();
  const fieldBase = cleanField.split('.').pop() || cleanField;
  const fieldLower = fieldBase.toLowerCase();

  const matchedTables: string[] = [];

  // 1. Direct schema prefix match if field is like "PerPerson.personIdExternal"
  if (cleanField.includes('.')) {
    const prefixSchema = cleanField.split('.')[0].trim();
    for (const t of extractedTables) {
      if (t.table_name.toLowerCase() === prefixSchema.toLowerCase()) {
        if (!matchedTables.includes(t.table_name)) {
          matchedTables.push(t.table_name);
        }
      }
    }
  }

  for (const t of extractedTables) {
    for (const col of t.columns) {
      const cleanCol = col.replace(/^\[\d+\]\s*/, '').trim();
      const colBase = cleanCol.split('.').pop() || cleanCol;
      if (colBase.toLowerCase() === fieldLower || cleanCol.toLowerCase() === cleanField.toLowerCase()) {
        if (!matchedTables.includes(t.table_name)) {
          matchedTables.push(t.table_name);
        }
      }
    }
  }

  if (matchedTables.length > 0) {
    return matchedTables;
  }

  // Fallback heuristics based on field names if not explicitly found in extractedTables schema
  if (fieldLower.includes('addr') || fieldLower.includes('city') || fieldLower.includes('country') || fieldLower.includes('street') || fieldLower.includes('post_code') || fieldLower.includes('telnr') || fieldLower.includes('smtp')) {
    return ['S_ADDRESS'];
  }
  if (fieldLower.includes('company') || fieldLower.includes('bukrs') || fieldLower.includes('akont')) {
    return ['S_CUST_COMPANY'];
  }
  if (fieldLower.includes('sales') || fieldLower.includes('vkorg') || fieldLower.includes('vtweg') || fieldLower.includes('spart')) {
    return ['S_CUST_SALES'];
  }
  if (fieldLower.includes('tax') || fieldLower.includes('stcd') || fieldLower.includes('vat')) {
    return ['S_CUST_TAXNUMBERS'];
  }

  const objName = (targetObject || 'CUST').toUpperCase();
  return [`S_${objName}_GEN`];
}

/* ─── Transformation Report Card (Matching Harmonization Report Card Aesthetic) ─── */
function TransformationReportCard({
  summary,
  transformedRows,
  extractedTables = [],
  targetObject,
}: {
  summary: any;
  transformedRows: any[];
  extractedTables?: TableInfo[];
  targetObject?: string;
}) {
  const [showLogDetails, setShowLogDetails] = useState(false);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditPage, setAuditPage] = useState(1);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const rawAuditLog: any[] = summary?.audit_log || [];
  const rowsLoaded = summary?.rows_loaded || transformedRows.length || 0;
  const rowsModified = summary?.rows_modified || 0;
  const rulesParsed = summary?.mapping_rules_parsed || 0;

  // Expand audit log entries across ALL target SAP tables containing each transformed field
  const expandedAuditLog: any[] = [];
  rawAuditLog.forEach((item: any) => {
    const fld = item.field || 'General';
    const targetTables = item.table_name
      ? [item.table_name]
      : resolveTargetTables(fld, extractedTables, targetObject);

    targetTables.forEach((tbl) => {
      expandedAuditLog.push({
        ...item,
        target_table: tbl,
      });
    });
  });

  const totalModifications = summary?.total_modifications || rawAuditLog.length || 0;

  // Group audit log by target table & field name
  const fieldGroups: Record<string, { tableName: string; field: string; items: any[] }> = {};
  expandedAuditLog.forEach((item) => {
    const tblName = item.target_table;
    const fld = item.field;
    const key = `${tblName}.${fld}`;
    if (!fieldGroups[key]) {
      fieldGroups[key] = { tableName: tblName, field: fld, items: [] };
    }
    fieldGroups[key].items.push(item);
  });

  const uniqueFieldsCount = Object.keys(fieldGroups).length;

  // Filtered audit log entries
  const filteredAuditLog = expandedAuditLog.filter((item: any) => {
    if (!auditSearch) return true;
    const s = auditSearch.toLowerCase();
    return (
      item.field?.toLowerCase().includes(s) ||
      item.target_table?.toLowerCase().includes(s) ||
      item.old_value?.toLowerCase().includes(s) ||
      item.new_value?.toLowerCase().includes(s) ||
      String(item.row).includes(s)
    );
  });

  const auditTotalPages = Math.max(1, Math.ceil(filteredAuditLog.length / AUDIT_PAGE_SIZE));

  return (
    <Card className="mb-6 border-violet-200 dark:border-violet-900/40 bg-gradient-to-br from-[var(--bg-primary)] via-[var(--bg-secondary)] to-violet-50/20 dark:to-violet-950/10 shadow-sm">
      <CardHeader
        title="Transformation Changes & Audit Report"
        subtitle="Executive summary of value replacements, target SF table mappings, and complete audit trail"
        icon={<FileText className="w-4 h-4 text-violet-600 dark:text-violet-400" />}
      >
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] text-[11px] font-bold text-[var(--text-secondary)] transition-colors cursor-pointer"
        >
          {isCollapsed ? (
            <>
              <ChevronDown className="w-3.5 h-3.5 text-violet-500" />
              <span>Expand Audit Report</span>
            </>
          ) : (
            <>
              <ChevronUp className="w-3.5 h-3.5 text-violet-500" />
              <span>Collapse Audit Report</span>
            </>
          )}
        </button>
      </CardHeader>
      {!isCollapsed && (
        <CardBody className="p-4 space-y-4">
          {/* Metric Cards Grid */}
          <div className="grid grid-cols-4 gap-3">
            <div className="p-3 rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)]/50">
              <div className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider">Rows Modified</div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-xl font-extrabold text-[var(--text-primary)]">{rowsModified}</span>
                <span className="text-[10px] text-[var(--text-tertiary)]">/ {rowsLoaded} total</span>
              </div>
              <div className="mt-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                {rowsModified > 0 ? `${((rowsModified / (rowsLoaded || 1)) * 100).toFixed(0)}% records transformed` : 'No records altered'}
              </div>
            </div>

            <div className="p-3 rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)]/50">
              <div className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider">Total Replacements</div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-xl font-extrabold text-violet-600 dark:text-violet-400">{totalModifications}</span>
                <span className="text-[10px] text-[var(--text-tertiary)]">cell edits</span>
              </div>
              <div className="mt-1 text-[10px] font-semibold text-violet-600/80 dark:text-violet-400/80">
                Across {uniqueFieldsCount} target fields
              </div>
            </div>

            <div className="p-3 rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)]/50">
              <div className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider">Rules Parsed</div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-xl font-extrabold text-[var(--text-primary)]">{rulesParsed}</span>
                <span className="text-[10px] text-[var(--text-tertiary)]">mapping rules</span>
              </div>
              <div className="mt-1 text-[10px] font-semibold text-cyan-600 dark:text-cyan-400">
                {summary?.ai_rules?.length ? 'AI natural language active' : 'File rules applied'}
              </div>
            </div>

            <div className="p-3 rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)]/50">
              <div className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider">Fields Transformed</div>
              <div className="mt-1.5 flex flex-wrap gap-1 max-h-[45px] overflow-y-auto scrollbar-thin">
                {Object.keys(fieldGroups).length > 0 ? (
                  Object.entries(fieldGroups).slice(0, 6).map(([key, grp]) => (
                    <span key={key} className="px-2 py-0.5 rounded-md bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 font-mono font-bold text-[10px]">
                      {grp.tableName}.{grp.field}: {grp.items.length}
                    </span>
                  ))
                ) : (
                  <span className="text-[10px] text-[var(--text-tertiary)] italic">No fields</span>
                )}
              </div>
            </div>
          </div>

          {/* Transformation Breakdown by Target Table & Field Grid */}
          {Object.keys(fieldGroups).length > 0 && (
            <div className="space-y-2">
              <div className="text-[11.5px] font-bold text-[var(--text-primary)]">
                Transformation Breakdown by Target Table & Field
              </div>
              <div className="grid grid-cols-2 gap-3">
                {Object.entries(fieldGroups).slice(0, 4).map(([key, grp], i) => (
                  <div key={i} className="p-3 rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)]/40 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-bold text-[var(--text-primary)]">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span>⚡</span>
                        <span className="font-mono text-purple-600 dark:text-purple-400 font-extrabold truncate">{grp.tableName}</span>
                        <span className="text-[var(--text-tertiary)]">.</span>
                        <span className="font-mono text-violet-600 dark:text-violet-400 truncate">{grp.field}</span>
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[9.5px] font-bold text-violet-600 dark:text-violet-400 border border-[var(--border)] shrink-0">
                        {grp.items.length} events
                      </span>
                    </div>
                    <div className="space-y-1 max-h-[100px] overflow-y-auto scrollbar-thin pr-1">
                      {grp.items.slice(0, 5).map((item, idx) => (
                        <div key={idx} className="text-[10px] text-[var(--text-secondary)] font-mono truncate bg-[var(--bg-primary)]/50 px-2 py-0.5 rounded flex items-center justify-between gap-1">
                          <span className="text-red-500 line-through truncate max-w-[120px]">{item.old_value || '(empty)'}</span>
                          <span className="text-[var(--text-tertiary)]">→</span>
                          <span className="text-emerald-500 font-bold truncate max-w-[120px]">{item.new_value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        {/* Expandable Complete Audit Trail */}
        <div className="pt-2 border-t border-[var(--border)] flex items-center justify-between">
          <button
            onClick={() => setShowLogDetails(!showLogDetails)}
            className="text-[11px] font-bold text-violet-600 dark:text-violet-400 hover:underline flex items-center gap-1 cursor-pointer"
          >
            {showLogDetails ? '▼ Hide Complete Audit Trail' : '▶ View Complete Audit Trail'} ({expandedAuditLog.length} logged replacements across target tables)
          </button>
        </div>

        {showLogDetails && (
          <div className="space-y-3 pt-2">
            <div className="flex items-center gap-2 p-2 rounded-xl bg-[var(--bg-tertiary)]/50 border border-[var(--border)]">
              <div className="relative w-full">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
                <input
                  type="text"
                  value={auditSearch}
                  onChange={(e) => { setAuditSearch(e.target.value); setAuditPage(1); }}
                  placeholder="Search audit log by target table, field, old value, or new value..."
                  className="w-full text-[11px] pl-8 pr-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-violet-500"
                />
              </div>
            </div>

            {filteredAuditLog.length === 0 ? (
              <div className="text-center py-6 text-[11px] text-[var(--text-tertiary)] font-mono">
                No audit log events match your search criteria.
              </div>
            ) : (
              <div className="rounded-xl border border-[var(--border)] overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-[var(--bg-tertiary)] text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider border-b border-[var(--border)]">
                    <tr>
                      <th className="py-2.5 px-3">Row #</th>
                      <th className="py-2.5 px-3">Phase</th>
                      <th className="py-2.5 px-3">Target SAP Table</th>
                      <th className="py-2.5 px-3">Field Name</th>
                      <th className="py-2.5 px-3">Transformation (Before → After)</th>
                      <th className="py-2.5 px-3 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)] text-[10.5px] font-mono">
                    {filteredAuditLog.slice((auditPage - 1) * AUDIT_PAGE_SIZE, auditPage * AUDIT_PAGE_SIZE).map((item: any, idx: number) => {
                      return (
                        <tr key={item.id ? `${item.id}_${item.target_table}_${idx}` : idx} className="hover:bg-[var(--bg-tertiary)]/40 transition-colors">
                          <td className="py-2 px-3 font-bold text-[var(--text-secondary)]">#{item.row}</td>
                          <td className="py-2 px-3">
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300">
                              {item.phase || 'Transform'}
                            </span>
                          </td>
                          <td className="py-2 px-3">
                            <span className="px-2 py-0.5 rounded text-[9.5px] font-bold font-mono bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-800">
                              {item.target_table}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-violet-600 dark:text-violet-400 font-bold">
                            <div className="inline-flex items-center gap-1">
                               {isPrimaryKeyField(item.field) && (
                                 <span title="Primary Key Field" className="inline-flex items-center">
                                   <Key className="w-3 h-3 text-amber-500 shrink-0" />
                                 </span>
                               )}
                              <span>{item.field}</span>
                            </div>
                          </td>
                          <td className="py-2 px-3">
                            <div className="flex items-center gap-1">
                              <span className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-600 dark:text-red-400 line-through text-[10px]">
                                {item.old_value || '(empty)'}
                              </span>
                              <span className="text-[var(--text-tertiary)]">→</span>
                              <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold text-[10px]">
                                {item.new_value}
                              </span>
                            </div>
                          </td>
                          <td className="py-2 px-3 text-right">
                            <span className="px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 text-[9px] font-bold">
                              APPLIED
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {/* Audit Log Pagination Footer */}
                <TablePaginationFooter
                  currentPage={auditPage}
                  totalRows={filteredAuditLog.length}
                  pageSize={AUDIT_PAGE_SIZE}
                  onPageChange={setAuditPage}
                  isFiltered={!!auditSearch}
                  accentColor="violet"
                />
              </div>
            )}
          </div>
        )}
      </CardBody>
      )}
    </Card>
  );
}

export interface TransformRuleItem {
  id: string;
  source: 'file' | 'nlp' | 'dynamic' | string;
  field: string;
  oldValue?: string;
  newValue?: string;
  pythonCode?: string;
  description: string;
  enabled: boolean;
  scope?: 'value' | 'row' | 'column';
  rowIndex?: number;
  rowNumber?: number;
  operation?: string;
  prefix?: string;
  suffix?: string;
}

export function Step7Transform() {
  const { state, dispatch } = useMigration();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { showLoad, hideLoad } = useLoading();
  
  const [mappingFile, setMappingFile] = useState<File | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [rules, setRules] = useState<TransformRuleItem[]>([]);
  const [isParsingFile, setIsParsingFile] = useState(false);
  const [isGeneratingAIRule, setIsGeneratingAIRule] = useState(false);

  // Dynamic Rule Spot Modal State
  const [dynamicModalState, setDynamicModalState] = useState<{
    isOpen: boolean;
    tableName: string;
    allFields: string[];
    initialField?: string;
    initialValue?: string;
    rowNumber?: number;
    rowIndex?: number;
  }>({
    isOpen: false,
    tableName: '',
    allFields: [],
  });
  
  const summary = state.transformSummary;
  
  // Audit log state
  const [openAuditAccordion, setOpenAuditAccordion] = useState(true);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditPage, setAuditPage] = useState(1);
  const [openPreviewAccordion, setOpenPreviewAccordion] = useState(true);

  const transformedRows = state.transformed || [];
  const has = transformedRows.length > 0;
  
  // Table filter state for output display
  const [selectedOutputTables, setSelectedOutputTables] = useState<Set<string>>(new Set());
  const [outputKeyFilter, setOutputKeyFilter] = useState('');
  const [tablePages, setTablePages] = useState<Record<string, number>>({});
  const extractedTables = state.extractedTables || [];

  const handleApplyDynamicRule = (newRule: TransformRuleItem) => {
    const updatedRules = [...rules, newRule];
    setRules(updatedRules);
    applyRulesBatch(updatedRules);
    toast(`Dynamic rule applied to ${newRule.field}! Added to Active Rules.`, 'ok');
  };

  // Computed all available display fields across extracted tables or dataset
  const allAvailableFields = useMemo(() => {
    const fieldSet = new Set<string>();
    const rows = transformedRows.length > 0 ? transformedRows : (state.cleaned || []);
    if (extractedTables && extractedTables.length > 0) {
      extractedTables.forEach((t: any) => {
        if (Array.isArray(t.columns)) {
          const { columns: tableCols } = getTableDisplayData(t, rows, state.mapping);
          tableCols.forEach((col: string) => fieldSet.add(col));
        }
      });
    }
    if (fieldSet.size === 0 && rows.length > 0) {
      Object.keys(rows[0] || {}).forEach((col) => fieldSet.add(col));
    }
    return Array.from(fieldSet);
  }, [extractedTables, transformedRows, state.cleaned, state.mapping]);

  const openCommonDynamicModal = () => {
    const rows = transformedRows.length > 0 ? transformedRows : (state.cleaned || []);
    const fields = allAvailableFields.length > 0
      ? allAvailableFields
      : (rows[0] ? Object.keys(rows[0]) : []);
    const defaultTable = extractedTables[0]?.table_name || 'Transformed Output';
    setDynamicModalState({
      isOpen: true,
      tableName: defaultTable,
      allFields: fields,
      initialField: fields[0] || '',
      initialValue: '',
    });
  };


  const cleanRule = (r: TransformRuleItem): TransformRuleItem => {
    if (r.source === 'dynamic' && (r.oldValue !== undefined || r.operation || r.scope)) {
      const { pythonCode, ...rest } = r;
      return rest as TransformRuleItem;
    }
    return r;
  };

  // Load saved transform rules for current project and target object on mount
  useEffect(() => {
    if (!state.projectId) return;

    const loadSavedTransformRules = async () => {
      try {
        const objName = state.obj || 'Biographical Info';
        const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/transform/load/${state.projectId}?target_object=${encodeURIComponent(objName)}`);
        if (res.ok) {
          const json = await res.json();
          const loadedRules = (Array.isArray(json.dynamic_rules) ? json.dynamic_rules : []).map(cleanRule);
          setRules(loadedRules);
          dispatch({ type: 'SET_FIELD', field: 'transformDynamicRules', value: loadedRules });
        }
      } catch (err) {
        console.error('Failed to load saved transform dynamic rules:', err);
      }
    };

    loadSavedTransformRules();
  }, [state.projectId, state.obj, dispatch]);

  async function saveTransformRulesToDB(rulesToSave?: TransformRuleItem[]) {
    if (!state.projectId) {
      toast('No project selected to save rules', 'err');
      return;
    }
    const targetRules = (Array.isArray(rulesToSave) ? rulesToSave : rules).map(cleanRule);
    showLoad('Saving rules...', 'Persisting transform rules to database');
    try {
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/transform/rules/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: state.projectId,
          target_object: state.obj,
          rules: targetRules
        })
      });

      if (!res.ok) throw new Error('Failed to save transform rules');

      dispatch({ type: 'SET_FIELD', field: 'transformDynamicRules', value: targetRules });
      hideLoad();
      toast(`Saved ${targetRules.length} transform rule(s) to database successfully!`, 'ok');
    } catch (err: any) {
      hideLoad();
      toast(err.message || 'Failed to save transform rules', 'err');
    }
  }

  // File upload handler
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {

    if (e.target.files && e.target.files.length > 0) {
      setMappingFile(e.target.files[0]);
    }
  };



  // 1. Reactive Batch Application Helper
  async function applyRulesBatch(targetRules: TransformRuleItem[]) {
    if (!state.projectId) return;

    const activeRules = targetRules.filter(r => r.enabled).map(cleanRule);
    showLoad('Updating Transformation...', `Applying ${activeRules.length} active rule(s)...`);

    const baseData = (state.cleaned && state.cleaned.length > 0)
      ? state.cleaned
      : (state.harmonized && state.harmonized.length > 0)
        ? state.harmonized
        : transformedRows;

    try {
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/transform/apply-batch-rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: state.projectId,
          target_object: state.obj,
          rules: activeRules,
          fallback_data: baseData && baseData.length > 0 ? baseData : undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Transform re-evaluation failed');
      }

      const data = await res.json();
      
      const cleanAiRules = (data.summary?.ai_rules || []).filter((r: any) => r.Source_Field !== "Python Script");
      const updatedSummary = {
        ...data.summary,
        ai_rules: cleanAiRules
      };

      dispatch({ type: 'SET_FIELD', field: 'transformed', value: data.data });
      dispatch({ type: 'SET_FIELD', field: 'transformSummary', value: updatedSummary });
      dispatch({ type: 'SET_FIELD', field: 'isTransformedSaved', value: false });
    } catch (err: any) {
      toast(err.message, 'err');
    } finally {
      hideLoad();
    }
  }

  // 2. Run File Mapping Transformation & Extract Rules to Panel
  async function handleFileTransform() {
    if (!mappingFile) {
      toast('Please upload a mapping file (CSV/Excel) first.', 'err');
      return;
    }
    if (!state.projectId) {
      toast('Project ID not found. Please extract data first.', 'err');
      return;
    }

    setIsParsingFile(true);
    showLoad('Applying Mappings...', 'Finding and replacing data based on your file...');

    const formData = new FormData();
    formData.append('project_id', state.projectId);
    formData.append('target_object', state.obj);
    formData.append('file', mappingFile);

    try {
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/transform/apply-mappings`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to apply mapping file');
      }

      const data = await res.json();
      const auditLog: any[] = data.summary?.audit_log || [];
      const newRules: TransformRuleItem[] = [];

      // Extract unique field replacement rules from audit log / summary
      const uniqueRuleMap = new Map<string, TransformRuleItem>();
      auditLog.forEach((item: any) => {
        const key = `${item.field}_${item.old_value}_${item.new_value}`;
        if (!uniqueRuleMap.has(key)) {
          uniqueRuleMap.set(key, {
            id: `rule_file_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            source: 'file',
            field: item.field || 'General',
            oldValue: item.old_value,
            newValue: item.new_value,
            description: `Replace '${item.old_value || '(empty)'}' → '${item.new_value}' in ${item.field}`,
            enabled: true,
          });
        }
      });

      if (uniqueRuleMap.size === 0) {
        newRules.push({
          id: `rule_file_${Date.now()}`,
          source: 'file',
          field: 'Mapping File',
          description: `Apply rules from ${mappingFile.name}`,
          enabled: true,
        });
      } else {
        newRules.push(...Array.from(uniqueRuleMap.values()));
      }

      const updatedRules = [...rules, ...newRules];
      setRules(updatedRules);
      
      // Execute combined active batch
      applyRulesBatch(updatedRules);

      toast(`Transformed data successfully! Parsed ${newRules.length} rule(s).`, 'ok');
    } catch (err: any) {
      toast(err.message, 'err');
    } finally {
      setIsParsingFile(false);
      hideLoad();
    }
  }

  // 3. Run AI Transformation & Extract Rule to Panel
  async function handleAITransform() {
    if (!aiPrompt.trim()) {
      toast('Please enter natural language instructions.', 'err');
      return;
    }
    if (!state.projectId) {
      toast('Project ID not found. Please extract data first.', 'err');
      return;
    }

    setIsGeneratingAIRule(true);
    showLoad('AI is Analyzing Instructions...', 'Applying AI transformation rules...');

    try {
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/transform/ai-apply-mappings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: state.projectId,
          target_object: state.obj,
          prompt: aiPrompt,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to apply AI transformation');
      }

      const data = await res.json();
      const pythonScript = data.ai_rules?.[0]?.Target_Data || data.summary?.ai_rules?.[0]?.Target_Data || '';

      const newAIRule: TransformRuleItem = {
        id: `rule_nlp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        source: 'nlp',
        field: 'AI Script',
        pythonCode: pythonScript,
        description: aiPrompt.trim(),
        enabled: true,
      };

      const updatedRules = [...rules, newAIRule];
      setRules(updatedRules);

      // Execute combined active batch
      applyRulesBatch(updatedRules);

      setAiPrompt('');
      toast(`AI Transformation successful! Added rule to active panel.`, 'ok');
    } catch (err: any) {
      toast(err.message, 'err');
    } finally {
      setIsGeneratingAIRule(false);
      hideLoad();
    }
  }

  // Rule Reactive Controls (Instantly update dataset on toggle/delete)
  const toggleRule = (id: string) => {
    const updated = rules.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r);
    setRules(updated);
    applyRulesBatch(updated);
  };

  const deleteRule = async (id: string) => {
    const updated = rules.filter(r => r.id !== id);
    setRules(updated);
    applyRulesBatch(updated);
    if (state.projectId) {
      try {
        await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/transform/rules/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project_id: state.projectId,
            target_object: state.obj,
            rules: updated
          })
        });
        dispatch({ type: 'SET_FIELD', field: 'transformDynamicRules', value: updated });
      } catch (err) {
        console.error('Failed to sync deleted rule to database:', err);
      }
    }
    toast('Rule removed and updated in database', 'info');
  };

  const toggleAllRules = (enabled: boolean) => {
    const updated = rules.map(r => ({ ...r, enabled }));
    setRules(updated);
    applyRulesBatch(updated);
  };

  const clearAllRules = async () => {
    setRules([]);
    applyRulesBatch([]);
    if (state.projectId) {
      try {
        await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/transform/rules/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project_id: state.projectId,
            target_object: state.obj,
            rules: []
          })
        });
        dispatch({ type: 'SET_FIELD', field: 'transformDynamicRules', value: [] });
      } catch (err) {
        console.error('Failed to clear rules in database:', err);
      }
    }
    toast('All rules cleared from database', 'info');
  };

  async function saveToDatabase() {
    if (!state.projectId) return;
    showLoad('Saving data...', 'Persisting transformed records to database');
    try {
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/transform/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: state.projectId,
          target_object: state.obj,
          payload: state.transformed
        })
      });

      if (!res.ok) throw new Error('Failed to save data');

      dispatch({ type: 'SET_FIELD', field: 'isTransformedSaved', value: true });
      toast('Transformed data saved to database successfully!', 'ok');
    } catch (err: any) {
      toast(err.message, 'err');
    } finally {
      hideLoad();
    }
  }

  // Audit Log Filtering & Pagination
  const allAuditItems = summary?.audit_log || [];
  const filteredAuditItems = allAuditItems.filter((item: any) => {
    if (!auditSearch) return true;
    const s = auditSearch.toLowerCase();
    return (
      item.field?.toLowerCase().includes(s) ||
      item.old_value?.toLowerCase().includes(s) ||
      item.new_value?.toLowerCase().includes(s) ||
      String(item.row).includes(s)
    );
  });

  const activeRulesCount = rules.filter(r => r.enabled).length;

  return (
    <PageLayout>
      <PageGrid>
        <GridCol span={12}>
          <PageHeader title="Step 7 — Data Transformation" subtitle="Upload a mapping file or enter AI instructions to run transformations and manage active rules">
            <Button variant="secondary" icon={<ArrowLeft className="w-3.5 h-3.5" />} onClick={() => navigate('/cleanse')}>Back</Button>
            {has && (
              <Button 
                variant={state.isTransformedSaved ? "secondary" : "cyan"} 
                icon={state.isTransformedSaved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />} 
                onClick={saveToDatabase}
                disabled={state.isTransformedSaved}
              >
                {state.isTransformedSaved ? "Saved" : "Save Data"}
              </Button>
            )}
            <Button variant="primary" icon={<ArrowRight className="w-3.5 h-3.5" />} onClick={() => navigate('/export')} disabled={!state.isTransformedSaved}>Next: DMC Export</Button>
          </PageHeader>

          {/* 3-Column Transformation Control Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 mb-6">
            
            {/* 1. File Upload Card (Left, 3.5 cols) */}
            <div className="lg:col-span-3 flex">
              <Card className="w-full flex flex-col justify-between">
                <CardHeader title="1. Upload Mapping File" subtitle="CSV / Excel file with mapping rules" />
                <CardBody className="p-4 flex-1 flex flex-col justify-between space-y-3">
                  <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-[var(--border)] border-dashed rounded-xl cursor-pointer bg-[var(--bg-tertiary)]/30 hover:bg-[var(--bg-tertiary)] hover:border-violet-400 transition-all">
                    <div className="flex flex-col items-center justify-center p-4 text-center">
                      <Upload className="w-7 h-7 text-[var(--text-tertiary)] mb-1.5" />
                      <p className="text-[12px] font-semibold text-[var(--text-secondary)]">Click to upload or drag & drop</p>
                      <p className="text-[10px] text-[var(--text-tertiary)]">.csv, .xlsx, .xls</p>
                    </div>
                    <input type="file" className="hidden" accept=".csv,.xlsx,.xls" onChange={handleFileChange} />
                  </label>
                  
                  <div className="space-y-2">
                    {mappingFile ? (
                      <div className="p-2.5 border border-violet-200 dark:border-violet-900 bg-violet-50 dark:bg-violet-950/40 rounded-lg flex items-center justify-between">
                        <div className="flex items-center gap-2 overflow-hidden">
                          <FileSpreadsheet className="w-4 h-4 text-violet-500 shrink-0" />
                          <span className="text-[11.5px] font-bold text-violet-700 dark:text-violet-300 truncate">{mappingFile.name}</span>
                        </div>
                        <button 
                          className="p-1 rounded text-violet-400 hover:text-violet-700 dark:hover:text-violet-200 transition-colors cursor-pointer shrink-0"
                          onClick={() => setMappingFile(null)}
                          title="Remove file"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="p-2 border border-[var(--border)] bg-[var(--bg-tertiary)]/50 rounded-lg text-center text-[11px] text-[var(--text-tertiary)]">
                        No file chosen
                      </div>
                    )}

                    <Button 
                      variant="cyan" 
                      icon={<Cog className="w-3.5 h-3.5" />} 
                      className="w-full justify-center text-[12px] py-2 font-bold" 
                      disabled={!mappingFile || isParsingFile}
                      onClick={handleFileTransform}
                    >
                      {isParsingFile ? 'Transforming...' : 'Run Transform'}
                    </Button>
                  </div>
                </CardBody>
              </Card>
            </div>

            {/* 2. AI Prompt Card (Middle, 4.5 cols) */}
            <div className="lg:col-span-4 flex">
              <Card className="w-full flex flex-col justify-between">
                <CardHeader 
                  title="2. AI Natural Language Transform" 
                  subtitle="Describe instructions (e.g. 'Change PLANT 1000 to 2000')" 
                  icon={<Bot className="w-4 h-4 text-cyan-500" />}
                />
                <CardBody className="p-4 flex-1 flex flex-col justify-between space-y-3">
                  <div className="relative flex-1">
                    <textarea
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      placeholder="Enter natural language instructions...&#10;&#10;Examples:&#10;• Change all PLANT values of '1000' to '2000'&#10;• Convert FIRST_NAME to lower case"
                      className="w-full h-28 p-3 rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)]/50 text-[var(--text-primary)] text-[12px] resize-none focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all placeholder:text-[var(--text-tertiary)]"
                    />
                    <Sparkles className="w-4 h-4 absolute top-2.5 right-2.5 text-cyan-500/40 pointer-events-none" />
                  </div>

                  {/* Quick prompt chips */}
                  <div className="flex flex-wrap gap-1">
                    {[
                      "Change '1000' to '2000'",
                      "Lower case FIRST_NAME",
                      "Trim spaces in USER_ID"
                    ].map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => setAiPrompt(chip)}
                        className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-cyan-50 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-800/60 hover:bg-cyan-100 transition-colors cursor-pointer"
                      >
                        + {chip}
                      </button>
                    ))}
                  </div>

                  <Button 
                    variant="cyan" 
                    icon={<Cog className="w-3.5 h-3.5" />} 
                    className="w-full justify-center text-[12px] py-2 font-bold"
                    disabled={!aiPrompt.trim() || isGeneratingAIRule}
                    onClick={handleAITransform}
                  >
                    {isGeneratingAIRule ? 'Transforming...' : 'Run Transform'}
                  </Button>
                </CardBody>
              </Card>
            </div>

            {/* 3. Active Transformation Rules Manager Panel (Right, 5 cols) */}
            <div className="lg:col-span-5 flex">
              <Card className="w-full flex flex-col justify-between border-violet-300 dark:border-violet-900/60 shadow-sm bg-gradient-to-b from-[var(--bg-primary)] to-violet-50/20 dark:to-violet-950/10">
                <CardHeader 
                  title="3. Active Transformation Rules" 
                  subtitle="Tick/untick rules to enable or delete unwanted rules" 
                  icon={<Layers className="w-4 h-4 text-violet-500" />}
                >
                  <div className="ml-auto flex items-center gap-2">
                    <Button
                      variant="cyan"
                      size="sm"
                      icon={<RotateCcw className="w-3.5 h-3.5" />}
                      onClick={() => applyRulesBatch(rules)}
                      disabled={rules.length === 0}
                      title="Re-run all active transformation rules on dataset"
                    >
                      Apply Rules
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Save className="w-3.5 h-3.5 text-violet-500" />}
                      onClick={() => saveTransformRulesToDB()}
                      disabled={rules.length === 0}
                    >
                      Save Rules
                    </Button>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-extrabold bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800">
                      {activeRulesCount} Active / {rules.length} Total
                    </span>
                  </div>
                </CardHeader>
                <CardBody className="p-3 flex-1 flex flex-col justify-between space-y-3">

                  
                  {/* Controls Header */}
                  {rules.length > 0 && (
                    <div className="flex items-center justify-between pb-1 border-b border-[var(--border)]">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggleAllRules(true)}
                          className="text-[10px] font-bold text-violet-600 dark:text-violet-400 hover:underline cursor-pointer"
                        >
                          Select All
                        </button>
                        <span className="text-[10px] text-[var(--text-tertiary)]">•</span>
                        <button
                          type="button"
                          onClick={() => toggleAllRules(false)}
                          className="text-[10px] font-bold text-[var(--text-tertiary)] hover:underline cursor-pointer"
                        >
                          Deselect All
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={clearAllRules}
                        className="text-[10px] font-bold text-red-500 hover:underline cursor-pointer flex items-center gap-1"
                      >
                        <RotateCcw className="w-3 h-3" /> Clear All
                      </button>
                    </div>
                  )}

                  {/* Scrollable Rules List */}
                  <div className="flex-1 max-h-[260px] overflow-y-auto space-y-2 pr-1 scrollbar-thin">
                    {rules.length === 0 ? (
                      <div className="h-[210px] flex flex-col items-center justify-center text-center p-4 rounded-xl border border-dashed border-[var(--border)] bg-[var(--bg-tertiary)]/30 text-[11px] text-[var(--text-tertiary)]">
                        <ListFilter className="w-8 h-8 text-[var(--text-tertiary)] mb-2 opacity-50" />
                        <p className="font-semibold text-[var(--text-secondary)] mb-1">No rules added yet</p>
                        <p className="text-[10px]">Upload a mapping file or enter an AI prompt and click Run Transform.</p>
                      </div>
                    ) : (
                      rules.map((rule) => (
                        <div
                          key={rule.id}
                          className={`p-2.5 rounded-xl border transition-all flex items-start gap-2.5 ${
                            rule.enabled
                              ? 'bg-white dark:bg-gray-900/80 border-violet-300 dark:border-violet-800 shadow-xs'
                              : 'bg-[var(--bg-tertiary)]/40 border-[var(--border)] opacity-60'
                          }`}
                        >
                          {/* Checkbox Tick/Untick */}
                          <button
                            type="button"
                            onClick={() => toggleRule(rule.id)}
                            className="mt-0.5 cursor-pointer text-violet-600 dark:text-violet-400 hover:opacity-80 transition-opacity shrink-0"
                            title={rule.enabled ? "Untick to disable rule" : "Tick to enable rule"}
                          >
                            {rule.enabled ? (
                              <CheckSquare className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                            ) : (
                              <Square className="w-4 h-4 text-[var(--text-tertiary)]" />
                            )}
                          </button>

                          {/* Rule Details */}
                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`px-1.5 py-0.2 rounded text-[9px] font-mono font-extrabold uppercase tracking-wider ${
                                rule.source === 'nlp'
                                  ? 'bg-cyan-100 dark:bg-cyan-950/60 text-cyan-700 dark:text-cyan-300 border border-cyan-300 dark:border-cyan-800'
                                  : (rule.source === 'dynamic' || rule.source === 'transform_dynamic_rule')
                                  ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                                  : 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                              }`}>
                                {rule.source === 'nlp' ? 'AI NLP' : (rule.source === 'dynamic' || rule.source === 'transform_dynamic_rule') ? 'DYNAMIC' : 'FILE'}
                              </span>
                              {rule.rowNumber !== undefined && (
                                <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800">
                                  Row #{rule.rowNumber}
                                </span>
                              )}
                              {rule.scope === 'column' && (
                                <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                                  Entire Column
                                </span>
                              )}
                              {rule.operation && (
                                <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-800 uppercase">
                                  {rule.operation}
                                </span>
                              )}
                              <span className="text-[11.5px] font-bold text-[var(--text-primary)] font-mono truncate">
                                {rule.field}
                              </span>
                            </div>


                            <div className="text-[11px] text-[var(--text-secondary)] leading-snug font-mono">
                              {rule.oldValue !== undefined || rule.newValue !== undefined ? (
                                <div className="flex items-center gap-1 flex-wrap text-[10px]">
                                  <span className="px-1 py-0.2 rounded bg-red-500/10 text-red-600 dark:text-red-400 line-through">
                                    {rule.oldValue || '(empty)'}
                                  </span>
                                  <span className="text-[var(--text-tertiary)]">→</span>
                                  <span className="px-1 py-0.2 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold">
                                    {rule.newValue}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-[10.5px] font-sans text-[var(--text-secondary)] line-clamp-2">
                                  {rule.description}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Delete Button */}
                          <button
                            type="button"
                            onClick={() => deleteRule(rule.id)}
                            className="p-1 rounded text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors cursor-pointer shrink-0"
                            title="Delete rule"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </CardBody>
              </Card>
            </div>

          </div>

          {/* Executive Summary */}
          {summary && (
            <div className="mb-6 space-y-6">
              <div>
                <h3 className="text-sm font-bold text-[var(--text-secondary)] mb-3">Executive Transformation Summary Report</h3>
                <StatsGrid>
                  <StatBox value={summary.rows_loaded} label="Rows Loaded" color="var(--color-primary-500)" />
                  <StatBox value={summary.rows_modified} label="Rows Modified" color="var(--color-warning)" />
                  <StatBox value={summary.total_modifications} label="Total Replacements" color="var(--color-success)" />
                  <StatBox value={summary.mapping_rules_parsed} label="Rules Parsed" color="var(--color-teal)" />
                </StatsGrid>
              </div>

              {summary.ai_rules && summary.ai_rules.filter((r: any) => r.Source_Field !== "Python Script").length > 0 && (
                <Card>
                  <CardHeader 
                    title="Interpreted AI Rules" 
                    subtitle="Here is how the AI interpreted your instructions" 
                    icon={<Bot className="w-4 h-4 text-cyan-500" />}
                  />
                  <CardBody>
                    <div className="flex flex-col gap-3">
                      {summary.ai_rules.filter((r: any) => r.Source_Field !== "Python Script").map((rule: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 p-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)]/50 text-[11px] font-mono w-fit">
                          <span className="text-violet-500 font-bold">{rule.Source_Field}</span>
                          <span className="text-[var(--text-tertiary)]">:</span>
                          <span className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-600 dark:text-red-400 line-through">
                            {rule.Source_Data || '(empty)'}
                          </span>
                          <span className="text-[var(--text-tertiary)]">→</span>
                          <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold">
                            {rule.Target_Data}
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardBody>
                </Card>
              )}
            </div>
          )}


          {/* Executive Transformation Summary Audit Report Card (Positioned ABOVE Data Preview) */}
          {summary && (
            <TransformationReportCard
              summary={summary}
              transformedRows={transformedRows}
              extractedTables={extractedTables}
              targetObject={state.obj}
            />
          )}

          {/* Transformed Data Preview — Multi-Table Display */}
          {has ? (() => {
            const allTables: TableInfo[] = extractedTables.length > 0
              ? extractedTables
              : [{ table_name: 'Transformed Output', columns: Object.keys(transformedRows[0] || {}) }];
            const visibleTables = allTables.filter((t: any) => selectedOutputTables.has(t.table_name));
            const allKeyColumns = detectKeyColumns(allTables.flatMap((t: any) => t.columns));
            const filteredRows = filterRowsByKey(transformedRows, outputKeyFilter, allKeyColumns);

            return (
              <div className="space-y-4">
                {/* Data Preview Header & Collapse Toggle */}
                <div className="flex items-center justify-between p-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] shadow-sm">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-xl bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400">
                      <FileSpreadsheet className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-xs font-extrabold text-[var(--text-primary)] uppercase tracking-wider">
                        Transformed Data Preview
                      </h3>
                      <p className="text-[10px] text-[var(--text-tertiary)]">
                        {visibleTables.length} of {allTables.length} target SAP tables displayed ({filteredRows.length} rows)
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => setOpenPreviewAccordion(!openPreviewAccordion)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] hover:bg-[var(--bg-primary)] text-[11px] font-bold text-[var(--text-secondary)] transition-colors cursor-pointer ml-auto"
                  >
                    {openPreviewAccordion ? (
                      <>
                        <ChevronUp className="w-3.5 h-3.5 text-violet-500" />
                        <span>Collapse Data Preview</span>
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-3.5 h-3.5 text-violet-500" />
                        <span>Expand Data Preview ({visibleTables.length} tables)</span>
                      </>
                    )}
                  </button>
                </div>

                {openPreviewAccordion && (
                  <>
                    <TableFilterToolbar
                      tables={allTables}
                      selectedTables={selectedOutputTables}
                      onSelectedTablesChange={setSelectedOutputTables}
                      keyFilterValue={outputKeyFilter}
                      onKeyFilterChange={setOutputKeyFilter}
                      keyColumns={allKeyColumns}
                      accentColor="violet"
                    />
                    {visibleTables.length === 0 ? (
                      <div className="p-8 text-center rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/30 text-gray-500 dark:text-gray-400 text-xs font-medium">
                        No tables selected. Click <strong>Tables Selected</strong> above to choose tables to view.
                      </div>
                    ) : (
                      visibleTables.map((t: any) => {
                        const { columns: tableCols, rows: tableRows } = getTableDisplayData(t, filteredRows, state.mapping, true);
                        const currentPage = tablePages[t.table_name] || 1;
                        const paginatedRows = tableRows.slice((currentPage - 1) * 15, currentPage * 15);

                        return (
                          <Card key={t.table_name}>
                            <CardHeader
                              title={`Transformed: ${t.table_name}`}
                              subtitle={`${tableRows.length} rows × ${tableCols.length} columns${outputKeyFilter ? ' (filtered)' : ''}`}
                            >
                              <div className="ml-auto flex items-center gap-2">
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  icon={<Download className="w-3 h-3" />}
                                  onClick={() => dl(expCSV(tableRows), `${t.table_name.replace(/[\s/]+/g, '_').toLowerCase()}_transformed.csv`, 'text/csv')}
                                >
                                  Export {t.table_name}
                                </Button>
                              </div>
                            </CardHeader>
                            <CardBody className="p-0 overflow-hidden">
                              <DataTable
                                rows={paginatedRows}
                                cols={tableCols}
                                editable={true}
                                onColumnEdit={(col) => {
                                  setDynamicModalState({
                                    isOpen: true,
                                    tableName: t.table_name,
                                    allFields: tableCols,
                                    initialField: col,
                                    initialValue: '',
                                  });
                                }}
                              />
                              <TablePaginationFooter
                                currentPage={currentPage}
                                totalRows={tableRows.length}
                                pageSize={15}
                                onPageChange={(newPage) => setTablePages(prev => ({ ...prev, [t.table_name]: newPage }))}
                                isFiltered={!!outputKeyFilter}
                                accentColor="violet"
                              />
                            </CardBody>
                          </Card>
                        );
                      })
                    )}
                  </>
                )}
              </div>
            );
          })() : (
            <Card>
              <CardBody>
                <EmptyState icon={<Cog className="w-10 h-10 text-violet-500" />} message="Upload mapping file or enter AI instructions to run transformation" />
              </CardBody>
            </Card>
          )}
        </GridCol>
      </PageGrid>

      {/* Dynamic Rule Spot Modal */}
      <DynamicTransformModal
        isOpen={dynamicModalState.isOpen}
        onClose={() => setDynamicModalState((prev) => ({ ...prev, isOpen: false }))}
        tableName={dynamicModalState.tableName}
        allFields={dynamicModalState.allFields}
        initialField={dynamicModalState.initialField}
        initialValue={dynamicModalState.initialValue}
        rowNumber={dynamicModalState.rowNumber}
        rowIndex={dynamicModalState.rowIndex}
        projectId={state.projectId}
        targetObject={state.obj}
        currentRows={transformedRows.length > 0 ? transformedRows : (state.cleaned || [])}
        onRunTransform={handleApplyDynamicRule}
      />

      {/* Floating Bottom-Right Add Dynamic Rule Button */}
      {(has || (state.cleaned && state.cleaned.length > 0)) && (
        <button
          type="button"
          onClick={openCommonDynamicModal}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-2.5 rounded-full bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white text-xs font-extrabold shadow-lg shadow-violet-500/30 hover:shadow-xl hover:shadow-violet-500/40 hover:-translate-y-0.5 active:translate-y-0 transition-all cursor-pointer border border-violet-400/30 backdrop-blur-xs"
          title="Add a dynamic transformation rule across any field"
        >
          <div className="p-1 rounded-full bg-white/20">
            <Plus className="w-3.5 h-3.5 text-white" strokeWidth={3} />
          </div>
          <span>Add Dynamic Rule</span>
          <Sparkles className="w-3.5 h-3.5 text-violet-200 animate-pulse" />
        </button>
      )}
    </PageLayout>
  );
}
