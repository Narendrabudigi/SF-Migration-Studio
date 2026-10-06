import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useMigration, isMock1Completed, isMock0Completed } from '@/store/migration-store';
import { useNavigate } from 'react-router-dom';
import {
  Sliders,
  Compass,
  Server,
  Zap,
  RotateCcw,
  CheckCircle2,
  Clock,
  ArrowRight,
  TrendingUp,
  AlertTriangle,
  Play,
  FileCheck,
  Cpu,
  Layers,
  Lock,
  Check
} from 'lucide-react';
import { useToast } from '@/components/ui/toast';

interface CutoverOption {
  id: string;
  title: string;
  tag: string;
  speed: string;
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  description: string;
  icon: any;
  features: string[];
}

const CUTOVER_OPTIONS: CutoverOption[] = [
  {
    id: 'opt-sf-staging',
    title: 'SuccessFactors Staging (Mock 0 Default)',
    tag: 'SF Recommended',
    speed: '~15,000 rec/hr',
    risk: 'LOW',
    description: 'Generates standard SuccessFactors XML/CSV staging files with native commit validations.',
    icon: Layers,
    features: ['Audit compliant', 'Official SuccessFactors standard', 'Full rollback support']
  },
  {
    id: 'opt-odata',
    title: 'Direct OData API Synchronous Posting',
    tag: 'Fast-Track',
    speed: '~45,000 rec/hr',
    risk: 'MEDIUM',
    description: 'Bypasses XML generation and posts directly to SuccessFactors application layer via direct OData API.',
    icon: Server,
    features: ['Instant error codes', '3x faster posting', 'Live feedback']
  },
  {
    id: 'opt-delta',
    title: 'Delta Sync Engine (CDC)',
    tag: 'Continuous Sync',
    speed: 'Near Real-time',
    risk: 'LOW',
    description: 'Timestamp & hash-based Change Data Capture engine that syncs only incremental legacy changes right before Go-Live.',
    icon: Zap,
    features: ['Zero-downtime cutover', 'Hash-based change detection', 'Parallel conflict resolution']
  },
  {
    id: 'opt-simulation',
    title: 'Cutover Weekend Dry-Run Simulator',
    tag: 'Rehearsal',
    speed: 'Instant Benchmark',
    risk: 'LOW',
    description: 'Simulates the entire Friday 18:00 to Sunday 22:00 Go-Live cutover window, estimating buffer margins and failure rates.',
    icon: Compass,
    features: ['Full timeline projection', 'Bottleneck detection', 'Resource allocation model']
  }
];

export function Mock2Options() {
  const { state, dispatch } = useMigration();
  const navigate = useNavigate();
  const { toast } = useToast();

  const isUnlocked = isMock1Completed(state);
  const isMock0Done = isMock0Completed(state);

  const [selectedOption, setSelectedOption] = useState<string>('opt-simulation');
  const [recordCount, setRecordCount] = useState<number>(
    state.transformed?.length || state.dmcRows?.length || 50000
  );
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [simulationComplete, setSimulationComplete] = useState<boolean>(false);

  // Approximate calculation: standard ~15k/hr, direct OData ~45k/hr
  const hoursSfStaging = (recordCount / 15000).toFixed(1);
  const hoursOdata = (recordCount / 45000).toFixed(1);
  const hoursSaved = (parseFloat(hoursSfStaging) - parseFloat(hoursOdata)).toFixed(1);

  const runSimulation = () => {
    setIsSimulating(true);
    setSimulationComplete(false);
    setTimeout(() => {
      setIsSimulating(false);
      setSimulationComplete(true);
      toast('Weekend cutover rehearsal simulation completed successfully!', 'ok');
    }, 1500);
  };

  // ═══════════════════════════════════════════════════════════════
  // LOCKED VIEW: If Mock 1 has not been completed
  // ═══════════════════════════════════════════════════════════════
  if (!isUnlocked) {
    return (
      <div className="max-w-4xl mx-auto py-12 px-4 space-y-6">
        <div className="rounded-3xl border border-teal-500/30 bg-zinc-900/50 p-8 md:p-12 text-center space-y-6 shadow-2xl relative overflow-hidden">
          <div className="w-20 h-20 rounded-2xl bg-teal-500/10 border border-teal-500/30 text-teal-500 flex items-center justify-center mx-auto shadow-lg shadow-teal-500/10">
            <Lock className="w-10 h-10" />
          </div>

          <div className="space-y-2 max-w-xl mx-auto">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-500/10 border border-teal-500/30 text-teal-500 text-xs font-mono font-bold uppercase tracking-wider">
              Prerequisite Required
            </div>
            <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight">
              Mock 2 (Options & Cutover) is Locked
            </h1>
            <p className="text-sm text-zinc-400 leading-relaxed">
              To unlock alternative cutover scenarios, direct OData API posting, and weekend Go-Live rehearsal, you must first complete <strong>Mock 1 (Agentic AI)</strong>.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-md mx-auto pt-2 text-left">
            <div className={`p-4 rounded-xl border space-y-1 ${
              isMock0Done
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 font-bold'
                : 'bg-zinc-800/50 border-zinc-700 text-zinc-500'
            }`}>
              <div className="flex items-center justify-between text-xs">
                <span>Mock 0: Standard Flow</span>
                {isMock0Done ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Clock className="w-4 h-4" />}
              </div>
              <div className="text-[11px] font-normal opacity-80">Completed through Step 9</div>
            </div>

            <div className={`p-4 rounded-xl border space-y-1 ${
              state.isMock1Completed
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 font-bold'
                : 'bg-zinc-800/50 border-zinc-700 text-zinc-500'
            }`}>
              <div className="flex items-center justify-between text-xs">
                <span>Mock 1: Agentic AI</span>
                {state.isMock1Completed ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Clock className="w-4 h-4" />}
              </div>
              <div className="text-[11px] font-normal opacity-80">Autonomous swarm executed</div>
            </div>
          </div>

          <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={() => {
                if (!isMock0Done) {
                  dispatch({ type: 'SET_FIELD', field: 'activeMock', value: 'mock-0' });
                  navigate('/');
                } else {
                  dispatch({ type: 'SET_FIELD', field: 'activeMock', value: 'mock-1' });
                  navigate('/mock-1');
                }
              }}
              className="px-6 py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs shadow-lg shadow-teal-500/20 transition-all flex items-center gap-2 cursor-pointer"
            >
              <span>{!isMock0Done ? 'Return to Mock 0' : 'Go to Mock 1 (Agentic AI)'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // UNLOCKED VIEW
  // ═══════════════════════════════════════════════════════════════
  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-12">
      {/* Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-900/40 via-teal-900/30 to-cyan-900/40 border border-emerald-500/20 p-6 md:p-8 backdrop-blur-xl shadow-xl">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-mono font-bold tracking-wider uppercase">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Mock 2 Unlocked — Options & Cutover Strategies
            </div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight text-white">
              Advanced Cutover & Deployment Strategies
            </h1>
            <p className="text-sm text-zinc-300 max-w-2xl">
              Operating on verified deliverables from Mock 0 and Mock 1. Test alternative Go-Live cutover configurations, direct OData API backend posting, Change Data Capture (CDC) delta sync, and weekend window simulation.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => {
                dispatch({ type: 'SET_FIELD', field: 'activeMock', value: 'mock-0' });
                navigate('/');
              }}
              className="px-4 py-2.5 rounded-xl border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-xs font-bold transition-all flex items-center gap-2 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Mock 0
            </button>

            <button
              onClick={() => {
                dispatch({ type: 'SET_FIELD', field: 'activeMock', value: 'mock-1' });
                navigate('/mock-1');
              }}
              className="px-4 py-2.5 rounded-xl border border-blue-500/40 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-xs font-bold transition-all flex items-center gap-2 cursor-pointer"
            >
              <Cpu className="w-3.5 h-3.5" />
              Mock 1 (Agentic)
            </button>
          </div>
        </div>

        {/* Decorative Grid Glow */}
        <div className="absolute -right-20 -bottom-20 w-80 h-80 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />
      </div>

      {/* Grid of 4 Strategy Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {CUTOVER_OPTIONS.map(opt => {
          const Icon = opt.icon;
          const isSelected = selectedOption === opt.id;
          return (
            <div
              key={opt.id}
              onClick={() => setSelectedOption(opt.id)}
              className={`rounded-2xl p-5 border cursor-pointer transition-all relative overflow-hidden flex flex-col justify-between ${
                isSelected
                  ? 'bg-teal-500/10 border-teal-500/60 shadow-lg shadow-teal-500/10 ring-1 ring-teal-500/30'
                  : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700'
              }`}
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                    isSelected ? 'bg-teal-500 text-white' : 'bg-zinc-800 text-zinc-500'
                  }`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                    opt.risk === 'LOW' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'
                  }`}>
                    {opt.risk} Risk
                  </span>
                </div>

                <div>
                  <div className="text-[10px] font-mono text-teal-500 font-bold uppercase">{opt.tag}</div>
                  <h3 className="text-sm font-bold text-white mt-0.5">{opt.title}</h3>
                </div>

                <p className="text-xs text-zinc-400 leading-relaxed">
                  {opt.description}
                </p>

                <div className="space-y-1.5 pt-2 border-t border-zinc-800">
                  {opt.features.map((f, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                      <CheckCircle2 className="w-3 h-3 text-teal-500 shrink-0" />
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-zinc-800 flex items-center justify-between text-xs font-mono">
                <span className="text-zinc-500">Est. Throughput:</span>
                <span className="font-bold text-white">{opt.speed}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Interactive Simulation & Cutover Window Calculator */}
      <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Compass className="w-4 h-4 text-teal-500" />
              Go-Live Cutover Window Timing Projection
            </h3>
            <p className="text-xs text-zinc-400">
              Model migration window requirements based on total expected source master entities.
            </p>
          </div>

          <button
            onClick={runSimulation}
            disabled={isSimulating}
            className="px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold shadow-lg shadow-teal-500/20 transition-all flex items-center gap-2 shrink-0 disabled:opacity-50 cursor-pointer"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            {isSimulating ? 'Simulating Cutover Window...' : 'Run Cutover Simulation'}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl bg-zinc-800/50 border border-zinc-700 space-y-2">
            <label className="text-xs font-bold text-zinc-400 block">
              Dataset Entity Volume
            </label>
            <input
              type="range"
              min="10000"
              max="250000"
              step="5000"
              value={recordCount}
              onChange={e => setRecordCount(Number(e.target.value))}
              className="w-full accent-teal-500 cursor-pointer"
            />
            <div className="flex justify-between text-xs font-mono text-zinc-500">
              <span>10k</span>
              <span className="text-teal-500 font-bold">{recordCount.toLocaleString()} rows</span>
              <span>250k</span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 space-y-1">
            <div className="text-[10px] font-mono uppercase text-blue-400 font-bold">Standard Staging (SF Export)</div>
            <div className="text-2xl font-black text-white font-mono">{hoursSfStaging} hrs</div>
            <div className="text-[11px] text-zinc-400">Full staging, transformation, and commit validation</div>
          </div>

          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 space-y-1">
            <div className="text-[10px] font-mono uppercase text-emerald-400 font-bold">Direct OData Fast-Track</div>
            <div className="text-2xl font-black text-emerald-500 font-mono">{hoursOdata} hrs</div>
            <div className="text-[11px] text-emerald-400 font-semibold">
              Saves {hoursSaved} hours of weekend cutover time
            </div>
          </div>
        </div>

        {simulationComplete && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 rounded-xl bg-teal-500/10 border border-teal-500/30 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-teal-500" />
              <div>
                <h4 className="text-xs font-bold text-white">Simulation Passed: Sufficient Weekend Buffer</h4>
                <p className="text-[11px] text-zinc-400">
                  Total cutover window required is {hoursOdata} hours, comfortably within the 36-hour planned cutover window.
                </p>
              </div>
            </div>
            <button
              onClick={() => navigate('/docs')}
              className="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
            >
              Export Cutover Doc <ArrowRight className="w-3 h-3" />
            </button>
          </motion.div>
        )}
      </div>
    </div>
  );
}
export default Mock2Options;
