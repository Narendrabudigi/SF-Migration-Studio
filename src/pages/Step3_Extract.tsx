import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMigration } from '@/store/migration-store';
import { useToast } from '@/components/ui/toast';
import { useLoading } from '@/components/ui/loading-overlay';
import { dl, expCSV } from '@/lib/utils';
import {
  PageLayout, PageGrid, GridCol, Card, CardHeader, CardBody, Button,
  StatBox, StatsGrid, DataTable, PageHeader, EmptyState
} from '@/components/shared';
import {
  ArrowLeft, ArrowRight, Zap, Download, ClipboardList,
  UploadCloud, AlertTriangle, Activity, CheckCircle, Save,
  BarChart2, ShieldAlert, Search, FileSpreadsheet, Layers, ChevronDown, ChevronUp,
  RefreshCw, CheckCircle2
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  CartesianGrid, Legend, Brush
} from 'recharts';
import { jsPDF } from 'jspdf';
import { TableFilterToolbar, filterRowsByKey, detectKeyColumns, getTableDisplayData } from '@/components/shared/TableFilterToolbar';
import type { TableInfo } from '@/components/shared/TableFilterToolbar';

export function Step3Extract() {
  const reportRef = useRef<HTMLDivElement>(null);
  const { state, dispatch } = useMigration();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { showLoad, tick, hideLoad } = useLoading();
  const [rowLimit, setRowLimit] = useState(5000);
  const [activeTab, setActiveTab] = useState<'table' | 'completeness' | 'cardinality'>('table');
  const [edaSearch, setEdaSearch] = useState('');
  const [edaSort, setEdaSort] = useState<'default' | 'null_desc' | 'anomalies_desc' | 'name'>('default');
  const [showAllRisks, setShowAllRisks] = useState(false);
  const [showAllActions, setShowAllActions] = useState(false);

  // Table filter state
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [keyFilterValue, setKeyFilterValue] = useState('');

  // Persistent data from global migration state
  const extractedTables = state.extractedTables || [];
  const edaStats = state.edaStats || [];
  const reportMetrics = state.reportMetrics || {
    score: 100,
    grade: 'A',
    healthy: 0,
    warning: 0,
    critical: 0,
    total_anomalies: 0,
    totalFields: edaStats.length || 0,
    totalRecords: state.extracted.length || 0,
    title: `Data Quality Intelligence Report: ${state.obj} Master Data`,
    summary: 'Exploratory Data Analysis and validation report.',
    warnings: [],
    recommendations: []
  };
  const complianceData = state.complianceData || [
    { name: 'Mandatory', Healthy: 0, Warning: 0, Critical: 0, Total: 0 },
    { name: 'Optional', Healthy: 0, Warning: 0, Critical: 0, Total: 0 }
  ];
  const aiSummary = state.aiReport || null;

  const has = state.extracted.length > 0 || extractedTables.length > 0;

  // Initialize selectedTables when extractedTables change
  useEffect(() => {
    if (extractedTables.length > 0) {
      setSelectedTables(new Set(extractedTables.map((t: any) => t.table_name)));
    }
  }, [extractedTables.length]);

  // Load saved extraction from Supabase on mount
  useEffect(() => {
    if (!state.projectId) return;

    const loadSaved = async () => {
      try {
        const objName = state.obj || 'Biographical Info';
        const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/extract/load/${state.projectId}?target_object=${encodeURIComponent(objName)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'success' && data.data && data.data.length > 0) {
            if (!state.extracted || state.extracted.length === 0) {
              dispatch({ type: 'SET_FIELD', field: 'extracted', value: data.data });
              dispatch({ type: 'SET_FIELD', field: 'isDataSaved', value: true });
            }
            if (data.tables && data.tables.length > 0 && (!state.extractedTables || state.extractedTables.length === 0)) {
              dispatch({ type: 'SET_FIELD', field: 'extractedTables', value: data.tables });
            }
          }
        }
      } catch (err) {
        console.error('Failed to load saved extraction:', err);
      }
    };

    loadSaved();
  }, [state.projectId, state.obj]);

  // Auto-hydrate EDA stats and tables if state has extracted data but missing metrics on page switch
  useEffect(() => {
    if (state.extracted && state.extracted.length > 0 && (!state.edaStats || state.edaStats.length === 0)) {
      const objName = state.obj || 'Biographical Info';
      const rawPayload = (state.uploadedData && state.uploadedData.length > 0) ? state.uploadedData : (state.rawData && state.rawData.length > 0 ? state.rawData : null);

      if (rawPayload) {
        fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/extract/execute_file`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            target_object: objName,
            mappings: state.mapping,
            raw_data: rawPayload
          })
        })
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data) {
            dispatch({ type: 'SET_FIELD', field: 'edaStats', value: data.eda_stats || [] });
            dispatch({ type: 'SET_FIELD', field: 'reportMetrics', value: data.summary_metrics || null });
            dispatch({ type: 'SET_FIELD', field: 'complianceData', value: data.compliance_data || [] });
            if (data.tables && (!state.extractedTables || state.extractedTables.length === 0)) {
              dispatch({ type: 'SET_FIELD', field: 'extractedTables', value: data.tables });
            }
            if (data.aiAnalysis?.report && !state.aiReport) {
              dispatch({ type: 'SET_FIELD', field: 'aiReport', value: data.aiAnalysis.report });
            }
          }
        })
        .catch(err => console.error('Failed to auto-hydrate EDA stats:', err));
      } else {
        fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/extract/eda_report`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            target_object: objName,
            mappings: state.mapping,
            records: state.extracted
          })
        })
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data) {
            dispatch({ type: 'SET_FIELD', field: 'edaStats', value: data.eda_stats || [] });
            dispatch({ type: 'SET_FIELD', field: 'reportMetrics', value: data.summary_metrics || null });
            dispatch({ type: 'SET_FIELD', field: 'complianceData', value: data.compliance_data || [] });
            if (data.tables && (!state.extractedTables || state.extractedTables.length === 0)) {
              dispatch({ type: 'SET_FIELD', field: 'extractedTables', value: data.tables });
            }
            if (data.aiAnalysis?.report && !state.aiReport) {
              dispatch({ type: 'SET_FIELD', field: 'aiReport', value: data.aiAnalysis.report });
            }
          }
        })
        .catch(err => console.error('Failed to auto-hydrate EDA report:', err));
      }
    }
  }, [state.extracted, state.edaStats, state.mapping, state.obj, dispatch, state.extractedTables, state.aiReport, state.uploadedData, state.rawData]);

  const saveDataToDB = async () => {
    if (!state.projectId) {
      toast('No project ID found. Please create a project first.', 'err');
      return;
    }

    showLoad('Saving data...', 'Persisting extracted records to database');
    try {
      const currentTables = extractedTables.length > 0 ? extractedTables : (state.extractedTables || []);
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/extract/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: state.projectId,
          target_object: state.obj,
          payload: state.extracted,
          tables: currentTables
        })
      });

      if (!res.ok) throw new Error('Failed to save data');

      hideLoad();
      dispatch({ type: 'SET_FIELD', field: 'extractedTables', value: currentTables });
      dispatch({ type: 'SET_FIELD', field: 'isDataSaved', value: true });
      toast('Extracted data saved to database successfully!', 'ok');
    } catch (err: any) {
      hideLoad();
      toast(err.message || 'Failed to save data', 'err');
    }
  };

  const doExtract = async () => {
    if (!state.src) { toast('Please configure a source first.', 'err'); return; }
    if (state.mapping.length === 0) { toast('Please map fields before extracting.', 'err'); return; }

    dispatch({ type: 'SET_FIELD', field: 'aiReport', value: null });

    if (state.src === 'LIVE_SAP') {
      showLoad('Extracting from SAP…', 'Connecting to live system and generating AI Quality Report', [
        'Connecting source…', 'Running $select query…', 'Applying mapping…', 'Running transforms…', 'LLM triggered…',
      ]);
      [0, 1, 2, 3].forEach((i) => setTimeout(() => tick(i), 400 + i * 500));

      try {
        const objName = state.obj || 'Biographical Info';
        const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/extract/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            base_url: state.connUrl,
            client: state.connClient,
            username: state.connUser,
            password: state.connPass,
            target_object: objName,
            mappings: state.mapping,
            system_type: state.src
          })
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.detail || 'Extraction failed');
        }

        const data = await res.json();
        tick(4, 'AI analysis done');

        setTimeout(() => {
          hideLoad();
          dispatch({ type: 'SET_FIELD', field: 'extracted', value: data.data || [] });
          dispatch({ type: 'SET_FIELD', field: 'extractedTables', value: data.tables || [] });
          dispatch({ type: 'SET_FIELD', field: 'edaStats', value: data.eda_stats || [] });
          dispatch({ type: 'SET_FIELD', field: 'reportMetrics', value: data.summary_metrics || null });
          dispatch({ type: 'SET_FIELD', field: 'complianceData', value: data.compliance_data || [] });
          dispatch({ type: 'SET_FIELD', field: 'aiReport', value: data.aiAnalysis?.report || data.aiAnalysis || null });
          toast(`Extracted ${data.data?.length || 0} records from live SAP`, 'ok');
        }, 1200);
      } catch (err: any) {
        hideLoad();
        toast(err.message, 'err');
      }
    } else {
      // EXCEL_CSV, ORACLE_EBS, or other data sources
      showLoad('Extracting Data…', 'Processing source records and generating Quality Report', [
        'Reading records…', 'Applying mapping…', 'Running transforms…', 'LLM triggered…',
      ]);
      [0, 1, 2, 3].forEach((i) => setTimeout(() => tick(i), 300 + i * 400));

      try {
        const objName = state.obj || 'Biographical Info';
        const rawPayload = (state.uploadedData && state.uploadedData.length > 0) ? state.uploadedData : (state.rawData || []);
        const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/extract/execute_file`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            target_object: objName,
            mappings: state.mapping,
            raw_data: rawPayload
          })
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.detail || 'Extraction failed');
        }

        const data = await res.json();
        tick(4, 'AI analysis done');

        setTimeout(() => {
          hideLoad();
          dispatch({ type: 'SET_FIELD', field: 'extracted', value: data.data || [] });
          dispatch({ type: 'SET_FIELD', field: 'extractedTables', value: data.tables || [] });
          dispatch({ type: 'SET_FIELD', field: 'edaStats', value: data.eda_stats || [] });
          dispatch({ type: 'SET_FIELD', field: 'reportMetrics', value: data.summary_metrics || null });
          dispatch({ type: 'SET_FIELD', field: 'complianceData', value: data.compliance_data || [] });
          dispatch({ type: 'SET_FIELD', field: 'aiReport', value: data.aiAnalysis?.report || data.aiAnalysis || null });
          toast(`Processed ${data.data?.length || 0} records`, 'ok');
        }, 1200);
      } catch (err: any) {
        hideLoad();
        toast(err.message, 'err');
      }
    }
  };

  // Sorted & Filtered list for UI display and interactive charts
  const displayEdaStats = useMemo(() => {
    let list = [...edaStats];
    if (edaSearch.trim()) {
      list = list.filter((r: any) => String(r.field || '').toLowerCase().includes(edaSearch.toLowerCase()));
    }
    if (edaSort === 'null_desc') {
      list.sort((a, b) => (b.null_count || 0) - (a.null_count || 0));
    } else if (edaSort === 'anomalies_desc') {
      list.sort((a, b) => (b.format_anomaly_count || 0) - (a.format_anomaly_count || 0));
    } else if (edaSort === 'name') {
      list.sort((a, b) => String(a.field).localeCompare(String(b.field)));
    }
    return list;
  }, [edaStats, edaSearch, edaSort]);

  // Clean Vector PDF Generator using jsPDF
  const exportToPDF = () => {
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();

      // Palette
      const primaryColor = [14, 116, 144]; // Deep Teal
      const darkText = [30, 41, 59];
      const lightBg = [248, 250, 252];

      // Header Banner
      doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.rect(0, 0, pageWidth, 28, 'F');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.setTextColor(255, 255, 255);
      doc.text('SAP Migration Studio — Data Quality Report', 14, 14);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(`Generated: ${new Date().toLocaleDateString()} | Target Object: ${state.obj}`, 14, 22);

      let yPos = 36;

      // Executive Title
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.setTextColor(darkText[0], darkText[1], darkText[2]);
      doc.text(reportMetrics.title, 14, yPos);
      yPos += 8;

      // Scorecard Box
      doc.setFillColor(lightBg[0], lightBg[1], lightBg[2]);
      doc.roundedRect(14, yPos, pageWidth - 28, 22, 3, 3, 'F');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.text(`Overall Data Readiness Score: ${reportMetrics.score} / 100  (Grade ${reportMetrics.grade})`, 20, yPos + 9);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.text(`Total Records: ${state.extracted.length}  |  Total Mapped Fields: ${reportMetrics.totalFields}  |  Healthy: ${reportMetrics.healthy}  |  Warning: ${reportMetrics.warning}  |  Critical: ${reportMetrics.critical}`, 20, yPos + 16);

      yPos += 28;

      // Executive Summary
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(darkText[0], darkText[1], darkText[2]);
      doc.text('1. Executive Summary', 14, yPos);
      yPos += 6;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(71, 85, 105);
      const splitSummary = doc.splitTextToSize(reportMetrics.summary, pageWidth - 28);
      doc.text(splitSummary, 14, yPos);
      yPos += (splitSummary.length * 4.5) + 6;

      // Critical Risks
      if (reportMetrics.warnings.length > 0) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(220, 38, 38);
        doc.text('2. Critical Data Quality Risks', 14, yPos);
        yPos += 6;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(127, 29, 29);

        reportMetrics.warnings.forEach((w: string) => {
          const cleanW = w.replace(/^\*\*(.*?)\*\*/, '$1').replace(/^\*/, '').trim();
          const splitW = doc.splitTextToSize(`•  ${cleanW}`, pageWidth - 32);
          doc.text(splitW, 18, yPos);
          yPos += (splitW.length * 4) + 2;
        });
        yPos += 4;
      }

      // Recommendations / Action Plan
      if (reportMetrics.recommendations.length > 0) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(darkText[0], darkText[1], darkText[2]);
        doc.text('3. Recommended Action Plan', 14, yPos);
        yPos += 6;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(71, 85, 105);

        reportMetrics.recommendations.forEach((r: string, idx: number) => {
          const cleanR = r.replace(/^\*\*(.*?)\*\*/, '$1').replace(/^\*/, '').trim();
          const splitR = doc.splitTextToSize(`${idx + 1}. ${cleanR}`, pageWidth - 32);
          doc.text(splitR, 18, yPos);
          yPos += (splitR.length * 4) + 2;
        });
        yPos += 6;
      }

      // Page Break for Table if necessary
      if (yPos > 210) {
        doc.addPage();
        yPos = 20;
      }

      // Field Statistics Table
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(darkText[0], darkText[1], darkText[2]);
      doc.text('4. Field Completeness & Statistics Breakdown', 14, yPos);
      yPos += 8;

      // Table Header
      doc.setFillColor(241, 245, 249);
      doc.rect(14, yPos, pageWidth - 28, 7, 'F');

      doc.setFontSize(8.5);
      doc.setTextColor(71, 85, 105);
      doc.text('Field Name', 18, yPos + 5);
      doc.text('Null Count', 85, yPos + 5);
      doc.text('Null %', 115, yPos + 5);
      doc.text('Completeness %', 142, yPos + 5);
      doc.text('Status', 178, yPos + 5);
      yPos += 7;

      doc.setFont('helvetica', 'normal');
      edaStats.forEach((stat: any, index: number) => {
        if (yPos > 275) {
          doc.addPage();
          yPos = 20;
        }

        if (index % 2 === 1) {
          doc.setFillColor(248, 250, 252);
          doc.rect(14, yPos, pageWidth - 28, 6, 'F');
        }

        const nullPct = stat.null_percentage ?? 0;
        const compPct = (100 - nullPct).toFixed(1);
        const status = stat.status || (nullPct <= 10 ? 'HEALTHY' : nullPct <= 50 ? 'WARNING' : 'CRITICAL');

        doc.setTextColor(darkText[0], darkText[1], darkText[2]);
        doc.text(String(stat.field).substring(0, 30), 18, yPos + 4.5);
        doc.text(String(stat.null_count ?? Math.round((nullPct / 100) * state.extracted.length)), 85, yPos + 4.5);
        doc.text(`${nullPct}%`, 115, yPos + 4.5);
        doc.text(`${compPct}%`, 142, yPos + 4.5);

        if (status === 'HEALTHY') doc.setTextColor(16, 185, 129);
        else if (status === 'WARNING') doc.setTextColor(245, 158, 11);
        else doc.setTextColor(239, 68, 68);

        doc.text(status, 178, yPos + 4.5);
        yPos += 6;
      });

      doc.save(`Data_Quality_Report_${state.obj}.pdf`);
      toast('Executive PDF Report exported successfully!', 'ok');
    } catch (err: any) {
      console.error(err);
      toast('Failed to generate PDF report', 'err');
    }
  };

  return (
    <PageLayout>
      <PageGrid>

        {/* Main Column */}
        <GridCol span={12}>
          <PageHeader title="Step 3 — Data Extraction" subtitle="Pull legacy data and validate against Mapping schemas">
            <div className="flex items-center gap-2 mr-4">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">Row Limit:</span>
              <input type="number" value={rowLimit} onChange={(e) => setRowLimit(Number(e.target.value))} className="w-20 rounded-md border border-[var(--border)] bg-[var(--bg-tertiary)] px-2 py-1 text-[11px] text-[var(--text-primary)] outline-none" />
            </div>
            <Button variant="secondary" icon={<ArrowLeft className="w-3.5 h-3.5" />} onClick={() => navigate('/mapping')}>Back</Button>
            <div title={state.mapping.length === 0 ? "You must complete Step 2 (AI Mapping) before extracting data." : ""}>
              <Button variant="cyan" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={doExtract} disabled={state.mapping.length === 0}>Run Extraction</Button>
            </div>
            <div title={!has ? "Run an extraction first before saving." : ""}>
              <Button variant="secondary" icon={<Save className="w-3.5 h-3.5" />} onClick={saveDataToDB} disabled={!has}>Save Data</Button>
            </div>
            <div title={!state.isDataSaved ? "You must save your data before proceeding to Step 4." : ""}>
              <Button variant="primary" icon={<ArrowRight className="w-3.5 h-3.5" />} onClick={() => navigate('/harmonize')} disabled={!state.isDataSaved}>Next: Harmonize</Button>
            </div>
          </PageHeader>

          {has && (
            <StatsGrid>
              <StatBox value={state.extracted.length} label="Records Extracted" subtitle="Source rows" color="var(--color-primary-500)" />
              <StatBox value={state.headers.length || Object.keys(state.extracted[0] || {}).length} label="Source Columns" color="var(--color-teal)" />
              <StatBox value={state.mapping.length} label="Fields Mapped" color="var(--color-success)" />
              <StatBox value={state.mapping.filter((m) => m.tr && m.tr !== 'none').length} label="Transforms" color="var(--color-warning)" />
            </StatsGrid>
          )}

          {has ? (
            <div className="space-y-6">
              {/* Table Filter Toolbar */}
              {(() => {
                const allTables: TableInfo[] = extractedTables.length > 0 
                  ? extractedTables 
                  : [{ table_name: 'Extracted Records', columns: Object.keys(state.extracted[0] || {}) }];
                const visibleTables = allTables.filter((t: any) => selectedTables.has(t.table_name));
                // Collect all key columns across all tables for filtering
                const allKeyColumns = detectKeyColumns(allTables.flatMap((t: any) => t.columns));
                const filteredRows = filterRowsByKey(state.extracted, keyFilterValue, allKeyColumns).slice(0, rowLimit);

                return (
                  <>
                    <TableFilterToolbar
                      tables={allTables}
                      selectedTables={selectedTables}
                      onSelectedTablesChange={setSelectedTables}
                      keyFilterValue={keyFilterValue}
                      onKeyFilterChange={setKeyFilterValue}
                      keyColumns={allKeyColumns}
                      accentColor="cyan"
                    />
                    {visibleTables.length === 0 ? (
                      <div className="p-8 text-center rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/30 text-gray-500 dark:text-gray-400 text-xs font-medium">
                        No tables selected. Click <strong>Tables Selected</strong> above to choose tables to view.
                      </div>
                    ) : (
                      visibleTables.map((t: any) => {
                        const { columns: tableCols, rows: tableRows } = getTableDisplayData(t, filteredRows, state.mapping);
                        return (
                          <Card key={t.table_name}>
                            <CardHeader title={`Extracted Records: ${t.table_name}`}>
                              <div className="ml-auto flex items-center gap-2">
                                <span className="text-[11px] text-[var(--text-secondary)] mr-2 font-mono">
                                  {tableCols.length} fields · {tableRows.length} rows{keyFilterValue ? ' (filtered)' : ''}
                                </span>
                                <Button 
                                  variant="secondary" 
                                  size="sm" 
                                  icon={<Download className="w-3 h-3" />} 
                                  onClick={() => dl(expCSV(tableRows), `${t.table_name.replace(/[\s/]+/g, '_').toLowerCase()}_extracted.csv`, 'text/csv')}
                                >
                                  Export {t.table_name}
                                </Button>
                              </div>
                            </CardHeader>
                            <CardBody>
                              <DataTable rows={tableRows} cols={tableCols} />
                            </CardBody>
                          </Card>
                        );
                      })
                    )}
                  </>
                );
              })()}
            </div>
          ) : (
            <Card>
              <CardHeader title="Extracted Mapped Records" />
              <CardBody>
                <EmptyState icon={<UploadCloud className="w-10 h-10 text-primary-500" />} message="Run extraction to see mapped data" />
              </CardBody>
            </Card>
          )}
        </GridCol>


      </PageGrid>

      {/* ───────────────────────────────────────────────────── */}
      {/*     DATA QUALITY INTELLIGENCE REPORT (FULL WIDTH)    */}
      {/* ───────────────────────────────────────────────────── */}
      {(state.aiReport || edaStats.length > 0) && (
        <div ref={reportRef} className="mt-8 mb-12 space-y-6">

          {/* ── Main Executive Container ── */}
          <div className="bg-[var(--bg-tertiary)]/40 border border-[var(--border)] rounded-2xl p-6 shadow-xl backdrop-blur-sm space-y-6">

            {/* ── Top Bar Header ── */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[var(--border)]">
              <div className="flex items-center gap-3.5">
                <div className="p-3 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-500 shadow-sm shrink-0">
                  <Activity className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h2 className="text-xl font-extrabold tracking-tight text-[var(--text-primary)]">
                      Data Quality Intelligence Report
                    </h2>
                    <span className="text-[10px] px-2.5 py-0.5 rounded-full font-mono font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 shadow-sm">
                      Grade {reportMetrics.grade} · {reportMetrics.score}/100 Score
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-[var(--text-secondary)] mt-1 font-medium">
                    <span className="flex items-center gap-1"><Layers className="w-3.5 h-3.5 text-indigo-500" /> Target Object: <strong className="text-[var(--text-primary)]">{state.obj}</strong></span>
                    <span>•</span>
                    <span className="flex items-center gap-1"><FileSpreadsheet className="w-3.5 h-3.5 text-teal-500" /> <strong className="text-[var(--text-primary)]">{state.extracted.length}</strong> Records Analyzed</span>
                    <span>•</span>
                    <span>{reportMetrics.totalFields} Mapped Fields</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" icon={<Download className="w-3.5 h-3.5 text-indigo-500" />} onClick={exportToPDF}>
                  Export Vector PDF
                </Button>
                <Button variant="secondary" size="sm" icon={<Download className="w-3.5 h-3.5 text-teal-500" />} onClick={() => dl(expCSV(state.extracted), 'extracted_summary.csv', 'text/csv')}>
                  Export CSV
                </Button>
              </div>
            </div>

            {/* ── Executive Scorecard Cards ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-[var(--bg-primary)] border border-[var(--border)] rounded-xl p-4 shadow-sm border-l-4 border-l-indigo-500 flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] mb-1">Readiness Score</div>
                  <div className="text-2xl font-black text-indigo-500 font-mono leading-none">{reportMetrics.score}<span className="text-xs font-normal text-[var(--text-tertiary)]"> / 100</span></div>
                  <div className="text-[10px] text-[var(--text-secondary)] mt-1.5 font-semibold">Grade {reportMetrics.grade} Rating</div>
                </div>
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-500 font-black text-base font-mono flex items-center justify-center border border-indigo-500/20">
                  {reportMetrics.grade}
                </div>
              </div>

              <div className="bg-[var(--bg-primary)] border border-[var(--border)] rounded-xl p-4 shadow-sm border-l-4 border-l-emerald-500 flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] mb-1">Healthy Fields</div>
                  <div className="text-2xl font-black text-emerald-500 font-mono leading-none">{reportMetrics.healthy}</div>
                  <div className="text-[10px] text-[var(--text-tertiary)] mt-1.5">&lt;10% null rate</div>
                </div>
                <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
              </div>

              <div className="bg-[var(--bg-primary)] border border-[var(--border)] rounded-xl p-4 shadow-sm border-l-4 border-l-amber-500 flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] mb-1">Warning Fields</div>
                  <div className="text-2xl font-black text-amber-500 font-mono leading-none">{reportMetrics.warning}</div>
                  <div className="text-[10px] text-[var(--text-tertiary)] mt-1.5">10% – 50% null rate</div>
                </div>
                <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20">
                  <AlertTriangle className="w-5 h-5" />
                </div>
              </div>

              <div className="bg-[var(--bg-primary)] border border-[var(--border)] rounded-xl p-4 shadow-sm border-l-4 border-l-red-500 flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] mb-1">Critical Fields</div>
                  <div className="text-2xl font-black text-red-500 font-mono leading-none">{reportMetrics.critical}</div>
                  <div className="text-[10px] text-[var(--text-tertiary)] mt-1.5">&gt;50% null rate</div>
                </div>
                <div className="p-2.5 rounded-xl bg-red-500/10 text-red-500 border border-red-500/20">
                  <ShieldAlert className="w-5 h-5" />
                </div>
              </div>
            </div>

            {/* ── Main Visual Analytics & Summary ── */}
            <div className="flex flex-col lg:flex-row gap-5 items-start">

              {/* LEFT MAIN: Data Table & Scatter Plot */}
              <div className="flex-1 space-y-4 min-w-0">

                {/* Visual Analytics Container */}
                <div className="bg-[var(--bg-primary)] border border-[var(--border)] rounded-xl p-5 shadow-sm space-y-4">

                  {/* Tab Header Bar */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--border)]">
                    <div className="flex items-center gap-2">
                      <BarChart2 className="w-4 h-4 text-indigo-500" />
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-primary)]">
                        Field-Level Analytics & Data Intelligence
                      </span>
                    </div>

                    <div className="flex bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg p-1 gap-1 text-[11px]">
                      <button
                        onClick={() => setActiveTab('table')}
                        className={`px-3 py-1 rounded-md font-medium transition-all cursor-pointer ${activeTab === 'table' ? 'bg-indigo-600 text-white shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                      >
                        Data Table
                      </button>
                      <button
                        onClick={() => setActiveTab('completeness')}
                        className={`px-3 py-1 rounded-md font-medium transition-all cursor-pointer ${activeTab === 'completeness' ? 'bg-indigo-600 text-white shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                      >
                        Completeness & Anomalies
                      </button>
                      <button
                        onClick={() => setActiveTab('cardinality')}
                        className={`px-3 py-1 rounded-md font-medium transition-all cursor-pointer ${activeTab === 'cardinality' ? 'bg-indigo-600 text-white shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                      >
                        Cardinality Spectrum
                      </button>
                    </div>
                  </div>

                  {/* Primary Data Table */}
                  {activeTab === 'table' && (
                    <div className="space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="relative flex-1 max-w-xs">
                          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[var(--text-tertiary)]" />
                          <input
                            type="text"
                            placeholder="Filter field name..."
                            value={edaSearch}
                            onChange={(e) => setEdaSearch(e.target.value)}
                            className="w-full pl-8 pr-3 py-1.5 rounded-lg text-[11px] bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] uppercase font-mono tracking-wider text-[var(--text-tertiary)]">Sort by:</span>
                          <select
                            value={edaSort}
                            onChange={(e: any) => setEdaSort(e.target.value)}
                            className="text-[11px] bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-md px-2 py-1 text-[var(--text-primary)] outline-none"
                          >
                            <option value="default">Default Order</option>
                            <option value="null_desc">Highest Nulls (Missing)</option>
                            <option value="anomalies_desc">Highest Anomalies</option>
                            <option value="name">Alphabetical (A-Z)</option>
                          </select>
                          <span className="text-[10.5px] text-[var(--text-tertiary)] font-mono ml-2">
                            Showing {displayEdaStats.length} of {edaStats.length} fields
                          </span>
                        </div>
                      </div>

                      <div className="overflow-x-auto rounded-lg border border-[var(--border)] max-h-[420px] overflow-y-auto">
                        <table className="w-full text-left text-[11.5px]">
                          <thead className="bg-[var(--bg-tertiary)] sticky top-0 border-b border-[var(--border)] text-[var(--text-tertiary)] font-mono uppercase text-[9.5px]">
                            <tr>
                              <th className="py-2.5 px-3">Field</th>
                              <th className="py-2.5 px-3 w-16">Mandatory</th>
                              <th className="py-2.5 px-3 min-w-[130px]">Populated vs Null</th>
                              <th className="py-2.5 px-3">Uniques</th>
                              <th className="py-2.5 px-3 min-w-[160px]">Format Anomalies (Count & Details)</th>
                              <th className="py-2.5 px-3">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--border)] font-mono">
                            {displayEdaStats.map((row: any, i: number) => {
                              const st = row.status || 'HEALTHY';
                              const bc = st === 'HEALTHY' ? { bg: '#10b98115', txt: '#10b981', brd: '#10b98130' }
                                : st === 'WARNING' ? { bg: '#f59e0b15', txt: '#f59e0b', brd: '#f59e0b30' }
                                  : { bg: '#ef444415', txt: '#ef4444', brd: '#ef444430' };

                              const total = state.extracted.length || 1;
                              const popPct = Math.round(((row.populated_count || 0) / total) * 100);
                              const nullPct = Math.round(((row.null_count || 0) / total) * 100);

                              return (
                                <tr key={i} className="hover:bg-[var(--bg-tertiary)]/50 transition-colors">
                                  <td className="py-2 px-3 font-semibold text-[var(--text-primary)] whitespace-nowrap">
                                    <div className="flex items-center gap-1.5">
                                      <span>{row.field}</span>
                                      {row.is_mandatory && (
                                        <span className="text-[8.5px] px-1 py-0.2 rounded bg-indigo-500/10 text-indigo-500 border border-indigo-500/20 font-bold">REQ</span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="py-2 px-3">
                                    {row.is_mandatory ? (
                                      <span className="text-[10px] text-indigo-500 font-bold">Yes</span>
                                    ) : (
                                      <span className="text-[10px] text-[var(--text-tertiary)]">No</span>
                                    )}
                                  </td>
                                  <td className="py-2 px-3">
                                    <div className="flex flex-col gap-1 w-full max-w-[130px]">
                                      <div className="flex justify-between text-[9px] text-[var(--text-tertiary)] uppercase tracking-wider">
                                        <span>{row.populated_count} Pop ({popPct}%)</span>
                                        <span>{row.null_count} Null</span>
                                      </div>
                                      <div className="w-full h-1.5 rounded-full bg-[var(--bg-tertiary)] overflow-hidden flex">
                                        <div className="h-full bg-emerald-500" style={{ width: `${popPct}%` }} />
                                        <div className="h-full bg-red-500" style={{ width: `${nullPct}%` }} />
                                      </div>
                                    </div>
                                  </td>
                                  <td className="py-2 px-3 text-[var(--text-secondary)]">
                                    <span className="font-semibold">{row.unique_count}</span>
                                    {row.is_constant && <span className="ml-1 text-[8.5px] text-purple-500 font-bold">(Const)</span>}
                                  </td>
                                  <td className="py-2 px-3">
                                    <div className="flex items-center gap-1.5 flex-wrap max-w-[220px]">
                                      {row.format_anomaly_count > 0 ? (
                                        <span className="bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold px-2 py-0.5 rounded text-[9.5px] border border-amber-500/30">
                                          {row.format_anomaly_count} rows
                                        </span>
                                      ) : (
                                        <span className="text-emerald-500 font-semibold text-[9.5px]">0 (Clean)</span>
                                      )}
                                      {row.anomalies && row.anomalies.map((a: string, ai: number) => (
                                        <span key={ai} className="bg-[var(--bg-tertiary)] text-[var(--text-secondary)] px-1.5 py-0.5 rounded text-[8.5px] border border-[var(--border)]">
                                          {a}
                                        </span>
                                      ))}
                                    </div>
                                  </td>
                                  <td className="py-2 px-3">
                                    <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 20, fontWeight: 700, background: bc.bg, color: bc.txt, border: `1px solid ${bc.brd}` }}>
                                      {st}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Chart 1: Modern Field Completeness & Quality Spectrum */}
                  {activeTab === 'completeness' && (
                    <div className="space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-[var(--text-secondary)]">
                        <div>Interactive breakdown of Populated vs Missing (Null) values and Format Anomalies across fields.</div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-[var(--text-tertiary)]">Sort:</span>
                          <select
                            value={edaSort}
                            onChange={(e: any) => setEdaSort(e.target.value)}
                            className="text-[10.5px] bg-[var(--bg-tertiary)] border border-[var(--border)] rounded px-2 py-0.5 text-[var(--text-primary)] outline-none"
                          >
                            <option value="default">Default Order</option>
                            <option value="null_desc">Most Nulls First</option>
                            <option value="anomalies_desc">Most Anomalies First</option>
                            <option value="name">A-Z</option>
                          </select>
                        </div>
                      </div>

                      <div style={{ width: '100%', height: 380 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={displayEdaStats}
                            margin={{ top: 20, right: 20, bottom: 30, left: 0 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} opacity={0.4} />
                            <XAxis
                              dataKey="field"
                              tick={{ fontSize: 9.5, fill: 'var(--text-tertiary)' }}
                              tickFormatter={(v: string) => v.length > 12 ? v.slice(0, 12) + '…' : v}
                              axisLine={false}
                              tickLine={false}
                              height={60}
                              angle={-40}
                              textAnchor="end"
                            />
                            <YAxis
                              tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
                              axisLine={false}
                              tickLine={false}
                              width={45}
                            />
                            <Tooltip
                              cursor={{ fill: 'var(--bg-tertiary)', opacity: 0.4 }}
                              contentStyle={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 11.5, boxShadow: '0 8px 16px -4px rgba(0,0,0,0.15)' }}
                              formatter={(value: any, name: any, props: any) => {
                                const total = (props.payload.populated_count || 0) + (props.payload.null_count || 0);
                                const pct = total > 0 ? Math.round((Number(value) / total) * 100) : 0;
                                return [`${value} rows (${pct}%)`, name];
                              }}
                              labelFormatter={(lbl) => `Field: ${lbl}`}
                            />
                            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
                            <Bar dataKey="populated_count" name="Populated Rows" stackId="stack" fill="#10b981" radius={[0, 0, 0, 0]} />
                            <Bar dataKey="null_count" name="Null (Missing) Rows" stackId="stack" fill="#ef4444" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="format_anomaly_count" name="Format Anomalies" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={20} />
                            <Brush dataKey="field" height={26} stroke="var(--border)" fill="var(--bg-tertiary)" tickFormatter={() => ''} startIndex={0} endIndex={Math.min(18, displayEdaStats.length - 1)} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}

                  {/* Chart 2: Modern Cardinality & Uniqueness Spectrum */}
                  {activeTab === 'cardinality' && (
                    <div className="space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-[var(--text-secondary)]">
                        <div>Distinct value density across fields. Purple indicates constant values (1 distinct value).</div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-[var(--text-tertiary)]">Sort:</span>
                          <select
                            value={edaSort}
                            onChange={(e: any) => setEdaSort(e.target.value)}
                            className="text-[10.5px] bg-[var(--bg-tertiary)] border border-[var(--border)] rounded px-2 py-0.5 text-[var(--text-primary)] outline-none"
                          >
                            <option value="default">Default Order</option>
                            <option value="name">A-Z</option>
                          </select>
                        </div>
                      </div>

                      <div style={{ width: '100%', height: 380 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={displayEdaStats}
                            margin={{ top: 20, right: 20, bottom: 30, left: 0 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} opacity={0.4} />
                            <XAxis
                              dataKey="field"
                              tick={{ fontSize: 9.5, fill: 'var(--text-tertiary)' }}
                              tickFormatter={(v: string) => v.length > 12 ? v.slice(0, 12) + '…' : v}
                              axisLine={false}
                              tickLine={false}
                              height={60}
                              angle={-40}
                              textAnchor="end"
                            />
                            <YAxis
                              tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
                              axisLine={false}
                              tickLine={false}
                              width={45}
                            />
                            <Tooltip
                              cursor={{ fill: 'var(--bg-tertiary)', opacity: 0.4 }}
                              contentStyle={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 11.5, boxShadow: '0 8px 16px -4px rgba(0,0,0,0.15)' }}
                              labelFormatter={(lbl) => `Field: ${lbl}`}
                              formatter={(value: any, name: any, props: any) => [
                                `${value} unique values ${props.payload.is_constant ? '(Single Constant)' : ''}`,
                                'Cardinality'
                              ]}
                            />
                            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
                            <Bar dataKey="unique_count" name="Distinct Unique Values" radius={[4, 4, 0, 0]} maxBarSize={36}>
                              {displayEdaStats.map((entry: any, index: number) => (
                                <Cell
                                  key={`cell-${index}`}
                                  fill={entry.is_constant ? '#8b5cf6' : (entry.unique_count > 50 ? '#06b6d4' : '#6366f1')}
                                />
                              ))}
                            </Bar>
                            <Brush dataKey="field" height={26} stroke="var(--border)" fill="var(--bg-tertiary)" tickFormatter={() => ''} startIndex={0} endIndex={Math.min(18, displayEdaStats.length - 1)} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}

                  {/* End Tabs */}
                </div>

              </div>

              {/* RIGHT COLUMN: Modern Compliance & Readiness Dashboard */}
              <div className="w-full lg:w-[320px] flex flex-col gap-4 shrink-0">
                <div className="bg-[var(--bg-primary)] border border-[var(--border)] rounded-xl p-4 shadow-sm space-y-4">
                  <div className="flex items-center justify-between pb-2 border-b border-[var(--border)]">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-primary)]">
                      Compliance Health
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-500 font-bold border border-indigo-500/20">
                      S/4HANA
                    </span>
                  </div>

                  {/* Mandatory Fields Gauge Card */}
                  {(() => {
                    const mand = complianceData.find((c: any) => c.name === 'Mandatory') || { Total: 0, Healthy: 0, Critical: 0, Warning: 0 };
                    const mandPct = mand.Total > 0 ? Math.round((mand.Healthy / mand.Total) * 100) : 100;
                    return (
                      <div className="p-3.5 rounded-xl bg-[var(--bg-tertiary)]/50 border border-[var(--border)] space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold text-[var(--text-primary)]">Mandatory Fields</span>
                          <span className={`text-[11px] font-mono font-extrabold ${mand.Critical > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                            {mandPct}% Compliant
                          </span>
                        </div>

                        <div className="w-full h-2 rounded-full bg-[var(--bg-primary)] overflow-hidden flex">
                          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${mandPct}%` }} />
                          <div className="h-full bg-red-500 transition-all" style={{ width: `${100 - mandPct}%` }} />
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-[10px] font-mono pt-1">
                          <div className="flex items-center justify-between px-2 py-1 rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                            <span>Healthy</span>
                            <strong>{mand.Healthy} / {mand.Total}</strong>
                          </div>
                          <div className="flex items-center justify-between px-2 py-1 rounded bg-red-500/10 text-red-500 border border-red-500/20">
                            <span>Critical</span>
                            <strong>{mand.Critical}</strong>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Optional Fields Gauge Card */}
                  {(() => {
                    const opt = complianceData.find((c: any) => c.name === 'Optional') || { Total: 0, Healthy: 0, Warning: 0 };
                    const optPct = opt.Total > 0 ? Math.round((opt.Healthy / opt.Total) * 100) : 100;
                    return (
                      <div className="p-3.5 rounded-xl bg-[var(--bg-tertiary)]/50 border border-[var(--border)] space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold text-[var(--text-primary)]">Optional Fields</span>
                          <span className="text-[11px] font-mono font-extrabold text-amber-500">
                            {optPct}% Populated
                          </span>
                        </div>

                        <div className="w-full h-2 rounded-full bg-[var(--bg-primary)] overflow-hidden flex">
                          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${optPct}%` }} />
                          <div className="h-full bg-amber-500 transition-all" style={{ width: `${100 - optPct}%` }} />
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-[10px] font-mono pt-1">
                          <div className="flex items-center justify-between px-2 py-1 rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                            <span>Healthy</span>
                            <strong>{opt.Healthy} / {opt.Total}</strong>
                          </div>
                          <div className="flex items-center justify-between px-2 py-1 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20">
                            <span>Warnings</span>
                            <strong>{opt.Warning}</strong>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Format Anomalies Global Count */}
                  <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/20 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                      <span className="text-[11px] font-bold text-[var(--text-primary)]">Format Anomalies</span>
                    </div>
                    <span className="text-xs font-mono font-extrabold text-amber-500">
                      {reportMetrics.total_anomalies || 0} total
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* BOTTOM FULL-WIDTH: Exec Summary, Risks, Actions */}
            <div className="flex flex-col gap-4 mt-5">

              {/* Executive Summary Card */}
              <div className="bg-[var(--bg-primary)] border border-[var(--border)] rounded-xl p-4 shadow-sm">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[var(--text-primary)] mb-2.5">
                  <ClipboardList className="w-4 h-4 text-indigo-500" /> {aiSummary ? 'AI Executive Summary' : 'Executive Summary'}
                </div>
                <p className="text-[12px] leading-relaxed text-[var(--text-secondary)]">
                  {aiSummary?.executive_summary || aiSummary?.summary || reportMetrics.summary}
                </p>
              </div>

              {/* Critical Migration Risks */}
              {((aiSummary?.critical_warnings || aiSummary?.warnings || reportMetrics.warnings) || []).length > 0 && (
                <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4 shadow-sm space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-red-500">
                      <ShieldAlert className="w-4 h-4" /> {aiSummary ? 'AI Assessed Risks' : 'Critical Migration Risks'} ({((aiSummary?.critical_warnings || aiSummary?.warnings || reportMetrics.warnings) || []).length})
                    </div>
                    {((aiSummary?.critical_warnings || aiSummary?.warnings || reportMetrics.warnings) || []).length > 2 && (
                      <button
                        onClick={() => setShowAllRisks(!showAllRisks)}
                        className="flex items-center gap-1 text-[10.5px] font-semibold text-red-500 hover:text-red-400 transition-colors cursor-pointer bg-red-500/10 px-2.5 py-1 rounded-md"
                      >
                        {showAllRisks ? (
                          <>Show Less <ChevronUp className="w-3.5 h-3.5" /></>
                        ) : (
                          <>Show All <ChevronDown className="w-3.5 h-3.5" /></>
                        )}
                      </button>
                    )}
                  </div>
                  <div className="space-y-2">
                    {(showAllRisks ? (aiSummary?.critical_warnings || aiSummary?.warnings || reportMetrics.warnings) : (aiSummary?.critical_warnings || aiSummary?.warnings || reportMetrics.warnings).slice(0, 2)).map((w: string, i: number) => (
                      <div key={i} className="flex gap-2 text-[11.5px] text-red-400 leading-snug bg-red-500/5 p-2.5 rounded-lg border border-red-500/10">
                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                        <span>{w}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Plan & Recommended Fixes */}
              {(aiSummary?.recommendations || reportMetrics.recommendations || []).length > 0 && (
                <div className="bg-[var(--bg-primary)] border border-[var(--border)] rounded-xl p-4 shadow-sm space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[var(--text-primary)]">
                      <Zap className="w-4 h-4 text-amber-500" /> {aiSummary ? 'AI Strategic Plan' : 'Action Plan'} ({(aiSummary?.recommendations || reportMetrics.recommendations || []).length})
                    </div>
                    {(aiSummary?.recommendations || reportMetrics.recommendations || []).length > 2 && (
                      <button
                        onClick={() => setShowAllActions(!showAllActions)}
                        className="flex items-center gap-1 text-[10.5px] font-semibold text-amber-600 dark:text-amber-400 hover:text-amber-500 transition-colors cursor-pointer bg-amber-500/10 px-2.5 py-1 rounded-md"
                      >
                        {showAllActions ? (
                          <>Show Less <ChevronUp className="w-3.5 h-3.5" /></>
                        ) : (
                          <>Show All <ChevronDown className="w-3.5 h-3.5" /></>
                        )}
                      </button>
                    )}
                  </div>
                  <div className="space-y-2">
                    {(showAllActions ? (aiSummary?.recommendations || reportMetrics.recommendations) : (aiSummary?.recommendations || reportMetrics.recommendations).slice(0, 2)).map((r: string, i: number) => (
                      <div key={i} className="p-2.5 rounded-lg bg-[var(--bg-tertiary)]/60 border border-[var(--border)] text-[10.5px] text-[var(--text-secondary)] flex items-start gap-2">
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                        {r}
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>

          </div>

        </div>
      )}
    </PageLayout>
  );
}
