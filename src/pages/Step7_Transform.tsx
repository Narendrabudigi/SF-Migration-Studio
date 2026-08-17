import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMigration } from '@/store/migration-store';
import { useToast } from '@/components/ui/toast';
import { useLoading } from '@/components/ui/loading-overlay';
import { dl, expCSV } from '@/lib/utils';
import { PageLayout, PageGrid, GridCol, Card, CardHeader, CardBody, Button, StatBox, StatsGrid, DataTable, PageHeader, EmptyState } from '@/components/shared';
import { ArrowLeft, ArrowRight, Cog, Download, Upload, FileText, Search, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, FileSpreadsheet, Save, Check, Bot, Sparkles, X } from 'lucide-react';
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
                          <td className="py-2 px-3 text-violet-600 dark:text-violet-400 font-bold">{item.field}</td>
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

export function Step7Transform() {
  const { state, dispatch } = useMigration();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { showLoad, hideLoad } = useLoading();
  
  const [mappingFile, setMappingFile] = useState<File | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  
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

  // Initialize selectedOutputTables when extractedTables are available
  useEffect(() => {
    if (extractedTables.length > 0) {
      setSelectedOutputTables(new Set(extractedTables.map((t: any) => t.table_name)));
    }
  }, [extractedTables.length]);
  
  // File upload handler
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setMappingFile(e.target.files[0]);
    }
  };

  async function doTransform() {
    if (!mappingFile) {
      toast('Please upload a mapping file (CSV/Excel) first.', 'err');
      return;
    }
    
    if (!state.projectId) {
      toast('Project ID not found. Please extract data first.', 'err');
      return;
    }

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
        throw new Error(err.detail || 'Failed to apply mappings');
      }

      const data = await res.json();
      
      dispatch({ type: 'SET_FIELD', field: 'transformed', value: data.data });
      dispatch({ type: 'SET_FIELD', field: 'transformSummary', value: data.summary });
      dispatch({ type: 'SET_FIELD', field: 'isTransformedSaved', value: false });
      
      toast(`Transformed data successfully. ${data.summary.total_modifications} replacements made.`, 'ok');
    } catch (err: any) {
      toast(err.message, 'err');
    } finally {
      hideLoad();
    }
  }

  async function doAITransform() {
    if (!aiPrompt.trim()) {
      toast('Please enter instructions for the AI.', 'err');
      return;
    }
    
    if (!state.projectId) {
      toast('Project ID not found. Please extract data first.', 'err');
      return;
    }

    showLoad('AI is analyzing...', 'Extracting mapping rules from your instructions...');
    
    try {
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/transform/ai-apply-mappings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: state.projectId,
          target_object: state.obj,
          prompt: aiPrompt
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to apply AI mappings');
      }

      const data = await res.json();
      
      const updatedSummary = { ...data.summary, ai_rules: data.ai_rules };
      
      dispatch({ type: 'SET_FIELD', field: 'transformed', value: data.data });
      dispatch({ type: 'SET_FIELD', field: 'transformSummary', value: updatedSummary });
      dispatch({ type: 'SET_FIELD', field: 'isTransformedSaved', value: false });
      
      toast(`AI Transformation successful! Parsed ${data.ai_rules.length} rules.`, 'ok');
    } catch (err: any) {
      toast(err.message, 'err');
    } finally {
      hideLoad();
    }
  }

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

  const auditTotalPages = Math.ceil(filteredAuditItems.length / AUDIT_PAGE_SIZE);
  const paginatedAuditItems = filteredAuditItems.slice((auditPage - 1) * AUDIT_PAGE_SIZE, auditPage * AUDIT_PAGE_SIZE);

  return (
    <PageLayout>
      <PageGrid>
        <GridCol span={12}>
          <PageHeader title="Step 7 — Data Transformation" subtitle="Upload a mapping file to automatically find and replace field values">
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

          {/* Transformation Options Box */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            
            {/* File Upload Box */}
            <Card className="h-full">
              <CardHeader title="Upload Mapping File" subtitle="File must contain: Source_Field, Source_Data, Target_Data" />
              <CardBody>
                <div className="flex flex-col gap-4">
                  <div className="flex-1 w-full">
                    <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-[var(--border)] border-dashed rounded-xl cursor-pointer bg-[var(--bg-tertiary)]/30 hover:bg-[var(--bg-tertiary)] hover:border-violet-400 transition-all">
                      <div className="flex flex-col items-center justify-center pt-5 pb-6">
                        <Upload className="w-8 h-8 text-[var(--text-tertiary)] mb-2" />
                        <p className="mb-1 text-sm font-semibold text-[var(--text-secondary)]">Click to upload or drag and drop</p>
                        <p className="text-xs text-[var(--text-tertiary)]">CSV or Excel file</p>
                      </div>
                      <input type="file" className="hidden" accept=".csv,.xlsx,.xls" onChange={handleFileChange} />
                    </label>
                  </div>
                  
                  <div className="w-full flex flex-row items-center gap-3">
                    <div className="flex-1">
                      {mappingFile ? (
                        <div className="p-3 border border-violet-200 dark:border-violet-900 bg-violet-50 dark:bg-violet-900/20 rounded-lg flex items-center gap-3 relative pr-8 h-[50px]">
                          <FileSpreadsheet className="w-5 h-5 text-violet-500 shrink-0" />
                          <div className="overflow-hidden flex-1">
                            <div className="text-sm font-bold text-violet-700 dark:text-violet-300 truncate leading-tight">{mappingFile.name}</div>
                            <div className="text-[10px] text-violet-500 leading-tight">Ready to process</div>
                          </div>
                          <button 
                            className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-violet-400 hover:text-violet-700 hover:bg-violet-200/50 transition-colors cursor-pointer"
                            onClick={() => setMappingFile(null)}
                            title="Remove file"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="p-3 border border-[var(--border)] bg-[var(--bg-tertiary)] rounded-lg text-center text-xs text-[var(--text-tertiary)] h-[50px] flex items-center justify-center">
                          No file selected
                        </div>
                      )}
                    </div>
                    
                    <Button 
                      variant="cyan" 
                      icon={<Cog className="w-4 h-4" />} 
                      className="h-[50px]" 
                      disabled={!mappingFile}
                      onClick={doTransform}
                    >
                      Run Transform
                    </Button>
                  </div>
                </div>
              </CardBody>
            </Card>

            {/* AI Chatbot Box */}
            <Card className="h-full">
              <CardHeader 
                title="AI Natural Language Transform" 
                subtitle="Tell the AI what to change, e.g., 'Change NET from 90 to NT90'" 
                icon={<Bot className="w-4 h-4 text-cyan-500" />}
              />
              <CardBody>
                <div className="flex flex-col gap-4">
                  <div className="flex-1 w-full flex flex-col relative group">
                    <textarea
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      placeholder="Enter natural language instructions here...&#10;&#10;Examples:&#10;- Change all PLANT values of '1000' to '2000'&#10;- Map 'USD' to 'EUR' in the CURRENCY field"
                      className="w-full h-32 p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)]/50 text-[var(--text-primary)] text-sm resize-none focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all placeholder:text-[var(--text-tertiary)]"
                    />
                    <div className="absolute top-3 right-3 text-cyan-500/30 group-focus-within:text-cyan-500 transition-colors">
                      <Sparkles className="w-5 h-5" />
                    </div>
                  </div>
                  
                  <div className="w-full flex justify-end">
                    <Button 
                      variant="cyan" 
                      icon={<Cog className="w-4 h-4" />} 
                      className="h-[50px] w-full"
                      disabled={!aiPrompt.trim()}
                      onClick={doAITransform}
                    >
                      Run Transform
                    </Button>
                  </div>
                </div>
              </CardBody>
            </Card>

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

              {summary.ai_rules && summary.ai_rules.length > 0 && (
                <Card>
                  <CardHeader 
                    title="Interpreted AI Rules" 
                    subtitle="Here is how the AI interpreted your instructions" 
                    icon={<Bot className="w-4 h-4 text-cyan-500" />}
                  />
                  <CardBody>
                    <div className="flex flex-col gap-3">
                      {summary.ai_rules.map((rule: any, i: number) => {
                        if (rule.Source_Field === "Python Script") {
                          return (
                            <div key={i} className="flex flex-col gap-2 p-3 rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)]/50 text-[11px] font-mono">
                              <span className="text-violet-500 font-bold">Generated Pandas Script Execution:</span>
                              <pre className="whitespace-pre-wrap text-[var(--text-secondary)] bg-[#1e1e1e] text-[#d4d4d4] p-4 rounded-md overflow-x-auto">
                                {rule.Target_Data.replace(/```python/g, '').replace(/```/g, '').trim()}
                              </pre>
                            </div>
                          );
                        }
                        
                        return (
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
                        );
                      })}
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
                        const { columns: tableCols, rows: tableRows } = getTableDisplayData(t, filteredRows, state.mapping);
                        const currentPage = tablePages[t.table_name] || 1;
                        const paginatedRows = tableRows.slice((currentPage - 1) * 15, currentPage * 15);

                        return (
                          <Card key={t.table_name}>
                            <CardHeader
                              title={`Transformed: ${t.table_name}`}
                              subtitle={`${tableRows.length} rows × ${tableCols.length} columns${outputKeyFilter ? ' (filtered)' : ''}`}
                            >
                              <Button
                                variant="secondary"
                                size="sm"
                                icon={<Download className="w-3 h-3" />}
                                onClick={() => dl(expCSV(tableRows), `${t.table_name.replace(/[\s/]+/g, '_').toLowerCase()}_transformed.csv`, 'text/csv')}
                                className="ml-auto"
                              >
                                Export {t.table_name}
                              </Button>
                            </CardHeader>
                            <CardBody className="p-0 overflow-hidden">
                              <DataTable
                                rows={paginatedRows}
                                cols={tableCols}
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
    </PageLayout>
  );
}
