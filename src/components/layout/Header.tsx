import React from 'react';
import { useLocation } from 'react-router-dom';
import { useMigration } from '@/store/migration-store';
import { Sun, Moon, Settings, Bell, Search, Menu } from 'lucide-react';
import { STEPS } from '@/config/steps';

export function Header() {
  const { state, dispatch } = useMigration();
  const location = useLocation();

  const toggleTheme = () => {
    const next = state.theme === 'light' ? 'dark' : 'light';
    dispatch({ type: 'SET_THEME', theme: next });
    document.documentElement.classList.toggle('dark', next === 'dark');
  };

  const currentStepObj = STEPS.find(s => s.path === location.pathname) || STEPS[0];
  const currentStepLabel = currentStepObj.label;

  return (
    <header className="shrink-0 relative z-50 h-16 flex items-center px-6 gap-4">
      {/* Breadcrumb / Title */}
      <div className="flex items-center gap-3">
        <button className="lg:hidden w-8 h-8 flex items-center justify-center rounded-lg text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] transition-colors">
          <Menu className="w-5 h-5" />
        </button>
        <div className="flex flex-col">
          <span className="text-[10px] font-mono font-semibold tracking-wider text-[var(--text-tertiary)] uppercase">
            {state.projectName ? `${state.projectName} / ${currentStepLabel}` : `No Project / ${currentStepLabel}`}
          </span>
          <span className="text-lg font-bold text-[var(--text-primary)] tracking-tight">
            {currentStepLabel}
          </span>
        </div>
      </div>

      <div className="flex-1" />

      {/* Right Actions */}
      <div className="flex items-center gap-2">
        <div className="hidden sm:flex items-center bg-[var(--bg-secondary)] border border-[var(--border)] rounded-full px-3 py-1.5 shadow-sm mr-2">
          <Search className="w-3.5 h-3.5 text-[var(--text-tertiary)] mr-2" />
          <input type="text" placeholder="Search resources..." className="bg-transparent border-none outline-none text-[12px] text-[var(--text-primary)] w-40 placeholder-[var(--text-tertiary)]" />
        </div>

        <button className="w-9 h-9 flex items-center justify-center rounded-full bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] shadow-sm transition-all" title="Notifications">
          <Bell className="w-4 h-4" />
        </button>

        <button className="w-9 h-9 flex items-center justify-center rounded-full bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] shadow-sm transition-all" title="Settings">
          <Settings className="w-4 h-4" />
        </button>

        <button onClick={toggleTheme} className="w-9 h-9 flex items-center justify-center rounded-full bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] shadow-sm transition-all" title="Toggle theme">
          {state.theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
        </button>

        <div className="w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center text-white text-[12px] font-bold shadow-sm ml-2 cursor-pointer hover:bg-primary-700 transition-colors">
          DC
        </div>
      </div>
    </header>
  );
}
