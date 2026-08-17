import React from 'react';
import { motion } from 'framer-motion';
import { useMigration } from '@/store/migration-store';
import { OBJS } from '@/data/sap-schemas';
import { esc } from '@/lib/utils';
import { PageLayout, PageGrid, GridCol, Badge, Card, CardHeader, CardBody, InfoBox } from '@/components/shared';

import { User, Users, Briefcase, Award, DollarSign, CreditCard, Coins, Building2, Package } from 'lucide-react';

const objIcons: Record<string, React.ReactNode> = {
  user: <User className="w-4 h-4" />,
  users: <Users className="w-4 h-4" />,
  briefcase: <Briefcase className="w-4 h-4" />,
  award: <Award className="w-4 h-4" />,
  'dollar-sign': <DollarSign className="w-4 h-4" />,
  'credit-card': <CreditCard className="w-4 h-4" />,
  coins: <Coins className="w-4 h-4" />,
  building: <Building2 className="w-4 h-4" />,
  package: <Package className="w-4 h-4" />
};

export function Step9TechDocs() {
  const { state } = useMigration();

  return (
    <PageLayout>
      <div className="max-w-[1080px] mx-auto space-y-6 bg-[var(--bg-secondary)] border border-[var(--border)] shadow-[var(--shadow-sm)] rounded-xl p-8">
        <div>
          <h1 className="text-2xl font-black text-[var(--text-primary)] tracking-tight">Technical Documentation</h1>
          <p className="text-[13px] text-[var(--text-secondary)] mt-1">SuccessFactors Data Migration Studio — Complete Architecture, Design & Implementation Reference</p>
          <div className="flex gap-2 flex-wrap mt-3">
            <Badge variant="blue">Vanilla JS ES6+</Badge>
            <Badge variant="cyan">Advanced LLM Engine</Badge>
            <Badge variant="green">Zero Dependencies</Badge>
            <Badge variant="violet">7 SF Objects</Badge>
            <Badge variant="teal">9-Step Pipeline</Badge>
            <Badge variant="amber">DMC/LTMC Ready</Badge>
          </div>
        </div>

        {/* 1. Architecture */}
        <Section title="1. Architecture Overview">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ArchBox title="Single-File Architecture" code={`sap-migration-studio-v3.html (self-contained)
├── CSS Design System
│   ├── CSS variables (all colors/spacing)
│   ├── Component library (cards, buttons, tables)
│   └── Animation keyframes
├── JavaScript Core
│   ├── S{} — Global state object
│   ├── SAMPLE{} — Embedded test data
│   ├── OBJS{} — SAP field schemas
│   ├── *_MAP — Transform dictionaries
│   ├── TRANSFORMS{} — 10 transform rules
│   ├── DMC_COLS{} — Export templates
│   ├── Navigation engine
│   ├── LLM API integration
│   ├── 9× page renderers (rP0–rP8)
│   └── Utility functions
└── HTML skeleton (9 page divs)`} />
            <ArchBox title="Global State Object (S)" code={`const S = {
  // Configuration
  src: 'SAP_ECC',
  obj: 'CUSTOMER',
  cc: '1000', so, po, plant, curr,
  // Data pipeline stages
  rawData: [],     // source rows
  headers: [],     // source fields
  mapping: [],     // AI mappings
  extracted: [],   // mapped rows
  harmonized: [],  // deduped+coded
  validated: [],   // with errors[]
  cleaned: [],     // auto-fixed
  transformed: [], // SAP-format
  dmcRows: [],     // export-ready
  aiLog: [],       // audit trail
  fixLog: [],      // cleanse fixes
  stats: {}        // counters
}`} />
          </div>
        </Section>

        {/* 2. AI Integration */}
        <Section title="2. AI Engine Integration">
          <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed mb-3">
            The studio calls the AI API at 5 stages. All calls use a consistent <code className="font-mono text-primary-600 dark:text-primary-400 bg-[var(--bg-tertiary)] px-1 rounded">ai()</code> wrapper with JSON response parsing.
          </p>
          <div className="rounded-xl border border-[var(--border)] overflow-auto">
            <table className="w-full border-collapse text-[12px] whitespace-nowrap">
              <thead>
                <tr className="bg-[var(--bg-tertiary)]">
                  {['Stage','AI Task','Prompt Pattern','Response Format','Fallback'].map((h) => (
                    <th key={h} className="px-3 py-2.5 text-left font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] border-b border-[var(--border)]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-[var(--text-secondary)]">
                {[
                  [<Badge variant="blue">Step 2</Badge>,'Semantic field matching','Source fields + SAP schema → match','JSON array [{src,sap,conf,tr}]','algorithmicMap()'],
                  [<Badge variant="cyan">Step 3</Badge>,'Quality analysis','Sample data → issues + score','JSON {score, issues[]}','Skip AI panel'],
                  [<Badge variant="teal">Step 4</Badge>,'Code conversion gaps','Harmonized sample → remaining gaps','JSON {score, issues[]}','Skip AI panel'],
                  [<Badge variant="violet">Step 7</Badge>,'Custom transform rules','Sample + config → rules','JSON [{field,rule,default}]','Standard transforms'],
                  [<Badge variant="green">Step 8</Badge>,'Upload readiness check','DMC sample → blockers + score','JSON {score, blockers[]}','Manual review'],
                ].map((row, ri) => (
                  <tr key={ri} className="hover:bg-[var(--bg-tertiary)]/50">
                    {row.map((cell, ci) => <td key={ci} className="px-3 py-2 border-b border-[var(--border-light)]">{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* 3-6 Additional Sections */}
        <Section title="3. Field Mapping Algorithm">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ArchBox title="5-Strategy Auto-Mapping (Fallback)" code={`function autoMap() {
  // Strategy 1: Exact name match → 90%
  if(hu === fn) score = 90;
  // Strategy 2: Semantic synonym dict → 90%
  else if(synonyms.includes(hu)) score = 90;
  // Strategy 3: Contains match → 72%
  else if(hu.includes(fn)||fn.includes(hu)) score=72;
  // Strategy 4: Transform inference
  const tr = inferTr(srcField, sapField, type);
  // Only include if score >= 40
}`} />
            <ArchBox title="Transform Auto-Inference" code={`function inferTr(src, tgt, type) {
  if(['KUNNR','LIFNR'].includes(tgt))
    return 'pad10';     // 5→0000000005
  if(tgt==='LAND1'||src.includes('COUNTRY'))
    return 'country';   // INDIA→IN
  if(type==='CUKY'||tgt==='WAERS')
    return 'currency';  // RUPEE→INR
  if(tgt==='ZTERM')
    return 'payterm';   // NET30→NT30
  if(tgt==='MTART')
    return 'mattype';   // FINISHED→FERT
  return 'trim';
}`} />
          </div>
        </Section>

        <Section title="4. Validation Engine">
          <ArchBox title="Two-layer validation" code={`// Layer 1: Required field check
if(f.req && !sv) errs.push({f:f.n, m:'Required empty'});

// Layer 2: Type/format rules
if(f.t==='CUKY' && !/^[A-Z]{3}$/.test(sv))  warns: '3-letter ISO'
if(f.t==='DATS' && !/^\\d{8}$/.test(sv))     warns: 'YYYYMMDD'
if(f.n==='LAND1' && !/^[A-Z]{2,3}$/.test(sv)) errs: 'ISO 2-3 chars'
if(f.n==='KUNNR' && !/^\\d{0,10}$/.test(sv))   errs: 'Numeric ≤10'
if(f.n==='SMTP_ADDR' && !emailRegex.test(sv)) warns: 'Email format'
if(f.len && sv.length>f.len)                   errs: 'Exceeds max length'

// Result per record
return {row, idx, errs, warns, st: errs.length?'ERROR':warns.length?'WARN':'PASS'}`} />
        </Section>

        <Section title="5. Data Cleansing Rules (10 Auto-Fix Operations)">
          <div className="rounded-xl border border-[var(--border)] overflow-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="bg-[var(--bg-tertiary)]">
                  {['#','Fix','Example','Fields'].map((h) => (
                    <th key={h} className="px-3 py-2.5 text-left font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] border-b border-[var(--border)]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-[var(--text-secondary)]">
                {[
                  ['1','Trim whitespace','" IBM " → "IBM"','All CHAR fields'],
                  ['2','Country→ISO','"INDIA" → "IN"','LAND1'],
                  ['3','Currency→ISO','"RUPEE" → "INR"','WAERS (CUKY)'],
                  ['4','Payment Terms→SAP','"NET30" → "NT30"','ZTERM'],
                  ['5','Material Type→SAP','"FINISHED GOODS" → "FERT"','MTART'],
                  ['6','Pad numeric IDs','"12345" → "0000012345"','KUNNR, LIFNR'],
                  ['7','UPPERCASE codes','"in" → "IN"','LAND1, WAERS, org fields'],
                  ['8','Clean tax numbers','"AAB-CI0932G!" → "AABCI0932G"','STCD1, STCD2'],
                  ['9','Truncate overlength','40-char→35 max for NAME1','All fields with max len'],
                  ['10','Fill null fields','undefined/null → ""','All fields'],
                ].map((row, ri) => (
                  <tr key={ri} className="hover:bg-[var(--bg-tertiary)]/50">
                    {row.map((cell, ci) => <td key={ci} className="px-3 py-2 border-b border-[var(--border-light)] font-mono text-[11px]">{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="6. SAP Object Schemas">
          <div className="rounded-xl border border-[var(--border)] overflow-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="bg-[var(--bg-tertiary)]">
                  {['Object','T-Code','Module','DMC Template','Fields','Required','Key Field'].map((h) => (
                    <th key={h} className="px-3 py-2.5 text-left font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] border-b border-[var(--border)]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-[var(--text-secondary)]">
                {Object.entries(OBJS)
                  .filter(([k]) => !['BIOGRAPHICAL INFO', 'PERSONAL INFO', 'EMPLOYMENT DETAILS', 'JOB INFO', 'COMPENSATION INFO', 'PAY COMPONENT RECURRING', 'PAY COMPONENT NON RECURRING'].includes(k))
                  .map(([k, v]) => (
                  <tr key={k} className="hover:bg-[var(--bg-tertiary)]/50">
                    <td className="px-3 py-2 border-b border-[var(--border-light)]"><Badge variant="blue">{objIcons[v.icon as keyof typeof objIcons]} {k}</Badge></td>
                    <td className="px-3 py-2 border-b border-[var(--border-light)] font-mono text-[11px]">{v.tcode}</td>
                    <td className="px-3 py-2 border-b border-[var(--border-light)]"><Badge variant="violet">{v.module}</Badge></td>
                    <td className="px-3 py-2 border-b border-[var(--border-light)] font-mono text-[10px]">{v.dmc}</td>
                    <td className="px-3 py-2 border-b border-[var(--border-light)] font-mono">{v.fields.length}</td>
                    <td className="px-3 py-2 border-b border-[var(--border-light)] font-mono text-red-500">{v.fields.filter((f) => f.req).length}</td>
                    <td className="px-3 py-2 border-b border-[var(--border-light)] font-mono text-teal-500">{v.fields.find((f) => f.key)?.n || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* 10. AI Log */}
        <Section title="7. Session AI Log">
          {state.aiLog.length ? (
            state.aiLog.map((l, i) => (
              <Card key={i} className="mb-3">
                <CardBody className="py-3">
                  <div className="flex justify-between mb-1.5">
                    <Badge variant="cyan">AI Call #{i + 1}</Badge>
                    <span className="font-mono text-[9.5px] text-[var(--text-tertiary)]">{l.ts}</span>
                  </div>
                  <div className="text-[11px] text-[var(--text-secondary)]">Prompt: {l.p}</div>
                  <div className="text-[11px] text-[var(--text-tertiary)] mt-1">Response: {l.r}</div>
                </CardBody>
              </Card>
            ))
          ) : (
            <InfoBox variant="info" className="text-center">
              No AI calls yet this session — start the pipeline to see activity here.
            </InfoBox>
          )}
        </Section>
      </div>
    </PageLayout>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-base font-extrabold text-teal-600 dark:text-teal-400 mb-3 flex items-center gap-2 pb-2 border-b border-[var(--border)]">
        <span className="w-0.5 h-4 bg-teal-500 rounded-full" />
        {title}
      </h2>
      {children}
    </div>
  );
}

function ArchBox({ title, code }: { title: string; code: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] p-4">
      <div className="font-mono text-[10px] uppercase tracking-wider text-teal-600 dark:text-teal-400 font-bold mb-3">{title}</div>
      <pre className="rounded-lg bg-[var(--bg)] border border-[var(--border)] p-3 font-mono text-[10.5px] leading-[1.8] text-[var(--text-secondary)] overflow-x-auto whitespace-pre-wrap">
        {code}
      </pre>
    </div>
  );
}
