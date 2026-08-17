import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function esc(s: unknown): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function expCSV(data: Record<string, any>[]): string {
  if (!data.length) return '';
  const c = Object.keys(data[0]);
  return [
    c.join(','),
    ...data.map((r) =>
      c
        .map((k) => {
          const v = String(r[k] || '');
          return v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : '' + v;
        })
        .join(',')
    ),
  ].join('\n');
}

export function dl(content: string, name: string, type: string) {
  const b = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
