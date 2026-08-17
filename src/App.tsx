import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { MigrationProvider, useMigration } from '@/store/migration-store';
import { ToastProvider } from '@/components/ui/toast';
import { LoadingProvider } from '@/components/ui/loading-overlay';
import { Header } from '@/components/layout/Header';
import { StepNavigation } from '@/components/layout/StepNavigation';
import { Step1SourceData } from '@/pages/Step1_SourceData';
import { Step2AIMapping } from '@/pages/Step2_AIMapping';
import { Step3Extract } from '@/pages/Step3_Extract';
import { Step4Harmonize } from '@/pages/Step4_Harmonize';
import { Step5Validate } from '@/pages/Step5_Validate';
import { Step6Cleanse } from '@/pages/Step6_Cleanse';
import { Step7Transform } from '@/pages/Step7_Transform';
import { Step8DMCExport } from '@/pages/Step8_DMCExport';
import { Step9TechDocs } from '@/pages/Step9_TechDocs';
import { Auth } from '@/pages/Auth';
import { InsertMapping } from '@/pages/InsertMapping';

function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('access_token');
  if (!token) return <Navigate to="/auth" replace />;

  return (
    <div className="h-full flex overflow-hidden" style={{ background: 'var(--bg)' }}>
      <StepNavigation />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <Header />
        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}

function AppContent() {
  const { state } = useMigration();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', state.theme === 'dark');
  }, [state.theme]);

  return (
    <Routes>
      <Route path="/auth" element={<Auth />} />
      <Route path="*" element={
        <ProtectedLayout>
          <Routes>
            <Route path="/" element={<Step1SourceData />} />
            <Route path="/mapping" element={<Step2AIMapping />} />
            <Route path="/extract" element={<Step3Extract />} />
            <Route path="/harmonize" element={<Step4Harmonize />} />
            <Route path="/validate" element={<Step5Validate />} />
            <Route path="/cleanse" element={<Step6Cleanse />} />
            <Route path="/transform" element={<Step7Transform />} />
            <Route path="/export" element={<Step8DMCExport />} />
            <Route path="/docs" element={<Step9TechDocs />} />
            <Route path="/insert" element={<InsertMapping />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ProtectedLayout>
      } />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <MigrationProvider>
        <ToastProvider>
          <LoadingProvider>
            <AppContent />
          </LoadingProvider>
        </ToastProvider>
      </MigrationProvider>
    </BrowserRouter>
  );
}
