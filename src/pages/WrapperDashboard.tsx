import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useMigration, isMock0Completed, isMock1Completed } from '@/store/migration-store';
import { useToast } from '@/components/ui/toast';
import { MOCK_CONFIGS } from '@/config/steps';
import {
  Activity, Layers, Database, Cpu, ShieldCheck, Sparkles, ArrowRight, ArrowLeft,
  RotateCcw, CheckCircle2, Clock, AlertTriangle, FileText, Server, Sliders, Folder,
  Compass, Check, ExternalLink, ChevronRight, ChevronDown, RefreshCw, Search, Plus,
  Users, Terminal, Zap, HardDrive, BarChart3, TrendingUp, Table, Eye, Settings, Radio, CheckSquare, Globe, Box, X
} from 'lucide-react';

interface ProjectItem {
  id: string;
  name: string;
  description?: string;
  created_at?: string;
}

interface TargetObjectItem {
  id: string;
  name: string;
  description?: string;
}

const DEFAULT_ICONS = [Users, HardDrive, Database, BarChart3, Globe, Folder, Box];
const DEFAULT_COLORS = [
  'from-blue-500/20 to-indigo-500/20 text-blue-500 border-blue-500/30',
  'from-emerald-500/20 to-teal-500/20 text-emerald-500 border-emerald-500/30',
  'from-purple-500/20 to-pink-500/20 text-purple-500 border-purple-500/30',
  'from-amber-500/20 to-orange-500/20 text-amber-500 border-amber-500/30',
  'from-rose-500/20 to-red-500/20 text-rose-500 border-rose-500/30',
  'from-cyan-500/20 to-sky-500/20 text-cyan-500 border-cyan-500/30'
];

export function WrapperDashboard() {
  const { state, dispatch } = useMigration();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<'matrix' | 'pipeline' | 'projects' | 'rehearsal' | 'diagnostics'>('matrix');
  const [projectsList, setProjectsList] = useState<ProjectItem[]>([]);
  const [targetObjects, setTargetObjects] = useState<TargetObjectItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);
  const [backendHealth, setBackendHealth] = useState<{ status: string; version?: string } | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [newProjectModal, setNewProjectModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [isCreatingProject, setIsCreatingProject] = useState(false);

  const refreshLiveSystem = async () => {
    setIsRefreshing(true);
    try {
      const [projRes, healthRes, objRes] = await Promise.allSettled([
        fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/projects/list`),
        fetch(`${import.meta.env.VITE_BACKEND_URL}/api/health`),
        fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/target-objects/list`)
      ]);

      if (projRes.status === 'fulfilled' && projRes.value.ok) {
        const data = await projRes.value.json();
        setProjectsList(Array.isArray(data) ? data : []);
      }

      if (healthRes.status === 'fulfilled' && healthRes.value.ok) {
        const data = await healthRes.value.json();
        setBackendHealth(data);
      }

      if (objRes.status === 'fulfilled' && objRes.value.ok) {
        const data = await objRes.value.json();
        setTargetObjects(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      console.warn('Live refresh error:', e);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    refreshLiveSystem();
  }, []);

  const activeMock = state.activeMock || 'mock-0';
  const currentObject = (state.obj || (targetObjects.length > 0 ? targetObjects[0].name : 'UNKNOWN')).toUpperCase();

  const extractedCount = state.extracted?.length || 0;
  const harmonizedCount = state.harmonized?.length || (extractedCount > 0 ? extractedCount : 0);
  const validatedCount = state.validated?.length || harmonizedCount;
  const valErrors = state.stats?.errors || (state.validated ? state.validated.filter(v => v.st === 'ERROR').length : 0);
  const valWarns = state.stats?.warns || (state.validated ? state.validated.filter(v => v.st === 'WARN').length : 0);
  const valPassed = state.stats?.passed || (state.validated ? state.validated.filter(v => v.st === 'PASS').length : Math.max(0, validatedCount - valErrors));
  const valPassRate = validatedCount > 0 ? ((valPassed / validatedCount) * 100).toFixed(1) : (extractedCount > 0 ? '100' : '0');

  const cleanedCount = state.cleaned?.length || harmonizedCount;
  const clModified = state.cleansingSummary?.rows_modified_count || 0;

  const transformedCount = state.transformed?.length || cleanedCount;
  const trModified = state.transformSummary?.rows_modified || 0;
  const trReplacements = state.transformSummary?.total_modifications || 0;
  const dmcCount = state.dmcRows?.length || transformedCount;

  const masterVolume = Math.max(dmcCount, transformedCount, extractedCount);
  const hoursSfStaging = masterVolume > 0 ? (masterVolume / 15000).toFixed(1) : '0.0';
  const hoursOdata = masterVolume > 0 ? (masterVolume / 45000).toFixed(1) : '0.0';
  const hoursSaved = (parseFloat(hoursSfStaging) - parseFloat(hoursOdata)).toFixed(1);

  const stepMilestones = [
    { num: 1, name: 'Source Scope', done: Boolean(state.projectId), path: '/' },
    { num: 2, name: 'AI Mapping', done: Boolean(state.isMappingSaved || state.mapping?.length > 0), path: '/mapping' },
    { num: 3, name: 'Extraction', done: Boolean(state.isDataSaved || state.extracted?.length > 0), path: '/extract' },
    { num: 4, name: 'Harmonize', done: Boolean(state.isHarmonizedSaved || state.harmonized?.length > 0), path: '/harmonize' },
    { num: 5, name: 'Validation', done: Boolean(state.isValidatedSaved || state.validated?.length > 0), path: '/validate' },
    { num: 6, name: 'Cleansing', done: Boolean(state.isCleansedSaved || state.cleaned?.length > 0), path: '/cleanse' },
    { num: 7, name: 'Transform', done: Boolean(state.isTransformedSaved || state.transformed?.length > 0), path: '/transform' },
    { num: 8, name: 'SF Export', done: Boolean(state.dmcRows?.length > 0), path: '/export' },
    { num: 9, name: 'Tech Docs', done: Boolean(state.isTechDocsSaved || state.techDocId), path: '/docs' }
  ];
  const completedMilestones = stepMilestones.filter(m => m.done).length;
  const overallProgressPct = Math.round((completedMilestones / stepMilestones.length) * 100);

  const mock0Done = isMock0Completed(state);
  const mock1Done = isMock1Completed(state);

  const handleSelectProject = (proj: ProjectItem) => {
    dispatch({ type: 'SET_FIELD', field: 'projectId', value: proj.id });
    dispatch({ type: 'SET_FIELD', field: 'projectName', value: proj.name });
    toast(`Active project switched to "${proj.name}"`, 'ok');
  };

  const handleSelectObject = (objName: string) => {
    dispatch({ type: 'SET_FIELD', field: 'obj', value: objName });
    toast(`Active migration object switched to "${objName}"`, 'ok');
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) {
      toast('Project name is required', 'err');
      return;
    }
    setIsCreatingProject(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/projects/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newProjectName.trim(), description: newProjectDesc.trim() })
      });
      if (res.ok) {
        const created = await res.json();
        setProjectsList(prev => [created, ...prev]);
        dispatch({ type: 'SET_FIELD', field: 'projectId', value: created.id });
        dispatch({ type: 'SET_FIELD', field: 'projectName', value: created.name });
        toast(`Project "${created.name}" created and set as active!`, 'ok');
        setNewProjectModal(false);
        setNewProjectName('');
        setNewProjectDesc('');
      } else {
        const err = await res.json();
        toast(err.detail || 'Failed to create project', 'err');
      }
    } catch (e: any) {
      toast(e.message || 'Error connecting to project service', 'err');
    } finally {
      setIsCreatingProject(false);
    }
  };

  const handleReturnToPipeline = () => {
    if (activeMock === 'mock-1') {
      navigate('/mock-1');
    } else if (activeMock === 'mock-2') {
      navigate('/mock-2');
    } else {
      const nextStep = stepMilestones.find(m => !m.done) || stepMilestones[stepMilestones.length - 1];
      navigate(nextStep.path);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-20 animate-fadeIn p-6">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-950 text-white border border-blue-500/30 p-6 md:p-8 shadow-2xl">
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-xs font-mono font-bold uppercase tracking-wider flex items-center gap-1.5 shadow-sm">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Live Reactive Dashboard
              </span>
              <span className="px-3 py-1 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30 text-xs font-mono font-bold">
                Target: {state.connUrl ? state.connUrl.replace('https://', '').split('/')[0] : 'SuccessFactors API'}
              </span>
            </div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight text-white">
              Enterprise Migration Portfolio & Command Center
            </h1>
            <div className="flex items-center gap-3 text-xs text-blue-200/80 pt-1 flex-wrap font-mono">
              <span>Active Wave: <strong className="text-white font-bold">{state.projectName || 'Default Project'}</strong></span>
              <span>•</span>
              <span>Active Focus Object: <strong className="text-emerald-400 font-bold">{currentObject}</strong></span>
              <span>•</span>
              <span>Active Mock: <strong className="text-amber-400 font-bold">{activeMock.toUpperCase()}</strong></span>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0 flex-wrap">
            <button onClick={refreshLiveSystem} disabled={isRefreshing} className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-white text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-primary-400' : ''}`} />
              <span className="hidden sm:inline">Sync Live</span>
            </button>
            <button onClick={() => setNewProjectModal(true)} className="px-3.5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-white text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer">
              <Plus className="w-3.5 h-3.5" />
              <span>New Wave</span>
            </button>
            <button onClick={handleReturnToPipeline} className="px-5 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-500 text-white font-black text-xs shadow-lg shadow-primary-500/30 transition-all flex items-center gap-2 cursor-pointer group">
              <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
              <span>Return to Studio Pipeline</span>
            </button>
          </div>
        </div>
        <div className="absolute -right-20 -bottom-20 w-80 h-80 bg-blue-500/15 rounded-full blur-3xl pointer-events-none" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 font-bold">Global Volume</span>
            <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-500 font-mono text-xs font-black">LIVE</span>
          </div>
          <div className="text-2xl font-black text-zinc-900 dark:text-white font-mono">{transformedCount.toLocaleString()}</div>
          <div className="text-xs text-zinc-500">Transformed SF records</div>
          <div className="text-[10px] text-zinc-400 font-mono flex items-center justify-between pt-1 border-t border-zinc-100 dark:border-zinc-800">
            <span>Extracted: <strong>{extractedCount.toLocaleString()}</strong></span>
            <span>SF Export: <strong>{dmcCount.toLocaleString()}</strong></span>
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 font-bold">Data Quality Yield</span>
            <span className="px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-500 font-mono text-xs font-black">{valPassRate}%</span>
          </div>
          <div className="text-2xl font-black text-emerald-500 font-mono">{valPassed.toLocaleString()}</div>
          <div className="text-xs text-zinc-500">Clean validated rows ({valErrors} blockers)</div>
          <div className="text-[10px] text-zinc-400 font-mono flex items-center justify-between pt-1 border-t border-zinc-100 dark:border-zinc-800">
            <span className="text-emerald-500 font-bold">{valPassed} Passed</span>
            <span className="text-amber-500 font-bold">{valWarns} Warns</span>
            <span className="text-red-500 font-bold">{valErrors} Errs</span>
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 font-bold">Cutover Dry-Run</span>
            <span className="px-2 py-0.5 rounded-md bg-teal-500/10 text-teal-500 font-mono text-xs font-black">~{hoursOdata} hrs</span>
          </div>
          <div className="text-2xl font-black text-zinc-900 dark:text-white font-mono">{hoursSaved} hrs</div>
          <div className="text-xs text-zinc-500">Projected downtime window saved</div>
          <div className="text-[10px] text-zinc-400 font-mono flex items-center justify-between pt-1 border-t border-zinc-100 dark:border-zinc-800">
            <span>SF Stage: {hoursSfStaging}h</span>
            <span className="text-teal-500 font-bold">OData API: {hoursOdata}h</span>
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 font-bold">Pipeline Stage</span>
            <span className="text-xs font-mono font-bold text-primary-500">{overallProgressPct}%</span>
          </div>
          <div className="text-2xl font-black text-zinc-900 dark:text-white font-mono">{completedMilestones} / 9</div>
          <div className="text-xs text-zinc-500">Stages signed off in Mock 0</div>
          <div className="text-[10px] text-zinc-400 font-mono flex items-center justify-between pt-1 border-t border-zinc-100 dark:border-zinc-800">
            <span className={mock0Done ? 'text-emerald-500 font-bold' : 'text-amber-500'}>{mock0Done ? 'Mock 0 Done' : 'Mock 0 Active'}</span>
            <span className={mock1Done ? 'text-emerald-500 font-bold' : mock0Done ? 'text-blue-500' : 'text-zinc-500'}>{mock1Done ? 'Mock 1 Done' : mock0Done ? 'Mock 1 Ready' : 'Mock 1 Locked'}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-800 pb-3 overflow-x-auto">
        <button onClick={() => setActiveTab('matrix')} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${activeTab === 'matrix' ? 'bg-primary-600 text-white shadow-sm' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>
          <Database className="w-3.5 h-3.5" /> Cross-Object Migration Matrix
        </button>
        <button onClick={() => setActiveTab('pipeline')} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${activeTab === 'pipeline' ? 'bg-primary-600 text-white shadow-sm' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>
          <Layers className="w-3.5 h-3.5" /> Live Pipeline Audit (Steps 1–9)
        </button>
        <button onClick={() => setActiveTab('projects')} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${activeTab === 'projects' ? 'bg-primary-600 text-white shadow-sm' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>
          <Folder className="w-3.5 h-3.5" /> Migration Waves ({projectsList.length})
        </button>
      </div>

      {activeTab === 'matrix' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-primary-500/10 border border-primary-500/20 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 text-xs text-primary-600 dark:text-primary-400 font-medium">
              <Activity className="w-4 h-4 shrink-0 text-primary-500" />
              <span>Cross-Object Migration Matrix displays live readiness across all configured target objects.</span>
            </div>
            <span className="text-[11px] font-mono font-bold text-primary-600 dark:text-primary-400">Active Focus: {currentObject}</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {targetObjects.length === 0 ? (
              <div className="col-span-1 md:col-span-2 text-center p-8 bg-zinc-50 dark:bg-zinc-900 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 text-zinc-500 text-sm">
                No target objects loaded. Please ensure Target Objects are created in the backend.
              </div>
            ) : (
              targetObjects.map((obj, i) => {
                const Icon = DEFAULT_ICONS[i % DEFAULT_ICONS.length];
                const colorCls = DEFAULT_COLORS[i % DEFAULT_COLORS.length];
                const isCurrent = currentObject === obj.name.toUpperCase();
                const objRows = isCurrent ? transformedCount : 0;
                const objMappings = isCurrent ? (state.mapping?.length || 0) : 0;
                const objPassRate = isCurrent ? valPassRate : '0.0';
                const objMock0 = isCurrent ? (mock0Done ? 'Completed' : `${overallProgressPct}% Complete`) : 'Standing by';
                const objMock1 = isCurrent ? (mock1Done ? 'Completed' : mock0Done ? 'Ready' : 'Locked') : 'Standing by';
                const objMock2 = isCurrent ? (mock1Done ? 'Ready' : 'Locked') : 'Standing by';

                return (
                  <div key={obj.id} className={`p-6 rounded-3xl border transition-all relative overflow-hidden shadow-xs ${isCurrent ? 'border-primary-500/60 bg-white dark:bg-zinc-900 ring-2 ring-primary-500/20 shadow-lg' : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50'}`}>
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div className="flex items-center gap-3.5">
                        <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${colorCls} border flex items-center justify-center shrink-0 shadow-sm`}>
                          <Icon className="w-6 h-6" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-base font-black text-zinc-900 dark:text-white tracking-tight">{obj.name}</h3>
                          </div>
                          <p className="text-xs text-zinc-500 font-mono mt-0.5 line-clamp-1">{obj.description}</p>
                        </div>
                      </div>

                      {isCurrent ? (
                        <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 text-[10px] font-mono font-bold uppercase tracking-wider flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Active Wave Object
                        </span>
                      ) : (
                        <button onClick={() => handleSelectObject(obj.name)} className="px-3 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-bold text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-all cursor-pointer">
                          Set as Active
                        </button>
                      )}
                    </div>

                    <div className="p-3.5 rounded-2xl bg-zinc-100/50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-800 space-y-2.5 mb-4">
                      <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-500 flex items-center justify-between">
                        <span>Mock Cycle Progression</span>
                        <span className="text-primary-500 font-bold">{isCurrent ? 'Live Pipeline' : 'Queued'}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center text-xs font-mono">
                        <div className="p-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700">
                          <span className="text-[9px] text-zinc-500 uppercase block">Mock 0</span>
                          <strong className={objMock0 === 'Completed' ? 'text-emerald-500 text-[11px]' : 'text-zinc-900 dark:text-zinc-100 text-[11px]'}>{objMock0}</strong>
                        </div>
                        <div className="p-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700">
                          <span className="text-[9px] text-zinc-500 uppercase block">Mock 1</span>
                          <strong className={objMock1 === 'Completed' || objMock1 === 'Ready' ? 'text-blue-500 text-[11px]' : 'text-zinc-400 text-[11px]'}>{objMock1}</strong>
                        </div>
                        <div className="p-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700">
                          <span className="text-[9px] text-zinc-500 uppercase block">Mock 2</span>
                          <strong className={objMock2 === 'Ready' ? 'text-teal-500 text-[11px]' : 'text-zinc-400 text-[11px]'}>{objMock2}</strong>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center text-xs font-mono">
                      <div className="p-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
                        <span className="text-[10px] text-zinc-500 uppercase block">Transformed</span>
                        <strong className="text-emerald-500 text-sm">{objRows.toLocaleString()}</strong>
                      </div>
                      <div className="p-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
                        <span className="text-[10px] text-zinc-500 uppercase block">Mappings</span>
                        <strong className="text-primary-500 text-sm">{objMappings} Rules</strong>
                      </div>
                      <div className="p-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
                        <span className="text-[10px] text-zinc-500 uppercase block">Pass Rate</span>
                        <strong className="text-purple-500 text-sm">{objPassRate}%</strong>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {activeTab === 'pipeline' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 font-medium">
              <Activity className="w-4 h-4 shrink-0 text-blue-500" />
              <span>Granular Live Audit inspects the exact live records, rules, and configurations of all 9 steps in the active studio pipeline.</span>
            </div>
          </div>
          <div className="space-y-3">
            {stepMilestones.map((st) => {
              return (
                <div key={st.num} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden transition-all shadow-xs p-5 flex items-center justify-between">
                  <div className="flex items-center gap-3.5">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs font-mono ${st.done ? 'bg-emerald-500/10 text-emerald-500' : 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800'}`}>0{st.num}</div>
                    <div>
                      <h3 className="text-sm font-black text-zinc-900 dark:text-white">Step {st.num} — {st.name}</h3>
                      <p className="text-xs text-zinc-500 mt-0.5">{st.done ? 'Completed' : 'Pending'}</p>
                    </div>
                  </div>
                  <button onClick={() => navigate(st.path)} className="px-4 py-2 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-xs font-bold text-zinc-700 dark:text-zinc-300 transition-all cursor-pointer">View Details</button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {activeTab === 'projects' && (
        <div className="space-y-4">
           <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Migration Waves</h2>
              <button onClick={() => setNewProjectModal(true)} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-xs font-bold">Create New Wave</button>
           </div>
           <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {projectsList.map((p) => (
                <div key={p.id} className="p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-3">
                  <h3 className="font-bold text-zinc-900 dark:text-white">{p.name}</h3>
                  <p className="text-xs text-zinc-500 h-10 overflow-hidden">{p.description}</p>
                  <button onClick={() => handleSelectProject(p)} className="w-full px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg text-xs font-bold transition-all">Select Wave</button>
                </div>
              ))}
           </div>
        </div>
      )}
      {/* MODAL: CREATE NEW PROJECT WAVE */}
      <AnimatePresence>
        {newProjectModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-4 shadow-2xl"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-black text-zinc-900 dark:text-white">Create Migration Wave</h3>
                <button
                  onClick={() => setNewProjectModal(false)}
                  className="p-1 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="font-bold text-zinc-900 dark:text-white block mb-1">Wave / Project Name</label>
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="e.g. SF_GLOBAL_ROLLOUT_WAVE_2"
                    className="w-full p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-white focus:outline-hidden focus:border-primary-500 font-mono"
                  />
                </div>

                <div>
                  <label className="font-bold text-zinc-900 dark:text-white block mb-1">Description (Optional)</label>
                  <textarea
                    value={newProjectDesc}
                    onChange={(e) => setNewProjectDesc(e.target.value)}
                    placeholder="Scope, target systems, or deployment objectives"
                    rows={3}
                    className="w-full p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-white focus:outline-hidden focus:border-primary-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={() => setNewProjectModal(false)}
                  className="px-4 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-bold text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateProject}
                  disabled={isCreatingProject}
                  className="px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
                >
                  {isCreatingProject ? 'Creating...' : 'Create & Activate'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
