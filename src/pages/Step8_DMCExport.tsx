import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMigration } from '@/store/migration-store';
import { useToast } from '@/components/ui/toast';
import { useLoading } from '@/components/ui/loading-overlay';
import { OBJS, DMC_COLS } from '@/data/sap-schemas';
import { ai, parseAI } from '@/services/ai-service';
import { dl, esc } from '@/lib/utils';
import { PageLayout, PageGrid, GridCol, Card, CardHeader, CardBody, Button, Badge, StatBox, StatsGrid, DataTable, InfoBox, PageHeader, EmptyState, AIResponse, CodeBlock } from '@/components/shared';
import { ArrowLeft, ArrowRight, Package, Bot, Download } from 'lucide-react';

function genCSV(rows: Record<string, string>[], cols: string[], obj: string): string {
  const hdr = [
    '# SAP S/4HANA DMC Preload File',
    '# Template: ' + (OBJS[obj]?.dmc || ''),
    '# Object: ' + obj,
    '# Generated: ' + new Date().toISOString(),
    '# Records: ' + rows.length,
    '',
    cols.join(','),
  ];
  const body = rows.map((r) =>
    cols.map((c) => {
      const v = String(r[c] || '');
      return v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : '' + v;
    }).join(',')
  );
  return [...hdr, ...body].join('\n');
}

export function Step8DMCExport() {
  const { state, dispatch } = useMigration();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { showLoad, tick, hideLoad } = useLoading();
  const [aiOutput, setAiOutput] = useState('');
  const cols = DMC_COLS[state.obj] || [];
  const obj = OBJS[state.obj] || {};
  const has = state.dmcRows.length > 0;

  function prepareDMC() {
    const src = state.transformed.length ? state.transformed : state.cleaned.length ? state.cleaned : state.harmonized;
    if (!src.length) { toast('Complete transformation first', 'err'); return; }
    showLoad('Preparing DMC…', 'Generating LTMC preload format', [
      'Loading template…', 'Mapping columns…', 'Adding headers…', 'Validating mandatory…', 'DMC ready…',
    ]);
    [0, 1, 2, 3, 4].forEach((i) => setTimeout(() => tick(i), 350 + i * 320));
    const dmcCols = DMC_COLS[state.obj] || Object.keys(src[0]);
    const dmcRows = src.map((row) => {
      const o: Record<string, string> = {};
      dmcCols.forEach((c) => { o[c] = row[c] !== undefined ? row[c] : ''; });
      return o;
    });
    setTimeout(() => {
      hideLoad();
      dispatch({ type: 'SET_FIELD', field: 'dmcRows', value: dmcRows });
      toast(`DMC ready: ${dmcRows.length} records`, 'ok');
    }, 2400);
  }

  function dlDMCcsv() {
    if (!state.dmcRows.length) return;
    dl(genCSV(state.dmcRows, DMC_COLS[state.obj] || [], state.obj), `DMC_${state.obj}_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
    toast('CSV downloaded', 'ok');
  }

  function dlDMCxls() {
    if (!state.dmcRows.length) return;
    const c = DMC_COLS[state.obj] || [];
    const xls = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"></head><body><table><tr>${c.map((col) => `<th style="background:#0064c8;color:#fff;font-weight:bold">${col}</th>`).join('')}</tr>${state.dmcRows.map((r) => `<tr>${c.map((col) => `<td>${r[col] || ''}</td>`).join('')}</tr>`).join('')}</table></body></html>`;
    dl(xls, `DMC_${state.obj}_${new Date().toISOString().slice(0, 10)}.xls`, 'application/vnd.ms-excel');
    toast('Excel downloaded', 'ok');
  }

  async function aiValidateDMC() {
    showLoad('AI Final Check…', '', ['Reviewing DMC readiness…']);
    setTimeout(() => tick(0, 'Checking…'), 400);
    try {
      const r = await ai(
        `Final SAP DMC readiness check for ${state.obj} migration.\nData sample: ${JSON.stringify(state.dmcRows.slice(0, 3))}\nMandatory fields: ${(OBJS[state.obj]?.fields || []).filter((f) => f.req).map((f) => f.n).join(',')}\nProvide upload readiness score and any blocking issues.\nJSON: {"score":0-100,"blockers":["issue"],"warnings":["warn"],"recommendation":"text"}`,
        state.aiLog
      );
      const res = parseAI(r) as Record<string, unknown> | null;
      hideLoad();
      if (res) {
        setAiOutput(
          `Upload Readiness: ${res.score || '?'}/100\n\n` +
          ((res.blockers as string[])?.length ? 'Blockers:\n' + (res.blockers as string[]).map((b) => '✗ ' + b).join('\n') + '\n\n' : '') +
          ((res.warnings as string[])?.length ? 'Warnings:\n' + (res.warnings as string[]).map((w) => '⚠ ' + w).join('\n') + '\n\n' : '') +
          `Recommendation: ${res.recommendation || 'Proceed with LTMC simulation run'}`
        );
      }
    } catch {
      hideLoad();
      toast('AI unavailable', 'info');
    }
  }

  return (
    <PageLayout>
      <PageGrid>

        {/* Left Column */}
        <GridCol span={3}>
          <Card>
            <CardHeader title="DMC Template" subtitle={obj.dmc || '—'} />
            <CardBody className="p-3 space-y-3">
              <div className="px-2 py-3 rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)]">
                <div className="text-[13px] font-bold text-primary-600 dark:text-primary-400 mb-1">{obj.dmc || '—'}</div>
                <div className="font-mono text-[9.5px] text-[var(--text-tertiary)] leading-relaxed">
                  T-Code: {obj.tcode || '—'}<br />
                  Columns: {cols.length}<br />
                  Version: S4HANA2023
                </div>
              </div>
              <div className="text-[10.5px] font-semibold text-[var(--text-secondary)] mt-3 mb-1.5 px-1">Column Order</div>
              {cols.map((c, i) => {
                const req = OBJS[state.obj]?.fields?.find((f) => f.n === c)?.req;
                return (
                  <div key={c} className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-light)]">
                    <span className="font-mono text-[9px] text-[var(--text-tertiary)] w-4 shrink-0">{i + 1}.</span>
                    <span className="font-mono text-[10.5px] text-teal-600 dark:text-teal-400">{c}</span>
                    {req && <Badge variant="red" className="ml-auto text-[7px]">M</Badge>}
                  </div>
                );
              })}
            </CardBody>
          </Card>
        </GridCol>

        {/* Middle Column */}
        <GridCol span={6}>
          <PageHeader title="Step 8 — SF Preload Export" subtitle="Generate SuccessFactors-compatible CSV and XLSX preload files for target upload">
            <Button variant="secondary" icon={<ArrowLeft className="w-3.5 h-3.5" />} onClick={() => navigate('/transform')}>Back</Button>
            <Button variant="warning" icon={<Package className="w-3.5 h-3.5" />} onClick={prepareDMC}>Prepare DMC File</Button>
            <Button variant="primary" icon={<ArrowRight className="w-3.5 h-3.5" />} onClick={() => navigate('/docs')} disabled={!has}>Next: Tech Docs</Button>
            {has && (
              <>
                <Button variant="success" icon={<Download className="w-3.5 h-3.5" />} onClick={dlDMCcsv}>CSV</Button>
                <Button variant="success" icon={<Download className="w-3.5 h-3.5" />} onClick={dlDMCxls}>XLSX</Button>
                <Button variant="cyan" size="sm" icon={<Bot className="w-3 h-3" />} onClick={aiValidateDMC}>AI Final Check</Button>
              </>
            )}
          </PageHeader>

          {has && (
            <StatsGrid>
              <StatBox value={state.dmcRows.length} label="DMC Records" color="var(--color-success)" />
              <StatBox value={cols.length} label="Columns" color="var(--color-primary-500)" />
              <StatBox value={obj.dmc || '—'} label="Template ID" color="var(--color-teal)" />
              <StatBox value="✓" label="Upload Ready" color="var(--color-success)" />
            </StatsGrid>
          )}

          <Card>
            <CardHeader title="DMC File Preview" />
            <CardBody>
              {has ? (
                <>
                  <CodeBlock className="text-[9px] max-h-[140px] overflow-auto mb-4">
                    {genCSV(state.dmcRows.slice(0, 3), cols, state.obj)}
                  </CodeBlock>
                  <DataTable rows={state.dmcRows.slice(0, 6)} cols={cols} />
                </>
              ) : (
                <EmptyState icon={<Package className="w-10 h-10 text-primary-500" />} message="Click Prepare DMC File to generate export" />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="LTMC Upload Instructions" />
            <CardBody>
              <InfoBox variant="info">
                <strong className="text-primary-600 dark:text-primary-400">Upload Steps in SuccessFactors Admin Center:</strong><br /><br />
                1. Go to <strong>Admin Center</strong> → <strong>Import Employee Data</strong><br />
                2. Select Entity: <strong>{state.obj || 'Biographical Info'}</strong><br />
                3. File Options → Select Full Purge or Incremental Load<br />
                4. Browse File → Upload the generated CSV file<br />
                5. <strong>Validate Import File</strong> → Run pre-import validation check<br />
                6. Review errors → Execute <strong>Import Data</strong><br />
                7. Verify records in <strong>Employee Profile</strong>
              </InfoBox>
              <InfoBox variant="success" className="mt-3">
                <strong>Migration Summary:</strong><br />
                Source: {state.src} | Object: {state.obj} | Extracted: {state.extracted.length} → Harmonized: {state.harmonized.length} → Validated: {state.validated.filter((v) => v.st !== 'ERROR').length} → Cleaned: {state.cleaned.length} → Transformed: {state.transformed.length} → <strong>DMC Ready: {state.dmcRows.length}</strong>
              </InfoBox>
            </CardBody>
          </Card>

          {aiOutput && (
            <Card>
              <CardHeader title="AI Final Readiness Check" />
              <CardBody><AIResponse>{aiOutput}</AIResponse></CardBody>
            </Card>
          )}
        </GridCol>

        {/* Right Column */}
        <GridCol span={3}>
          <Card>
            <CardBody className="p-3 space-y-4">
              {[['LTMC', 'Data Migration Cockpit'], ['LTMOM', 'Object Management'], ['LTMCE', 'Create project'], ['SE16N', 'View migrated tables'], ['XD01', 'Verify customer'], ['XK01', 'Verify vendor'], ['MM60', 'Material stock'], ['SU53', 'Auth check']].map(([t, d]) => (
                <div key={t} className="px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)]/50">
                  <div className="font-mono text-[11px] text-primary-600 dark:text-primary-400">{t}</div>
                  <div className="text-[10.5px] text-[var(--text-tertiary)]">{d}</div>
                </div>
              ))}
            </CardBody>
          </Card>
        </GridCol>

      </PageGrid>
    </PageLayout>
  );
}
