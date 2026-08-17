import {
  Database, Brain, Download, Layers, ShieldCheck,
  Sparkles, Cog, Package, FileText
} from 'lucide-react';

export const STEPS = [
  { label: 'Source & Data', icon: Database, path: '/' },
  { label: 'AI Mapping', icon: Brain, path: '/mapping' },
  { label: 'Extract', icon: Download, path: '/extract' },
  { label: 'Harmonize', icon: Layers, path: '/harmonize' },
  { label: 'Validate', icon: ShieldCheck, path: '/validate' },
  { label: 'Cleanse', icon: Sparkles, path: '/cleanse' },
  { label: 'Transform', icon: Cog, path: '/transform' },
  { label: 'SF Export', icon: Package, path: '/export' },
  { label: 'Tech Docs', icon: FileText, path: '/docs' },
];
