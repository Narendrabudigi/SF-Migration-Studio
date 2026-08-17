import React, { useState, useCallback, type ReactNode, createContext, useContext } from 'react';

interface LoadingStep {
  label: string;
  done: boolean;
  result?: string;
}

interface LoadingState {
  visible: boolean;
  title: string;
  sub: string;
  steps: LoadingStep[];
}

const LoadingContext = createContext<{
  showLoad: (title: string, sub: string, steps?: string[]) => void;
  tick: (index: number, msg?: string) => void;
  hideLoad: () => void;
  loading: LoadingState;
} | null>(null);

export function LoadingProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState<LoadingState>({
    visible: false,
    title: '',
    sub: '',
    steps: [],
  });

  const showLoad = useCallback((title: string, sub: string, steps: string[] = []) => {
    setLoading({
      visible: true,
      title,
      sub,
      steps: steps.map((s) => ({ label: s, done: false })),
    });
  }, []);

  const tick = useCallback((index: number, msg?: string) => {
    setLoading((prev) => ({
      ...prev,
      steps: prev.steps.map((s, i) =>
        i === index ? { ...s, done: true, result: msg } : s
      ),
    }));
  }, []);

  const hideLoad = useCallback(() => {
    setLoading((prev) => ({ ...prev, visible: false }));
  }, []);

  return (
    <LoadingContext.Provider value={{ showLoad, tick, hideLoad, loading }}>
      {children}
      {loading.visible && (
        <div className="fixed inset-0 z-[9000] flex flex-col items-center justify-center gap-6 backdrop-blur-md bg-[var(--overlay)]">
          {/* Spinner */}
          <div className="w-12 h-12 rounded-full border-[3px] border-[var(--border)] border-t-[var(--color-primary-500)] border-r-[var(--color-teal)] animate-spin-slow" />
          <div className="text-center">
            <div className="text-base font-bold text-[var(--text-primary)]">{loading.title}</div>
            {loading.sub && (
              <div className="font-mono text-xs text-[var(--text-tertiary)] mt-1">{loading.sub}</div>
            )}
          </div>
          {loading.steps.length > 0 && (
            <div className="flex flex-col gap-2 min-w-[320px]">
              {loading.steps.map((step, i) => (
                <div
                  key={i}
                  className={`
                    flex items-center gap-2.5 font-mono text-[11px] transition-all duration-300
                    ${step.done ? 'text-[var(--color-success)]' : 'text-[var(--text-tertiary)]'}
                  `}
                  style={{
                    animation: `slideIn 0.4s ease-out ${i * 0.3}s both`,
                  }}
                >
                  <span className="text-sm">{step.done ? '✓' : '○'}</span>
                  {step.result || step.label}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </LoadingContext.Provider>
  );
}

export function useLoading() {
  const ctx = useContext(LoadingContext);
  if (!ctx) throw new Error('useLoading must be used within LoadingProvider');
  return ctx;
}
