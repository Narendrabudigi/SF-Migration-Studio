import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Search, ChevronDown, ChevronUp, Check, X, Layers, CheckCheck, Hash, Plus, CornerDownLeft } from 'lucide-react';

/* ─── Key Column Detection ─── */
const KEY_PATTERNS = [
  'KUNNR', 'LIFNR', 'MATNR', 'PARTNER', 'CUSTOMER_NUMBER', 'VENDOR_NUMBER',
  'MATERIAL_NUMBER', 'ACCOUNT', 'PARTY_NUMBER', 'BP_NUMBER', 'BUSINESS_PARTNER',
  'ID', 'CODE', 'NUMBER', 'NAME', 'NAME1', 'CITY', 'COUNTRY', 'LAND1'
];

export function isKeyColumn(colName: string): boolean {
  const upper = colName.toUpperCase().replace(/[.\s]/g, '_');
  if (KEY_PATTERNS.some(k => upper.includes(k))) return true;
  if (upper.endsWith('_ID') || upper.endsWith('_NUM') || upper.endsWith('_NO') || upper.endsWith('_CODE')) return true;
  return false;
}

export function detectKeyColumns(columns: string[]): string[] {
  const detected = columns.filter(isKeyColumn);
  return detected.length > 0 ? detected : columns.slice(0, 4);
}

/* ─── Types ─── */
export interface TableInfo {
  table_name: string;
  columns: string[];
  row_count?: number;
}

interface TableFilterToolbarProps {
  tables: TableInfo[];
  selectedTables: Set<string>;
  onSelectedTablesChange: (selected: Set<string>) => void;
  keyFilterValue: string;
  onKeyFilterChange: (value: string) => void;
  /** Optional: key columns across all tables */
  keyColumns?: string[];
  accentColor?: 'indigo' | 'purple' | 'violet' | 'teal' | 'cyan';
}

/* ─── Helper: Get all unique key columns from tables ─── */
function getAllKeyColumns(tables: TableInfo[]): string[] {
  const keys = new Set<string>();
  tables.forEach(t => {
    t.columns.forEach(c => {
      if (isKeyColumn(c)) keys.add(c);
    });
  });
  return Array.from(keys);
}

/* ─── Multi-Row ID / Key Filtering Engine (Supports Multiple IDs with OR matching) ─── */
export function filterRowsByKey(
  rows: Record<string, any>[],
  keyFilterValue: string,
  keyColumns: string[] = []
): Record<string, any>[] {
  if (!keyFilterValue || !keyFilterValue.trim()) return rows;

  // Split input into individual tokens (supports space, comma, semicolon, newline separated IDs)
  const tokens = keyFilterValue
    .trim()
    .toLowerCase()
    .split(/[\s,;]+/)
    .filter(Boolean);

  if (tokens.length === 0) return rows;

  return rows.filter(row => {
    // If ANY of the search tokens matches ANY key/column in this row, include it (OR condition)
    return tokens.some(token => {
      // 1. Check in key columns
      if (keyColumns && keyColumns.length > 0) {
        const inKeyCol = keyColumns.some(kc => {
          const val = String(row[kc] ?? '').toLowerCase();
          if (val.includes(token)) return true;
          const base = kc.split('.').pop() || kc;
          const valBase = String(row[base] ?? '').toLowerCase();
          return valBase.includes(token);
        });
        if (inKeyCol) return true;
      }

      // 2. Check in all key-like columns
      const inAnyKey = Object.entries(row).some(([k, v]) => {
        if (isKeyColumn(k)) {
          return String(v ?? '').toLowerCase().includes(token);
        }
        return false;
      });
      if (inAnyKey) return true;

      // 3. Fallback: check across all fields in the row
      return Object.values(row).some(v => {
        if (typeof v === 'string' || typeof v === 'number') {
          return String(v).toLowerCase().includes(token);
        }
        return false;
      });
    });
  });
}

/**
 * For a given table definition t (from extractedTables), and data rows (from extract, harmonize, or cleanse),
 * resolve the columns to display and map the row data so every column value is correctly populated.
 */
export function getTableDisplayData(
  table: TableInfo,
  rows: Record<string, any>[],
  mappings: any[] = []
): { columns: string[]; rows: Record<string, any>[] } {
  if (!rows || rows.length === 0) {
    return { columns: table.columns, rows: [] };
  }

  const sampleRow = rows[0] || {};
  const rowKeys = Object.keys(sampleRow);
  const rowKeysLower = new Map<string, string>();
  rowKeys.forEach(k => rowKeysLower.set(k.toLowerCase(), k));

  // Build mapping lookup:
  // src (clean/base/full) -> sap (clean/base/full)
  // sap (clean/base/full) -> src (clean/base/full)
  const srcToSapMap = new Map<string, string[]>();
  const sapToSrcMap = new Map<string, string[]>();

  (mappings || []).forEach(m => {
    const srcStr = typeof m === 'object' ? String(m.src || '') : '';
    const sapStr = typeof m === 'object' ? String(m.sap || '') : '';
    const srcClean = srcStr.replace(/^\[\d+\]\s*/, '').trim();
    const srcBase = srcClean.split('.').pop() || '';
    const sapClean = sapStr.replace(/^\[\d+\]\s*/, '').trim();
    const sapBase = sapClean.split('.').pop() || '';

    const sapCandidates = [sapBase, sapClean, sapStr].filter(Boolean);
    const srcCandidates = [srcBase, srcClean, srcStr].filter(Boolean);

    [srcClean.toLowerCase(), srcBase.toLowerCase(), srcStr.toLowerCase()].forEach(k => {
      if (k) srcToSapMap.set(k, sapCandidates);
    });

    [sapClean.toLowerCase(), sapBase.toLowerCase(), sapStr.toLowerCase()].forEach(k => {
      if (k) sapToSrcMap.set(k, srcCandidates);
    });
  });

  // For each column defined in table.columns, determine displayCol and actualKey
  const columnBindings: { displayCol: string; actualKey: string }[] = [];

  table.columns.forEach(col => {
    const colClean = col.replace(/^\[\d+\]\s*/, '').trim();
    const colBase = colClean.split('.').pop() || '';
    const colLower = col.toLowerCase();
    const colCleanLower = colClean.toLowerCase();
    const colBaseLower = colBase.toLowerCase();

    // 1. Direct match in rowKeys
    if (sampleRow[col] !== undefined) {
      columnBindings.push({ displayCol: col, actualKey: col });
      return;
    }
    if (sampleRow[colClean] !== undefined) {
      columnBindings.push({ displayCol: colClean, actualKey: colClean });
      return;
    }
    if (sampleRow[colBase] !== undefined) {
      columnBindings.push({ displayCol: colBase, actualKey: colBase });
      return;
    }
    if (rowKeysLower.has(colLower)) {
      const actual = rowKeysLower.get(colLower)!;
      columnBindings.push({ displayCol: actual, actualKey: actual });
      return;
    }
    if (rowKeysLower.has(colBaseLower)) {
      const actual = rowKeysLower.get(colBaseLower)!;
      columnBindings.push({ displayCol: actual, actualKey: actual });
      return;
    }

    // 2. Check if col is a src field, and row has the mapped sap field (e.g. CUSTOMER_NUMBER -> KUNNR)
    const sapCandidates = srcToSapMap.get(colLower) || srcToSapMap.get(colCleanLower) || srcToSapMap.get(colBaseLower) || [];
    for (const sapCand of sapCandidates) {
      if (sampleRow[sapCand] !== undefined) {
        columnBindings.push({ displayCol: sapCand, actualKey: sapCand });
        return;
      }
      const sapCandLower = sapCand.toLowerCase();
      if (rowKeysLower.has(sapCandLower)) {
        const actual = rowKeysLower.get(sapCandLower)!;
        columnBindings.push({ displayCol: actual, actualKey: actual });
        return;
      }
    }

    // 3. Check if col is a sap field, and row has the mapped src field (e.g. KUNNR -> CUSTOMER_NUMBER)
    const srcCandidates = sapToSrcMap.get(colLower) || sapToSrcMap.get(colCleanLower) || sapToSrcMap.get(colBaseLower) || [];
    for (const srcCand of srcCandidates) {
      if (sampleRow[srcCand] !== undefined) {
        columnBindings.push({ displayCol: srcCand, actualKey: srcCand });
        return;
      }
      const srcCandLower = srcCand.toLowerCase();
      if (rowKeysLower.has(srcCandLower)) {
        const actual = rowKeysLower.get(srcCandLower)!;
        columnBindings.push({ displayCol: actual, actualKey: actual });
        return;
      }
    }

    // Fallback: keep col
    columnBindings.push({ displayCol: col, actualKey: col });
  });

  // If table had NO matching columns at all in rowKeys, fallback to all rowKeys
  const matchedCount = columnBindings.filter(b => sampleRow[b.actualKey] !== undefined).length;
  if (matchedCount === 0 && rowKeys.length > 0) {
    return {
      columns: rowKeys,
      rows: rows
    };
  }

  const finalColumns = columnBindings.map(b => b.displayCol);

  // Normalize rows so row[displayCol] = row[actualKey]
  const normalizedRows = rows.map(r => {
    const projected: Record<string, any> = {};
    columnBindings.forEach(b => {
      projected[b.displayCol] = r[b.actualKey] !== undefined ? r[b.actualKey] : (r[b.displayCol] ?? '');
    });
    if (r.SOURCE !== undefined && projected.SOURCE === undefined) {
      projected.SOURCE = r.SOURCE;
    }
    return projected;
  });

  return {
    columns: finalColumns,
    rows: normalizedRows
  };
}

/* ─── Multi-Tag Row ID Filter Toolbar Component ─── */
export function TableFilterToolbar({
  tables,
  selectedTables,
  onSelectedTablesChange,
  keyFilterValue,
  onKeyFilterChange,
  keyColumns: keyColumnsProp,
  accentColor = 'indigo',
}: TableFilterToolbarProps) {
  const [isTableDropdownOpen, setIsTableDropdownOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const allSelected = tables.length > 0 && selectedTables.size === tables.length;
  const noneSelected = selectedTables.size === 0;

  // Extract committed tags from keyFilterValue
  const committedTags = useMemo(() => {
    if (!keyFilterValue || !keyFilterValue.trim()) return [];
    return keyFilterValue.trim().split(/[\s,;]+/).filter(Boolean);
  }, [keyFilterValue]);

  // Sync internal input when parent clears filter
  useEffect(() => {
    if (!keyFilterValue) {
      setInputValue('');
    }
  }, [keyFilterValue]);

  const toggleTable = (tableName: string) => {
    const next = new Set(selectedTables);
    if (next.has(tableName)) {
      next.delete(tableName);
    } else {
      next.add(tableName);
    }
    onSelectedTablesChange(next);
  };

  const toggleAllTables = () => {
    if (allSelected) {
      onSelectedTablesChange(new Set());
    } else {
      onSelectedTablesChange(new Set(tables.map(t => t.table_name)));
    }
  };

  // Add new tag(s)
  const addTag = (textToAdd: string) => {
    const newItems = textToAdd
      .trim()
      .split(/[\s,;]+/)
      .map(s => s.trim())
      .filter(Boolean);

    if (newItems.length === 0) return;

    const existingSet = new Set(committedTags.map(t => t.toLowerCase()));
    const combined = [...committedTags];

    newItems.forEach(item => {
      if (!existingSet.has(item.toLowerCase())) {
        existingSet.add(item.toLowerCase());
        combined.push(item);
      }
    });

    onKeyFilterChange(combined.join(' '));
    setInputValue('');
  };

  // Remove a specific tag
  const removeTag = (tagToRemove: string) => {
    const next = committedTags.filter(t => t.toLowerCase() !== tagToRemove.toLowerCase());
    onKeyFilterChange(next.join(' '));
  };

  // Clear all tags
  const clearAll = () => {
    setInputValue('');
    onKeyFilterChange('');
    if (inputRef.current) inputRef.current.focus();
  };

  // Handle keyboard events in input
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (inputValue.trim()) {
        addTag(inputValue);
      }
    } else if (e.key === 'Backspace' && !inputValue && committedTags.length > 0) {
      // Remove last tag when backspacing on empty input
      e.preventDefault();
      removeTag(committedTags[committedTags.length - 1]);
    }
  };

  // Handle paste with multiple IDs
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text');
    if (pasted && /[\s,;\n]/.test(pasted.trim())) {
      e.preventDefault();
      addTag(pasted);
    }
  };

  // Color themes
  const colorTheme = {
    indigo: {
      activeBadge: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30',
      activeBtn: 'bg-indigo-600 text-white border-indigo-600 shadow-indigo-600/20',
      focusBorder: 'focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/20',
      tag: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30',
    },
    purple: {
      activeBadge: 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30',
      activeBtn: 'bg-purple-600 text-white border-purple-600 shadow-purple-600/20',
      focusBorder: 'focus-within:border-purple-500 focus-within:ring-2 focus-within:ring-purple-500/20',
      tag: 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30',
    },
    violet: {
      activeBadge: 'bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30',
      activeBtn: 'bg-violet-600 text-white border-violet-600 shadow-violet-600/20',
      focusBorder: 'focus-within:border-violet-500 focus-within:ring-2 focus-within:ring-violet-500/20',
      tag: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30',
    },
    teal: {
      activeBadge: 'bg-teal-500/15 text-teal-600 dark:text-teal-400 border-teal-500/30',
      activeBtn: 'bg-teal-600 text-white border-teal-600 shadow-teal-600/20',
      focusBorder: 'focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500/20',
      tag: 'bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/30',
    },
    cyan: {
      activeBadge: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/30',
      activeBtn: 'bg-cyan-600 text-white border-cyan-600 shadow-cyan-600/20',
      focusBorder: 'focus-within:border-cyan-500 focus-within:ring-2 focus-within:ring-cyan-500/20',
      tag: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30',
    },
  }[accentColor] || {
    activeBadge: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30',
    activeBtn: 'bg-indigo-600 text-white border-indigo-600 shadow-indigo-600/20',
    focusBorder: 'focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/20',
    tag: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30',
  };

  return (
    <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-3.5 shadow-sm space-y-2.5">
      
      {/* Main Controls Row */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        
        {/* Left: Table Selector */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <button
              onClick={() => setIsTableDropdownOpen(!isTableDropdownOpen)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-[11.5px] font-bold bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 hover:border-indigo-500/60 transition-all cursor-pointer shadow-xs"
            >
              <Layers className="w-3.5 h-3.5 text-indigo-500" />
              <span>Tables Selected</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-extrabold border ${colorTheme.activeBadge}`}>
                {selectedTables.size} / {tables.length}
              </span>
              {isTableDropdownOpen
                ? <ChevronUp className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400 ml-0.5" />
                : <ChevronDown className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400 ml-0.5" />
              }
            </button>

            {/* Table Dropdown Popover (Solid White Background, No Blur) */}
            {isTableDropdownOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setIsTableDropdownOpen(false)} />
                <div className="absolute left-0 top-full mt-2 z-50 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl p-2.5 min-w-[300px] max-h-[380px] overflow-y-auto space-y-1">
                  
                  {/* Select / Deselect All Bar */}
                  <div className="flex items-center justify-between pb-2 mb-1 border-b border-gray-100 dark:border-gray-800 px-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                      SF Target Tables ({tables.length})
                    </span>
                    <button
                      onClick={toggleAllTables}
                      className="text-[10.5px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <CheckCheck className="w-3.5 h-3.5" />
                      {allSelected ? 'Deselect All' : 'Select All'}
                    </button>
                  </div>

                  {/* Table Checkbox Items */}
                  {tables.map(t => {
                    const checked = selectedTables.has(t.table_name);
                    return (
                      <button
                        key={t.table_name}
                        onClick={() => toggleTable(t.table_name)}
                        className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[11.5px] transition-all cursor-pointer text-left ${
                          checked
                            ? 'bg-indigo-50 dark:bg-indigo-950/40 text-gray-900 dark:text-gray-100 border border-indigo-200 dark:border-indigo-800'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-800/60 text-gray-700 dark:text-gray-300 border border-transparent'
                        }`}
                      >
                        <div className={`w-4 h-4 rounded-md flex items-center justify-center shrink-0 transition-all ${
                          checked
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : 'border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800'
                        }`}>
                          {checked && <Check className="w-3 h-3 stroke-[3]" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-gray-900 dark:text-gray-100 truncate">{t.table_name}</div>
                          <div className="text-[9.5px] text-gray-500 dark:text-gray-400 font-mono">
                            {t.columns.length} columns {t.row_count ? `· ${t.row_count} rows` : ''}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right: Multi-Row ID / Key Search Filter Box (Expanded & Enlarged) */}
        <div className="flex items-center gap-2 flex-1 min-w-[280px] sm:min-w-[380px] lg:max-w-2xl justify-end">
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              placeholder={committedTags.length === 0 ? "Type row ID and press Enter (e.g. 0001, 0002, C001)…" : `Type another ID + Enter (currently ${committedTags.length} active)…`}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              className={`w-full pl-10 pr-20 py-2.5 rounded-xl text-[13px] font-medium bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] ${colorTheme.focusBorder} font-mono placeholder:font-sans placeholder:text-[12px] shadow-xs hover:border-indigo-400 transition-all`}
            />

            {/* Inline Add button when user types */}
            {inputValue.trim() ? (
              <button
                type="button"
                onClick={() => addTag(inputValue)}
                className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-600 text-white shadow-xs hover:bg-emerald-700 transition-colors cursor-pointer"
                title="Add ID Filter (or press Enter)"
              >
                <Plus className="w-3 h-3" />
                <span>Add</span>
              </button>
            ) : committedTags.length > 0 ? (
              <button
                type="button"
                onClick={clearAll}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-red-500 cursor-pointer transition-colors"
                title="Clear all filters"
              >
                <X className="w-4 h-4" />
              </button>
            ) : null}
          </div>
        </div>

      </div>

      {/* Row ID Status & Active Filter Badges Bar (Shown Below Search Box) */}
      {committedTags.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-[var(--border)]/60 text-[11px]">
          <span className="text-[10.5px] font-mono font-bold uppercase tracking-wider text-[var(--text-tertiary)] flex items-center gap-1">
            <Hash className="w-3.5 h-3.5 text-emerald-500" />
            FILTERING ROWS ({committedTags.length} {committedTags.length === 1 ? 'ID' : 'IDs'}):
          </span>
          {committedTags.map((token) => (
            <span
              key={token}
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-mono font-bold border ${colorTheme.tag} shadow-xs animate-in fade-in zoom-in-95 duration-150`}
            >
              <span>{token}</span>
              <button
                type="button"
                onClick={() => removeTag(token)}
                className="hover:text-red-500 cursor-pointer ml-0.5"
                title={`Remove ${token}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={clearAll}
            className="text-[10.5px] font-bold text-red-500 hover:underline cursor-pointer ml-auto"
          >
            Clear All
          </button>
        </div>
      )}

    </div>
  );
}
