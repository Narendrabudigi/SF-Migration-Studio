import {
  Database, Brain, Download, Layers, ShieldCheck,
  Sparkles, Cog, Package, FileText, Bot, Cpu, GitMerge, Activity, Server, Zap, Compass, Sliders
} from 'lucide-react';

export type MockCycle = 'mock-0' | 'mock-1' | 'mock-2';

export interface StepItem {
  label: string;
  icon: any;
  path: string;
  badge?: string;
  desc?: string;
}

export const MOCK_0_STEPS: StepItem[] = [
  { label: 'Source & Data', icon: Database, path: '/', desc: 'Connection & Object Selection' },
  { label: 'AI Mapping', icon: Brain, path: '/mapping', desc: 'Schema & Field Association' },
  { label: 'Extract', icon: Download, path: '/extract', desc: 'Data Ingestion & Staging' },
  { label: 'Harmonize', icon: Layers, path: '/harmonize', desc: 'Schema Alignment & Joins' },
  { label: 'Validate', icon: ShieldCheck, path: '/validate', desc: 'Business Rule Checks' },
  { label: 'Cleanse', icon: Sparkles, path: '/cleanse', desc: 'Automated Remediation' },
  { label: 'Transform', icon: Cog, path: '/transform', desc: 'SuccessFactors Field Value Mapping' },
  { label: 'SF Export', icon: Package, path: '/export', desc: 'SuccessFactors Staging' },
  { label: 'Tech Docs', icon: FileText, path: '/docs', desc: 'Consolidated Master Audit' },
];

export const MOCK_1_STEPS: StepItem[] = [
  { label: 'Agentic AI Hub', icon: Bot, path: '/mock-1', desc: 'Autonomous Multi-Agent Architecture' },
  { label: 'Agent Orchestrator', icon: Cpu, path: '/mock-1', desc: 'Autonomous Execution & Routing', badge: 'AI' },
  { label: 'HITL Approvals', icon: Activity, path: '/mock-1', desc: 'Human-in-the-Loop Review Gates' },
  { label: 'Agent Logs & Audit', icon: GitMerge, path: '/mock-1', desc: 'Agent Decisions & Chain-of-Thought' },
  { label: 'Tech Docs', icon: FileText, path: '/docs', desc: 'Consolidated Master Audit' },
];

export const MOCK_2_STEPS: StepItem[] = [
  { label: 'Options & Cutover', icon: Sliders, path: '/mock-2', desc: 'Alternative Cutover & Sync Options' },
  { label: 'Cutover Simulation', icon: Compass, path: '/mock-2', desc: 'Dry-run Mock Cutover Window' },
  { label: 'Direct OData API', icon: Server, path: '/mock-2', desc: 'Direct SuccessFactors API Posting' },
  { label: 'Delta Sync Engine', icon: Zap, path: '/mock-2', desc: 'Incremental Change Capture' },
  { label: 'Tech Docs', icon: FileText, path: '/docs', desc: 'Consolidated Master Audit' },
];

export const MOCK_CONFIGS: Record<MockCycle, { name: string; subtitle: string; tag: string; steps: StepItem[] }> = {
  'mock-0': {
    name: 'Mock 0',
    subtitle: 'Standard Pipeline',
    tag: 'Present Flow',
    steps: MOCK_0_STEPS,
  },
  'mock-1': {
    name: 'Mock 1',
    subtitle: 'Agentic AI',
    tag: 'Autonomous Multi-Agent',
    steps: MOCK_1_STEPS,
  },
  'mock-2': {
    name: 'Mock 2',
    subtitle: 'Options & Cutover',
    tag: 'Advanced Cutover',
    steps: MOCK_2_STEPS,
  },
};

// Backwards-compatibility for existing imports
export const STEPS = MOCK_0_STEPS;
