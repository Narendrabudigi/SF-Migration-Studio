import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '@/components/ui/toast';
import { useLoading } from '@/components/ui/loading-overlay';
import { dl, expCSV } from '@/lib/utils';
import {
  PageLayout, PageGrid, GridCol, Card, CardHeader, CardBody, Button,
  StatBox, StatsGrid, DataTable, PageHeader, EmptyState
} from '@/components/shared';
import {
  FlaskConical, Upload, FileSpreadsheet, MapPin, Download,
  Play, Trash2, CheckCircle2, AlertCircle, FileText, ArrowLeft, ArrowRight, Save, Database, Plus, Sparkles, Eye, Zap, X, Check, Pencil, ChevronDown, ChevronUp
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useMigration } from '@/store/migration-store';
import { TableFilterToolbar, filterRowsByKey, detectKeyColumns, getTableDisplayData } from '@/components/shared/TableFilterToolbar';
import type { TableInfo } from '@/components/shared/TableFilterToolbar';
import { TablePaginationFooter } from '@/components/shared/TablePaginationFooter';

/* ─── Types ─── */
interface DroppedFile {
  file: File;
  name: string;
  size: string;
  rows?: number;
}

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
}

interface AdditionalSource {
  source: string;
  file: DroppedFile | null;
  mappingFile: DroppedFile | null;
}

interface RuleItemConfig {
  enabled: boolean;
  custom_instruction?: string;
  params?: Record<string, any>;
}

/* ─── Drop Zone Component ─── */
function DropZone({
  id,
  label,
  subtitle,
  icon: Icon,
  accept,
  file,
  onDrop,
  onClear,
  disabled = false,
  accentColor = 'primary',
}: {
  id: string;
  label: string;
  subtitle: string;
  icon: React.ElementType;
  accept: string;
  file: DroppedFile | null;
  onDrop: (f: File) => void;
  onClear: () => void;
  disabled?: boolean;
  accentColor?: string;
}) {
  const [isDragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    if (e.type === 'dragenter' || e.type === 'dragover') setDragOver(true);
    else if (e.type === 'dragleave') setDragOver(false);
  }, [disabled]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (disabled) return;
    const files = e.dataTransfer.files;
    if (files?.[0]) onDrop(files[0]);
  }, [disabled, onDrop]);

  const handleClick = () => {
    if (!disabled && inputRef.current) inputRef.current.click();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) onDrop(e.target.files[0]);
  };

  const colorMap: Record<string, { border: string; bg: string; text: string; glow: string }> = {
    primary: {
      border: 'border-primary-400 dark:border-primary-500',
      bg: 'bg-primary-50/50 dark:bg-primary-900/20',
      text: 'text-primary-600 dark:text-primary-400',
      glow: 'shadow-[0_0_20px_rgba(37,99,235,0.15)]',
    },
    teal: {
      border: 'border-teal-400 dark:border-teal-500',
      bg: 'bg-teal-50/50 dark:bg-teal-900/20',
      text: 'text-teal-600 dark:text-teal-400',
      glow: 'shadow-[0_0_20px_rgba(20,184,166,0.15)]',
    },
    violet: {
      border: 'border-violet-400 dark:border-violet-500',
      bg: 'bg-violet-50/50 dark:bg-violet-900/20',
      text: 'text-violet-600 dark:text-violet-400',
      glow: 'shadow-[0_0_20px_rgba(124,58,237,0.15)]',
    },
    amber: {
      border: 'border-amber-400 dark:border-amber-500',
      bg: 'bg-amber-50/50 dark:bg-amber-900/20',
      text: 'text-amber-600 dark:text-amber-400',
      glow: 'shadow-[0_0_20px_rgba(245,158,11,0.15)]',
    },
  };
  const colors = colorMap[accentColor] || colorMap.primary;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div
        id={id}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={handleClick}
        className={`
          relative rounded-xl border-2 border-dashed p-5 transition-all duration-300 cursor-pointer
          ${disabled
            ? 'opacity-40 pointer-events-none border-[var(--border)] bg-[var(--bg-tertiary)]/30'
            : file
              ? `border-emerald-400 dark:border-emerald-500 bg-emerald-50/30 dark:bg-emerald-900/10`
              : isDragOver
                ? `${colors.border} ${colors.bg} ${colors.glow} scale-[1.01]`
                : 'border-[var(--border)] bg-[var(--bg-tertiary)]/30 hover:border-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)]/60'
          }
        `}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={handleChange}
          className="hidden"
        />

        <AnimatePresence mode="wait">
          {file ? (
            <motion.div
              key="file-info"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex items-center gap-3"
            >
              <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-[var(--text-primary)] truncate">
                  {file.name}
                </div>
                <div className="text-[10px] text-[var(--text-tertiary)]">
                  {file.size}{file.rows ? ` · ${file.rows} rows` : ''}
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onClear(); }}
                className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-[var(--text-tertiary)] hover:text-red-500 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-2 text-center"
            >
              <div className={`w-10 h-10 rounded-lg bg-[var(--bg-tertiary)] flex items-center justify-center ${isDragOver ? colors.text : 'text-[var(--text-tertiary)]'}`}>
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <div className={`text-[12px] font-semibold ${isDragOver ? colors.text : 'text-[var(--text-secondary)]'}`}>
                  {label}
                </div>
                <div className="text-[10px] text-[var(--text-tertiary)] mt-0.5">{subtitle}</div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}


/* ─── Source Options ─── */
const SOURCE_OPTIONS = [
  { value: 'EXCEL_CSV', label: 'Excel / CSV File' },
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

/* ─── Rule Definitions (Matched to Screenshot UI Layout) ─── */
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

/* ─── Harmonization Report Card ─── */
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
      title: 'Dynamic AI & Fallback Rules',
      icon: '⚡',
      items: fixLog.filter((l) => l.includes('[DynamicAI]')),
    },
  ];

  const totalFixEvents = fixLog.filter(
    (l) => l.startsWith('[') && !l.includes('[Init]') && !l.includes('[ColumnNaming]') && !l.includes('[Mapping]') && !l.includes('[Merge]')
  ).length;

  return (
    <Card className="mt-4 border-purple-200 dark:border-purple-900/40 bg-gradient-to-br from-[var(--bg-primary)] via-[var(--bg-secondary)] to-purple-50/20 dark:to-purple-950/10 shadow-sm">
      <CardHeader
        title="Harmonization Changes & Audit Report"
        subtitle="Summary of standardized fields, rule fixes and source origins"
      />
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
              <span className="text-xl font-extrabold text-[var(--text-primary)]">{stats.columns || 0}</span>
              <span className="text-[10px] text-[var(--text-tertiary)]">total fields</span>
            </div>
          </div>

          <div className="p-3 rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)]/50">
            <div className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider">Standardization Fixes</div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-xl font-extrabold text-purple-600 dark:text-purple-400">{totalFixEvents}</span>
              <span className="text-[10px] text-[var(--text-tertiary)]">field fixes</span>
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
    // 1. Check if explicit detail line: [Tag::Detail] Row X...
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

    // 2. Check if standard log line [Tag] ...
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

    // 3. Check if line starts with "Row X ..." (individual row log without explicit summary header)
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

    // 4. Standard summary log line
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
  // Filter out logs for disabled rules optimistically
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
            const isDynamic = grp.summary.includes('[DynamicAI]');
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
                {/* Summary Header Line */}
                <div className="flex items-center justify-between px-3 py-1.5 text-[11px] font-mono">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="truncate">{grp.summary}</span>
                  </div>

                  {/* Dropdown Button for Details */}
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

                {/* Collapsible Row Details List */}
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

  // State
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
  const [secondarySource, setSecondarySource] = useState('');

  // Files for Multi-Source
  const [secondaryFile, setSecondaryFile] = useState<DroppedFile | null>(null);
  const [secondaryMappingFile, setSecondaryMappingFile] = useState<DroppedFile | null>(null);

  // Additional Sources (N-source)
  const [additionalSources, setAdditionalSources] = useState<AdditionalSource[]>([]);

  // Results & Preview
  const result: HarmonizationResult | null = state.harmonizationResult;
  const setResult = (val: any) => dispatch({ type: 'SET_FIELD', field: 'harmonizationResult', value: val });
  const [previewData, setPreviewData] = useState<{ fixLog: string[]; stats: any } | null>(null);

  // Table filter & pagination state for output display
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

  // Editable Rule Config (Inline box per rule)
  const [ruleConfig, setRuleConfig] = useState<Record<string, RuleItemConfig>>({ ...DEFAULT_RULE_CONFIG });
  const [expandedRuleKey, setExpandedRuleKey] = useState<string | null>(null);

  // Dynamic AI Rules
  const [customPrompts, setCustomPrompts] = useState<string[]>([]);
  const [newPromptInput, setNewPromptInput] = useState('');

  const enabledRuleCount = RULE_LIST.filter(r => (ruleConfig[r.key] !== undefined ? ruleConfig[r.key].enabled : true)).length;
  const totalRuleCount = RULE_LIST.length;

  const handleAddPrompt = () => {
    if (!newPromptInput.trim()) return;
    setCustomPrompts([...customPrompts, newPromptInput.trim()]);
    setNewPromptInput('');
  };

  const handleRemovePrompt = (index: number) => {
    setCustomPrompts(customPrompts.filter((_, i) => i !== index));
  };

  const toggleRule = (key: string) => {
    setRuleConfig(prev => ({
      ...prev,
      [key]: { ...prev[key], enabled: !prev[key]?.enabled }
    }));
  };

  const updateRuleParamInline = (key: string, paramKey: string, val: any) => {
    setRuleConfig(prev => ({
      ...prev,
      [key]: {
        ...prev[key],
        params: { ...(prev[key]?.params || {}), [paramKey]: val }
      }
    }));
  };

  const updateRuleInstructionInline = (key: string, instruction: string) => {
    setRuleConfig(prev => ({
      ...prev,
      [key]: {
        ...prev[key],
        custom_instruction: instruction || undefined
      }
    }));
  };

  const addAdditionalSource = () => {
    setAdditionalSources(prev => [...prev, { source: '', file: null, mappingFile: null }]);
  };

  const removeAdditionalSource = (idx: number) => {
    setAdditionalSources(prev => prev.filter((_, i) => i !== idx));
  };

  const updateAdditionalSource = (idx: number, updates: Partial<AdditionalSource>) => {
    setAdditionalSources(prev => prev.map((s, i) => i === idx ? { ...s, ...updates } : s));
  };

  const saveDataToDB = async () => {
    if (!state.projectId) {
      toast('No project ID found. Please create a project first.', 'err');
      return;
    }
    if (!result?.final_table) return;

    showLoad('Saving data...', 'Persisting harmonized records to database');
    try {
      const currentTables = extractedTables.length > 0 ? extractedTables : (state.extractedTables || []);
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/harmonize/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: state.projectId,
          target_object: state.obj,
          payload: result.final_table,
          tables: currentTables
        })
      });

      if (!res.ok) throw new Error('Failed to save data');

      hideLoad();
      dispatch({ type: 'SET_FIELD', field: 'extractedTables', value: currentTables });
      dispatch({ type: 'SET_FIELD', field: 'isHarmonizedSaved', value: true });
      toast('Harmonized data saved to database successfully!', 'ok');
    } catch (err: any) {
      hideLoad();
      toast(err.message || 'Failed to save data', 'err');
    }
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleFileDrop = (
    setter: React.Dispatch<React.SetStateAction<DroppedFile | null>>
  ) => async (file: File) => {
    const dropped: DroppedFile = {
      file,
      name: file.name,
      size: formatSize(file.size),
    };

    if (file.name.endsWith('.csv')) {
      try {
        const text = await file.text();
        const lines = text.split('\n').filter(l => l.trim());
        dropped.rows = Math.max(0, lines.length - 1);
      } catch { /* ignore */ }
    }

    setter(dropped);
  };

  const canRun = mode === 'flow'
    ? true
    : !!(secondarySource && secondaryFile && secondaryMappingFile);

  async function runHarmonization(isPreview: boolean = true, silent: boolean = false) {
    if (!canRun) return;
    dispatch({ type: 'SET_FIELD', field: 'isHarmonizedSaved', value: false });

    if (!silent) {
      const loadMsg = isPreview ? 'Generating Preview…' : 'Running Harmonization Agent…';
      showLoad(loadMsg, `Processing your data through rules${customPrompts.length > 0 ? ` + ${customPrompts.length} AI rules` : ''}`, [
        'Reading files from Database or Uploads…',
        'Applying field mappings…',
        'Applying Cleansing & Harmonization Rules…',
        'Checking fallback LLM constraints if needed…',
        'Generating audit report & results…',
      ]);
      [0, 1, 2, 3, 4, 5, 6, 7].forEach(i => setTimeout(() => tick(i), 300 + i * 300));
    }

    try {
      let res;
      if (mode === 'flow') {
        if (!state.projectId) {
          throw new Error("No Project ID found. Please extract and save data in Step 3 first.");
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
            custom_prompts: customPrompts.length > 0 ? customPrompts : null,
          })
        });
      } else {
        // Multi mode
        if (!state.projectId) {
          // If multi mode with standalone uploads
          const formData = new FormData();
          formData.append('mode', 'multi');
          formData.append('sap_object', sapObject);
          formData.append('company_code', companyCode);
          formData.append('sales_org', salesOrg);
          formData.append('purch_org', purchOrg);
          formData.append('plant', plant);
          formData.append('dist_channel', distChannel);
          formData.append('division', division);
          formData.append('currency', currency);
          formData.append('primary_source', primarySource);
          formData.append('secondary_source', secondarySource);
          formData.append('secondary_file', secondaryFile!.file);
          if (secondaryMappingFile) formData.append('secondary_mapping_file', secondaryMappingFile.file);
          formData.append('preview', isPreview ? 'true' : 'false');
          formData.append('rule_config_json', JSON.stringify(ruleConfig));
          if (customPrompts.length > 0) formData.append('custom_prompts_json', JSON.stringify(customPrompts));

          res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/harmonize`, { method: 'POST', body: formData });
        } else {
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
          formData.append('secondary_file', secondaryFile!.file);
          formData.append('secondary_mapping_file', secondaryMappingFile!.file);
          formData.append('preview', isPreview ? 'true' : 'false');
          formData.append('rule_config_json', JSON.stringify(ruleConfig));
          if (customPrompts.length > 0) formData.append('custom_prompts_json', JSON.stringify(customPrompts));

          res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/harmonize/multi-flow`, { method: 'POST', body: formData });
        }
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
            toast(`Preview ready: ${data.fix_log.length} log entries generated`, 'ok');
          } else {
            setPreviewData(null);
            setResult(data);
            if (data.tables && data.tables.length > 0 && (!state.extractedTables || state.extractedTables.length === 0)) {
              dispatch({ type: 'SET_FIELD', field: 'extractedTables', value: data.tables });
            }
            toast(
              `Harmonized: ${data.stats.total_output} rows from ${data.stats.total_input} input rows`,
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

  // Auto-refresh preview in background when ruleConfig or customPrompts changes
  const isFirstRender = useRef(true);
  React.useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (previewData) {
      const timer = setTimeout(() => {
        runHarmonization(true, true);
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [ruleConfig, customPrompts]);

  function handleProceed() {
    setPreviewData(null);
    runHarmonization(false);
  }

  function downloadResult() {
    if (!result?.session_id) return;
    window.open(`${import.meta.env.VITE_BACKEND_URL}/api/sap/harmonize/download/${result.session_id}`, '_blank');
  }

  return (
    <PageLayout>
      <PageGrid>

        {/* ─── Main Column: Drop Zones + Results ─── */}
        <GridCol span={9}>
          <div className="space-y-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">Step 4 — Harmonization Agent</h1>
              <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">Upload files, configure rules, and test the harmonization pipeline</p>
            </div>

            {/* Two mode options: Flow & Multi */}
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
              <div title={!result ? "Run harmonization first before saving." : ""}>
                <Button variant="secondary" icon={<Save className="w-3.5 h-3.5" />} onClick={saveDataToDB} disabled={!result}>Save Data</Button>
              </div>
              <div title={!state.isHarmonizedSaved ? "You must save your data before proceeding to Step 5." : ""}>
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

          {mode === 'multi' && (
            <Card>
              <CardHeader
                title="Multi-Source Harmonization"
                subtitle="Primary data from database + secondary/additional data uploaded"
              />
              <CardBody className="p-4 space-y-4">
                {/* Primary data from DB indicator */}
                <div className="px-3 py-2.5 rounded-xl border border-emerald-300 dark:border-emerald-600 bg-emerald-50/50 dark:bg-emerald-900/20">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                      <Database className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div>
                      <div className="text-[11.5px] font-semibold text-emerald-700 dark:text-emerald-300">Primary Data: From Database ({state.src || 'SAP_ECC'})</div>
                      <div className="text-[10px] text-emerald-600/70 dark:text-emerald-400/70">
                        Using extracted data & mappings from Step 3 {state.extracted.length > 0 ? `(${state.extracted.length} rows)` : ''}
                      </div>
                    </div>
                    {state.isDataSaved && <CheckCircle2 className="w-4 h-4 text-emerald-500 ml-auto" />}
                  </div>
                </div>

                {/* Secondary Data Source Selector */}
                <div className="px-3 py-2.5 rounded-xl border border-teal-300 dark:border-teal-600 bg-teal-50/40 dark:bg-teal-900/15">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[11.5px] font-semibold text-teal-800 dark:text-teal-300">Secondary Data Source System</div>
                      <div className="text-[10px] text-teal-600/80 dark:text-teal-400/80">Select system origin for secondary file</div>
                    </div>
                    <select
                      value={secondarySource}
                      onChange={(e) => setSecondarySource(e.target.value)}
                      className="px-3 py-1.5 rounded-lg text-[11.5px] font-bold bg-[var(--bg-primary)] border border-teal-400 dark:border-teal-500 text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-teal-500 cursor-pointer shadow-sm"
                    >
                      <option value="">— Select Source —</option>
                      {SOURCE_OPTIONS.map((s) => (
                        <option key={s.value} value={s.value}>{s.label} ({s.value})</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Secondary file uploads — only visible when source selected */}
                {secondarySource && (
                  <div className="grid grid-cols-2 gap-3">
                    <DropZone
                      id="drop-secondary"
                      label="Secondary Data File"
                      subtitle="Drag & drop CSV or Excel"
                      icon={FileSpreadsheet}
                      accept=".csv,.xlsx,.xls"
                      file={secondaryFile}
                      onDrop={handleFileDrop(setSecondaryFile)}
                      onClear={() => setSecondaryFile(null)}
                      accentColor="teal"
                    />

                    <DropZone
                      id="drop-secondary-mapping"
                      label="Secondary Mapping CSV"
                      subtitle="Columns: src, sap, transform, confidence"
                      icon={MapPin}
                      accept=".csv"
                      file={secondaryMappingFile}
                      onDrop={handleFileDrop(setSecondaryMappingFile)}
                      onClear={() => setSecondaryMappingFile(null)}
                      accentColor="amber"
                    />
                  </div>
                )}

                {/* Additional Sources */}
                {additionalSources.map((extra, idx) => (
                  <div key={idx} className="space-y-2">
                    <div className="flex items-center justify-between px-3 py-2 rounded-xl border border-purple-300 dark:border-purple-600 bg-purple-50/40 dark:bg-purple-900/15">
                      <div className="flex items-center gap-3 flex-1">
                        <div>
                          <div className="text-[11.5px] font-semibold text-purple-800 dark:text-purple-300">Additional Source #{idx + 1}</div>
                        </div>
                        <select
                          value={extra.source}
                          onChange={(e) => updateAdditionalSource(idx, { source: e.target.value })}
                          className="px-3 py-1.5 rounded-lg text-[11.5px] font-bold bg-[var(--bg-primary)] border border-purple-400 dark:border-purple-500 text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-purple-500 cursor-pointer shadow-sm"
                        >
                          <option value="">— Select Source —</option>
                          {SOURCE_OPTIONS.map((s) => (
                            <option key={s.value} value={s.value}>{s.label} ({s.value})</option>
                          ))}
                        </select>
                      </div>
                      <button onClick={() => removeAdditionalSource(idx)} className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-[var(--text-tertiary)] hover:text-red-500 transition-colors ml-2 cursor-pointer">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    {extra.source && (
                      <div className="grid grid-cols-2 gap-3 pl-3">
                        <DropZone
                          id={`drop-extra-${idx}`}
                          label={`Source #${idx + 1} Data File`}
                          subtitle="Drag & drop CSV or Excel"
                          icon={FileSpreadsheet}
                          accept=".csv,.xlsx,.xls"
                          file={extra.file}
                          onDrop={(f) => {
                            const dropped: DroppedFile = { file: f, name: f.name, size: formatSize(f.size) };
                            updateAdditionalSource(idx, { file: dropped });
                          }}
                          onClear={() => updateAdditionalSource(idx, { file: null })}
                          accentColor="violet"
                        />
                        <DropZone
                          id={`drop-extra-mapping-${idx}`}
                          label={`Source #${idx + 1} Mapping CSV`}
                          subtitle="Columns: src, sap, transform, confidence"
                          icon={MapPin}
                          accept=".csv"
                          file={extra.mappingFile}
                          onDrop={(f) => {
                            const dropped: DroppedFile = { file: f, name: f.name, size: formatSize(f.size) };
                            updateAdditionalSource(idx, { mappingFile: dropped });
                          }}
                          onClear={() => updateAdditionalSource(idx, { mappingFile: null })}
                          accentColor="amber"
                        />
                      </div>
                    )}
                  </div>
                ))}

                {/* Add Source Button */}
                <button
                  onClick={addAdditionalSource}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border-2 border-dashed border-[var(--border)] hover:border-purple-400 text-[11.5px] font-semibold text-[var(--text-tertiary)] hover:text-purple-600 transition-all cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  Add Another Source
                </button>
              </CardBody>
            </Card>
          )}

          {/* Preview Card */}
          {previewData && (
            <PreviewCard fixLog={previewData.fixLog} stats={previewData.stats} ruleConfig={ruleConfig} onProceed={handleProceed} />
          )}

          {/* Results Table — Multi-Table Display */}
          {result && (() => {
            const outputRows = result.final_table || [];
            const targetCols = (result.columns && result.columns.length > 0)
              ? result.columns
              : (outputRows.length > 0 ? Object.keys(outputRows[0]) : []);

            const allTables: TableInfo[] = extractedTables.length > 0
              ? extractedTables.map((t: any) => ({
                  table_name: t.table_name,
                  columns: targetCols.length > 0 ? targetCols : t.columns
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

          {/* Harmonization Changes & Audit Report */}
          {result && <HarmonizationReportCard result={result} />}

          {!result && !previewData && (
            <Card>
              <CardBody>
                <EmptyState
                  icon={<FlaskConical className="w-10 h-10 text-purple-500" />}
                  message="Click 'Preview Changes' to see what harmonization will do, then 'Proceed' to execute"
                />
              </CardBody>
            </Card>
          )}
        </GridCol>

        {/* ─── Right Column: Cleansing Rules UI Redesign (Inline Parameter Box) ─── */}
        <GridCol span={3} className="space-y-4">

          {/* Harmonization Rules Card (Redesigned with Inline Parameter Boxes — No Popups!) */}
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
                    {/* Main Rule Header Line */}
                    <div className="flex items-center justify-between p-3">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {/* Purple Square Checkbox */}
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

                        {/* Title & Subtitle */}
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

                      {/* Far Right: Edit Pencil Icon to toggle inline box */}
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

                    {/* Inline Parameter Box (No popups!) */}
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="px-3 pb-3 pt-1 border-t border-[var(--border)] bg-[var(--bg-tertiary)]/50 space-y-2 text-[11px]"
                      >
                        {/* Specific parameters */}
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

                        {/* Custom Instruction Box */}
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

          {/* Dynamic AI Harmonization Rules Card */}
          <Card className="border-purple-200 dark:border-purple-900/50 bg-gradient-to-br from-[var(--bg-primary)] to-purple-50/20 dark:to-purple-950/10">
            <CardHeader
              title="Dynamic AI Rules"
              subtitle="Custom harmonization transforms"
              icon={<Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400" />}
            />
            <CardBody className="p-3 space-y-3">
              {/* Input & Add Prompt */}
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={newPromptInput}
                  onChange={(e) => setNewPromptInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddPrompt()}
                  placeholder="e.g. Convert all names to uppercase"
                  className="flex-1 px-2.5 py-1.5 rounded-lg text-[11px] bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
                <Button variant="secondary" size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={handleAddPrompt}>
                  Add
                </Button>
              </div>

              {/* List of Custom Prompts */}
              {customPrompts.length > 0 ? (
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider">
                    <span>Transform Rules ({customPrompts.length})</span>
                    <span className="text-[9.5px] text-purple-600 dark:text-purple-400 font-semibold normal-case">
                      ⚡ 1 LLM Call
                    </span>
                  </div>
                  <div className="space-y-1.5 max-h-[220px] overflow-y-auto scrollbar-thin">
                    {customPrompts.map((p, idx) => (
                      <div key={idx} className="flex items-start justify-between p-2 rounded-lg bg-[var(--bg-tertiary)]/70 text-[10.5px] border border-[var(--border)] gap-1.5">
                        <div className="flex gap-1.5">
                          <span className="text-purple-600 font-bold shrink-0">⚡</span>
                          <span className="text-[var(--text-primary)] font-medium leading-tight">#{idx + 1}. {p}</span>
                        </div>
                        <button onClick={() => handleRemovePrompt(idx)} className="text-[var(--text-tertiary)] hover:text-red-500 p-0.5 cursor-pointer shrink-0">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-[10px] text-[var(--text-tertiary)] italic px-1 py-1">
                  No custom AI rules added yet. Add prompts above to create LLM-generated transform functions.
                </div>
              )}
            </CardBody>
          </Card>
        </GridCol>

      </PageGrid>
    </PageLayout>
  );
}
