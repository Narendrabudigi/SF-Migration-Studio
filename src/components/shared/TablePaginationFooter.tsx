import React from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

export interface TablePaginationFooterProps {
  currentPage: number;
  totalRows: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
  isFiltered?: boolean;
  accentColor?: 'indigo' | 'purple' | 'violet' | 'teal' | 'cyan';
}

export function TablePaginationFooter({
  currentPage,
  totalRows,
  pageSize = 15,
  onPageChange,
  isFiltered = false,
  accentColor = 'violet',
}: TablePaginationFooterProps) {
  if (totalRows === 0) return null;

  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const page = Math.min(Math.max(1, currentPage), totalPages);

  const startRow = (page - 1) * pageSize + 1;
  const endRow = Math.min(page * pageSize, totalRows);

  const activeBadgeColor = {
    indigo: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/30',
    purple: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30',
    violet: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/30',
    teal: 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/30',
    cyan: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/30',
  }[accentColor] || 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/30';

  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-t border-[var(--border)] bg-[var(--bg-tertiary)]/40 text-[11.5px] select-none flex-wrap gap-2">
      {/* Left: Row Range Indicator */}
      <div className="flex items-center gap-1.5 text-[var(--text-secondary)] font-medium">
        <span>
          Showing <strong className="text-[var(--text-primary)] font-mono">{startRow}–{endRow}</strong> of{' '}
          <strong className="text-[var(--text-primary)] font-mono">{totalRows}</strong> rows
        </span>
        {isFiltered && (
          <span className="px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
            Filtered
          </span>
        )}
      </div>

      {/* Right: Pagination Controls */}
      <div className="flex items-center gap-1.5 ml-auto">
        {/* First Page */}
        <button
          onClick={() => onPageChange(1)}
          disabled={page === 1}
          title="First Page"
          className="p-1 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all"
        >
          <ChevronsLeft className="w-3.5 h-3.5" />
        </button>

        {/* Previous Page */}
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page === 1}
          title="Previous Page"
          className="p-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all flex items-center gap-1 font-semibold text-[11px]"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Prev</span>
        </button>

        {/* Page Badge */}
        <span className={`px-2.5 py-1 rounded-lg font-mono font-extrabold text-[11px] border ${activeBadgeColor}`}>
          Page {page} of {totalPages}
        </span>

        {/* Next Page */}
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page === totalPages}
          title="Next Page"
          className="p-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all flex items-center gap-1 font-semibold text-[11px]"
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>

        {/* Last Page */}
        <button
          onClick={() => onPageChange(totalPages)}
          disabled={page === totalPages}
          title="Last Page"
          className="p-1 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all"
        >
          <ChevronsRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
