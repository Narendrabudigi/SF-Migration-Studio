import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useMigration } from '@/store/migration-store';
import { cn } from '@/lib/utils';
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { STEPS } from '@/config/steps';

interface StepNavigationProps {
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export function StepNavigation({ mobileOpen = false, onCloseMobile }: StepNavigationProps = {}) {
  const { state } = useMigration();
  const location = useLocation();
  const navigate = useNavigate();

  const currentStepIndex = STEPS.findIndex(s => s.path === location.pathname);
  const activeStep = currentStepIndex === -1 ? 0 : currentStepIndex;
  const progress = (activeStep / 8) * 100;

  const [isCollapsed, setIsCollapsed] = useState(false);

  // Close mobile drawer whenever route changes
  useEffect(() => {
    onCloseMobile?.();
  }, [location.pathname]);

  return (
    <>
      {/* Desktop Sidebar (hidden on mobile, flex on lg+) */}
      <aside className={cn(
        "h-full hidden lg:flex flex-col bg-[var(--bg-secondary)] border-r border-[var(--border)] relative z-20 shadow-sm transition-all duration-300",
        isCollapsed ? "w-20" : "w-64"
      )}>
        {/* Logo Area */}
        <div className="h-16 flex items-center px-6 gap-3 border-b border-[var(--border)] overflow-hidden shrink-0">
          <div className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center shadow-sm overflow-hidden bg-white">
            <img src="/Yash.png" alt="Yash Logo" className="w-full h-full object-contain" />
          </div>
          {!isCollapsed && (
            <div className="leading-tight whitespace-nowrap opacity-100 transition-opacity duration-300">
              <div className="text-sm font-black tracking-tight text-[var(--text-primary)]">
                Migration Studio
              </div>
            </div>
          )}
        </div>

        {/* Steps List */}
        <div className="flex-1 overflow-y-auto px-3 py-6 space-y-1.5 scrollbar-none">
          {!isCollapsed && (
            <div className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest px-3 mb-4 whitespace-nowrap">
              Pipeline Steps
            </div>
          )}

          {STEPS.map((step, i) => {
            const Icon = step.icon;
            const isActive = activeStep === i;
            const isDone = activeStep > i;

            return (
              <button
                key={i}
                onClick={() => navigate(step.path)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors duration-200 group relative cursor-pointer',
                  isActive && 'text-primary-800 dark:text-primary-300 font-bold',
                  isDone && 'text-teal-600 dark:text-teal-400 font-semibold hover:bg-[var(--bg-tertiary)]',
                  !isActive && !isDone && 'text-[var(--text-secondary)] font-medium hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                )}
              >
                {isActive && (
                  <motion.div
                    layoutId="active-nav-pill"
                    className="apple-glass-pill"
                    transition={{ type: "spring", damping: 18, stiffness: 250, mass: 0.8, bounce: 0.4 }}
                  >
                    <div className="absolute left-0 top-1.5 bottom-1.5 w-1.5 bg-primary-600 rounded-r-full shadow-[0_0_8px_rgba(37,99,235,0.6)] z-10" />
                  </motion.div>
                )}

                <div
                  className={cn(
                    'relative z-10 w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors shadow-sm',
                    isActive ? 'bg-primary-600 text-white' :
                      isDone ? 'bg-teal-50 dark:bg-teal-900/40 text-teal-600 dark:text-teal-400 border border-teal-200 dark:border-teal-800/50' :
                        'bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] border border-[var(--border)] group-hover:text-[var(--text-secondary)]'
                  )}
                >
                  {isDone ? <Check className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
                </div>
                {!isCollapsed && <span className="relative z-10 text-[13px] whitespace-nowrap">{step.label}</span>}
              </button>
            );
          })}
        </div>

        {/* Bottom Progress */}
        {!isCollapsed && (
          <div className="p-5 border-t border-[var(--border)] bg-[var(--bg-tertiary)]/30 shrink-0">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold text-[var(--text-secondary)]">Progress</span>
              <span className="text-[11px] font-mono text-primary-600 dark:text-primary-400 font-bold">{Math.round(progress)}%</span>
            </div>
            <div className="h-1.5 w-full bg-[var(--border)] rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-primary-600 to-teal-500 rounded-full"
                initial={false}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
          </div>
        )}

        {/* Collapse Toggle */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="absolute -right-3 top-20 w-6 h-6 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-full flex items-center justify-center shadow-md text-[var(--text-secondary)] hover:text-primary-500 transition-colors z-30 cursor-pointer"
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
        </button>
      </aside>

      {/* Mobile Drawer Slide-Over (only on mobile screens < lg) */}
      <AnimatePresence>
        {mobileOpen && (
          <div className="fixed inset-0 z-[100] lg:hidden">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={onCloseMobile}
              className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[100]"
            />

            {/* Sidebar Drawer */}
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed inset-y-0 left-0 z-[101] w-72 max-w-[80vw] h-full flex flex-col bg-white dark:bg-slate-900 border-r border-[var(--border)] shadow-2xl overflow-hidden"
            >
              {/* Logo Area & Close Button */}
              <div className="h-16 flex items-center justify-between px-5 border-b border-[var(--border)] bg-slate-50/70 dark:bg-slate-800/40 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center shadow-sm overflow-hidden bg-white p-1 border border-slate-200 dark:border-slate-700">
                    <img src="/Yash.png" alt="Yash Logo" className="w-full h-full object-contain" />
                  </div>
                  <div>
                    <div className="text-sm font-black tracking-tight text-[var(--text-primary)] leading-none">
                      Migration Studio
                    </div>
                    <div className="text-[10px] font-medium text-[var(--text-tertiary)] mt-1">
                      SAP DMS Pipeline
                    </div>
                  </div>
                </div>
                <button
                  onClick={onCloseMobile}
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors cursor-pointer"
                  title="Close Navigation"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Steps List */}
              <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1 scrollbar-none">
                <div className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest px-3 mb-2.5">
                  Pipeline Steps
                </div>

                {STEPS.map((step, i) => {
                  const Icon = step.icon;
                  const isActive = activeStep === i;
                  const isDone = activeStep > i;

                  return (
                    <button
                      key={i}
                      onClick={() => {
                        navigate(step.path);
                        onCloseMobile?.();
                      }}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors duration-200 group relative cursor-pointer',
                        isActive && 'bg-primary-50 dark:bg-primary-950/60 text-primary-700 dark:text-primary-300 font-bold border border-primary-200 dark:border-primary-800/50 shadow-xs',
                        isDone && 'text-teal-600 dark:text-teal-400 font-semibold hover:bg-[var(--bg-tertiary)]',
                        !isActive && !isDone && 'text-[var(--text-secondary)] font-medium hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                      )}
                    >
                      <div
                        className={cn(
                          'w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors shadow-sm',
                          isActive ? 'bg-primary-600 text-white' :
                            isDone ? 'bg-teal-50 dark:bg-teal-900/40 text-teal-600 dark:text-teal-400 border border-teal-200 dark:border-teal-800/50' :
                              'bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] border border-[var(--border)] group-hover:text-[var(--text-secondary)]'
                        )}
                      >
                        {isDone ? <Check className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
                      </div>
                      <span className="text-[13px] font-medium">{step.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Bottom Progress */}
              <div className="p-4 border-t border-[var(--border)] bg-slate-50/50 dark:bg-slate-800/30 shrink-0">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold text-[var(--text-secondary)]">Progress</span>
                  <span className="text-[11px] font-mono text-primary-600 dark:text-primary-400 font-bold">{Math.round(progress)}%</span>
                </div>
                <div className="h-1.5 w-full bg-[var(--border)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-primary-600 to-teal-500 rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
