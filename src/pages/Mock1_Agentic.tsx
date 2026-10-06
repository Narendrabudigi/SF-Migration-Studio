import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMigration, isMock0Completed } from '@/store/migration-store';
import { useNavigate } from 'react-router-dom';
import {
  BrainCircuit, Sparkles, Server, CheckCircle2, RotateCcw, ShieldCheck, 
  Settings, Clock, ArrowRight, Play, Terminal, Database, Activity, Lock
} from 'lucide-react';
import { useToast } from '@/components/ui/toast';

export function Mock1Agentic() {
  const { state, dispatch } = useMigration();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const isUnlocked = isMock0Completed(state);

  const [isSwarmActive, setIsSwarmActive] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  const startSwarm = () => {
    setIsSwarmActive(true);
    setLogs(['[SYSTEM] Initializing Agentic AI Swarm for Mock 1...', '[AGENT-1] Analyzing source payloads against SuccessFactors Guardrails...']);
    setTimeout(() => {
      setLogs(prev => [...prev, '[AGENT-2] Harmonizing legacy data via dynamic AST evaluation...']);
    }, 1500);
    setTimeout(() => {
      setLogs(prev => [...prev, '[AGENT-3] Generating synthetic SuccessFactors target structures...']);
    }, 3000);
    setTimeout(() => {
      setLogs(prev => [...prev, '[SYSTEM] Mock 1 execution complete.']);
      setIsSwarmActive(false);
      dispatch({ type: 'SET_FIELD', field: 'isMock1Completed', value: true });
      toast('Mock 1 Autonomous Swarm Completed!', 'ok');
    }, 4500);
  };

  if (!isUnlocked) {
    return (
      <div className="max-w-4xl mx-auto py-12 px-4 space-y-6">
        <div className="rounded-3xl border border-blue-500/30 bg-zinc-900/50 p-8 md:p-12 text-center space-y-6 shadow-2xl relative overflow-hidden">
          <div className="w-20 h-20 rounded-2xl bg-blue-500/10 border border-blue-500/30 text-blue-500 flex items-center justify-center mx-auto shadow-lg shadow-blue-500/10">
            <Lock className="w-10 h-10" />
          </div>

          <div className="space-y-2 max-w-xl mx-auto">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-500 text-xs font-mono font-bold uppercase tracking-wider">
              Prerequisite Required
            </div>
            <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight">
              Mock 1 (Agentic AI) is Locked
            </h1>
            <p className="text-sm text-zinc-400 leading-relaxed">
              You must complete all 9 stages in <strong>Mock 0</strong> to unlock the autonomous Agentic AI swarm execution.
            </p>
          </div>
          
          <button
              onClick={() => {
                dispatch({ type: 'SET_FIELD', field: 'activeMock', value: 'mock-0' });
                navigate('/');
              }}
              className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-lg shadow-blue-500/20 transition-all flex items-center gap-2 cursor-pointer mx-auto"
            >
              <span>Return to Mock 0</span>
              <ArrowRight className="w-4 h-4" />
            </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-12">
      {/* Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-blue-900/40 via-indigo-900/30 to-purple-900/40 border border-blue-500/20 p-6 md:p-8 backdrop-blur-xl shadow-xl">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-mono font-bold tracking-wider uppercase">
              <BrainCircuit className="w-3.5 h-3.5" />
              Mock 1 Unlocked — Autonomous Execution
            </div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight text-white">
              Agentic AI Swarm Orchestration
            </h1>
            <p className="text-sm text-zinc-300 max-w-2xl">
              Utilize autonomous agents to automatically cleanse, harmonize, and validate your data against SuccessFactors guardrails without manual intervention.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900 space-y-6">
           <h2 className="text-xl font-bold text-white flex items-center gap-2"><Sparkles className="w-5 h-5 text-blue-500" /> Start Autonomous Swarm</h2>
           <p className="text-sm text-zinc-400">
             The swarm will evaluate legacy data using secure AST validation and target object mapping specific to SuccessFactors.
           </p>
           <button
            onClick={startSwarm}
            disabled={isSwarmActive}
            className="w-full py-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-black text-sm shadow-lg shadow-blue-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
           >
            {isSwarmActive ? <Activity className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
            {isSwarmActive ? 'Swarm Active...' : 'Launch Agentic Swarm'}
           </button>
        </div>

        <div className="p-6 rounded-2xl border border-zinc-800 bg-black space-y-4">
          <div className="flex items-center gap-2 border-b border-zinc-800 pb-3">
             <Terminal className="w-5 h-5 text-zinc-500" />
             <span className="text-sm font-mono text-zinc-500 font-bold">Swarm Terminal Output</span>
          </div>
          <div className="h-48 overflow-y-auto space-y-2 font-mono text-[11px]">
             {logs.length === 0 ? (
               <span className="text-zinc-600">Waiting for swarm execution...</span>
             ) : (
               logs.map((log, i) => (
                 <div key={i} className="text-emerald-400">{log}</div>
               ))
             )}
          </div>
        </div>
      </div>
      
      {state.isMock1Completed && (
        <div className="p-6 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between">
           <div className="flex items-center gap-3">
             <CheckCircle2 className="w-8 h-8 text-emerald-500" />
             <div>
               <h3 className="font-bold text-white">Agentic AI Execution Complete</h3>
               <p className="text-xs text-zinc-400">Mock 2 Cutover Scenarios are now unlocked.</p>
             </div>
           </div>
           <button onClick={() => navigate('/mock-2')} className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-lg transition-all flex items-center gap-2 cursor-pointer">
              Go to Mock 2 <ArrowRight className="w-4 h-4" />
           </button>
        </div>
      )}
    </div>
  );
}
export default Mock1Agentic;
