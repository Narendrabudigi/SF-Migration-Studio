import React, { type ReactNode, useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { ChevronDown, Check } from 'lucide-react';

/* ── Card ── */
interface CardProps {
  children: ReactNode;
  className?: string;
}
export function Card({ children, className }: CardProps) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'bg-[var(--bg-secondary)] border border-[var(--border)] shadow-[var(--shadow-sm)] rounded-xl overflow-hidden',
        className
      )}
    >
      {children}
    </motion.section>
  );
}

interface CardHeaderProps {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  children?: ReactNode;
}
export function CardHeader({ icon, title, subtitle, children }: CardHeaderProps) {
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--border)] px-5 py-3.5">
      {icon && (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]">
          {icon}
        </span>
      )}
      <div className="flex-1 min-w-0">
        <h2 className="truncate text-[13px] font-semibold tracking-tight text-[var(--text-primary)]">{title}</h2>
        {subtitle && <p className="truncate text-xs text-[var(--text-tertiary)] mt-0.5">{subtitle}</p>}
      </div>
      {children && <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('p-5', className)}>{children}</div>;
}

/* ── Stat Box ── */
interface StatBoxProps {
  value: string | number;
  label: string;
  subtitle?: string;
  color?: string;
}
export function StatBox({ value, label, subtitle, color = 'var(--color-primary-500)' }: StatBoxProps) {
  return (
    <div className="glass-panel rounded-2xl p-5 relative overflow-hidden group">
      <div className="absolute inset-0 bg-gradient-to-br from-primary-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="relative z-10">
        <div className="font-mono text-3xl font-black tracking-tight mb-1" style={{ color }}>{value}</div>
        <div className="text-[13px] font-bold text-[var(--text-secondary)]">{label}</div>
        {subtitle && <div className="text-[11px] text-[var(--text-tertiary)] mt-1">{subtitle}</div>}
      </div>
    </div>
  );
}

export function StatsGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{children}</div>;
}

/* ── Badge ── */
type BadgeVariant = 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'teal' | 'cyan' | 'neutral';
const badgeStyles: Record<BadgeVariant, string> = {
  blue: 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800/40',
  green: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/40',
  amber: 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800/40',
  red: 'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800/40',
  violet: 'bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400 border-violet-200 dark:border-violet-800/40',
  teal: 'bg-teal-50 dark:bg-teal-950/40 text-teal-600 dark:text-teal-400 border-teal-200 dark:border-teal-800/40',
  cyan: 'bg-cyan-50 dark:bg-cyan-950/40 text-cyan-600 dark:text-cyan-400 border-cyan-200 dark:border-cyan-800/40',
  neutral: 'bg-gray-50 dark:bg-gray-950/40 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-800/40',
};

export function Badge({ children, variant = 'blue', className }: { children: ReactNode; variant?: BadgeVariant; className?: string }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-mono text-[10px] font-semibold border whitespace-nowrap',
      badgeStyles[variant],
      className
    )}>
      {children}
    </span>
  );
}

/* ── Button ── */
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'success' | 'warning' | 'danger' | 'cyan';
const btnStyles: Record<BtnVariant, string> = {
  primary: 'bg-primary-600 hover:bg-primary-700 text-white shadow-sm border border-transparent active:scale-95',
  secondary: 'bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] hover:border-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] active:scale-95 shadow-sm',
  ghost: 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] active:scale-95',
  success: 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm border border-transparent active:scale-95',
  warning: 'bg-amber-500 hover:bg-amber-600 text-white shadow-sm border border-transparent active:scale-95',
  danger: 'bg-red-600 hover:bg-red-700 text-white shadow-sm border border-transparent active:scale-95',
  cyan: 'bg-cyan-600 hover:bg-cyan-700 text-white shadow-sm border border-transparent active:scale-95',
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: 'sm' | 'md';
  icon?: ReactNode;
}
export function Button({ variant = 'primary', size = 'md', icon, children, className, disabled, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-1.5 font-medium rounded-md transition-all duration-150 whitespace-nowrap cursor-pointer select-none active:scale-[0.98]',
        size === 'sm' ? 'px-3 py-1.5 text-[12px]' : 'px-4 py-2 text-[13px]',
        btnStyles[variant],
        disabled && 'opacity-40 cursor-not-allowed pointer-events-none',
        className
      )}
      disabled={disabled}
      {...(props as any)}
    >
      {icon}
      {children}
    </button>
  );
}

/* ── InfoBox ── */
type InfoVariant = 'info' | 'warning' | 'success' | 'error';
const infoStyles: Record<InfoVariant, string> = {
  info: 'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800/30 text-blue-800 dark:text-blue-300',
  warning: 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/30 text-amber-800 dark:text-amber-300',
  success: 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/30 text-emerald-800 dark:text-emerald-300',
  error: 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800/30 text-red-800 dark:text-red-300',
};

export function InfoBox({ variant = 'info', children, className }: { variant?: InfoVariant; children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-xl border p-3.5 text-[12px] leading-relaxed', infoStyles[variant], className)}>
      {children}
    </div>
  );
}

/* ── EmptyState ── */
export function EmptyState({ icon, message }: { icon: ReactNode; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="text-4xl mb-3 opacity-40">{icon}</div>
      <div className="text-[13px] text-[var(--text-tertiary)]">{message}</div>
    </div>
  );
}

/* ── AI Response ── */
export function AIResponse({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)] p-4 font-mono text-[11.5px] leading-[1.8] text-[var(--text-secondary)] whitespace-pre-wrap">
      {children}
    </div>
  );
}

/* ── CodeBlock ── */
export function CodeBlock({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn(
      'rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4 font-mono text-[10.5px] leading-[1.8] text-[var(--text-secondary)] overflow-x-auto',
      className
    )}>
      {children}
    </div>
  );
}

/* ── DataTable ── */
export function DataTable({ rows, cols }: { rows: Record<string, unknown>[]; cols: string[] }) {
  if (!rows?.length) return <div className="py-6 text-center text-[var(--text-tertiary)] text-sm">No data</div>;
  const c = cols.length ? cols : Object.keys(rows[0] || {});
  return (
    <div className="rounded-xl border border-[var(--border)] overflow-auto max-h-[420px]">
      <table className="w-full border-collapse text-[12px] whitespace-nowrap">
        <thead>
          <tr>
            {c.map((col) => (
              <th
                key={col}
                className="px-3.5 py-2.5 text-left font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] bg-[var(--bg-tertiary)] border-b border-[var(--border)] sticky top-0 z-10"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="group hover:bg-[var(--bg-tertiary)]/50 transition-colors">
              {c.map((col) => {
                const v = row[col] !== undefined ? String(row[col]) : '';
                const empty = !v.trim();
                return (
                  <td
                    key={col}
                    className={cn(
                      'px-3.5 py-2 font-mono text-[11px] border-b border-[var(--border-light)]',
                      empty ? 'text-red-400 dark:text-red-500 italic' : 'text-[var(--text-secondary)]'
                    )}
                  >
                    {empty ? '(empty)' : v}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Page Layout Helpers ── */
export function PageLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 w-full max-w-[1600px] mx-auto space-y-6">
      {children}
    </div>
  );
}

export function PageGrid({ children }: { children: ReactNode }) {
  return <div className="flex flex-col xl:flex-row gap-5 items-start">{children}</div>;
}

export function GridCol({ span = 12, className, children }: { span?: number, className?: string, children: ReactNode }) {
  // Use fixed widths for sidebars (span 3) and fluid width for main content (span 6, 8, 9)
  const spanClass =
    span === 3 ? 'w-full xl:w-[270px] xl:shrink-0' :
      span === 4 ? 'w-full xl:w-[320px] xl:shrink-0' :
        (span === 6 || span === 8 || span === 9) ? 'w-full flex-1 min-w-0' :
          'w-full';

  return <div className={cn(spanClass, className, "space-y-5")}>{children}</div>;
}

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">{subtitle}</p>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/* ── Divider ── */
export function Divider() {
  return <hr className="border-0 border-t border-[var(--border)] my-2.5" />;
}

/* ── SidebarItem ── */
export function SidebarItem({
  active,
  onClick,
  icon,
  title,
  subtitle,
  layoutIdGroup,
}: {
  active?: boolean;
  onClick?: () => void;
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  layoutIdGroup?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-all duration-150 cursor-pointer relative group border border-transparent outline-none focus:outline-none focus-visible:ring-0',
        active
          ? 'text-primary-800 dark:text-primary-300'
          : 'hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
      )}
    >
      {active && (
        <motion.div
          layoutId={layoutIdGroup ? `active-sidebar-${layoutIdGroup}` : undefined}
          className="apple-glass-pill"
          transition={{ type: "spring", damping: 18, stiffness: 250, mass: 0.8, bounce: 0.4 }}
        />
      )}
      {icon && <span className={cn("text-xl shrink-0 transition-transform duration-200 relative z-10", active && "scale-110")}>{icon}</span>}
      <div className="min-w-0 flex-1 relative z-10">
        <div className="text-[13px] font-bold truncate">{title}</div>
        {subtitle && <div className={cn("font-mono text-[10px] truncate mt-0.5 transition-colors", active ? "text-primary-600 dark:text-primary-400" : "text-[var(--text-tertiary)]")}>{subtitle}</div>}
      </div>
    </button>
  );
}

/* ── PipelineStep ── */
export function PipelineStep({ icon, title, subtitle, done }: { icon: ReactNode; title: string; subtitle: string; done?: boolean }) {
  return (
    <div className={cn(
      'flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-all',
      done
        ? 'border-teal-200 dark:border-teal-800/30 bg-teal-50/50 dark:bg-teal-950/20'
        : 'border-[var(--border)] bg-[var(--bg-tertiary)]/50'
    )}>
      <div className={cn(
        'w-7 h-7 rounded-lg flex items-center justify-center text-sm shrink-0',
        done ? 'bg-teal-100 dark:bg-teal-900/40' : 'bg-[var(--bg-tertiary)]'
      )}>
        {done ? <span className="text-teal-600 dark:text-teal-400">✓</span> : icon}
      </div>
      <div>
        <div className="text-[11.5px] font-semibold text-[var(--text-primary)]">{title}</div>
        <div className={cn(
          'font-mono text-[9.5px]',
          done ? 'text-teal-600 dark:text-teal-400' : 'text-[var(--text-tertiary)]'
        )}>{subtitle}</div>
      </div>
    </div>
  );
}

/* ── Custom Select ── */
export function Select({
  value,
  onChange,
  options,
  className,
  size = 'md',
  searchable = false,
  disabled = false,
}: {
  value: string;
  onChange: (val: string) => void;
  options: { value: string; label: string }[];
  className?: string;
  size?: 'sm' | 'md';
  searchable?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find((o) => o.value === value) || options[0];

  return (
    <div ref={ref} className={cn('relative w-full', className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className={cn(
          "w-full flex items-center justify-between border border-[var(--border)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] outline-none focus:border-primary-500 transition-colors shadow-sm",
          size === 'sm' ? "px-2 py-1 rounded-md text-[10.5px]" : "px-3 py-2 rounded-lg text-[12.5px]",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <span className="truncate pr-2">{selectedOption?.label || value}</span>
        <ChevronDown className={cn("shrink-0 text-[var(--text-tertiary)] transition-transform duration-200", open && "rotate-180", size === 'sm' ? "w-3 h-3" : "w-3.5 h-3.5")} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 w-full mt-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] shadow-lg overflow-hidden py-1 backdrop-blur-xl"
          >
            {searchable && (
              <div className="px-2 py-1.5 border-b border-[var(--border)]">
                <input
                  type="text"
                  autoFocus
                  placeholder="Search..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-light)] rounded px-2 py-1 text-[11px] outline-none focus:border-primary-500"
                />
              </div>
            )}
            <div className="max-h-60 overflow-y-auto">
              {options.filter(o => o.label.toLowerCase().includes(search.toLowerCase())).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                    setSearch('');
                  }}
                  className={cn(
                    "w-full flex items-center justify-between text-left transition-colors cursor-pointer",
                    size === 'sm' ? "px-2.5 py-1.5 text-[10.5px]" : "px-3 py-2 text-[12px]",
                    value === opt.value
                      ? "bg-primary-500/10 text-primary-600 dark:text-primary-400 font-medium"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                  )}
                >
                  <span className="truncate">{opt.label}</span>
                  {value === opt.value && <Check className={size === 'sm' ? "w-3 h-3" : "w-3.5 h-3.5"} />}
                </button>
              ))}
              {options.filter(o => o.label.toLowerCase().includes(search.toLowerCase())).length === 0 && (
                <div className="px-3 py-2 text-center text-[11px] text-[var(--text-tertiary)]">No results</div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Confirm Modal ── */
interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isDestructive?: boolean;
}
export function ConfirmModal({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  isDestructive = false
}: ConfirmModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={onCancel}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: 'spring', duration: 0.4, bounce: 0.15 }}
            className="relative w-full max-w-md overflow-hidden rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] shadow-2xl"
          >
            <div className="p-5">
              <h3 className="text-[15px] font-semibold text-[var(--text-primary)] mb-2">{title}</h3>
              <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">{message}</p>
            </div>
            <div className="flex justify-end gap-2 p-4 bg-[var(--bg-tertiary)] border-t border-[var(--border)]">
              <Button variant="secondary" onClick={onCancel}>{cancelText}</Button>
              <Button variant={isDestructive ? 'danger' : 'primary'} onClick={() => {
                onConfirm();
              }}>
                {confirmText}
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
