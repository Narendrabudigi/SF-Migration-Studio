import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '@/components/ui/toast';
import { useLoading } from '@/components/ui/loading-overlay';
import { dl, expCSV } from '@/lib/utils';
import {
  PageLayout, PageGrid, GridCol, Card, CardHeader, CardBody, Button,
  DataTable, EmptyState
} from '@/components/shared';
import {
  FlaskConical, FileSpreadsheet, Download,
  Play, Trash2, CheckCircle2, ArrowLeft, ArrowRight, Save, Database, Plus, Eye, Zap, X, Check, Pencil, ChevronDown, ChevronUp,
  Link2, FileText, Layers, Sparkles, RefreshCw, UploadCloud
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useMigration } from '@/store/migration-store';
import { TableFilterToolbar, filterRowsByKey, detectKeyColumns, getTableDisplayData } from '@/components/shared/TableFilterToolbar';
import type { TableInfo } from '@/components/shared/TableFilterToolbar';
import { TablePaginationFooter } from '@/components/shared/TablePaginationFooter';

/* ─── Types ─── */
interface HarmonizationStats {
  total_input: number;
  total_output: number;
  primary_rows?: number;
  secondary_rows?: number;
  deduped?: number;
  empty_removed?: number;
  columns?: number;
  [key: string]: number | undefined;
}

interface HarmonizationResult {
  stats: HarmonizationStats;
  fix_log: string[];
  final_table: Record<string, any>[];
  columns: string[];
  session_id?: string;
  is_preview?: boolean;
  tables?: any[];
  dynamic_rules?: any[];
  custom_prompts?: string[];
}

interface StagedSecondaryFile {
  file: File;
  filename: string;
  size: string;
  columns_count: number;
  row_count: number;
  headers: string[];
  mappingFile: File | null;
}

interface KeyCondition {
  left_key: string;
  right_key: string;
}

interface SecondaryJoinConfig {
  file_name: string;
  join_with: string;
  key_conditions: KeyCondition[];
}

interface RuleItemConfig {
  enabled: boolean;
  custom_instruction?: string;
  params?: Record<string, any>;
}

/* ─── Heuristic Key Auto-Matching ─── */
const ERP_KEY_SYNONYMS: Record<string, string[]> = {
  customer: ['kunnr', 'customerid', 'customer_id', 'cust_id', 'custid', 'customer', 'account_num', 'account_number', 'customerno', 'customer_no', 'client_id', 'client_no'],
  company_code: ['bukrs', 'company_code', 'companycode', 'cocode', 'co_code', 'comp_code', 'legal_entity', 'company', 'comp_id', 'compid'],
  employee: ['pernr', 'person_id_external', 'person_id', 'userid', 'user_id', 'employee_id', 'empid', 'emp_id', 'staff_id'],
  material: ['matnr', 'material_id', 'mat_id', 'item_id', 'item_code', 'product_id', 'sku'],
  vendor: ['lifnr', 'vendor_id', 'supplier_id', 'supp_id', 'vendor_num'],
  sales_org: ['vkorg', 'sales_org', 'sales_organization', 'salesorg'],
  order: ['vbeln', 'order_id', 'sales_order', 'order_num'],
  plant: ['werks', 'plant', 'plant_id', 'facility'],
  address: ['address_id', 'addressid', 'addr_id', 'addrid'],
};

function normalizeKeyName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findAllMatchingKeyPairs(parentHeaders: string[], childHeaders: string[]): KeyCondition[] {
  if (!parentHeaders.length || !childHeaders.length) {
    return [{ left_key: parentHeaders[0] || '', right_key: childHeaders[0] || '' }];
  }

  const matchedPairs: KeyCondition[] = [];
  const usedParent = new Set<string>();
  const usedChild = new Set<string>();

  // 1. Exact matches (case-insensitive)
  for (const ph of parentHeaders) {
    if (usedParent.has(ph)) continue;
    const exact = childHeaders.find(ch => !usedChild.has(ch) && ch.toLowerCase() === ph.toLowerCase());
    if (exact) {
      matchedPairs.push({ left_key: ph, right_key: exact });
      usedParent.add(ph);
      usedChild.add(exact);
    }
  }

  // 2. Normalized matches (e.g. CustID <-> Cust_ID, CoCode <-> Co_Code)
  for (const ph of parentHeaders) {
    if (usedParent.has(ph)) continue;
    const normP = normalizeKeyName(ph);
    const normMatch = childHeaders.find(ch => !usedChild.has(ch) && normalizeKeyName(ch) === normP);
    if (normMatch) {
      matchedPairs.push({ left_key: ph, right_key: normMatch });
      usedParent.add(ph);
      usedChild.add(normMatch);
    }
  }

  // 3. ERP synonym groups (e.g. Customer, Company Code, Employee, etc.)
  for (const group of Object.values(ERP_KEY_SYNONYMS)) {
    const parentMatches = parentHeaders.filter(ph => {
      if (usedParent.has(ph)) return false;
      const np = normalizeKeyName(ph);
      return group.some(syn => np === syn || np.includes(syn) || syn.includes(np));
    });

    const childMatches = childHeaders.filter(ch => {
      if (usedChild.has(ch)) return false;
      const nc = normalizeKeyName(ch);
      return group.some(syn => nc === syn || nc.includes(syn) || syn.includes(nc));
    });

    const pairCount = Math.min(parentMatches.length, childMatches.length);
    for (let i = 0; i < pairCount; i++) {
      const ph = parentMatches[i];
      const ch = childMatches[i];
      if (!usedParent.has(ph) && !usedChild.has(ch)) {
        matchedPairs.push({ left_key: ph, right_key: ch });
        usedParent.add(ph);
        usedChild.add(ch);
      }
    }
  }

  // 4. Common key/ID indicators if no match found yet
  if (matchedPairs.length === 0) {
    const idKeywords = ['id', 'key', 'code', 'num', 'number'];
    for (const kw of idKeywords) {
      const pId = parentHeaders.find(ph => !usedParent.has(ph) && normalizeKeyName(ph).includes(kw));
      const cId = childHeaders.find(ch => !usedChild.has(ch) && normalizeKeyName(ch).includes(kw));
      if (pId && cId) {
        matchedPairs.push({ left_key: pId, right_key: cId });
        usedParent.add(pId);
        usedChild.add(cId);
        break;
      }
    }
  }

  if (matchedPairs.length === 0) {
    matchedPairs.push({
      left_key: parentHeaders[0] || '',
      right_key: childHeaders[0] || ''
    });
  }

  return matchedPairs;
}

/* ─── Source Options ─── */
const SOURCE_OPTIONS = [
  { value: 'EXCEL_CSV', label: 'Excel/CSV' },
  { value: 'SAP_ECC', label: 'SAP ECC' },
  { value: 'ORACLE_EBS', label: 'Oracle EBS' },
  { value: 'DATABASE', label: 'Extracted Database' },
];

/* ─── Rule Config Defaults ─── */
const DEFAULT_RULE_CONFIG: Record<string, RuleItemConfig> = {
  whitespace_trim: { enabled: true, params: { mode: 'both' } },
  country_iso: { enabled: true, params: { iso_length: 2 } },
  currency_iso: { enabled: true },
  dedup: { enabled: true },
  empty_filter: { enabled: true },
  date_format: { enabled: true, params: { format: 'YYYYMMDD' } },
  phone_clean: { enabled: true, params: { keep_plus: true } },
};

/* ─── Rule Definitions ─── */
interface RuleDef {
  key: string;
  title: string;
  sub: string;
  emoji: string;
  logKey: string;
}

const RULE_LIST: RuleDef[] = [
  { key: 'dedup', title: 'Key-based Dedup', sub: 'Remove duplicate key field rows', emoji: '🔑', logKey: 'Dedup' },
  { key: 'empty_filter', title: 'Empty Row Filter', sub: 'Remove 100% empty records', emoji: '🗑️', logKey: 'EmptyFilter' },
  { key: 'country_iso', title: 'Country → ISO', sub: 'Full names to 2-3 letter ISO', emoji: '🌍', logKey: 'Country' },
  { key: 'currency_iso', title: 'Currency → ISO', sub: 'Map to ISO 4217 3-letter', emoji: '💱', logKey: 'Currency' },
  { key: 'whitespace_trim', title: 'Whitespace Trim', sub: 'All fields trimmed', emoji: '✂️', logKey: 'WhitespaceTrim' },
  { key: 'date_format', title: 'Date → YYYYMMDD', sub: 'SAP 8-digit date format', emoji: '📅', logKey: 'Date' },
  { key: 'phone_clean', title: 'Phone Cleanup', sub: 'Remove invalid characters', emoji: '📞', logKey: 'PhoneClean' },
];

/* ─── Harmonization Report Card (With Vector PDF & Report CSV Exports) ─── */
function HarmonizationReportCard({ result }: { result: HarmonizationResult }) {
  const [showLogDetails, setShowLogDetails] = useState(false);

  const fixLog = result.fix_log || [];
  const stats = result.stats || {};
  const rows = result.final_table || [];

  const sourceCounts: Record<string, number> = {};
  rows.forEach((r) => {
    const src = String(r.SOURCE || 'UNKNOWN');
    sourceCounts[src] = (sourceCounts[src] || 0) + 1;
  });

  const categories = [
    {
      title: 'Dedup & Filtering',
      icon: '🗑️',
      items: fixLog.filter((l) => l.includes('[Dedup]') || l.includes('[EmptyFilter]') || l.includes('[HeaderCleanup]')),
    },
    {
      title: 'Country, Currency & Code Conversions',
      icon: '🌍',
      items: fixLog.filter((l) =>
        l.includes('[Country→ISO]') ||
        l.includes('[Currency→ISO]')
      ),
    },
    {
      title: 'Date & Phone Formatting',
      icon: '📅',
      items: fixLog.filter((l) => l.includes('[Date→YYYYMMDD]') || l.includes('[PhoneClean]')),
    },
    {
      title: 'Text & Field Adjustments',
      icon: '✂️',
      items: fixLog.filter((l) => l.includes('[WhitespaceTrim]') || l.includes('[UPPER]') || l.includes('[Pad10]') || l.includes('[Trim]') || l.includes('[Transform:')),
    },
    {
      title: 'Dynamic AI & Relational Joins',
      icon: '⚡',
      items: fixLog.filter((l) => l.includes('[DynamicAI]') || l.includes('[RelationalJoin]')),
    },
  ];

  const totalFixEvents = fixLog.filter(
    (l) => l.startsWith('[') && !l.includes('[Init]') && !l.includes('[ColumnNaming]') && !l.includes('[Mapping]') && !l.includes('[Merge]') && !l.includes('::Detail]')
  ).length;

  const exportReportCSV = () => {
    const structuredRows = fixLog.map((line, idx) => {
      let category = 'General';
      let rowNum = '';
      let fieldName = '';
      let origVal = '';
      let harmVal = '';
      let details = line;

      const matchTransform = line.match(/^\[([^\]]+)\]\s*(?:Row\s*(\d+))?(?:\s*\(([^)]+)\))?:\s*(?:'([^']*)'\s*→\s*'([^']*)')?(.*)$/);
      if (matchTransform) {
        category = matchTransform[1] || 'Transform';
        rowNum = matchTransform[2] || '';
        fieldName = matchTransform[3] || '';
        origVal = matchTransform[4] || '';
        harmVal = matchTransform[5] || '';
        details = matchTransform[6]?.trim() || line;
      } else {
        const matchCat = line.match(/^\[([^\]]+)\]\s*(.*)$/);
        if (matchCat) {
          category = matchCat[1];
          details = matchCat[2];
        }
      }

      return {
        Index: idx + 1,
        Category: category,
        Row_Number: rowNum,
        Field_Name: fieldName,
        Original_Value: origVal,
        Harmonized_Value: harmVal,
        Details: details,
      };
    });

    const csvContent = expCSV(structuredRows);
    dl(csvContent, `harmonization_audit_report_${Date.now()}.csv`, 'text/csv');
  };

  const exportVectorPDF = () => {
    window.print();
  };

  return (
    <Card className="border-purple-200 dark:border-purple-900/40 bg-gradient-to-br from-[var(--bg-primary)] via-[var(--bg-secondary)] to-purple-50/20 dark:to-purple-950/10 shadow-sm">
      <CardHeader
        title="Harmonization Changes & Audit Report"
        subtitle="Summary of standardized fields, rule fixes and source origins"
      >
        <div className="flex items-center gap-2 ml-auto">
          <Button
            variant="secondary"
            size="sm"
            icon={<FileText className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />}
            onClick={exportVectorPDF}
          >
            Export Vector PDF
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<Download className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />}
            onClick={exportReportCSV}
          >
            Export Report CSV
          </Button>
        </div>
      </CardHeader>
      <CardBody className="p-4 space-y-4">
        {/* Metric Cards Grid */}
        <div className="grid grid-cols-4 gap-3">
          <div className="p-3 rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)]/50">
            <div className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider">Rows Preserved</div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-xl font-extrabold text-[var(--text-primary)]">{stats.total_output || rows.length}</span>
              <span className="text-[10px] text-[var(--text-tertiary)]">/ {stats.total_input || 0} input</span>
            </div>
            <div className="mt-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
              {(stats.deduped || 0) + (stats.empty_removed || 0) > 0
                ? `Cleaned ${(stats.deduped || 0) + (stats.empty_removed || 0)} invalid/dup rows`
                : 'All input records preserved'}
            </div>
          </div>

          <div className="p-3 rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)]/50">
            <div className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider">Output Columns</div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-xl font-extrabold text-[var(--text-primary)]">{stats.columns || (rows.length > 0 ? Object.keys(rows[0]).length : 0)}</span>
              <span className="text-[10px] text-[var(--text-tertiary)]">total fields</span>
            </div>
            <div className="mt-1 text-[10px] text-[var(--text-tertiary)]">
              Unified relational schema
            </div>
          </div>

          <div className="p-3 rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)]/50">
            <div className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider">Standardization Fixes</div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-xl font-extrabold text-purple-600 dark:text-purple-400">{totalFixEvents}</span>
              <span className="text-[10px] text-[var(--text-tertiary)]">field fixes</span>
            </div>
            <div className="mt-1 text-[10px] text-purple-600 dark:text-purple-400 font-semibold">
              Rules & AI transformations
            </div>
          </div>

          <div className="p-3 rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)]/50">
            <div className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider">Source Systems</div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {Object.entries(sourceCounts).map(([src, count]) => (
                <span key={src} className="px-2 py-0.5 rounded-md bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 font-mono font-bold text-[10px]">
                  {src}: {count}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Harmonization Categories Grid */}
        <div className="space-y-2">
          <div className="text-[11.5px] font-bold text-[var(--text-primary)]">
            Harmonization Breakdown
          </div>
          <div className="grid grid-cols-2 gap-3">
            {categories.filter(c => c.items.length > 0).map((cat, i) => (
              <div key={i} className="p-3 rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)]/40 space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-bold text-[var(--text-primary)]">
                  <span className="flex items-center gap-1.5">
                    <span>{cat.icon}</span>
                    <span>{cat.title}</span>
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[9.5px] font-bold text-purple-600 dark:text-purple-400 border border-[var(--border)]">
                    {cat.items.length} events
                  </span>
                </div>
                <div className="space-y-1 max-h-[100px] overflow-y-auto scrollbar-thin scrollbar-thumb-[var(--border)] scrollbar-track-transparent pr-1">
                  {cat.items.map((item, idx) => (
                    <div key={idx} className="text-[10px] text-[var(--text-secondary)] font-mono truncate bg-[var(--bg-primary)]/50 px-2 py-0.5 rounded">
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Expandable Full Audit Log */}
        <div className="pt-2 border-t border-[var(--border)] flex items-center justify-between">
          <button
            onClick={() => setShowLogDetails(!showLogDetails)}
            className="text-[11px] font-bold text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1 cursor-pointer"
          >
            {showLogDetails ? '▼ Hide Complete Audit Trail' : '▶ View Complete Audit Trail'} ({fixLog.length} log entries)
          </button>
        </div>

        {showLogDetails && (
          <div className="p-3 rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)] max-h-[250px] overflow-y-auto font-mono text-[10px] space-y-1 scrollbar-thin">
            {fixLog.map((log, idx) => (
              <div key={idx} className="text-[var(--text-secondary)]">
                {log}
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

interface LogGroup {
  id: string;
  summary: string;
  ruleTag: string;
  details: string[];
}

function groupFixLogEntries(fixLog: string[]): LogGroup[] {
  const groups: LogGroup[] = [];
  const tagSummaryMap: Record<string, LogGroup> = {};
  let lastGroup: LogGroup | null = null;

  fixLog.forEach((line, idx) => {
    if (line.includes('::Detail]')) {
      const matchDetail = line.match(/^\[([^:]+)::Detail\]\s*(.*)$/);
      if (matchDetail) {
        const tag = matchDetail[1];
        const detailText = matchDetail[2];

        if (lastGroup && (lastGroup.ruleTag === tag || lastGroup.summary.includes(`[${tag}`))) {
          lastGroup.details.push(detailText);
          return;
        } else if (tagSummaryMap[tag]) {
          tagSummaryMap[tag].details.push(detailText);
          return;
        }
      }
    }

    const matchRule = line.match(/^\[([^\]]+)\]\s*(.*)$/);
    if (!matchRule) {
      const grp: LogGroup = {
        id: `grp_${idx}`,
        summary: line,
        ruleTag: 'Log',
        details: [],
      };
      groups.push(grp);
      lastGroup = grp;
      return;
    }

    const tag = matchRule[1];
    const content = matchRule[2];

    if (content.startsWith('Row ')) {
      if (!tagSummaryMap[tag]) {
        const grp: LogGroup = {
          id: `grp_tag_${tag}`,
          summary: `[${tag}] Transformations applied across rows`,
          ruleTag: tag,
          details: [content],
        };
        tagSummaryMap[tag] = grp;
        groups.push(grp);
        lastGroup = grp;
      } else {
        tagSummaryMap[tag].details.push(content);
        tagSummaryMap[tag].summary = `[${tag}] ${tagSummaryMap[tag].details.length} values transformed across rows`;
      }
      return;
    }

    const grp: LogGroup = {
      id: `grp_${idx}_${tag}`,
      summary: line,
      ruleTag: tag,
      details: [],
    };
    tagSummaryMap[tag] = grp;
    groups.push(grp);
    lastGroup = grp;
  });

  return groups;
}

/* ─── Preview Card ─── */
function PreviewCard({
  fixLog,
  stats,
  ruleConfig,
  onProceed,
}: {
  fixLog: string[];
  stats: any;
  ruleConfig?: Record<string, RuleItemConfig>;
  onProceed: () => void;
}) {
  const activeFixLog = useMemo(() => {
    if (!ruleConfig) return fixLog;
    const disabledLogKeys = RULE_LIST.filter(r => ruleConfig[r.key]?.enabled === false).map(r => r.logKey);
    if (disabledLogKeys.length === 0) return fixLog;

    return fixLog.filter(line => {
      for (const key of disabledLogKeys) {
        if (
          line.includes(`[${key}]`) ||
          line.includes(`[${key}::`) ||
          line.includes(`[${key} →`) ||
          line.includes(`[${key}→`)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [fixLog, ruleConfig]);

  const logGroups = useMemo(() => groupFixLogEntries(activeFixLog), [activeFixLog]);
  const [expandedGroupIds, setExpandedGroupIds] = useState<Record<string, boolean>>({});

  const toggleGroup = (id: string) => {
    setExpandedGroupIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <Card className="border-amber-300 dark:border-amber-700/60 bg-gradient-to-br from-amber-50/30 to-amber-100/10 dark:from-amber-950/20 dark:to-amber-900/5">
      <CardHeader
        title="📋 Preview — Proposed Changes"
        subtitle="Review the changes that will be applied. Click Proceed to execute."
        icon={<Eye className="w-4 h-4 text-amber-600" />}
      >
        <Button variant="primary" size="sm" icon={<Play className="w-3.5 h-3.5" />} onClick={onProceed}>
          Proceed & Execute
        </Button>
      </CardHeader>
      <CardBody className="p-4 space-y-3">
        <div className="flex gap-3 text-[11px]">
          <div className="px-3 py-1.5 rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 font-bold">
            {stats.total_input || 0} input rows
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 font-bold">
            {fixLog.filter(l => l.startsWith('[') && !l.includes('[Init]') && !l.includes('[Mapping]') && !l.includes('::Detail]')).length} transformation events
          </div>
        </div>

        <div className="space-y-1.5 max-h-[350px] overflow-y-auto scrollbar-thin pr-1">
          {logGroups.map((grp) => {
            const isInit = grp.summary.includes('[Init]') || grp.summary.includes('[Mapping]') || grp.summary.includes('[Merge]');
            const isDynamic = grp.summary.includes('[DynamicAI]') || grp.summary.includes('[RelationalJoin]');
            const hasDetails = grp.details.length > 0;
            const isExpanded = !!expandedGroupIds[grp.id];

            return (
              <div
                key={grp.id}
                className={`rounded-lg border transition-all ${isDynamic
                    ? 'border-purple-200 dark:border-purple-900/40 bg-purple-50/50 dark:bg-purple-950/20 text-purple-800 dark:text-purple-300'
                    : isInit
                      ? 'border-gray-200 dark:border-gray-800 bg-[var(--bg-tertiary)]/50 text-[var(--text-tertiary)]'
                      : 'border-amber-200 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/15 text-[var(--text-primary)]'
                  }`}
              >
                <div className="flex items-center justify-between px-3 py-1.5 text-[11px] font-mono">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="truncate">{grp.summary}</span>
                  </div>

                  {hasDetails && (
                    <button
                      onClick={() => toggleGroup(grp.id)}
                      className="ml-3 px-2.5 py-1 rounded-md text-[10px] font-bold bg-purple-600 hover:bg-purple-700 text-white flex items-center gap-1 cursor-pointer transition-all shadow-xs shrink-0"
                    >
                      {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      <span>{isExpanded ? 'Hide Details' : `View Details (${grp.details.length} rows)`}</span>
                    </button>
                  )}
                </div>

                {hasDetails && isExpanded && (
                  <div className="px-3 py-2 border-t border-amber-200/60 dark:border-amber-900/40 bg-[var(--bg-primary)]/90 max-h-[220px] overflow-y-auto space-y-1 font-mono text-[10.5px] scrollbar-thin">
                    <div className="text-[9.5px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] pb-1 border-b border-[var(--border)] flex justify-between items-center">
                      <span>Edited Rows & Value Transformations ({grp.details.length}):</span>
                    </div>
                    {grp.details.map((detail, dIdx) => (
                      <div key={dIdx} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-purple-50 dark:hover:bg-purple-900/20 px-1.5 py-0.5 rounded transition-colors">
                        {detail}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}

/* ─── Main Page ─── */
export function Step4Harmonize() {
  const { toast } = useToast();
  const { showLoad, tick, hideLoad } = useLoading();
  const navigate = useNavigate();
  const { state, dispatch } = useMigration();

  // Mode: flow vs multi
  const [mode, setMode] = useState<'flow' | 'multi'>('flow');
  const [sapObject, setSapObject] = useState(state.obj || 'Biographical Info');
  const [companyCode, setCompanyCode] = useState(state.cc || '1000');
  const [plant, setPlant] = useState(state.plant || '1000');
  const [currency, setCurrency] = useState(state.curr || 'INR');
  const [salesOrg, setSalesOrg] = useState(state.so || '1000');
  const [purchOrg, setPurchOrg] = useState(state.po || '1000');
  const [distChannel, setDistChannel] = useState(state.distch || '10');
  const [division, setDivision] = useState(state.spart || '00');

  // Source Systems
  const [primarySource, setPrimarySource] = useState(state.src || 'SAP_ECC');
  const [secondarySource, setSecondarySource] = useState('EXCEL_CSV');

  // Primary Data Info
  const primaryHeaders = useMemo(() => {
    if (state.headers && state.headers.length > 0) return state.headers;
    if (state.extracted && state.extracted.length > 0) return Object.keys(state.extracted[0]);
    if (state.rawData && state.rawData.length > 0) return Object.keys(state.rawData[0]);
    if (state.uploadedData && state.uploadedData.length > 0) return Object.keys(state.uploadedData[0]);
    return ['CustomerID', 'CustomerName', 'Country', 'Currency', 'CompanyCode'];
  }, [state.headers, state.extracted, state.rawData, state.uploadedData]);

  const primaryRowCount = (state.extracted?.length) || (state.rawData?.length) || (state.uploadedData?.length) || 5;
  const primaryFileName = useMemo(() => {
    // Use actual uploaded filename from Step 1 if available
    if (state.uploadedFileName) return state.uploadedFileName;
    return state.obj ? `${state.obj.replace(/[\s/]+/g, '_')}.csv` : 'Customers.csv';
  }, [state.obj, state.uploadedFileName]);

  // Multi-Source Staged Files & Relational Joins
  const [stagedFiles, setStagedFiles] = useState<StagedSecondaryFile[]>([]);
  const [baseTableSelection, setBaseTableSelection] = useState<string>(primaryFileName);
  const [joinConfigs, setJoinConfigs] = useState<Record<string, SecondaryJoinConfig>>({});
  const [isInspectingFiles, setIsInspectingFiles] = useState(false);

  // File input refs
  const multiFileInputRef = useRef<HTMLInputElement>(null);
  const mappingFileInputRef = useRef<HTMLInputElement>(null);
  const [activeMappingTargetFile, setActiveMappingTargetFile] = useState<string | null>(null);

  // Results & Preview
  const result: HarmonizationResult | null = state.harmonizationResult;
  const setResult = (val: any) => dispatch({ type: 'SET_FIELD', field: 'harmonizationResult', value: val });
  const [previewData, setPreviewData] = useState<{ fixLog: string[]; stats: any } | null>(null);

  // Table filter & pagination state for output display
  const [selectedOutputTables, setSelectedOutputTables] = useState<Set<string>>(new Set());
  const [outputKeyFilter, setOutputKeyFilter] = useState('');
  const [tablePages, setTablePages] = useState<Record<string, number>>({});
  const extractedTables = state.extractedTables || [];

  useEffect(() => {
    const tablesToUse = (result as any)?.tables || extractedTables || [];
    if (tablesToUse.length > 0) {
      setSelectedOutputTables(new Set(tablesToUse.map((t: any) => t.table_name)));
    }
  }, [extractedTables.length, (result as any)?.tables]);

  // Editable Rule Config
  const [ruleConfig, setRuleConfig] = useState<Record<string, RuleItemConfig>>({ ...DEFAULT_RULE_CONFIG });
  const [expandedRuleKey, setExpandedRuleKey] = useState<string | null>(null);

  // Dynamic AI Rules
  const [customPrompts, setCustomPrompts] = useState<string[]>(state.harmonizeCustomPrompts || []);
  const [savedDynamicRules, setSavedDynamicRules] = useState<any[]>(state.harmonizeDynamicRules || []);
  const [selectedDynamicRules, setSelectedDynamicRules] = useState<Record<string, boolean>>(
    Object.fromEntries((state.harmonizeDynamicRules || []).map((r: any) => [r.id, true]))
  );

  const dedupeRules = (rules: any[]) => {
    const seenIds = new Set<string>();
    return rules.map((r, idx) => {
      let ruleId = r.id || r.rule;
      if (!ruleId || seenIds.has(ruleId)) {
        ruleId = `DYNAMIC_HARM_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 6)}`;
      }
      seenIds.add(ruleId);
      return { ...r, id: ruleId };
    });
  };

  // Dynamic Rule Editing States (matched with Step 5 Validate)
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  const [newPromptInput, setNewPromptInput] = useState<string>('');

  const handleAddPrompt = () => {
    if (!newPromptInput.trim()) return;
    const updatedPrompts = [...customPrompts, newPromptInput.trim()];
    setCustomPrompts(updatedPrompts);
    dispatch({ type: 'SET_FIELD', field: 'harmonizeCustomPrompts', value: updatedPrompts });
    setNewPromptInput('');
    toast('Custom rule added! Click Preview Changes or Merge & Harmonize to apply.', 'ok');
  };

  const handleDeletePrompt = (index: number) => {
    const updated = customPrompts.filter((_, i) => i !== index);
    setCustomPrompts(updated);
    dispatch({ type: 'SET_FIELD', field: 'harmonizeCustomPrompts', value: updated });
    if (editingIndex === index) {
      setEditingIndex(null);
      setEditingText('');
    }
  };

  const handleStartEdit = (index: number) => {
    setEditingIndex(index);
    setEditingText(customPrompts[index] || '');
  };

  const handleSaveEdit = (index: number) => {
    if (!editingText.trim()) {
      handleDeletePrompt(index);
      return;
    }
    const updated = [...customPrompts];
    updated[index] = editingText.trim();
    setCustomPrompts(updated);
    dispatch({ type: 'SET_FIELD', field: 'harmonizeCustomPrompts', value: updated });
    setEditingIndex(null);
    setEditingText('');
    toast('Rule prompt updated!', 'ok');
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
    setEditingText('');
  };

  const toggleSelectDynamicRule = (ruleId: string) => {
    setSelectedDynamicRules((prev) => ({
      ...prev,
      [ruleId]: prev[ruleId] === false ? true : false,
    }));
  };

  const deleteDynamicRule = (ruleId: string) => {
    const remaining = savedDynamicRules.filter((r) => r.id !== ruleId);
    setSavedDynamicRules(remaining);
    dispatch({ type: 'SET_FIELD', field: 'harmonizeDynamicRules', value: remaining });
    toast('Dynamic rule removed', 'info');
  };

  const handleClearAllDynamicRules = () => {
    setSavedDynamicRules([]);
    setCustomPrompts([]);
    dispatch({ type: 'SET_FIELD', field: 'harmonizeDynamicRules', value: [] });
    dispatch({ type: 'SET_FIELD', field: 'harmonizeCustomPrompts', value: [] });
    toast('All dynamic rules cleared', 'info');
  };

  const saveRulesToDB = async () => {
    if (!state.projectId) {
      toast('No project selected to save rules', 'err');
      return;
    }
    showLoad('Saving rules...', 'Compiling and saving dynamic harmonization rules to database');
    try {
      const actualCols = (state.extracted && state.extracted.length > 0)
        ? Object.keys(state.extracted[0])
        : ((result?.columns && result.columns.length > 0) ? result.columns : (state.headers || []));

      let compiled: any[] = [];
      if (customPrompts.length > 0) {
        const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/harmonize/generate-dynamic-rules`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompts: customPrompts,
            target_object: state.obj,
            actual_columns: actualCols
          })
        });
        if (res.ok) {
          const json = await res.json();
          compiled = json.rules || [];
        }
      }

      const deduupedCompiled = dedupeRules(compiled);
      const payloadRules = [
        ...savedDynamicRules,
        ...deduupedCompiled
      ].map((r: any) => ({
        ...r,
        enabled: selectedDynamicRules[r.id] !== false
      }));

      const res2 = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/harmonize/rules/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: state.projectId, target_object: state.obj, rules: payloadRules })
      });
      if (!res2.ok) throw new Error('Failed to save dynamic rules');

      setSavedDynamicRules(payloadRules);
      dispatch({ type: 'SET_FIELD', field: 'harmonizeDynamicRules', value: payloadRules });
      setSelectedDynamicRules((prev) => {
        const updated = { ...prev };
        payloadRules.forEach((r: any) => {
          if (!(r.id in updated)) updated[r.id] = true;
        });
        return updated;
      });
      setCustomPrompts([]);
      dispatch({ type: 'SET_FIELD', field: 'harmonizeCustomPrompts', value: [] });
      hideLoad();
      toast(`Successfully saved ${payloadRules.length} dynamic rule(s) to database!`, 'ok');
    } catch (err: any) {
      hideLoad();
      toast(err.message || 'Failed to save dynamic rules', 'err');
    }
  };

  // Helper to format file sizes
  const formatSize = (bytes?: number): string => {
    if (!bytes || isNaN(bytes)) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Handle uploading/staging multiple secondary files
  const handleAddSecondaryFiles = async (fileList: FileList | File[] | null) => {
    if (!fileList || fileList.length === 0) return;
    const filesArray = Array.from(fileList);

    setIsInspectingFiles(true);
    showLoad('Inspecting Files...', `Analyzing ${filesArray.length} file schema(s)`, ['Detecting headers & columns...']);

    try {
      const formData = new FormData();
      filesArray.forEach(f => formData.append('files', f));

      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/extract/upload-preview`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ detail: 'Preview failed' }));
        throw new Error(errData.detail || 'Failed to preview files');
      }

      const resData = await res.json();
      const newStagedList: StagedSecondaryFile[] = (resData.files || []).map((pf: any, idx: number) => {
        const fileObj = filesArray[idx] || filesArray.find(f => f.name === pf.filename) || filesArray[0];
        const fileSize = fileObj ? fileObj.size : (pf.file_size || 0);
        return {
          file: fileObj,
          filename: pf.filename || (fileObj ? fileObj.name : `file_${idx}.csv`),
          size: formatSize(fileSize),
          headers: pf.headers || [],
          columns_count: pf.columns_count || (pf.headers ? pf.headers.length : 0),
          row_count: pf.row_count || 0,
          mappingFile: null,
        };
      });

      // Combine with existing staged files
      const existingMap = new Map(stagedFiles.map(f => [f.filename, f]));
      newStagedList.forEach(sf => existingMap.set(sf.filename, sf));
      const combinedList = Array.from(existingMap.values());
      setStagedFiles(combinedList);

      // Initialize join configs with heuristic key matching
      const updatedConfigs = { ...joinConfigs };
      combinedList.forEach((sec) => {
        if (!updatedConfigs[sec.filename] || !updatedConfigs[sec.filename].key_conditions || updatedConfigs[sec.filename].key_conditions.length === 0) {
          // Default join target: Always Primary Base Table (like Step 1)
          const targetParent = primaryFileName;
          const parentHdrs = primaryHeaders || [];

          const matchedPairs = findAllMatchingKeyPairs(parentHdrs, sec.headers || []);
          updatedConfigs[sec.filename] = {
            file_name: sec.filename,
            join_with: targetParent,
            key_conditions: matchedPairs.length > 0 ? matchedPairs : [{ left_key: parentHdrs[0] || '', right_key: sec.headers?.[0] || '' }],
          };
        }
      });
      setJoinConfigs(updatedConfigs);

      toast(`Staged ${combinedList.length} secondary file(s). Configure relational join keys below!`, 'ok');
    } catch (err: any) {
      toast(err.message || 'Error inspecting secondary files', 'err');
    } finally {
      setIsInspectingFiles(false);
      hideLoad();
      if (multiFileInputRef.current) multiFileInputRef.current.value = '';
    }
  };

  const handleRemoveStagedFile = (filename: string) => {
    const remaining = stagedFiles.filter(f => f.filename !== filename);
    setStagedFiles(remaining);
    const updatedConfigs = { ...joinConfigs };
    delete updatedConfigs[filename];
    setJoinConfigs(updatedConfigs);
  };

  const handleResetSecondary = () => {
    setStagedFiles([]);
    setJoinConfigs({});
    toast('Secondary files reset', 'info');
  };

  // Attach mapping CSV to a specific secondary file
  const handleOpenMappingPicker = (targetFilename: string) => {
    setActiveMappingTargetFile(targetFilename);
    if (mappingFileInputRef.current) {
      mappingFileInputRef.current.click();
    }
  };

  const handleMappingFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && activeMappingTargetFile) {
      setStagedFiles(prev => prev.map(sf => {
        if (sf.filename === activeMappingTargetFile) {
          return { ...sf, mappingFile: file };
        }
        return sf;
      }));
      toast(`Attached mapping CSV to ${activeMappingTargetFile}`, 'ok');
    }
    setActiveMappingTargetFile(null);
    if (mappingFileInputRef.current) mappingFileInputRef.current.value = '';
  };

  const handleRemoveMappingFile = (targetFilename: string) => {
    setStagedFiles(prev => prev.map(sf => {
      if (sf.filename === targetFilename) {
        return { ...sf, mappingFile: null };
      }
      return sf;
    }));
  };

  // Join Topology & Composite Keys modification
  const updateJoinParent = (secFilename: string, newParent: string) => {
    const parentHeaders = newParent === primaryFileName
      ? primaryHeaders
      : (stagedFiles.find(f => f.filename === newParent)?.headers || primaryHeaders);
    const secObj = stagedFiles.find(f => f.filename === secFilename);
    const secHeaders = secObj?.headers || [];

    const matchedPairs = findAllMatchingKeyPairs(parentHeaders, secHeaders);
    setJoinConfigs(prev => ({
      ...prev,
      [secFilename]: {
        file_name: secFilename,
        join_with: newParent,
        key_conditions: matchedPairs,
      },
    }));
  };

  const updateKeyCondition = (secFilename: string, condIdx: number, field: 'left_key' | 'right_key', val: string) => {
    setJoinConfigs(prev => {
      const current = prev[secFilename] || { file_name: secFilename, join_with: primaryFileName, key_conditions: [] };
      const nextConds = current.key_conditions.map((c, i) => i === condIdx ? { ...c, [field]: val } : c);
      return {
        ...prev,
        [secFilename]: { ...current, key_conditions: nextConds },
      };
    });
  };

  const addCompositeKeyCondition = (secFilename: string) => {
    setJoinConfigs(prev => {
      const current = prev[secFilename] || { file_name: secFilename, join_with: primaryFileName, key_conditions: [] };
      const parentName = current.join_with || primaryFileName;
      const parentHeaders = parentName === primaryFileName
        ? primaryHeaders
        : (stagedFiles.find(f => f.filename === parentName)?.headers || primaryHeaders);
      const secObj = stagedFiles.find(f => f.filename === secFilename);
      const secHeaders = secObj?.headers || [];

      const usedLeft = new Set(current.key_conditions.map(c => c.left_key).filter(Boolean));
      const usedRight = new Set(current.key_conditions.map(c => c.right_key).filter(Boolean));

      const unusedParent = parentHeaders.filter(h => !usedLeft.has(h));
      const unusedChild = secHeaders.filter(h => !usedRight.has(h));

      const candidatePairs = findAllMatchingKeyPairs(
        unusedParent.length > 0 ? unusedParent : parentHeaders,
        unusedChild.length > 0 ? unusedChild : secHeaders
      );

      const nextPair = candidatePairs[0] || {
        left_key: unusedParent[0] || parentHeaders[0] || '',
        right_key: unusedChild[0] || secHeaders[0] || ''
      };

      return {
        ...prev,
        [secFilename]: {
          ...current,
          key_conditions: [...current.key_conditions, nextPair],
        },
      };
    });
  };

  const removeCompositeKeyCondition = (secFilename: string, condIdx: number) => {
    setJoinConfigs(prev => {
      const current = prev[secFilename];
      if (!current || current.key_conditions.length <= 1) return prev;
      return {
        ...prev,
        [secFilename]: {
          ...current,
          key_conditions: current.key_conditions.filter((_, i) => i !== condIdx),
        },
      };
    });
  };

  // Harmonization Execution
  const canRun = mode === 'flow'
    ? true
    : stagedFiles.length > 0;

  async function runHarmonization(isPreview: boolean = true, silent: boolean = false) {
    if (!canRun) {
      if (mode === 'multi' && stagedFiles.length === 0) {
        toast('Please stage at least one secondary file to harmonize in Multi mode', 'err');
      }
      return;
    }
    dispatch({ type: 'SET_FIELD', field: 'isHarmonizedSaved', value: false });

    if (!silent) {
      const loadMsg = isPreview ? 'Generating Preview…' : 'Running Harmonization Agent…';
      showLoad(loadMsg, `Processing multi-source data through relational topology & rules`, [
        'Reading primary data from Database payload…',
        'Parsing secondary file schemas & direct columns…',
        'Resolving topological join hierarchy & composite keys…',
        'Executing LEFT JOIN merges with suffix protection…',
        'Applying standardization & dynamic AI rules…',
        'Generating audit report & results…',
      ]);
      [0, 1, 2, 3, 4, 5, 6, 7].forEach(i => setTimeout(() => tick(i), 300 + i * 300));
    }

    try {
      let res;
      const selectedDynRules = savedDynamicRules.filter((r: any) => selectedDynamicRules[r.id] !== false);

      if (mode === 'flow') {
        if (!state.projectId) {
          throw new Error('No Project ID found. Please extract and save data in Step 3 first.');
        }
        res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/harmonize/flow`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project_id: state.projectId,
            sap_object: sapObject,
            company_code: companyCode,
            sales_org: salesOrg,
            purch_org: purchOrg,
            plant: plant,
            dist_channel: distChannel,
            division: division,
            currency: currency,
            primary_source: state.src || primarySource,
            preview: isPreview,
            rule_config: ruleConfig,
            custom_prompts: customPrompts,
            dynamic_rules: selectedDynRules,
          }),
        });
      } else {
        // Multi mode
        const formData = new FormData();
        formData.append('project_id', state.projectId || '');
        formData.append('sap_object', sapObject);
        formData.append('company_code', companyCode);
        formData.append('sales_org', salesOrg);
        formData.append('purch_org', purchOrg);
        formData.append('plant', plant);
        formData.append('dist_channel', distChannel);
        formData.append('division', division);
        formData.append('currency', currency);
        formData.append('primary_source', state.src || primarySource);
        formData.append('secondary_source', secondarySource);
        formData.append('preview', isPreview ? 'true' : 'false');
        formData.append('rule_config_json', JSON.stringify(ruleConfig));
        if (customPrompts.length > 0) formData.append('custom_prompts_json', JSON.stringify(customPrompts));
        if (selectedDynRules.length > 0) formData.append('dynamic_rules_json', JSON.stringify(selectedDynRules));

        // Append all secondary files
        stagedFiles.forEach(sf => {
          formData.append('secondary_files', sf.file);
          if (sf.mappingFile) {
            formData.append('secondary_mapping_files', sf.mappingFile);
          }
        });

        // Join configs array
        const configsArray = stagedFiles.map(sf => {
          const cfg = joinConfigs[sf.filename] || {
            file_name: sf.filename,
            join_with: primaryFileName,
            key_conditions: findAllMatchingKeyPairs(primaryHeaders, sf.headers),
          };
          return {
            file_name: sf.filename,
            join_with: cfg.join_with || primaryFileName,
            key_conditions: (cfg.key_conditions || []).filter(c => c.left_key && c.right_key),
            mapping_file: sf.mappingFile ? sf.mappingFile.name : undefined,
          };
        });

        formData.append('join_configs_json', JSON.stringify(configsArray));
        formData.append('base_table_name', primaryFileName);

        const endpoint = state.projectId
          ? `${import.meta.env.VITE_BACKEND_URL}/api/sap/harmonize/multi-flow`
          : `${import.meta.env.VITE_BACKEND_URL}/api/sap/harmonize`;

        res = await fetch(endpoint, { method: 'POST', body: formData });
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
        throw new Error(err.detail || 'Harmonization failed');
      }

      const data = await res.json();

      if (silent) {
        if (data.is_preview) {
          setPreviewData({ fixLog: data.fix_log, stats: data.stats });
        }
        return;
      }

      setTimeout(() => {
        tick(8, 'Complete');
        setTimeout(() => {
          hideLoad();
          if (data.is_preview) {
            setPreviewData({ fixLog: data.fix_log, stats: data.stats });
            setResult(null);
            toast(`Preview ready: ${data.fix_log.length} transformations detected`, 'ok');
          } else {
            setPreviewData(null);
            setResult(data);
            if (data.tables && data.tables.length > 0) {
              dispatch({ type: 'SET_FIELD', field: 'extractedTables', value: data.tables });
            }

            const returnedDynRules = data.dynamic_rules || [];
            const existingIds = new Set(savedDynamicRules.map((r: any) => r.id));
            const newlyAddedRules = dedupeRules(returnedDynRules).filter((r: any) => !existingIds.has(r.id));
            const combinedDynamicRules = [...savedDynamicRules, ...newlyAddedRules];
            setSavedDynamicRules(combinedDynamicRules);
            dispatch({ type: 'SET_FIELD', field: 'harmonizeDynamicRules', value: combinedDynamicRules });
            setSelectedDynamicRules((d) => {
              const updated = { ...d };
              newlyAddedRules.forEach((r: any) => {
                if (r?.id && !(r.id in updated)) {
                  updated[r.id] = true;
                }
              });
              return updated;
            });

            toast(
              `Harmonized: ${data.stats.total_output} rows from ${data.stats.total_input} input rows across tables`,
              'ok'
            );
          }
        }, 600);
      }, 500);

    } catch (err: any) {
      if (!silent) hideLoad();
      toast(err.message || 'Harmonization failed', 'err');
    }
  }

  const handleProceed = () => {
    setPreviewData(null);
    runHarmonization(false);
  };

  const saveDataToDB = async () => {
    if (!state.projectId) {
      toast('No project ID found. Please create a project first.', 'err');
      return;
    }
    if (!result?.final_table) return;

    showLoad('Saving data...', 'Persisting harmonized records to database');
    try {
      const resultTables = (result as any)?.tables;
      const currentTables = (resultTables && resultTables.length > 0)
        ? resultTables
        : (extractedTables.length > 0 ? extractedTables : (state.extractedTables || []));

      const currentDynRules = savedDynamicRules.length > 0 ? savedDynamicRules : ((result as any)?.dynamic_rules || state.harmonizeDynamicRules || []);

      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/harmonize/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: state.projectId,
          target_object: state.obj,
          payload: result.final_table,
          tables: currentTables,
          dynamic_rules: currentDynRules,
          custom_prompts: customPrompts,
        }),
      });

      if (!res.ok) throw new Error('Failed to save data');

      hideLoad();
      dispatch({ type: 'SET_FIELD', field: 'extractedTables', value: currentTables });
      dispatch({ type: 'SET_FIELD', field: 'harmonized', value: result.final_table });
      dispatch({ type: 'SET_FIELD', field: 'harmonizeDynamicRules', value: currentDynRules });
      dispatch({ type: 'SET_FIELD', field: 'isHarmonizedSaved', value: true });
      toast('Harmonized data saved to database successfully!', 'ok');
    } catch (err: any) {
      hideLoad();
      toast(err.message || 'Failed to save data', 'err');
    }
  };

  const toggleRule = (key: string) => {
    setRuleConfig(prev => ({
      ...prev,
      [key]: { ...prev[key], enabled: !prev[key]?.enabled },
    }));
  };

  const updateRuleParamInline = (key: string, paramKey: string, val: any) => {
    setRuleConfig(prev => ({
      ...prev,
      [key]: {
        ...prev[key],
        params: { ...(prev[key]?.params || {}), [paramKey]: val },
      },
    }));
  };

  const updateRuleInstructionInline = (key: string, instruction: string) => {
    setRuleConfig(prev => ({
      ...prev,
      [key]: {
        ...prev[key],
        custom_instruction: instruction || undefined,
      },
    }));
  };

  const enabledRuleCount = RULE_LIST.filter(r => (ruleConfig[r.key] !== undefined ? ruleConfig[r.key].enabled : true)).length;
  const totalRuleCount = RULE_LIST.length;

  return (
    <PageLayout>
      <PageGrid>

        {/* ─── Main Column: Staging + Data Modeling + Reports + Results ─── */}
        <GridCol span={9}>
          <div className="space-y-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">Step 4 — Harmonization Agent</h1>
              <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">Upload files, configure rules, and test the harmonization pipeline</p>
            </div>

            {/* Mode toggle: Flow vs Multi */}
            <div className="flex items-center gap-2">
              {(['flow', 'multi'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => { setMode(m); setResult(null); setPreviewData(null); }}
                  className={`
                    px-3.5 py-1.5 rounded-lg text-[11.5px] font-semibold transition-all duration-200 border cursor-pointer
                    ${mode === m
                      ? 'bg-purple-600 text-white border-purple-600 shadow-md shadow-purple-600/20'
                      : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border-[var(--border)] hover:border-purple-300'}
                  `}
                >
                  {m === 'flow' ? '⚡ Flow' : '🔗 Multi'}
                </button>
              ))}
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
              <Button variant="secondary" icon={<ArrowLeft className="w-3.5 h-3.5" />} onClick={() => navigate('/extract')}>
                Back
              </Button>
              <Button
                variant="primary"
                icon={<Eye className="w-3.5 h-3.5" />}
                onClick={() => runHarmonization(true)}
                disabled={!canRun}
                className="bg-blue-600 hover:bg-blue-700 text-white border-blue-600"
              >
                Preview Changes
              </Button>
              {previewData && (
                <Button
                  variant="warning"
                  icon={<Play className="w-3.5 h-3.5" />}
                  onClick={handleProceed}
                >
                  Proceed & Execute
                </Button>
              )}
              <div title={!result ? 'Run harmonization first before saving.' : ''}>
                <Button variant="secondary" icon={<Save className="w-3.5 h-3.5" />} onClick={saveDataToDB} disabled={!result}>Save Data</Button>
              </div>
              <div title={!state.isHarmonizedSaved ? 'You must save your data before proceeding to Step 5.' : ''}>
                <Button
                  variant="primary"
                  icon={<ArrowRight className="w-3.5 h-3.5" />}
                  onClick={() => navigate('/validate')}
                  disabled={!state.isHarmonizedSaved}
                >
                  Next: Validation
                </Button>
              </div>
            </div>
          </div>

          {/* ─── Multi-Source Data Modeling & Relational Key Join Card ─── */}
          {mode === 'multi' && (
            <Card className="mt-4 border-[var(--border)] shadow-sm">
              <CardHeader
                title="Multi-Source Data Modeling & Relational Key Join"
                subtitle="Stage multi-table files, configure primary & foreign key relationships, and harmonise"
              />
              <CardBody className="p-4 space-y-4">
                {/* Source System selector */}
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] block mb-1">
                    SOURCE SYSTEM
                  </label>
                  <select
                    value={secondarySource}
                    onChange={(e) => setSecondarySource(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-[12px] font-semibold bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:border-purple-500 cursor-pointer"
                  >
                    {SOURCE_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>

                {/* Selected Files Header & Action Buttons */}
                <div className="pt-2">
                  <div className="flex items-center justify-between pb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[11.5px] font-bold uppercase tracking-wider text-[var(--text-primary)]">
                        SELECTED FILES ({stagedFiles.length + 1})
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-900/40">
                        Multi-Table Join
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="file"
                        multiple
                        accept=".csv,.xlsx,.xls"
                        ref={multiFileInputRef}
                        className="hidden"
                        onChange={(e) => handleAddSecondaryFiles(e.target.files)}
                      />
                      <input
                        type="file"
                        accept=".csv"
                        ref={mappingFileInputRef}
                        className="hidden"
                        onChange={handleMappingFileSelected}
                      />
                      <button
                        type="button"
                        onClick={() => multiFileInputRef.current?.click()}
                        disabled={isInspectingFiles}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-white dark:bg-gray-800 border border-[var(--border)] text-[var(--text-primary)] hover:border-purple-400 hover:text-purple-600 transition-colors cursor-pointer shadow-xs"
                      >
                        <Plus className="w-3.5 h-3.5 text-purple-600" />
                        <span>{isInspectingFiles ? 'Inspecting…' : 'Add Secondary File'}</span>
                      </button>
                      {stagedFiles.length > 0 && (
                        <button
                          type="button"
                          onClick={handleResetSecondary}
                          className="px-2 py-1 rounded-md text-[11px] font-semibold text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors cursor-pointer"
                        >
                          Reset Secondary
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Staged Files List */}
                  <div className="space-y-2">
                    {/* Primary / Base Table Card */}
                    <div className="flex items-center justify-between p-3 rounded-xl border border-emerald-300 dark:border-emerald-700 bg-emerald-50/40 dark:bg-emerald-950/20">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center text-emerald-600">
                          <Database className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-[12px] font-bold text-[var(--text-primary)]">{primaryFileName}</span>
                            <span className="px-1.5 py-0.5 rounded text-[9.5px] font-extrabold bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 uppercase tracking-wider">
                              PRIMARY / BASE
                            </span>
                          </div>
                          <div className="text-[10.5px] text-[var(--text-tertiary)]">
                            {primaryRowCount} records • {primaryHeaders.length} columns (Extracted & Mapped)
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-[10.5px] font-semibold">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Step 3 Schema Linked</span>
                      </div>
                    </div>

                    {/* Secondary Staged Files Cards */}
                    {stagedFiles.map((sf) => (
                      <div
                        key={sf.filename}
                        className="flex items-center justify-between p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/60 shadow-xs hover:border-emerald-300 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/40">
                            <FileSpreadsheet className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-[13px] font-bold text-gray-900 dark:text-gray-100">{sf.filename}</div>
                            <div className="text-[11px] text-gray-400">
                              {sf.size} <span className="mx-1">•</span> <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{sf.columns_count} columns</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {/* Optional Mapping CSV Picker */}
                          {!sf.mappingFile ? (
                            <button
                              type="button"
                              onClick={() => handleOpenMappingPicker(sf.filename)}
                              className="px-2.5 py-1 rounded-md border border-dashed border-amber-400 dark:border-amber-600 bg-amber-50/40 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300 text-[10.5px] font-bold hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors flex items-center gap-1 cursor-pointer"
                            >
                              <UploadCloud className="w-3 h-3 text-amber-600" />
                              <span>+ Add Mapping CSV (Optional)</span>
                            </button>
                          ) : (
                            <div className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-purple-50 dark:bg-purple-950/30 border border-purple-300 dark:border-purple-800 text-[10.5px] font-semibold text-purple-700 dark:text-purple-300">
                              <span className="truncate max-w-[120px]">{sf.mappingFile.name}</span>
                              <button
                                onClick={() => handleRemoveMappingFile(sf.filename)}
                                className="text-purple-500 hover:text-red-500 p-0.5"
                                title="Remove mapping CSV"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          )}

                          {/* Delete Staged File */}
                          <button
                            type="button"
                            onClick={() => handleRemoveStagedFile(sf.filename)}
                            className="p-1 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors cursor-pointer"
                            title="Remove file"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ─── Key Join Configuration (Data Modeling) ─── */}
                {stagedFiles.length > 0 && (
                  <div className="pt-3 border-t border-[var(--border)] space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wider text-[var(--text-primary)]">
                        <Link2 className="w-4 h-4 text-teal-600" />
                        <span>Key Join Configuration (Data Modeling)</span>
                      </div>
                      <span className="text-[10px] font-mono text-[var(--text-tertiary)]">
                        Joining secondary tables into Base Table
                      </span>
                    </div>

                    {/* Master Base Table Designation */}
                    <div>
                      <label className="text-[9.5px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] block mb-1">
                        PRIMARY / BASE TABLE (MASTER TABLE)
                      </label>
                      <select
                        value={baseTableSelection}
                        onChange={(e) => setBaseTableSelection(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg text-[12px] font-bold bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:border-purple-500 cursor-pointer"
                      >
                        <option value={primaryFileName}>{primaryFileName} (Primary Data)</option>
                        {stagedFiles.map(f => (
                          <option key={f.filename} value={f.filename}>{f.filename}</option>
                        ))}
                      </select>
                    </div>

                    {/* Secondary Join Cards */}
                    <div className="space-y-3.5 pt-1">
                      {stagedFiles.map((sec, secIdx) => {
                        const fallbackConds = findAllMatchingKeyPairs(primaryHeaders || [], sec.headers || []);
                        const config = joinConfigs[sec.filename] || {
                          file_name: sec.filename,
                          join_with: primaryFileName,
                          key_conditions: fallbackConds.length > 0 ? fallbackConds : [{ left_key: '', right_key: '' }],
                        };

                        const keyConditions = (config.key_conditions && config.key_conditions.length > 0)
                          ? config.key_conditions
                          : (fallbackConds.length > 0 ? fallbackConds : [{ left_key: '', right_key: '' }]);

                        const parentName = config.join_with || primaryFileName;
                        const parentHeaders = (parentName === primaryFileName
                          ? primaryHeaders
                          : (stagedFiles.find(f => f.filename === parentName)?.headers || primaryHeaders)) || [];
                        const secHeaders = sec.headers || [];

                        const availableParents = Array.from(new Set([
                          primaryFileName,
                          ...stagedFiles.map(f => f.filename),
                        ])).filter(p => p && p !== sec.filename);

                        const isMapped = !!sec.mappingFile;

                        return (
                          <div
                            key={sec.filename}
                            className="p-4 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/60 shadow-xs space-y-3"
                          >
                            {/* Card Top Row */}
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <div className="flex items-center gap-2">
                                <Layers className="w-4 h-4 text-emerald-500" />
                                <span className="text-[13px] font-bold text-gray-900 dark:text-gray-100">
                                  Join: {sec.filename}
                                </span>
                                {isMapped && (
                                  <span className="px-2 py-0.5 rounded text-[9.5px] font-bold border bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800">
                                    Mapped Join
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-2.5">
                                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-800/60 text-[11px]">
                                  <span className="text-gray-400 font-mono">Join With:</span>
                                  <select
                                    value={config.join_with || primaryFileName}
                                    onChange={(e) => updateJoinParent(sec.filename, e.target.value)}
                                    className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-900 dark:text-gray-100 focus:outline-none cursor-pointer"
                                  >
                                    {availableParents.map((p) => (
                                      <option key={p} value={p}>
                                        {p === primaryFileName ? `${p} (Base)` : p}
                                      </option>
                                    ))}
                                  </select>
                                </div>

                                {keyConditions.length > 1 && (
                                  <span className="px-2 py-0.5 rounded text-[9.5px] font-mono font-bold uppercase tracking-wider bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                                    {keyConditions.length} KEY CONDITIONS
                                  </span>
                                )}

                                <span className="text-[10px] font-mono font-bold tracking-wider text-gray-400 uppercase">
                                  LEFT JOIN
                                </span>
                              </div>
                            </div>

                            {/* Condition Box */}
                            <div className="p-3.5 rounded-xl border border-gray-200 dark:border-gray-700/80 bg-gray-50/40 dark:bg-gray-800/30 space-y-3">
                              {keyConditions.map((cond, condIdx) => (
                                <React.Fragment key={condIdx}>
                                  {condIdx > 0 && (
                                    <div className="flex items-center justify-center pt-1 pb-0.5">
                                      <span className="px-2.5 py-0.5 rounded-full text-[9px] font-extrabold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 uppercase tracking-wider shadow-2xs">
                                        AND (COMPOSITE KEY)
                                      </span>
                                    </div>
                                  )}

                                  <div className="flex items-center gap-3">
                                     {/* Left Dropdown (Parent Key) */}
                                     <div className="flex-1 min-w-0 space-y-1">
                                       <label className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 block truncate">
                                         {parentName} {keyConditions.length > 1 ? `Key #${condIdx + 1}` : 'Key'}
                                       </label>
                                       <select
                                         value={cond.left_key || ''}
                                         onChange={(e) => updateKeyCondition(sec.filename, condIdx, 'left_key', e.target.value)}
                                         className="w-full px-3 py-2 rounded-lg text-[12px] font-semibold bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-emerald-500 cursor-pointer shadow-xs"
                                       >
                                         <option value="">Select {parentName} Key...</option>
                                         {parentHeaders.map((h) => (
                                           <option key={h} value={h}>{h}</option>
                                         ))}
                                       </select>
                                     </div>

                                     {/* Arrow */}
                                     <div className="shrink-0 pt-4 text-emerald-500 font-bold text-base">
                                       ➔
                                     </div>

                                     {/* Right Dropdown (Foreign Key) */}
                                     <div className="flex-1 min-w-0 space-y-1">
                                       <label className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 block truncate">
                                          {sec.filename} {keyConditions.length > 1 ? `Key #${condIdx + 1}` : 'Foreign Key'}
                                       </label>
                                       <select
                                         value={cond.right_key || ''}
                                         onChange={(e) => updateKeyCondition(sec.filename, condIdx, 'right_key', e.target.value)}
                                         className="w-full px-3 py-2 rounded-lg text-[12px] font-semibold bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-emerald-500 cursor-pointer shadow-xs"
                                       >
                                         <option value="">Select {sec.filename} Key...</option>
                                         {secHeaders.map((h) => (
                                           <option key={h} value={h}>{h}</option>
                                         ))}
                                       </select>
                                     </div>

                                     {/* Delete Condition Button / Spacer */}
                                     {keyConditions.length > 1 && condIdx > 0 ? (
                                       <div className="shrink-0 pt-4">
                                         <button
                                           type="button"
                                           onClick={() => removeCompositeKeyCondition(sec.filename, condIdx)}
                                           className="p-1.5 rounded-lg text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors cursor-pointer"
                                           title="Remove key condition"
                                         >
                                           <Trash2 className="w-4 h-4 text-red-500" />
                                         </button>
                                       </div>
                                     ) : keyConditions.length > 1 ? (
                                       <div className="shrink-0 pt-4 w-7" />
                                     ) : null}
                                   </div>
                                </React.Fragment>
                              ))}
                            </div>

                            {/* Add Composite Key Button */}
                              <div>
                                <button
                                  type="button"
                                  onClick={() => addCompositeKeyCondition(sec.filename)}
                                  className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800/80 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                                >
                                  <Plus className="w-3.5 h-3.5 text-emerald-600" />
                                  <span>Add Composite Key Condition</span>
                                </button>
                              </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Bottom Action Button */}
                    <div className="pt-2">
                      <Button
                        variant="primary"
                        size="lg"
                        icon={<Link2 className="w-4 h-4" />}
                        className="w-full justify-center py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-[13px] rounded-xl shadow-sm cursor-pointer"
                        onClick={() => runHarmonization(false)}
                      >
                        Merge & Load {stagedFiles.length + 1} Tables
                      </Button>
                    </div>
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          {/* ─── Preview Proposed Changes Card ─── */}
          {previewData && (
            <PreviewCard fixLog={previewData.fixLog} stats={previewData.stats} ruleConfig={ruleConfig} onProceed={handleProceed} />
          )}

          {/* ─── Harmonization Changes & Audit Report (SHOWN FIRST ABOVE DATA TABLES) ─── */}
          {result && <HarmonizationReportCard result={result} />}

          {/* ─── Harmonized Data Output Tables (SHOWN BELOW AUDIT REPORT) ─── */}
          {result && (() => {
            const outputRows = result.final_table || [];
            const targetCols = (result.columns && result.columns.length > 0)
              ? result.columns
              : (outputRows.length > 0 ? Object.keys(outputRows[0]) : []);

            const resultTables = (result as any)?.tables;
            const tablesSource = (resultTables && resultTables.length > 0)
              ? resultTables
              : (extractedTables.length > 0 ? extractedTables : []);

            const allTables: TableInfo[] = tablesSource.length > 0
              ? tablesSource.map((t: any) => ({
                  table_name: t.table_name,
                  columns: (t.columns && t.columns.length > 0) ? t.columns : targetCols,
                }))
              : [{ table_name: 'Harmonized Output', columns: targetCols }];

            const visibleTables = allTables.filter((t: any) => selectedOutputTables.has(t.table_name));
            const allKeyColumns = detectKeyColumns(allTables.flatMap((t: any) => t.columns));
            const filteredRows = filterRowsByKey(outputRows, outputKeyFilter, allKeyColumns);

            return (
              <div className="space-y-4">
                <TableFilterToolbar
                  tables={allTables}
                  selectedTables={selectedOutputTables}
                  onSelectedTablesChange={setSelectedOutputTables}
                  keyFilterValue={outputKeyFilter}
                  onKeyFilterChange={setOutputKeyFilter}
                  keyColumns={allKeyColumns}
                  accentColor="purple"
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
                          title={`Harmonized: ${t.table_name}`}
                          subtitle={`${tableRows.length} rows × ${tableCols.length} columns${outputKeyFilter ? ' (filtered)' : ''}`}
                        >
                          <Button
                            variant="secondary"
                            size="sm"
                            icon={<Download className="w-3 h-3" />}
                            onClick={() => dl(expCSV(tableRows), `${t.table_name.replace(/[\s/]+/g, '_').toLowerCase()}_harmonized.csv`, 'text/csv')}
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
                            accentColor="purple"
                          />
                        </CardBody>
                      </Card>
                    );
                  })
                )}
              </div>
            );
          })()}

          {!result && !previewData && (
            <Card>
              <CardBody>
                <EmptyState
                  icon={<FlaskConical className="w-10 h-10 text-purple-500" />}
                  message="Click 'Preview Changes' to inspect transformations or 'Merge & Harmonize' to execute"
                />
              </CardBody>
            </Card>
          )}
        </GridCol>

        {/* ─── Right Column: Cleansing Rules UI Redesign ─── */}
        <GridCol span={3} className="space-y-4">

          <Card className="shadow-xs border-[var(--border)]">
            <CardHeader
              title="Harmonization Rules"
              subtitle={`${enabledRuleCount}/${totalRuleCount} enabled`}
            />
            <CardBody className="p-3 space-y-2">
              {RULE_LIST.map((rule) => {
                const cfg = ruleConfig[rule.key] || { enabled: true };
                const isExpanded = expandedRuleKey === rule.key;
                const isEdited = !!cfg.custom_instruction || !!cfg.params?.target_fields || (rule.key === 'country_iso' && cfg.params?.iso_length === 3);

                return (
                  <div
                    key={rule.key}
                    className={`
                      relative rounded-xl border transition-all duration-200 overflow-hidden
                      ${!cfg.enabled
                        ? 'border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/20 opacity-50'
                        : isEdited
                          ? 'border-purple-400 dark:border-purple-600 bg-purple-50/20 dark:bg-purple-950/20 shadow-xs'
                          : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/60 hover:border-purple-300'
                      }
                    `}
                  >
                    <div className="flex items-center justify-between p-3">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <button
                          onClick={() => toggleRule(rule.key)}
                          className={`
                            w-5 h-5 rounded-md flex items-center justify-center transition-all cursor-pointer shrink-0
                            ${cfg.enabled
                              ? 'bg-purple-600 text-white shadow-xs'
                              : 'border-2 border-gray-300 dark:border-gray-600 bg-transparent'
                            }
                          `}
                        >
                          {cfg.enabled && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                        </button>

                        <span className="text-sm shrink-0">{rule.emoji}</span>

                        <div className="min-w-0 flex-1">
                          <div className={`text-[12px] font-bold leading-snug truncate ${cfg.enabled ? (isEdited ? 'text-purple-700 dark:text-purple-300' : 'text-emerald-600 dark:text-emerald-400') : 'text-[var(--text-tertiary)] line-through'}`}>
                            {rule.title}
                            {isEdited && <span className="ml-1 text-[9px] text-purple-500 font-normal">(Customized)</span>}
                          </div>
                          <div className="text-[10.5px] text-[var(--text-tertiary)] leading-tight truncate">
                            {cfg.custom_instruction ? `💬 ${cfg.custom_instruction}` : rule.sub}
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => setExpandedRuleKey(isExpanded ? null : rule.key)}
                        title={`Configure parameters for ${rule.title}`}
                        className={`p-1.5 rounded-lg transition-colors ml-2 cursor-pointer shrink-0 ${isExpanded
                            ? 'bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300'
                            : 'hover:bg-purple-100 dark:hover:bg-purple-900/40 text-gray-400 hover:text-purple-600'
                          }`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="px-3 pb-3 pt-1 border-t border-[var(--border)] bg-[var(--bg-tertiary)]/50 space-y-2 text-[11px]"
                      >
                        {rule.key === 'country_iso' && (
                          <div className="flex items-center justify-between gap-2 pt-1">
                            <span className="font-semibold text-[var(--text-secondary)]">ISO Format:</span>
                            <select
                              value={cfg.params?.iso_length ?? 2}
                              onChange={(e) => updateRuleParamInline(rule.key, 'iso_length', parseInt(e.target.value))}
                              className="px-2 py-0.5 rounded text-xs font-semibold bg-[var(--bg-primary)] border border-[var(--border)] text-[var(--text-primary)]"
                            >
                              <option value={2}>2-Letter (US, IN)</option>
                              <option value={3}>3-Letter (USA, IND)</option>
                            </select>
                          </div>
                        )}

                        {rule.key === 'whitespace_trim' && (
                          <div className="flex items-center justify-between gap-2 pt-1">
                            <span className="font-semibold text-[var(--text-secondary)]">Trim Mode:</span>
                            <select
                              value={cfg.params?.mode ?? 'both'}
                              onChange={(e) => updateRuleParamInline(rule.key, 'mode', e.target.value)}
                              className="px-2 py-0.5 rounded text-xs font-semibold bg-[var(--bg-primary)] border border-[var(--border)] text-[var(--text-primary)]"
                            >
                              <option value="both">Both Sides</option>
                              <option value="left">Left Only</option>
                              <option value="right">Right Only</option>
                            </select>
                          </div>
                        )}

                        <div>
                          <label className="text-[10px] font-bold text-purple-600 dark:text-purple-400 block mb-0.5">
                            Custom Constraint:
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. Convert to 3-letter ISO if country starts with DE"
                            value={cfg.custom_instruction || ''}
                            onChange={(e) => updateRuleInstructionInline(rule.key, e.target.value)}
                            className="w-full px-2.5 py-1 rounded text-xs bg-[var(--bg-primary)] border border-purple-300 dark:border-purple-800 text-[var(--text-primary)] focus:ring-1 focus:ring-purple-500"
                          />
                        </div>
                      </motion.div>
                    )}
                  </div>
                );
              })}
            </CardBody>
          </Card>

          {/* Dynamic AI Rules Card (Matched with Step 5 Validate) */}
          <Card className="shadow-xs border-[var(--border)]">
            <CardHeader
              title="Dynamic AI Rules"
              subtitle={`${savedDynamicRules.filter(r => selectedDynamicRules[r.id] !== false).length + customPrompts.length} active`}
              icon={<Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400" />}
            >
              <Button variant="secondary" size="sm" icon={<Save className="w-3 h-3" />} onClick={saveRulesToDB}>
                Save Rules
              </Button>
            </CardHeader>
            <CardBody className="p-3 space-y-3">
              {/* Saved Dynamic Rules */}
              {savedDynamicRules.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-3 py-1">
                    <span className="text-[11px] font-bold text-violet-700 dark:text-violet-300 uppercase tracking-wider">
                      ⚡ Saved Rules ({savedDynamicRules.length})
                    </span>
                    <button
                      onClick={handleClearAllDynamicRules}
                      className="text-[10px] text-red-500 hover:text-red-600 font-semibold cursor-pointer"
                    >
                      Clear All
                    </button>
                  </div>
                  <div className="space-y-1.5 px-1 max-h-[180px] overflow-y-auto scrollbar-thin">
                    {savedDynamicRules.map((r: any) => (
                      <div key={r.id} className="flex items-start gap-2 p-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)]/40">
                        <input
                          type="checkbox"
                          checked={selectedDynamicRules[r.id] !== false}
                          onChange={() => toggleSelectDynamicRule(r.id)}
                          className="w-4 h-4 mt-0.5 cursor-pointer accent-violet-600 shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <div className={`font-bold text-[10.5px] ${selectedDynamicRules[r.id] !== false ? 'text-violet-600 dark:text-violet-400' : 'text-[var(--text-tertiary)] line-through'}`}>
                            {r.label || r.title || r.id}
                          </div>
                          {r.description && (
                            <div className="text-[var(--text-secondary)] text-[10px] mt-0.5">{r.description}</div>
                          )}
                        </div>
                        <button
                          onClick={() => deleteDynamicRule(r.id)}
                          className="text-[var(--text-tertiary)] hover:text-red-500 p-1 rounded hover:bg-red-500/10 transition-colors cursor-pointer shrink-0"
                          title="Delete rule"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Divider */}
              {(savedDynamicRules.length > 0 || customPrompts.length > 0) && (
                <div className="h-px bg-[var(--border)]" />
              )}

              {/* Add New Custom Prompt Section */}
              <div className="space-y-2">
                <div className="text-[11px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider px-1">
                  Add Custom Rule
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={newPromptInput}
                    onChange={(e) => setNewPromptInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddPrompt()}
                    placeholder="e.g. Convert currency USD to EUR for Plant 2000..."
                    className="flex-1 px-2.5 py-1.5 rounded-lg text-[11px] bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-violet-500 focus:border-violet-400 transition-all font-mono"
                  />
                  <Button variant="secondary" size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={handleAddPrompt}>
                    Add
                  </Button>
                </div>
              </div>

              {/* List of Custom Prompts */}
              {customPrompts.length > 0 && (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center gap-2 px-1">
                    <span className="text-[11px] font-bold text-purple-700 dark:text-purple-300 uppercase tracking-wider">
                      ✨ Custom Prompts ({customPrompts.length})
                    </span>
                  </div>
                  <div className="space-y-1.5 max-h-[200px] overflow-y-auto scrollbar-thin">
                    {customPrompts.map((p, idx) => (
                      <div key={idx} className="flex items-start gap-2 p-2.5 rounded-lg border border-purple-200 dark:border-purple-900/40 bg-purple-50/40 dark:bg-purple-950/20">
                        {editingIndex === idx ? (
                          <div className="flex items-center gap-1.5 w-full">
                            <span className="text-purple-600 font-bold shrink-0 text-[10px]">#{idx + 1}</span>
                            <input
                              type="text"
                              value={editingText}
                              onChange={(e) => setEditingText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveEdit(idx);
                                if (e.key === 'Escape') handleCancelEdit();
                              }}
                              className="flex-1 px-2 py-1 text-[10px] rounded bg-[var(--bg-primary)] border border-purple-400 text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-purple-500 font-medium"
                              autoFocus
                            />
                            <button
                              onClick={() => handleSaveEdit(idx)}
                              className="p-1 rounded text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 cursor-pointer shrink-0 transition-colors"
                              title="Save"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={handleCancelEdit}
                              className="p-1 rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] cursor-pointer shrink-0 transition-colors"
                              title="Cancel"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <div className="flex gap-1.5 items-start flex-1 min-w-0">
                              <span className="text-purple-600 dark:text-purple-400 font-bold shrink-0 text-[10px]">✨</span>
                              <span className="text-[var(--text-primary)] font-medium text-[10px] leading-snug break-words">#{idx + 1}. {p}</span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={() => handleStartEdit(idx)}
                                className="text-[var(--text-tertiary)] hover:text-purple-500 p-1 rounded hover:bg-purple-500/10 transition-colors cursor-pointer"
                                title="Edit"
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => handleDeletePrompt(idx)}
                                className="text-[var(--text-tertiary)] hover:text-red-500 p-1 rounded hover:bg-red-500/10 transition-colors cursor-pointer"
                                title="Delete prompt"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardBody>
          </Card>
        </GridCol>

      </PageGrid>
    </PageLayout>
  );
}
