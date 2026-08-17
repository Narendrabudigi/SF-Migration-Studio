import React, { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { CheckCircle, XCircle, Info, X } from 'lucide-react';

interface Toast {
  id: number;
  msg: string;
  type: 'ok' | 'err' | 'info';
}

const ToastContext = createContext<{
  toast: (msg: string, type?: 'ok' | 'err' | 'info', dur?: number) => void;
} | null>(null);

let toastId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((msg: string, type: 'ok' | 'err' | 'info' = 'info', dur = 3500) => {
    const id = ++toastId;
    setToasts((p) => [...p, { id, msg, type }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), dur);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((p) => p.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2.5">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`
              animate-toast-in flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium
              shadow-lg backdrop-blur-sm max-w-[380px] border
              ${t.type === 'ok'
                ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800/40 text-emerald-700 dark:text-emerald-300'
                : t.type === 'err'
                  ? 'bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-800/40 text-red-700 dark:text-red-300'
                  : 'bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800/40 text-blue-700 dark:text-blue-300'
              }
            `}
          >
            {t.type === 'ok' ? <CheckCircle className="w-4 h-4 shrink-0" /> :
             t.type === 'err' ? <XCircle className="w-4 h-4 shrink-0" /> :
             <Info className="w-4 h-4 shrink-0" />}
            <span className="flex-1">{t.msg}</span>
            <button onClick={() => dismiss(t.id)} className="shrink-0 opacity-60 hover:opacity-100 transition-opacity">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
