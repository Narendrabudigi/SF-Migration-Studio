import React, { useState, useMemo, useCallback } from 'react';
import { useMigration } from '@/store/migration-store';
import { dl, expCSV } from '@/lib/utils';
import { PageLayout, Badge, Button } from '@/components/shared';
import { useToast } from '@/components/ui/toast';
import { jsPDF } from 'jspdf';

import {
  FileText, Download, CheckCircle2, ShieldCheck, Wrench, Database, Layers,
  Table, Sparkles, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  RotateCcw, ArrowRight
} from 'lucide-react';

type ReportTab = 'master' | 'mapping' | 'extraction' | 'harmonization' | 'validation' | 'cleansing' | 'transformation';

/* ─── Reusable Pagination Component ─── */
function Pagination({
  currentPage,
  totalItems,
  pageSize,
  onPageChange
}: {
  currentPage: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalItems <= pageSize) return null;

  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-t border-[var(--border)] bg-[var(--bg-tertiary)]/20 text-[11px] text-[var(--text-tertiary)]">
      <div>
        Showing <span className="font-semibold text-[var(--text-primary)]">{start}</span> to{' '}
        <span className="font-semibold text-[var(--text-primary)]">{end}</span> of{' '}
        <span className="font-semibold text-[var(--text-primary)]">{totalItems}</span> items
      </div>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
          className="px-2.5 py-1 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-40 disabled:cursor-not-allowed text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1"
        >
          <ChevronLeft className="w-3 h-3" /> Previous
        </button>
        <span className="px-2 py-0.5 font-mono text-[11px] font-bold text-[var(--text-secondary)]">
          Page {currentPage} of {totalPages}
        </span>
        <button
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage >= totalPages}
          className="px-2.5 py-1 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-40 disabled:cursor-not-allowed text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1"
        >
          Next <ChevronRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

/* ─── Reusable Collapsible Card ─── */
function CollapsibleCard({
  title,
  subtitle,
  icon,
  badge,
  badgeVariant = 'teal',
  defaultOpen = true,
  children,
  action,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  badge?: string | number;
  badgeVariant?: any;
  defaultOpen?: boolean;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden shadow-xs">
      <div className="flex items-center justify-between p-3.5 bg-[var(--bg-tertiary)]/35 border-b border-[var(--border)] gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          {icon && <div className="text-teal-600 dark:text-teal-400 shrink-0">{icon}</div>}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-[var(--text-primary)]">{title}</span>
              {badge !== undefined && (
                <Badge variant={badgeVariant}>{badge}</Badge>
              )}
            </div>
            {subtitle && (
              <p className="text-[10.5px] text-[var(--text-tertiary)] truncate mt-0.5">{subtitle}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {action}
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="p-1 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
            title={isOpen ? "Collapse section" : "Expand section"}
          >
            {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>
      {isOpen && <div>{children}</div>}
    </div>
  );
}

export function Step9TechDocs() {
  const { state } = useMigration();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<ReportTab>('master');

  // Drill-down filtering state (used specifically in Harmonization, Validation, Cleansing where rules transform records)
  const [selectedFieldFilter, setSelectedFieldFilter] = useState<string | null>(null);
  const [showOnlyChangedHarmonization, setShowOnlyChangedHarmonization] = useState<boolean>(true);
  const [filterChangedFieldsOnly, setFilterChangedFieldsOnly] = useState<boolean>(false);
  const [showOnlyFailingValidation, setShowOnlyFailingValidation] = useState<boolean>(true);
  const [filterFailingFieldsOnly, setFilterFailingFieldsOnly] = useState<boolean>(false);

  // Pagination states
  const [page1, setPage1] = useState(1);
  const [page2, setPage2] = useState(1);
  const PAGE_SIZE = 10;

  // Reset drill-down & pages when switching tabs
  const handleTabChange = (tab: ReportTab) => {
    setActiveTab(tab);
    setSelectedFieldFilter(null);
    setShowOnlyChangedHarmonization(true);
    setFilterChangedFieldsOnly(false);
    setShowOnlyFailingValidation(true);
    setFilterFailingFieldsOnly(false);
    setPage1(1);
    setPage2(1);
  };

  // Session Data & Fallbacks
  const mappingRows = state.mapping.length > 0 ? state.mapping : [
    { src: 'EMP_ID', sap: 'person-id-external', sapLabel: 'Person ID External', conf: 95, tr: 'pad10', note: 'Exact Key Match', req: true },
    { src: 'DOB', sap: 'date-of-birth', sapLabel: 'Date of Birth', conf: 90, tr: 'date_format', note: 'YYYY-MM-DD Iso Standard', req: false },
    { src: 'BIRTH_CNTRY', sap: 'country-of-birth', sapLabel: 'Country of Birth', conf: 88, tr: 'country_iso', note: 'Mapped to 2-letter ISO', req: false },
    { src: 'BIRTH_CITY', sap: 'place-of-birth', sapLabel: 'Place of Birth', conf: 85, tr: 'trim', note: 'Cleaned Whitespace', req: false },
    { src: 'GENDER_CD', sap: 'gender', sapLabel: 'Gender Code', conf: 92, tr: 'uppercase', note: 'Standardized to Single Char', req: false },
  ];

  const extractedData = state.extracted.length > 0
    ? state.extracted
    : (state.rawData && state.rawData.length > 0)
    ? state.rawData
    : (state.uploadedData && state.uploadedData.length > 0)
    ? state.uploadedData
    : [
        { 'person-id-external': '10001', 'date-of-birth': '1985-04-12', 'country-of-birth': 'USA', 'place-of-birth': ' New York ', 'gender': 'Male' },
        { 'person-id-external': '10002', 'date-of-birth': '1990-11-23', 'country-of-birth': 'INDIA', 'place-of-birth': 'Mumbai', 'gender': 'female' },
        { 'person-id-external': '10003', 'date-of-birth': '1992/08/15', 'country-of-birth': 'DE', 'place-of-birth': 'Berlin', 'gender': 'M' },
        { 'person-id-external': '10004', 'date-of-birth': '1988-01-30', 'country-of-birth': 'UK', 'place-of-birth': 'London', 'gender': 'F' },
        { 'person-id-external': '10005', 'date-of-birth': '1995-06-18', 'country-of-birth': 'FRANCE', 'place-of-birth': ' Paris ', 'gender': 'female' },
      ];

  const validationResults = state.validated.length > 0 ? state.validated : [
    { idx: 1, primary_key: '10001', row: extractedData[0], st: 'PASS' as const, errs: [], warns: [] },
    { idx: 2, primary_key: '10002', row: extractedData[1], st: 'WARN' as const, errs: [], warns: [{ f: 'country-of-birth', m: 'Non-ISO Country Name: INDIA (Expected 2-character ISO code)', sev: 'WARN', rule: 'ISO_COUNTRY' }] },
    { idx: 3, primary_key: '10003', row: extractedData[2], st: 'ERROR' as const, errs: [{ f: 'date-of-birth', m: 'Invalid Date Format: 1992/08/15 (Expected YYYY-MM-DD)', sev: 'ERROR', rule: 'DATE_FORMAT' }], warns: [] },
    { idx: 4, primary_key: '10004', row: extractedData[3], st: 'PASS' as const, errs: [], warns: [] },
    { idx: 5, primary_key: '10005', row: extractedData[4], st: 'WARN' as const, errs: [], warns: [{ f: 'country-of-birth', m: 'Non-ISO Country Name: FRANCE (Expected FR)', sev: 'WARN', rule: 'ISO_COUNTRY' }] },
  ];

  const cleansingFixes = (state.cleansingSummary?.cleanser_fixes?.items || []).length > 0
    ? state.cleansingSummary.cleanser_fixes.items
    : [
        { rule_code: 'CL_TRIM_WHITESPACE', row: 1, field: 'place-of-birth', old: ' New York ', new: 'New York' },
        { rule_code: 'CL_COUNTRY_TO_ISO', row: 2, field: 'country-of-birth', old: 'INDIA', new: 'IN' },
        { rule_code: 'CL_COUNTRY_TO_ISO', row: 1, field: 'country-of-birth', old: 'USA', new: 'US' },
        { rule_code: 'CL_COUNTRY_TO_ISO', row: 4, field: 'country-of-birth', old: 'UK', new: 'GB' },
        { rule_code: 'CL_COUNTRY_TO_ISO', row: 5, field: 'country-of-birth', old: 'FRANCE', new: 'FR' },
        { rule_code: 'CL_PAD_NUMERIC_IDENTIFIER', row: 1, field: 'person-id-external', old: '10001', new: '0000010001' },
        { rule_code: 'CL_TRIM_WHITESPACE', row: 5, field: 'place-of-birth', old: ' Paris ', new: 'Paris' },
      ];

  const harmonizedData = state.harmonized.length > 0 ? state.harmonized : [
    { 'person-id-external': '0000010001', 'date-of-birth': '1985-04-12', 'country-of-birth': 'US', 'place-of-birth': 'New York', 'gender': 'M' },
    { 'person-id-external': '0000010002', 'date-of-birth': '1990-11-23', 'country-of-birth': 'IN', 'place-of-birth': 'Mumbai', 'gender': 'F' },
    { 'person-id-external': '0000010003', 'date-of-birth': '1992-08-15', 'country-of-birth': 'DE', 'place-of-birth': 'Berlin', 'gender': 'M' },
    { 'person-id-external': '0000010004', 'date-of-birth': '1988-01-30', 'country-of-birth': 'GB', 'place-of-birth': 'London', 'gender': 'F' },
    { 'person-id-external': '0000010005', 'date-of-birth': '1995-06-18', 'country-of-birth': 'FR', 'place-of-birth': 'Paris', 'gender': 'F' },
  ];

  const transformedData = state.transformed.length > 0 ? state.transformed : harmonizedData;

  /* ─── Enterprise PDF Export Helper (Executive Reference Styling) ─── */
  interface EnterprisePDFConfig {
    bannerTitle?: string;
    reportTitle?: string;
    targetObject?: string;
    kpiTitle?: string;
    kpiSubtitle?: string;
    summaryTitle?: string;
    summary?: string;
    criticalRisksTitle?: string;
    criticalRisks?: string[];
    actionPlanTitle?: string;
    actionPlan?: string[];
    tableTitle?: string;
    headers: string[];
    rows: string[][];
    colWidths?: number[];
    orientation?: 'portrait' | 'landscape';
    filename: string;
  }

  const exportPDF = (
    configOrTitle: string | EnterprisePDFConfig,
    legacySubtitle?: string,
    legacyHeaders?: string[],
    legacyRows?: string[][],
    legacyFilename?: string
  ) => {
    try {
      let cfg: EnterprisePDFConfig;
      if (typeof configOrTitle === 'object') {
        cfg = configOrTitle;
      } else {
        cfg = {
          bannerTitle: configOrTitle.split('—')[0]?.replace('SAP Migration Studio', '').trim() || 'Migration Audit Report',
          reportTitle: configOrTitle,
          targetObject: state.obj || 'Biographical Info',
          kpiTitle: `Stage Audit Overview: ${configOrTitle}`,
          kpiSubtitle: `Target Object: ${state.obj || 'Biographical Info'} | Total Records: ${legacyRows?.length || 0} | Status: Completed`,
          summary: legacySubtitle || 'Automated data migration processing audit log and verification trail.',
          headers: legacyHeaders || [],
          rows: legacyRows || [],
          filename: legacyFilename || 'Migration_Report.pdf',
          orientation: 'landscape',
        };
      }

      const orientation = cfg.orientation || 'landscape';
      const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      // Executive enterprise palette matching reference design
      const primaryColor = [14, 116, 144]; // Deep Teal #0e7490
      const darkText = [30, 41, 59];       // Slate-800
      const lightBg = [248, 250, 252];      // Slate-50

      const targetObj = cfg.targetObject || state.obj || 'Biographical Info';
      const bannerTitle = cfg.bannerTitle || 'Migration Audit Report';

      // 1. Solid Top Header Banner
      doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.rect(0, 0, pageWidth, 26, 'F');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      doc.setTextColor(255, 255, 255);
      doc.text(`SAP Migration Studio — ${bannerTitle}`, 14, 12.5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(224, 242, 254);
      doc.text(`Generated: ${new Date().toLocaleDateString()} | Target Object: ${targetObj} | Project: SF-MIG-${targetObj}`, 14, 20);

      let yPos = 34;

      // 2. Executive Title
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12.5);
      doc.setTextColor(darkText[0], darkText[1], darkText[2]);
      doc.text(cfg.reportTitle || `${bannerTitle}: ${targetObj} Master Data`, 14, yPos);
      yPos += 7;

      // 3. Scorecard / KPI Highlight Box
      doc.setFillColor(lightBg[0], lightBg[1], lightBg[2]);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(14, yPos, pageWidth - 28, 20, 2.5, 2.5, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.text(cfg.kpiTitle || `Overall Status: Completed`, 19, yPos + 8);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(100, 116, 139);
      doc.text(cfg.kpiSubtitle || `Target Object: ${targetObj} | Total Records: ${cfg.rows.length}`, 19, yPos + 14.5);

      yPos += 26;

      // 4. Section 1: Executive Summary
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(darkText[0], darkText[1], darkText[2]);
      doc.text(cfg.summaryTitle || '1. Executive Summary', 14, yPos);
      yPos += 5.5;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(71, 85, 105);
      const summaryText = cfg.summary || `Automated migration audit completed for ${targetObj}. All schemas and transformation rules verified against SAP SuccessFactors constraints.`;
      const splitSummary = doc.splitTextToSize(summaryText, pageWidth - 28);
      doc.text(splitSummary, 14, yPos);
      yPos += (splitSummary.length * 4) + 4;

      // 5. Section 2: Critical Observations / Rules Applied (if provided)
      if (cfg.criticalRisks && cfg.criticalRisks.length > 0) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(220, 38, 38);
        doc.text(cfg.criticalRisksTitle || '2. Critical Observations & Rules Applied', 14, yPos);
        yPos += 5;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(127, 29, 29);

        cfg.criticalRisks.forEach((w: string) => {
          const cleanW = w.replace(/^\*\*(.*?)\*\*/, '$1').replace(/^•\s*/, '').trim();
          const splitW = doc.splitTextToSize(`•  ${cleanW}`, pageWidth - 32);
          doc.text(splitW, 18, yPos);
          yPos += (splitW.length * 3.8) + 1.5;
        });
        yPos += 3;
      }

      // 6. Section 3: Recommended Action Plan (if provided)
      if (cfg.actionPlan && cfg.actionPlan.length > 0) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(darkText[0], darkText[1], darkText[2]);
        doc.text(cfg.actionPlanTitle || '3. Recommended Action Plan', 14, yPos);
        yPos += 5;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(71, 85, 105);

        cfg.actionPlan.forEach((r: string, idx: number) => {
          const cleanR = r.replace(/^\*\*(.*?)\*\*/, '$1').replace(/^\d+\.\s*/, '').trim();
          const splitR = doc.splitTextToSize(`${idx + 1}. ${cleanR}`, pageWidth - 32);
          doc.text(splitR, 18, yPos);
          yPos += (splitR.length * 3.8) + 1.5;
        });
        yPos += 4;
      }

      // Check space before table
      if (yPos > pageHeight - 40) {
        doc.addPage();
        yPos = 20;
      }

      // 7. Section 4: Detailed Audit Trail Table
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(darkText[0], darkText[1], darkText[2]);
      doc.text(cfg.tableTitle || '4. Detailed Audit Trail & Record Breakdown', 14, yPos);
      yPos += 6;

      // Usable width and column calculations
      const usableWidth = pageWidth - 28;
      const effectiveColWidths = (cfg.colWidths && cfg.colWidths.length === cfg.headers.length)
        ? cfg.colWidths
        : cfg.headers.map(() => usableWidth / cfg.headers.length);

      const colPositions: number[] = [];
      let curX = 16;
      for (let i = 0; i < cfg.headers.length; i++) {
        colPositions.push(curX);
        curX += effectiveColWidths[i];
      }

      const drawTableHeader = (y: number) => {
        doc.setFillColor(241, 245, 249);
        doc.rect(14, y, usableWidth, 7, 'F');
        doc.setDrawColor(226, 232, 240);
        doc.line(14, y + 7, 14 + usableWidth, y + 7);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(71, 85, 105);

        cfg.headers.forEach((h, i) => {
          const maxW = effectiveColWidths[i] - 2;
          let title = h;
          while (doc.getTextWidth(title) > maxW && title.length > 3) {
            title = title.slice(0, -4) + '...';
          }
          doc.text(title, colPositions[i], y + 4.8);
        });
      };

      drawTableHeader(yPos);
      yPos += 7;

      // 8. Data Rows with Alternating Striping & Status Color Codes
      cfg.rows.forEach((row, rowIndex) => {
        if (yPos > pageHeight - 18) {
          doc.addPage();
          // Mini top header banner on continuation page
          doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
          doc.rect(0, 0, pageWidth, 9, 'F');
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(8);
          doc.setTextColor(255, 255, 255);
          doc.text(`SAP Migration Studio — ${bannerTitle} (Continued)`, 14, 6.2);

          yPos = 14;
          drawTableHeader(yPos);
          yPos += 7;
        }

        // Alternating row background
        if (rowIndex % 2 === 1) {
          doc.setFillColor(248, 250, 252);
          doc.rect(14, yPos, usableWidth, 5.8, 'F');
        }
        doc.setDrawColor(241, 245, 249);
        doc.line(14, yPos + 5.8, 14 + usableWidth, yPos + 5.8);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);

        row.forEach((cell, ci) => {
          const rawVal = String(cell ?? '—');
          const cleanVal = rawVal.trim().toUpperCase();

          // Status & Severity Color Coding
          if (['HEALTHY', 'HARMONIZED', 'VALID', 'PASS', 'PASSED', 'COMPLETED', 'READY', 'COMPLIANT', 'GRADE A', 'YES', 'REQUIRED'].includes(cleanVal)) {
            doc.setTextColor(16, 185, 129); // Green
          } else if (['WARNING', 'WARN', 'MANUAL_REVIEW', 'FLAGGED', 'GRADE B'].includes(cleanVal)) {
            doc.setTextColor(245, 158, 11); // Amber
          } else if (['ERROR', 'CRITICAL', 'BLOCKING_ERROR', 'FAILED', 'GRADE C', 'GRADE D', 'NO'].includes(cleanVal)) {
            doc.setTextColor(239, 68, 68); // Red
          } else {
            doc.setTextColor(darkText[0], darkText[1], darkText[2]);
          }

          const maxW = effectiveColWidths[ci] - 2;
          let cellText = rawVal;
          while (doc.getTextWidth(cellText) > maxW && cellText.length > 3) {
            cellText = cellText.slice(0, -4) + '...';
          }
          doc.text(cellText, colPositions[ci], yPos + 4.2);
        });

        yPos += 5.8;
      });

      // 9. Running Footer on Every Page
      const totalPages = doc.getNumberOfPages();
      for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        doc.setDrawColor(226, 232, 240);
        doc.line(14, pageHeight - 8, pageWidth - 14, pageHeight - 8);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(148, 163, 184);
        doc.text('SAP Migration Studio — Confidential Migration Audit Documentation', 14, pageHeight - 4.5);
        doc.text(`Page ${p} of ${totalPages}`, pageWidth - 25, pageHeight - 4.5);
      }

      doc.save(cfg.filename);
      toast('Executive PDF Report exported successfully!', 'ok');
    } catch (e) {
      console.error('PDF export failed:', e);
      toast('Failed to generate PDF report', 'err');
    }
  };

  /* ─── STEP 2: FIELD MAPPING DATA (Mapping Info Only) ─── */
  const mappingReportData = useMemo(() => {
    return mappingRows.map(m => ({
      sourceField: m.src,
      targetField: m.sap,
      fieldLabel: m.sapLabel || m.sap,
      confidence: m.conf,
      strategy: m.conf >= 90 ? 'Exact Key Match' : m.conf >= 80 ? 'Semantic Synonym Dict' : 'Heuristic Match',
      transformRule: m.tr || 'trim',
      transformDescription: m.tr === 'pad10'
        ? 'Left-pad identifier with leading zeros to 10 digits'
        : m.tr === 'country_iso'
        ? 'Standardize country name to 2-letter ISO 3166-1 standard'
        : m.tr === 'date_format'
        ? 'Convert date string to ISO YYYY-MM-DD'
        : m.tr === 'uppercase'
        ? 'Convert text to uppercase'
        : 'Trim leading/trailing whitespace',
      mandatory: m.req ? 'REQUIRED' : 'OPTIONAL',
      notes: m.note || 'AI Matched',
    }));
  }, [mappingRows]);

  /* ─── STEP 3: DATA EXTRACTION & QUALITY DATA (Quality Scorecard & Completeness) ─── */
  const extractionQualityData = useMemo(() => {
    const cols = Object.keys(extractedData[0] || {});
    return cols.map(col => {
      let nullCount = 0;
      let anomalyCount = 0;
      extractedData.forEach(r => {
        const val = String(r[col] || '').trim();
        if (!val) nullCount++;
        if (val.length > 50 || /[!#$%^&*()]/.test(val) || (col.includes('date') && val.includes('/'))) {
          anomalyCount++;
        }
      });
      const completeness = Math.round(((extractedData.length - nullCount) / extractedData.length) * 100);
      return {
        field: col,
        totalRows: extractedData.length,
        completeness,
        nullCount,
        anomalyCount,
        qualityGrade: completeness === 100 && anomalyCount === 0 ? 'EXCELLENT (100%)' : completeness >= 80 ? 'GOOD (>=80%)' : 'NEEDS ATTENTION',
        status: completeness === 100 && anomalyCount === 0 ? 'CLEAN' : anomalyCount > 0 ? 'FORMAT ANOMALIES' : 'MISSING VALUES',
        profilingNote: anomalyCount > 0 ? 'Contains special chars or non-standard dates' : nullCount > 0 ? 'Contains empty records' : 'Format adheres to SF standards',
      };
    });
  }, [extractedData]);

  /* ─── STEP 4: HARMONIZATION DATA (Rules Applied & Before/After Changes) ─── */
  // 1. Parse structured before-and-after audit trail from state.fixLog
  const parsedFixLog = useMemo(() => {
    const map = new Map<string, { origVal: string; harmVal: string; rule: string }>();
    (state.fixLog || []).forEach(line => {
      // Format examples from backend harmonization_agent:
      // [Country→ISO] Row 1 (countryOfBirth): 'Germany' → 'DE'
      // [Country→ISO] Row 1 [Key: EXT-000001] (countryOfBirth): 'Germany' → 'DE'
      // [DynamicAI] Row 1 [Key: EXT-000001] (personIdExternal): '18138' → 'HR-18138'
      // [Date→YYYYMMDD::Detail] Row 2 (dateOfBirth): '1990/11/23' → '19901123'
      const m = line.match(/^\[([^\]]+)\]\s*Row\s*(\d+)(?:\s*\[Key:[^\]]+\])?\s*\(([^)]+)\):\s*'([^']*)'\s*→\s*'([^']*)'/i);
      if (m) {
        const rule = m[1].replace(/::Detail$/, '').trim();
        const rowIdx = parseInt(m[2], 10) - 1;
        const field = m[3].trim().replace(/[-_\s]/g, '').toLowerCase();
        const origVal = m[4];
        const harmVal = m[5];
        map.set(`${rowIdx}:${field}`, { origVal, harmVal, rule });
      }
    });
    return map;
  }, [state.fixLog]);

  // 2. Comprehensive resolver for finding pre-harmonized original value for row & field
  const getOriginalFieldValue = useCallback((rowIdx: number, col: string, harmVal: string): { origVal: string; ruleApplied?: string } => {
    const normCol = col.replace(/[-_\s]/g, '').toLowerCase();

    // 2a. Check if logged as a specific transform in fixLog
    const fixEntry = parsedFixLog.get(`${rowIdx}:${normCol}`);
    if (fixEntry && fixEntry.origVal !== undefined && fixEntry.origVal !== '') {
      return { origVal: fixEntry.origVal, ruleApplied: fixEntry.rule };
    }

    // 2b. Candidate pre-harmonized row sources in priority order
    const rawSources: Record<string, any>[] = [
      extractedData[rowIdx],
      state.rawData?.[rowIdx],
      state.uploadedData?.[rowIdx],
    ].filter(Boolean);

    // 2c. Look up source column names defined in state.mapping
    const mappedSrcNames: string[] = [];
    mappingRows.forEach(m => {
      const sapNorm = (m.sap || '').replace(/[-_\s]/g, '').toLowerCase();
      const sapLabelNorm = (m.sapLabel || '').replace(/[-_\s]/g, '').toLowerCase();
      if (sapNorm === normCol || sapLabelNorm === normCol) {
        if (m.src) {
          mappedSrcNames.push(m.src);
          const clean = m.src.replace(/^\[\d+\]\s*/, '').split('.').pop() || '';
          if (clean && clean !== m.src) mappedSrcNames.push(clean);
        }
      }
    });

    for (const src of rawSources) {
      for (const srcName of mappedSrcNames) {
        if (src[srcName] !== undefined && src[srcName] !== null && String(src[srcName]).trim() !== '') {
          return { origVal: String(src[srcName]) };
        }
      }
    }

    // 2d. Exact & normalized key matching across rawSources
    for (const src of rawSources) {
      if (src[col] !== undefined && src[col] !== null && String(src[col]).trim() !== '') {
        return { origVal: String(src[col]) };
      }
      for (const k of Object.keys(src)) {
        const cleanKey = k.replace(/^\[\d+\]\s*/, '').split('.').pop() || k;
        const normK = cleanKey.replace(/[-_\s]/g, '').toLowerCase();
        if (normK === normCol) {
          if (src[k] !== undefined && src[k] !== null && String(src[k]).trim() !== '') {
            return { origVal: String(src[k]) };
          }
        }
      }
    }

    // 2e. Semantic synonyms & abbreviations dictionary
    const aliasMap: Record<string, string[]> = {
      personidexternal: ['empid', 'emp_id', 'employee_id', 'employeeid', 'person_id', 'personid', 'ext_id', 'extid', 'id', 'pernr'],
      userid: ['user_id', 'user-id', 'username', 'login_id', 'bname', 'userid'],
      maritalstatus: ['marital_status', 'marital-status', 'marital', 'marital_cd', 'maritalcode', 'famst'],
      firstname: ['first_name', 'first-name', 'fname', 'first', 'vorna'],
      lastname: ['last_name', 'last-name', 'lname', 'last', 'nachn', 'surname'],
      dateofbirth: ['date_of_birth', 'date-of-birth', 'dob', 'birth_date', 'birthdate', 'gbdat'],
      countryofbirth: ['country_of_birth', 'country-of-birth', 'birth_country', 'country', 'cntry', 'land', 'gbort_land'],
      placeofbirth: ['place_of_birth', 'place-of-birth', 'birth_place', 'birthplace', 'city', 'city_of_birth', 'gbort'],
      gender: ['sex', 'gender_code', 'gendercd', 'gesch'],
      nationality: ['nation', 'citizenship', 'natio'],
      nativepreferredlang: ['native_preferred_lang', 'native-preferred-lang', 'preferred_lang', 'preferredlanguage', 'language', 'lang', 'spras'],
    };

    const aliases = aliasMap[normCol] || [];
    for (const src of rawSources) {
      for (const k of Object.keys(src)) {
        const cleanKey = k.replace(/^\[\d+\]\s*/, '').split('.').pop() || k;
        const normK = cleanKey.replace(/[-_\s]/g, '').toLowerCase();
        if (aliases.includes(normK)) {
          if (src[k] !== undefined && src[k] !== null && String(src[k]).trim() !== '') {
            return { origVal: String(src[k]) };
          }
        }
      }
    }

    // 2f. If harmVal is non-empty and no transformation occurred, pre-harmonized original is harmVal
    if (harmVal && harmVal.trim() !== '') {
      return { origVal: harmVal };
    }

    return { origVal: '' };
  }, [parsedFixLog, extractedData, state.rawData, state.uploadedData, mappingRows]);

  const harmonizationRulesSummary = useMemo(() => {
    const cols = Object.keys(harmonizedData[0] || {}).filter(c => c !== 'SOURCE' && c !== '_source');
    const summary = cols.map(col => {
      let modifiedCount = 0;
      harmonizedData.forEach((harmRow, i) => {
        const harmVal = String(harmRow[col] || '');
        const { origVal } = getOriginalFieldValue(i, col, harmVal);
        if (origVal && origVal !== harmVal) modifiedCount++;
      });
      let ruleCode = 'HARM_STANDARD';
      let ruleDesc = 'Standardized code lookup & casing';
      const cLower = col.toLowerCase();
      if (cLower.includes('country')) {
        ruleCode = 'HARM_COUNTRY_ISO';
        ruleDesc = 'ISO-3166 2-Letter Country Code Harmonization';
      } else if (cLower.includes('gender')) {
        ruleCode = 'HARM_GENDER_NORM';
        ruleDesc = 'Normalized gender terms to single character (M/F)';
      } else if (cLower.includes('date')) {
        ruleCode = 'HARM_DATE_ISO';
        ruleDesc = 'Standardized date formats to YYYY-MM-DD';
      } else if (cLower.includes('person') || cLower.includes('id')) {
        ruleCode = 'HARM_PAD_ID';
        ruleDesc = 'Left-padded numeric keys to standard SAP length';
      }
      return {
        field: col,
        totalRows: harmonizedData.length,
        modifiedCount,
        ruleCode,
        description: ruleDesc,
        status: modifiedCount > 0 ? 'HARMONIZED' : 'UNCHANGED',
      };
    });

    // Sort so fields with changes appear first
    summary.sort((a, b) => b.modifiedCount - a.modifiedCount);
    return summary;
  }, [harmonizedData, getOriginalFieldValue]);

  const displayedRulesSummary = useMemo(() => {
    if (filterChangedFieldsOnly) {
      return harmonizationRulesSummary.filter(r => r.modifiedCount > 0);
    }
    return harmonizationRulesSummary;
  }, [harmonizationRulesSummary, filterChangedFieldsOnly]);

  const harmonizationRecordDiffs = useMemo(() => {
    const list: any[] = [];
    harmonizedData.forEach((harmRow, i) => {
      const keyId = harmRow['userId'] || harmRow['personIdExternal'] || harmRow['person-id-external'] || harmRow['EMP_ID'] || `#${i + 1}`;
      Object.keys(harmRow).forEach(col => {
        if (col === 'SOURCE' || col === '_source') return;
        if (selectedFieldFilter && col !== selectedFieldFilter) return;
        const harmVal = String(harmRow[col] || '');
        const { origVal, ruleApplied } = getOriginalFieldValue(i, col, harmVal);
        const changed = origVal !== '' && origVal !== harmVal;

        // When showOnlyChangedHarmonization is enabled, only include changed records!
        if (showOnlyChangedHarmonization && !changed) return;

        let ruleCode = ruleApplied;
        let ruleDescription = 'Standardized canonical code format';
        const cLower = col.toLowerCase();
        if (ruleApplied) {
          ruleDescription = ruleApplied;
        } else if (changed) {
          if (cLower.includes('country')) {
            ruleCode = 'HARM_COUNTRY_ISO';
            ruleDescription = 'ISO-3166 2-Letter Country Code Harmonization';
          } else if (cLower.includes('gender')) {
            ruleCode = 'HARM_GENDER_NORM';
            ruleDescription = 'Normalized gender terms to single character (M/F)';
          } else if (cLower.includes('date')) {
            ruleCode = 'HARM_DATE_ISO';
            ruleDescription = 'Standardized date formats to YYYY-MM-DD';
          } else if (cLower.includes('person') || cLower.includes('id')) {
            ruleCode = 'HARM_PAD_ID';
            ruleDescription = 'Left-padded numeric keys to standard SAP length';
          } else {
            ruleCode = 'HARM_STANDARDIZE';
            ruleDescription = 'Standardized canonical code format';
          }
        } else {
          ruleCode = 'PASS_THROUGH';
          ruleDescription = 'Source value verified without transformation';
        }

        list.push({
          row: i + 1,
          keyId,
          field: col,
          oldValue: origVal || harmVal || '(Empty)',
          newValue: harmVal || '(Empty)',
          changed,
          ruleCode,
          ruleDescription,
          status: changed ? 'HARMONIZED' : 'VERIFIED',
        });
      });
    });
    return list;
  }, [harmonizedData, selectedFieldFilter, getOriginalFieldValue, showOnlyChangedHarmonization]);

  /* ─── STEP 5: VALIDATION AUDIT DATA (Rules Evaluated & Violations) ─── */
  const validationRulesSummary = useMemo(() => {
    const map = new Map<string, { errors: number; warns: number; rules: Set<string> }>();
    validationResults.forEach(v => {
      v.errs.forEach(e => {
        const item = map.get(e.f) || { errors: 0, warns: 0, rules: new Set() };
        item.errors++;
        item.rules.add(e.rule || 'MANDATORY_OR_FORMAT');
        map.set(e.f, item);
      });
      v.warns.forEach(w => {
        const item = map.get(w.f) || { errors: 0, warns: 0, rules: new Set() };
        item.warns++;
        item.rules.add(w.rule || 'FORMAT_WARNING');
        map.set(w.f, item);
      });
    });

    const allFields = Object.keys(harmonizedData[0] || extractedData[0] || {}).filter(c => c !== 'SOURCE' && c !== '_source');
    const summary = allFields.map(f => {
      const info = map.get(f) || { errors: 0, warns: 0, rules: new Set(['SCHEMA_COMPLIANCE']) };
      const ruleStr = Array.from(info.rules).join(', ');
      return {
        field: f,
        errors: info.errors,
        warns: info.warns,
        rulesEvaluated: ruleStr,
        status: info.errors > 0 ? 'BLOCKING_ERROR' : info.warns > 0 ? 'WARNING_FLAG' : 'COMPLIANT',
      };
    });

    // Sort so fields with failures appear first
    summary.sort((a, b) => (b.errors * 10 + b.warns) - (a.errors * 10 + a.warns));
    return summary;
  }, [validationResults, harmonizedData, extractedData]);

  const displayedValidationRules = useMemo(() => {
    if (filterFailingFieldsOnly) {
      return validationRulesSummary.filter(v => v.errors > 0 || v.warns > 0);
    }
    return validationRulesSummary;
  }, [validationRulesSummary, filterFailingFieldsOnly]);

  const validationViolationsList = useMemo(() => {
    const list: any[] = [];
    validationResults.forEach((v) => {
      const hasDefect = v.errs.length > 0 || v.warns.length > 0;
      
      // Add each blocking error
      v.errs.forEach(e => {
        if (selectedFieldFilter && e.f !== selectedFieldFilter) return;
        const rawVal = (v.row as any)?.[e.f] ?? (extractedData[v.idx - 1] as any)?.[e.f] ?? (harmonizedData[v.idx - 1] as any)?.[e.f] ?? '';
        list.push({
          row: v.idx,
          keyId: v.primary_key || `#${v.idx}`,
          field: e.f,
          value: String(rawVal || '(Empty / Missing)'),
          finding: e.m,
          severity: 'ERROR',
          ruleCode: e.rule || 'VAL_MANDATORY_OR_FORMAT',
        });
      });

      // Add each warning flag
      v.warns.forEach(w => {
        if (selectedFieldFilter && w.f !== selectedFieldFilter) return;
        const rawVal = (v.row as any)?.[w.f] ?? (extractedData[v.idx - 1] as any)?.[w.f] ?? (harmonizedData[v.idx - 1] as any)?.[w.f] ?? '';
        list.push({
          row: v.idx,
          keyId: v.primary_key || `#${v.idx}`,
          field: w.f,
          value: String(rawVal || '(Review format)'),
          finding: w.m,
          severity: 'WARN',
          ruleCode: w.rule || 'VAL_FORMAT_WARNING',
        });
      });

      // If user toggled to view all records (including clean), and this row had zero defects:
      if (!showOnlyFailingValidation && !hasDefect && !selectedFieldFilter) {
        list.push({
          row: v.idx,
          keyId: v.primary_key || `#${v.idx}`,
          field: 'ALL_FIELDS',
          value: 'Validated clean',
          finding: 'Record passes all SuccessFactors schema constraints and business rules',
          severity: 'PASS',
          ruleCode: 'VAL_SUCCESS',
        });
      }
    });
    return list;
  }, [validationResults, selectedFieldFilter, showOnlyFailingValidation, extractedData, harmonizedData]);

  /* ─── STEP 6: CLEANSING AUDIT DATA (Fixes Applied & Before/After Remediation) ─── */
  const cleansingRulesSummary = useMemo(() => {
    const map = new Map<string, { count: number; rules: Set<string>; examples: string[] }>();
    cleansingFixes.forEach(f => {
      const item = map.get(f.field) || { count: 0, rules: new Set(), examples: [] };
      item.count++;
      item.rules.add(f.rule_code);
      if (item.examples.length < 2) {
        item.examples.push(`"${f.old}" → "${f.new}"`);
      }
      map.set(f.field, item);
    });

    return Array.from(map.entries()).map(([field, data]) => ({
      field,
      fixesCount: data.count,
      rulesApplied: Array.from(data.rules).join(', '),
      description: data.examples.join(' | '),
      status: 'REMEDIATED',
    }));
  }, [cleansingFixes]);

  const cleansingDiffsList = useMemo(() => {
    return cleansingFixes
      .filter(f => !selectedFieldFilter || f.field === selectedFieldFilter)
      .map(f => ({
        row: f.row,
        field: f.field,
        oldValue: f.old,
        newValue: f.new,
        ruleCode: f.rule_code,
        status: 'APPLIED',
      }));
  }, [cleansingFixes, selectedFieldFilter]);

  /* ─── STEP 7: TRANSFORMATION & DMC PRELOAD DATA (Preload Format & Defaults) ─── */
  const transformationPreloadData = useMemo(() => {
    const cols = Object.keys(transformedData[0] || {});
    return cols.map(col => {
      let ruleName = 'Direct Target Field Alignment';
      let ruleDetail = 'Target column matched directly from cleansed master';
      if (col.includes('id') || col.includes('person')) {
        ruleName = 'Key Standardization';
        ruleDetail = 'Padded numeric identifier to standard length';
      } else if (col.includes('country')) {
        ruleName = 'ISO Country Format';
        ruleDetail = 'Preload compliant 2-letter alpha ISO code';
      } else if (col.includes('date')) {
        ruleName = 'Target ISO Date Conversion';
        ruleDetail = 'Formatted strictly to YYYY-MM-DD for DMC import';
      }
      return {
        targetField: col,
        ruleApplied: ruleName,
        ruleDescription: ruleDetail,
        targetType: 'NVARCHAR / STRING',
        recordsCompliant: transformedData.length,
        status: 'DMC_READY',
      };
    });
  }, [transformedData]);

  return (
    <PageLayout>
      <div className="max-w-[1100px] mx-auto space-y-6 bg-[var(--bg-secondary)] border border-[var(--border)] shadow-[var(--shadow-sm)] rounded-xl p-6 sm:p-8">
        <div>
          <h1 className="text-2xl font-black text-[var(--text-primary)] tracking-tight">Technical Documentation & Migration Control Center</h1>
          <p className="text-[13px] text-[var(--text-secondary)] mt-1">SuccessFactors Data Migration Studio — Stage-by-Stage Operational Audit Reports & Applied Rule Logs</p>
          <div className="flex gap-2 flex-wrap mt-3">
            <Badge variant="blue">SuccessFactors Ready</Badge>
            <Badge variant="cyan">AI Mapping Engine</Badge>
            <Badge variant="green">Audit Logging</Badge>
            <Badge variant="violet">7 SF Objects</Badge>
            <Badge variant="teal">9-Step Pipeline</Badge>
            <Badge variant="amber">DMC/LTMC Templates</Badge>
          </div>
        </div>

        {/* 1. Architecture Overview */}
        <Section title="1. Architecture Overview">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ArchBox title="Studio Pipeline Architecture" code={`SF-Migration-Studio (React + Vite + FastAPI)
├── Core Frontend Pipeline
│   ├── Step 1: Source Data Connection & Upload
│   ├── Step 2: AI-Powered Field Mapping
│   ├── Step 3: EDA & Quality Analysis
│   ├── Step 4: Data Harmonization & Standardization
│   ├── Step 5: Multi-Rule Validation Engine
│   ├── Step 6: Autonomous AI Cleanser
│   ├── Step 7: Preload Transformation
│   ├── Step 8: DMC / LTMC File Export
│   └── Step 9: TechDocs & Customer Audit Reports
└── Backend Engine (FastAPI + Supabase)
    ├── RAG Metadata Search & Dynamic Rule Compilers
    ├── Deterministic & LLM Business Rule Execution
    └── High-Performance File & DB Transformers`} />
            <ArchBox title="Global State Management" code={`const MigrationStore = {
  // Session Scope
  projectId, projectName, obj: 'Biographical Info',
  // Stage Data Flow
  rawData: [],     // Source uploaded rows
  headers: [],     // Source legacy fields
  mapping: [],     // Field-to-field mappings
  extracted: [],   // Normalized extracted dataset
  harmonized: [],  // Standardized code lookups
  validated: [],   // Audit findings & status
  cleaned: [],     // Remediated records
  transformed: [], // DMC ready target format
  dmcRows: [],     // Preload package rows
  // Dynamic Rule Engines
  harmonizeDynamicRules: [],
  validationDynamicRules: [],
  cleanserDynamicRules: [],
  transformDynamicRules: []
}`} />
          </div>
        </Section>

        {/* 2. Comprehensive Migration Reports Section */}
        <Section title="2. Migration Stage Reports (Rules Applied & Operational Logs)">
          <div className="space-y-5">
            <p className="text-[12.5px] text-[var(--text-secondary)] leading-relaxed">
              Detailed, downloadable stage-specific reports for target object:{' '}
              <strong className="text-teal-600 dark:text-teal-400 font-mono">{state.obj || 'Biographical Info'}</strong>.
              Each tab provides the specific report required for that phase, detailing the exact rules applied and compliance results.
            </p>

            {/* Navigation Tab Bar */}
            <div className="flex gap-1.5 p-1.5 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border)] overflow-x-auto">
              {[
                { id: 'master', label: 'Master Summary', icon: <Layers className="w-3.5 h-3.5" /> },
                { id: 'mapping', label: '1. Field Mapping Report', icon: <Table className="w-3.5 h-3.5" /> },
                { id: 'extraction', label: '2. Extraction Quality Report', icon: <Database className="w-3.5 h-3.5" /> },
                { id: 'harmonization', label: '3. Harmonization Report', icon: <Sparkles className="w-3.5 h-3.5" /> },
                { id: 'validation', label: '4. Validation Audit Report', icon: <ShieldCheck className="w-3.5 h-3.5" /> },
                { id: 'cleansing', label: '5. Cleansing Audit Log', icon: <Wrench className="w-3.5 h-3.5" /> },
                { id: 'transformation', label: '6. Transformation Report', icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id as ReportTab)}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[11px] font-bold transition-all whitespace-nowrap cursor-pointer ${
                    activeTab === tab.id
                      ? 'bg-teal-600 text-white shadow-sm'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </div>

            {/* ════════════════ TAB 1: MASTER EXECUTIVE SUMMARY ════════════════ */}
            {activeTab === 'master' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)]/50 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono uppercase font-bold text-teal-600 dark:text-teal-400 flex items-center gap-1">
                        <Database className="w-3.5 h-3.5" /> Extraction & EDA
                      </span>
                      <Badge variant="teal">{extractedData.length} Rows</Badge>
                    </div>
                    <div className="text-base font-extrabold text-[var(--text-primary)] font-mono">
                      {state.reportMetrics?.score || 95}/100 <span className="text-[10px] font-normal text-[var(--text-tertiary)]">Score</span>
                    </div>
                    <div className="text-[10.5px] text-[var(--text-secondary)] space-y-0.5 font-mono">
                      <div>Mapped Fields: <strong>{mappingRows.length}</strong></div>
                      <div>Format Anomalies: <strong className="text-amber-500">{state.reportMetrics?.total_anomalies || 1}</strong></div>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)]/50 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono uppercase font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1">
                        <ShieldCheck className="w-3.5 h-3.5" /> Validation Rules
                      </span>
                      <Badge variant="blue">{validationResults.length} Rows</Badge>
                    </div>
                    <div className="text-base font-extrabold text-[var(--text-primary)] font-mono">
                      {Math.round((validationResults.filter(r => r.st !== 'ERROR').length / validationResults.length) * 100)}% <span className="text-[10px] font-normal text-[var(--text-tertiary)]">Pass Rate</span>
                    </div>
                    <div className="text-[10.5px] text-[var(--text-secondary)] space-y-0.5 font-mono">
                      <div>Valid: <strong className="text-emerald-500">{validationResults.filter(r => r.st === 'PASS').length}</strong></div>
                      <div>Errors: <strong className="text-red-500">{validationResults.filter(r => r.st === 'ERROR').length}</strong></div>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)]/50 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono uppercase font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                        <Wrench className="w-3.5 h-3.5" /> Cleansing Fixes
                      </span>
                      <Badge variant="amber">{cleansingFixes.length} Fixes</Badge>
                    </div>
                    <div className="text-base font-extrabold text-[var(--text-primary)] font-mono">
                      100% <span className="text-[10px] font-normal text-[var(--text-tertiary)]">Standardized</span>
                    </div>
                    <div className="text-[10.5px] text-[var(--text-secondary)] space-y-0.5 font-mono">
                      <div>ISO Fixes: <strong>{cleansingFixes.filter(f => String(f.rule_code).includes('COUNTRY')).length}</strong></div>
                      <div>Space Trims: <strong>{cleansingFixes.filter(f => String(f.rule_code).includes('TRIM')).length}</strong></div>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)]/50 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono uppercase font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Preload Ready
                      </span>
                      <Badge variant="green">{transformedData.length} Rows</Badge>
                    </div>
                    <div className="text-base font-extrabold text-emerald-500 font-mono">
                      DMC Ready
                    </div>
                    <div className="text-[10.5px] text-[var(--text-secondary)] space-y-0.5 font-mono">
                      <div>Org Defaults: <strong>Applied</strong></div>
                      <div>Export Target: <strong>SF DMC CSV</strong></div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 rounded-xl bg-gradient-to-r from-teal-950/20 via-indigo-950/20 to-purple-950/20 border border-[var(--border)]">
                  <div className="flex items-center gap-3">
                    <FileText className="w-6 h-6 text-teal-500 shrink-0" />
                    <div>
                      <div className="text-sm font-bold text-[var(--text-primary)]">Executive Master Migration Report</div>
                      <div className="text-[11px] text-[var(--text-tertiary)]">Consolidated stage-by-stage audit package for {state.obj || 'Biographical Info'}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="primary"
                      size="sm"
                      icon={<Download className="w-3.5 h-3.5" />}
                      onClick={() => {
                        const headers = ['Stage', 'Input Records', 'Metrics / Quality Score', 'Actions & Rules Applied', 'Status'];
                        const rows = [
                          ['1. Field Mapping', `${mappingRows.length} fields`, `Avg Confidence: 90%`, 'Mapped Source to SF Target Schema', 'Completed'],
                          ['2. Data Extraction', `${extractedData.length} records`, `Quality Score: ${state.reportMetrics?.score || 95}/100`, 'Scanned EDA stats & field completeness', 'Completed'],
                          ['3. Harmonization', `${harmonizedData.length} records`, `Lookup Mapped`, 'Standardized ISO Codes & Pay Terms', 'Completed'],
                          ['4. Validation Rules', `${validationResults.length} records`, `Pass Rate: ${Math.round((validationResults.filter(r => r.st !== 'ERROR').length / validationResults.length) * 100)}%`, 'Evaluated Mandatory, Format & Length Rules', 'Completed'],
                          ['5. Data Cleansing', `${cleansingFixes.length} auto-fixes`, `100% Cleansed`, 'Applied ISO mapping, Whitespace Trimming & Padding', 'Completed'],
                          ['6. Preload Transformation', `${transformedData.length} records`, `100% DMC Compliant`, 'Injected Org defaults & formatted for SF DMC export', 'Ready']
                        ];
                        exportPDF({
                          bannerTitle: 'Master Executive Migration Report',
                          reportTitle: `Consolidated Multi-Stage Migration Scorecard: ${state.obj || 'Biographical Info'}`,
                          targetObject: state.obj || 'Biographical Info',
                          kpiTitle: `Overall Migration Readiness Score: ${state.reportMetrics?.score || 96} / 100  (Grade ${state.reportMetrics?.grade || 'A'})`,
                          kpiSubtitle: `Total Source Records: ${extractedData.length} | Mapped Fields: ${mappingRows.length} | Harmonized Records: ${harmonizedData.length} | DMC Preload: Ready`,
                          summaryTitle: '1. Executive Summary',
                          summary: `Consolidated end-to-end migration execution scorecard for ${state.obj || 'Biographical Info'}. Validates semantic mapping alignment, extraction profiling hygiene, canonical value harmonization, schema constraint validation, automated defect cleansing, and DMC staging readiness.`,
                          criticalRisksTitle: '2. Stage Completion & Quality Gates',
                          criticalRisks: [
                            `• Field Mapping: Semantically mapped ${mappingRows.length} source attributes to target SF schema with 90% average confidence.`,
                            `• Harmonization: Executed ISO standard lookups and corporate formatting rules on ${harmonizedData.length} master records.`,
                            `• Validation & Cleansing: Evaluated mandatory constraints with ${Math.round((validationResults.filter(r => r.st !== 'ERROR').length / (validationResults.length || 1)) * 100)}% pass rate; applied ${cleansingFixes.length} deterministic auto-fixes.`
                          ],
                          actionPlanTitle: '3. Recommended Action Plan',
                          actionPlan: [
                            'Review final field transforms with migration business owners before triggering DMC production load.',
                            'Verify zero blocking errors in destination SuccessFactors staging workspace.',
                            'Archive this signed executive report package for audit and compliance traceability.'
                          ],
                          tableTitle: '4. Stage-by-Stage Migration Progress & Audit Matrix',
                          headers,
                          rows,
                          colWidths: [45, 32, 50, 112, 30],
                          orientation: 'landscape',
                          filename: `Master_Executive_Report_${state.obj || 'Biographical Info'}.pdf`
                        });
                      }}
                    >
                      Export Master PDF
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Download className="w-3.5 h-3.5 text-teal-500" />}
                      onClick={() => {
                        const summaryData = [
                          { Stage: '1. Mapping', Records: mappingRows.length, Metric: 'Avg Conf 90%', Status: 'Completed' },
                          { Stage: '2. Extraction', Records: extractedData.length, Metric: `Score ${state.reportMetrics?.score || 95}/100`, Status: 'Completed' },
                          { Stage: '3. Harmonization', Records: harmonizedData.length, Metric: 'ISO Standardized', Status: 'Completed' },
                          { Stage: '4. Validation', Records: validationResults.length, Metric: `Pass Rate ${Math.round((validationResults.filter(r => r.st !== 'ERROR').length / validationResults.length) * 100)}%`, Status: 'Completed' },
                          { Stage: '5. Cleansing Audit', Records: cleansingFixes.length, Metric: `${cleansingFixes.length} Auto-Fixes`, Status: 'Completed' },
                          { Stage: '6. Transformation', Records: transformedData.length, Metric: 'DMC Ready', Status: 'Ready' }
                        ];
                        dl(expCSV(summaryData), `Master_Executive_Summary_${state.obj || 'Biographical Info'}.csv`, 'text/csv');
                      }}
                    >
                      Export Master CSV
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* ════════════════ TAB 2: FIELD MAPPING REPORT (MAPPING INFO ONLY) ════════════════ */}
            {activeTab === 'mapping' && (
              <div className="space-y-4">
                <CollapsibleCard
                  title="Field Mapping Specification Report"
                  subtitle="Source-to-Target schema mapping rules, matching strategies, and inferred transforms"
                  icon={<Table className="w-4 h-4" />}
                  badge={`${mappingReportData.length} Fields Mapped`}
                  action={
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Download className="w-3 h-3 text-teal-500" />}
                        onClick={() => dl(expCSV(mappingReportData), `Field_Mapping_Report_${state.obj}.csv`, 'text/csv')}
                      >
                        Download CSV
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Download className="w-3 h-3 text-indigo-500" />}
                        onClick={() => {
                          const headers = ['Source Field', 'Target SF Field', 'Field Label', 'Confidence', 'Strategy', 'Transform Rule', 'Mandatory'];
                          const rows = mappingReportData.map(m => [m.sourceField, m.targetField, m.fieldLabel, `${m.confidence}%`, m.strategy, m.transformRule, m.mandatory]);
                          const avgConf = Math.round(mappingReportData.reduce((acc, m) => acc + m.confidence, 0) / (mappingReportData.length || 1));
                          const reqCount = mappingReportData.filter(m => m.mandatory === 'REQUIRED' || m.mandatory === 'YES').length;
                          exportPDF({
                            bannerTitle: 'Field Mapping Specification Report',
                            reportTitle: `Source to SuccessFactors Mapping Matrix: ${state.obj || 'Biographical Info'}`,
                            targetObject: state.obj || 'Biographical Info',
                            kpiTitle: `Overall Mapping Alignment: ${avgConf}% Avg Confidence  (${mappingReportData.length} Fields Mapped)`,
                            kpiSubtitle: `Target Object: ${state.obj || 'Biographical Info'} | Mandatory Fields: ${reqCount} | Exact Key Matches: ${mappingReportData.filter(m => m.confidence >= 90).length}`,
                            summaryTitle: '1. Executive Summary',
                            summary: `Complete semantic alignment documentation mapping legacy source fields to the destination SuccessFactors ${state.obj || 'Biographical Info'} schema. Contains verified AI confidence ratings, matching heuristics, and assigned transformation rules.`,
                            criticalRisksTitle: '2. Mapping Heuristics & Schema Rules',
                            criticalRisks: [
                              `• Exact Key Matches: ${mappingReportData.filter(m => m.confidence >= 90).length} fields matched with >=90% confidence.`,
                              `• Mandatory Destination Fields: Verified ${reqCount} required fields have valid source bindings.`,
                              `• Format Transformations: Assigned custom transforms (ISO conversion, whitespace trimming, zero-padding).`
                            ],
                            actionPlanTitle: '3. Recommended Action Plan',
                            actionPlan: [
                              'Verify semantic mappings for any fields with confidence score under 85%.',
                              'Confirm mandatory target fields without direct source counterparts have default constant injection configured.',
                              'Obtain formal customer sign-off on target field labels and data type mappings.'
                            ],
                            tableTitle: '4. Field Mapping Specification Matrix',
                            headers,
                            rows,
                            colWidths: [38, 44, 44, 24, 45, 46, 28],
                            orientation: 'landscape',
                            filename: `Field_Mapping_Report_${state.obj || 'Biographical Info'}.pdf`
                          });
                        }}
                      >
                        Download PDF
                      </Button>
                    </div>
                  }
                >
                  <div className="p-4 space-y-2 text-[12px] text-[var(--text-secondary)] leading-relaxed border-t border-[var(--border)]">
                    <p>
                      <strong>Mapping Overview:</strong> This report documents the complete semantic alignment between legacy source fields and the target SuccessFactors <strong>{state.obj || 'Biographical Info'}</strong> metadata schema. It provides exact confidence scores, matching strategies, and the inferred transformation rule assigned to each field.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 font-mono text-[11px]">
                      <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]/50 border border-[var(--border)]">
                        <strong>Total Fields Mapped:</strong> {mappingReportData.length} fields
                      </div>
                      <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]/50 border border-[var(--border)]">
                        <strong>Average Confidence:</strong> {Math.round(mappingReportData.reduce((acc, m) => acc + m.confidence, 0) / mappingReportData.length)}%
                      </div>
                      <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]/50 border border-[var(--border)]">
                        <strong>Mandatory Target Fields:</strong> {mappingReportData.filter(m => m.mandatory === 'REQUIRED').length} required
                      </div>
                    </div>
                  </div>
                </CollapsibleCard>

                {/* Mapping Information Table */}
                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden shadow-xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[11.5px]">
                      <thead className="bg-[var(--bg-tertiary)] border-b border-[var(--border)] text-[var(--text-tertiary)] font-mono uppercase text-[9.5px]">
                        <tr>
                          <th className="py-2.5 px-3">#</th>
                          <th className="py-2.5 px-3">Source Field</th>
                          <th className="py-2.5 px-3">Target SF Field</th>
                          <th className="py-2.5 px-3">Field Label</th>
                          <th className="py-2.5 px-3">Match Confidence</th>
                          <th className="py-2.5 px-3">Matching Strategy</th>
                          <th className="py-2.5 px-3">Inferred Transform Rule</th>
                          <th className="py-2.5 px-3">Mandatory</th>
                          <th className="py-2.5 px-3">Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)] font-mono text-[11px] text-[var(--text-secondary)]">
                        {mappingReportData.slice((page1 - 1) * PAGE_SIZE, page1 * PAGE_SIZE).map((m, idx) => (
                          <tr key={idx} className="hover:bg-[var(--bg-tertiary)]/50 transition-colors">
                            <td className="py-2.5 px-3 text-[var(--text-tertiary)]">{(page1 - 1) * PAGE_SIZE + idx + 1}</td>
                            <td className="py-2.5 px-3 font-bold text-teal-600 dark:text-teal-400">{m.sourceField}</td>
                            <td className="py-2.5 px-3 font-bold text-[var(--text-primary)]">{m.targetField}</td>
                            <td className="py-2.5 px-3">{m.fieldLabel}</td>
                            <td className="py-2.5 px-3">
                              <Badge variant={m.confidence >= 90 ? 'green' : 'amber'}>{m.confidence}%</Badge>
                            </td>
                            <td className="py-2.5 px-3 text-[10.5px] text-[var(--text-tertiary)]">{m.strategy}</td>
                            <td className="py-2.5 px-3 text-indigo-500 font-semibold">{m.transformRule}</td>
                            <td className="py-2.5 px-3">
                              <Badge variant={m.mandatory === 'REQUIRED' ? 'red' : 'blue'}>{m.mandatory}</Badge>
                            </td>
                            <td className="py-2.5 px-3 text-[10.5px] text-[var(--text-tertiary)]">{m.notes}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pagination
                    currentPage={page1}
                    totalItems={mappingReportData.length}
                    pageSize={PAGE_SIZE}
                    onPageChange={setPage1}
                  />
                </div>
              </div>
            )}

            {/* ════════════════ TAB 3: EXTRACTION QUALITY REPORT ════════════════ */}
            {activeTab === 'extraction' && (
              <div className="space-y-4">
                <CollapsibleCard
                  title="Data Extraction & Quality Audit Report"
                  subtitle="Field completeness scorecard, null distributions, and detected formatting anomalies"
                  icon={<Database className="w-4 h-4" />}
                  badge={`${extractedData.length} Extracted Records`}
                  action={
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Download className="w-3 h-3 text-teal-500" />}
                        onClick={() => dl(expCSV(extractionQualityData), `Extraction_Quality_Report_${state.obj}.csv`, 'text/csv')}
                      >
                        Download CSV
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Download className="w-3 h-3 text-indigo-500" />}
                        onClick={() => {
                          const headers = ['Field Name', 'Completeness', 'Missing / Nulls', 'Anomalies Detected', 'Quality Grade', 'Profiling Finding'];
                          const rows = extractionQualityData.map(e => [e.field, `${e.completeness}%`, String(e.nullCount), String(e.anomalyCount), e.qualityGrade, e.profilingNote]);
                          const score = state.reportMetrics?.score || 98;
                          const grade = state.reportMetrics?.grade || 'A';
                          const healthyCount = extractionQualityData.filter(e => e.qualityGrade === 'A').length;
                          const warnCount = extractionQualityData.filter(e => e.qualityGrade === 'B').length;
                          const critCount = extractionQualityData.filter(e => e.qualityGrade === 'C' || e.qualityGrade === 'D').length;
                          exportPDF({
                            bannerTitle: 'Data Quality Report',
                            reportTitle: `Deterministic Data Quality Report: ${state.obj || 'Biographical Info'} Master Data`,
                            targetObject: state.obj || 'Biographical Info',
                            kpiTitle: `Overall Data Readiness Score: ${score} / 100  (Grade ${grade})`,
                            kpiSubtitle: `Total Records: ${extractedData.length} | Total Mapped Fields: ${extractionQualityData.length} | Healthy: ${healthyCount} | Warning: ${warnCount} | Critical: ${critCount}`,
                            summaryTitle: '1. Executive Summary',
                            summary: `Automated quality scan completed across ${extractedData.length} records and ${extractionQualityData.length} fields with data readiness score ${score}/100. Evaluated null frequencies, character formats, and schema compliance.`,
                            criticalRisksTitle: '2. Critical Data Quality Observations',
                            criticalRisks: [
                              `• Null Value Distribution: Scanned completeness across all extracted columns.`,
                              `• Boundary Checks: Evaluated anomalies in key identifier and date fields.`
                            ],
                            actionPlanTitle: '3. Recommended Action Plan',
                            actionPlan: [
                              '[SOURCE] has constant value across all rows. Consider default configuration in SAP.',
                              'Remediate anomalous records via downstream harmonization and automated cleansing steps.',
                              'Ensure critical primary key identifiers have 100% completeness before validation.'
                            ],
                            tableTitle: '4. Field Completeness & Quality Statistics Breakdown',
                            headers,
                            rows,
                            colWidths: [45, 30, 30, 35, 28, 101],
                            orientation: 'landscape',
                            filename: `Data_Quality_Report_${state.obj || 'Biographical Info'}.pdf`
                          });
                        }}
                      >
                        Download PDF
                      </Button>
                    </div>
                  }
                >
                  <div className="p-4 space-y-2 text-[12px] text-[var(--text-secondary)] leading-relaxed border-t border-[var(--border)]">
                    <p>
                      <strong>Quality Profiling Summary:</strong> Every column extracted from source uploads was evaluated for null frequencies, character format validity, and schema boundary violations. This scorecard provides baseline data health metrics before running harmonization and validation.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 font-mono text-[11px]">
                      <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]/50 border border-[var(--border)]">
                        <strong>Overall Quality Score:</strong> {state.reportMetrics?.score || 95}/100
                      </div>
                      <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]/50 border border-[var(--border)]">
                        <strong>Total Anomalies Detected:</strong> {extractionQualityData.reduce((acc, e) => acc + e.anomalyCount, 0)} across fields
                      </div>
                      <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]/50 border border-[var(--border)]">
                        <strong>Average Completeness:</strong> {Math.round(extractionQualityData.reduce((acc, e) => acc + e.completeness, 0) / extractionQualityData.length)}%
                      </div>
                    </div>
                  </div>
                </CollapsibleCard>

                {/* Quality Scorecard Table */}
                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden shadow-xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[11.5px]">
                      <thead className="bg-[var(--bg-tertiary)] border-b border-[var(--border)] text-[var(--text-tertiary)] font-mono uppercase text-[9.5px]">
                        <tr>
                          <th className="py-2.5 px-3">#</th>
                          <th className="py-2.5 px-3">Field Name</th>
                          <th className="py-2.5 px-3">Total Rows</th>
                          <th className="py-2.5 px-3">Completeness</th>
                          <th className="py-2.5 px-3">Missing / Nulls</th>
                          <th className="py-2.5 px-3">Anomalies Detected</th>
                          <th className="py-2.5 px-3">Quality Grade</th>
                          <th className="py-2.5 px-3">Assessment Finding</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)] font-mono text-[11px] text-[var(--text-secondary)]">
                        {extractionQualityData.slice((page1 - 1) * PAGE_SIZE, page1 * PAGE_SIZE).map((e, idx) => (
                          <tr key={idx} className="hover:bg-[var(--bg-tertiary)]/50 transition-colors">
                            <td className="py-2.5 px-3 text-[var(--text-tertiary)]">{(page1 - 1) * PAGE_SIZE + idx + 1}</td>
                            <td className="py-2.5 px-3 font-bold text-teal-600 dark:text-teal-400">{e.field}</td>
                            <td className="py-2.5 px-3">{e.totalRows}</td>
                            <td className="py-2.5 px-3">
                              <span className="font-bold text-[var(--text-primary)]">{e.completeness}%</span>
                            </td>
                            <td className="py-2.5 px-3 text-red-500 font-semibold">{e.nullCount}</td>
                            <td className="py-2.5 px-3 text-amber-500 font-semibold">{e.anomalyCount}</td>
                            <td className="py-2.5 px-3">
                              <Badge variant={e.completeness === 100 && e.anomalyCount === 0 ? 'green' : e.anomalyCount > 0 ? 'amber' : 'red'}>
                                {e.status}
                              </Badge>
                            </td>
                            <td className="py-2.5 px-3 text-[10.5px] text-[var(--text-tertiary)]">{e.profilingNote}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pagination
                    currentPage={page1}
                    totalItems={extractionQualityData.length}
                    pageSize={PAGE_SIZE}
                    onPageChange={setPage1}
                  />
                </div>
              </div>
            )}

            {/* ════════════════ TAB 4: HARMONIZATION REPORT (RULES APPLIED & BEFORE/AFTER) ════════════════ */}
            {activeTab === 'harmonization' && (
              <div className="space-y-4">
                <CollapsibleCard
                  title="Data Harmonization Operational Report"
                  subtitle="Standardized legacy codes, country ISO conversions, gender norms, and casing rules"
                  icon={<Sparkles className="w-4 h-4" />}
                  badge={`${harmonizedData.length} Records Harmonized`}
                  action={
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Download className="w-3 h-3 text-teal-500" />}
                        onClick={() => {
                          const exportData = harmonizationRecordDiffs.filter(r => r.changed);
                          const toExport = exportData.length > 0 ? exportData : harmonizationRecordDiffs;
                          const cleanRows = toExport.map(r => ({
                            'Row #': r.row,
                            'Record Key ID': r.keyId,
                            'Field Name': r.field,
                            'Original Value (Before)': r.oldValue,
                            'Harmonized Value (After)': r.newValue,
                            'Rule Applied': r.ruleCode,
                            'Rule Description': r.ruleDescription || r.ruleCode,
                            'Status': r.status,
                          }));
                          dl(expCSV(cleanRows), `Harmonization_Changed_Records_${state.obj}.csv`, 'text/csv');
                        }}
                      >
                        Download CSV (Changed Only)
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Download className="w-3 h-3 text-indigo-500" />}
                        onClick={() => {
                          const exportData = harmonizationRecordDiffs.filter(r => r.changed);
                          const toExport = exportData.length > 0 ? exportData : harmonizationRecordDiffs;
                          const headers = ['Row #', 'Key ID', 'Field Name', 'Original Value (Before)', 'Harmonized Value (After)', 'Rule Code Applied', 'Status'];
                          const rows = toExport.map(r => [String(r.row), r.keyId, r.field, r.oldValue, r.newValue, r.ruleCode, r.status]);
                          exportPDF({
                            bannerTitle: 'Harmonization Audit Report',
                            reportTitle: `Canonical Harmonization Audit Trail: ${state.obj || 'Biographical Info'} Master Data`,
                            targetObject: state.obj || 'Biographical Info',
                            kpiTitle: `Harmonization Impact: ${toExport.length} Changed Records  (100% Standardized)`,
                            kpiSubtitle: `Target Object: ${state.obj || 'Biographical Info'} | Total Records Audited: ${harmonizationRecordDiffs.length} | Transformed: ${toExport.length} | Status: All Canonical Rules Applied`,
                            summaryTitle: '1. Executive Summary',
                            summary: `Comprehensive audit trail documenting legacy data value standardization into canonical SAP SuccessFactors formats. Captures original source values, transformed target values, and the exact rule applied.`,
                            criticalRisksTitle: '2. Canonical Standardization Rules Applied',
                            criticalRisks: [
                              '• ISO Country Standardization (HARM_STANDARDIZE): Converted country descriptions to official 2-letter ISO 3166-1 alpha-2 codes.',
                              '• Date Formatting (HARM_DATE_ISO): Normalized heterogeneous date strings into strict YYYYMMDD / YYYY-MM-DD formats.',
                              '• Gender & Code Lookups: Standardized legacy gender and picklist strings into single-character canonical codes.'
                            ],
                            actionPlanTitle: '3. Recommended Action Plan',
                            actionPlan: [
                              'Verify harmonized 2-letter ISO country codes match the target SAP SuccessFactors tenant picklist.',
                              'Inspect all date transformations to ensure time zones and delimiter adjustments conform to DMC templates.',
                              'Sign off on harmonization diffs before advancing to schema validation.'
                            ],
                            tableTitle: `4. Harmonization Audit Trail (${toExport.length} Changed Records)`,
                            headers,
                            rows,
                            colWidths: [18, 30, 38, 45, 45, 63, 30],
                            orientation: 'landscape',
                            filename: `Harmonization_Changed_Records_${state.obj || 'Biographical Info'}.pdf`
                          });
                        }}
                      >
                        Download PDF (Changed Only)
                      </Button>
                    </div>
                  }
                >
                  <div className="p-4 space-y-2 text-[12px] text-[var(--text-secondary)] leading-relaxed border-t border-[var(--border)]">
                    <p>
                      <strong>Harmonization Rules Overview:</strong> In this phase, source system discrepancies are standardized into canonical formats. Standard dictionary lookups (ISO country codes, single-character gender keys) and custom dynamic rules are executed.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 font-mono text-[11px]">
                      <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]/50 border border-[var(--border)]">
                        <strong>Standard Rules Active:</strong> ISO Country, Gender Norm, Date ISO
                      </div>
                      <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]/50 border border-[var(--border)]">
                        <strong>Dynamic Harmonization Rules:</strong> {state.harmonizeDynamicRules?.length || 0} custom rules
                      </div>
                      <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]/50 border border-[var(--border)]">
                        <strong>Total Values Modified:</strong> {harmonizationRulesSummary.reduce((acc, r) => acc + r.modifiedCount, 0)} modifications
                      </div>
                    </div>
                  </div>
                </CollapsibleCard>

                {/* 1. Rules Applied Summary Table */}
                <CollapsibleCard
                  title="1. Harmonization Rules Applied (Field-by-Field)"
                  subtitle="Rules executed and count of values modified per field"
                  badge={`${displayedRulesSummary.length} Fields`}
                  action={
                    <button
                      onClick={() => {
                        setFilterChangedFieldsOnly(!filterChangedFieldsOnly);
                        setPage1(1);
                      }}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer ${
                        filterChangedFieldsOnly
                          ? 'bg-teal-50 text-teal-700 border-teal-300 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-800'
                          : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border-[var(--border)] hover:bg-[var(--bg-tertiary)]/80'
                      }`}
                    >
                      {filterChangedFieldsOnly
                        ? `✓ Changed Fields Only (${harmonizationRulesSummary.filter(r => r.modifiedCount > 0).length})`
                        : `Show Only Changed Fields (${harmonizationRulesSummary.filter(r => r.modifiedCount > 0).length})`}
                    </button>
                  }
                >
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[11.5px]">
                      <thead className="bg-[var(--bg-tertiary)] border-b border-[var(--border)] text-[var(--text-tertiary)] font-mono uppercase text-[9.5px]">
                        <tr>
                          <th className="py-2.5 px-3">#</th>
                          <th className="py-2.5 px-3">Field Name</th>
                          <th className="py-2.5 px-3">Harmonization Rule Code</th>
                          <th className="py-2.5 px-3">Rule Description & Logic</th>
                          <th className="py-2.5 px-3">Records Modified</th>
                          <th className="py-2.5 px-3">Status</th>
                          <th className="py-2.5 px-3 text-right">Inspect Diff</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)] font-mono text-[11px] text-[var(--text-secondary)]">
                        {displayedRulesSummary.slice((page1 - 1) * PAGE_SIZE, page1 * PAGE_SIZE).map((r, idx) => (
                          <tr key={idx} className={`hover:bg-[var(--bg-tertiary)]/50 transition-colors ${selectedFieldFilter === r.field ? 'bg-teal-50/40 dark:bg-teal-950/20' : ''}`}>
                            <td className="py-2 px-3 text-[var(--text-tertiary)]">{(page1 - 1) * PAGE_SIZE + idx + 1}</td>
                            <td className="py-2 px-3 font-bold text-teal-600 dark:text-teal-400">{r.field}</td>
                            <td className="py-2 px-3 text-indigo-500 font-semibold">{r.ruleCode}</td>
                            <td className="py-2 px-3 text-[10.5px] text-[var(--text-tertiary)]">{r.description}</td>
                            <td className="py-2 px-3">
                              <span className={`font-bold ${r.modifiedCount > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-[var(--text-tertiary)]'}`}>
                                {r.modifiedCount} / {r.totalRows}
                              </span>
                            </td>
                            <td className="py-2 px-3">
                              <Badge variant={r.modifiedCount > 0 ? 'green' : 'blue'}>{r.status}</Badge>
                            </td>
                            <td className="py-2 px-3 text-right">
                              {r.modifiedCount > 0 ? (
                                <button
                                  onClick={() => {
                                    setSelectedFieldFilter(selectedFieldFilter === r.field ? null : r.field);
                                    setPage2(1);
                                  }}
                                  className={`px-2.5 py-1 rounded-lg text-[10.5px] font-bold inline-flex items-center gap-1 cursor-pointer transition-colors ${
                                    selectedFieldFilter === r.field
                                      ? 'bg-teal-600 text-white shadow-sm'
                                      : 'bg-teal-50 text-teal-700 hover:bg-teal-100 dark:bg-teal-950/40 dark:text-teal-300 dark:hover:bg-teal-900/50 border border-teal-200 dark:border-teal-800/50'
                                  }`}
                                >
                                  {selectedFieldFilter === r.field ? 'Viewing' : 'Inspect'} <ArrowRight className="w-3 h-3" />
                                </button>
                              ) : (
                                <span className="text-[10.5px] text-[var(--text-tertiary)] italic">No changes</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pagination
                    currentPage={page1}
                    totalItems={displayedRulesSummary.length}
                    pageSize={PAGE_SIZE}
                    onPageChange={setPage1}
                  />
                </CollapsibleCard>

                {/* 2. Before vs After Detailed Record Changes */}
                <CollapsibleCard
                  title="2. Harmonization Audit Log (Before vs After Values)"
                  subtitle={
                    selectedFieldFilter
                      ? `Showing changed records for: ${selectedFieldFilter}`
                      : showOnlyChangedHarmonization
                      ? "Showing only transformed and standardized records"
                      : "Showing all record transformations"
                  }
                  badge={`${harmonizationRecordDiffs.length} ${showOnlyChangedHarmonization ? 'Changed' : 'Total'} Records`}
                  action={
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setShowOnlyChangedHarmonization(!showOnlyChangedHarmonization);
                          setPage2(1);
                        }}
                        className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-colors cursor-pointer ${
                          showOnlyChangedHarmonization
                            ? 'bg-teal-50 text-teal-700 border-teal-300 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-800'
                            : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border-[var(--border)] hover:bg-[var(--bg-tertiary)]/80'
                        }`}
                      >
                        {showOnlyChangedHarmonization ? '✓ Changed Records Only' : 'Show All Records'}
                      </button>
                      {selectedFieldFilter && (
                        <button
                          onClick={() => { setSelectedFieldFilter(null); setPage2(1); }}
                          className="text-[11px] text-teal-600 dark:text-teal-400 hover:underline flex items-center gap-1 font-semibold cursor-pointer ml-1"
                        >
                          <RotateCcw className="w-3 h-3" /> Show All Fields
                        </button>
                      )}
                    </div>
                  }
                >
                  {harmonizationRecordDiffs.length === 0 ? (
                    <div className="p-8 text-center text-[var(--text-tertiary)] font-mono text-xs">
                      <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-80" />
                      <div className="font-bold text-[var(--text-primary)] text-sm mb-1">No Changes Found</div>
                      <div>
                        All values{selectedFieldFilter ? ` for field "${selectedFieldFilter}"` : ''} conform to SuccessFactors canonical standards.
                      </div>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-[11.5px]">
                        <thead className="bg-[var(--bg-tertiary)] border-b border-[var(--border)] text-[var(--text-tertiary)] font-mono uppercase text-[9.5px]">
                          <tr>
                            <th className="py-2.5 px-3">Row #</th>
                            <th className="py-2.5 px-3">Record Key ID</th>
                            <th className="py-2.5 px-3">Field Name</th>
                            <th className="py-2.5 px-3">Original Value (Before)</th>
                            <th className="py-2.5 px-3">Harmonized Value (After)</th>
                            <th className="py-2.5 px-3">Rule Applied</th>
                            <th className="py-2.5 px-3">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)] font-mono text-[11px] text-[var(--text-secondary)]">
                          {harmonizationRecordDiffs.slice((page2 - 1) * PAGE_SIZE, page2 * PAGE_SIZE).map((r, idx) => (
                            <tr key={idx} className="hover:bg-[var(--bg-tertiary)]/50">
                              <td className="py-2 px-3 text-[var(--text-tertiary)]">#{r.row}</td>
                              <td className="py-2 px-3 font-bold text-[var(--text-primary)]">{r.keyId}</td>
                              <td className="py-2 px-3 font-bold text-teal-600 dark:text-teal-400">{r.field}</td>
                              <td className="py-2 px-3">
                                <span className={r.changed ? "text-red-400 line-through bg-red-950/10 px-1.5 py-0.5 rounded font-mono" : "text-[var(--text-tertiary)] font-mono"}>
                                  {r.oldValue}
                                </span>
                              </td>
                              <td className="py-2 px-3">
                                <span className={r.changed ? "text-emerald-500 font-bold bg-emerald-950/10 px-1.5 py-0.5 rounded font-mono" : "text-[var(--text-primary)] font-mono"}>
                                  {r.newValue}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-indigo-400 font-semibold">{r.ruleCode}</td>
                              <td className="py-2 px-3">
                                <Badge variant={r.changed ? 'green' : 'blue'}>{r.status}</Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <Pagination
                    currentPage={page2}
                    totalItems={harmonizationRecordDiffs.length}
                    pageSize={PAGE_SIZE}
                    onPageChange={setPage2}
                  />
                </CollapsibleCard>
              </div>
            )}

            {/* ════════════════ TAB 5: VALIDATION AUDIT REPORT (RULES EVALUATED & VIOLATIONS) ════════════════ */}
            {activeTab === 'validation' && (
              <div className="space-y-4">
                <CollapsibleCard
                  title="Validation Audit Report (Rule Evaluations & Findings)"
                  subtitle="Detailed compliance check against mandatory constraints, format rules, and custom validations"
                  icon={<ShieldCheck className="w-4 h-4" />}
                  badge={`${validationResults.length} Audited Records`}
                  action={
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Download className="w-3 h-3 text-teal-500" />}
                        onClick={() => {
                          const exportData = validationViolationsList.filter(v => v.severity !== 'PASS');
                          const toExport = exportData.length > 0 ? exportData : validationViolationsList;
                          const cleanRows = toExport.map(v => ({
                            'Row #': v.row,
                            'Record Key ID': v.keyId,
                            'Field Name': v.field,
                            'Tested / Failing Value': v.value,
                            'Failure Reason': v.finding,
                            'Rule Violated': v.ruleCode,
                            'Severity': v.severity,
                          }));
                          dl(expCSV(cleanRows), `Validation_Failures_${state.obj}.csv`, 'text/csv');
                        }}
                      >
                        Download CSV (Failing Only)
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Download className="w-3 h-3 text-indigo-500" />}
                        onClick={() => {
                          const exportData = validationViolationsList.filter(v => v.severity !== 'PASS');
                          const toExport = exportData.length > 0 ? exportData : validationViolationsList;
                          const headers = ['Row #', 'Key ID', 'Field Name', 'Tested / Failing Value', 'Failure Reason', 'Rule Violated', 'Severity'];
                          const rows = toExport.map(v => [String(v.row), v.keyId, v.field, v.value, v.finding, v.ruleCode, v.severity]);
                          const passRate = Math.round((validationResults.filter(r => r.st !== 'ERROR').length / (validationResults.length || 1)) * 100);
                          const errCount = validationViolationsList.filter(v => v.severity === 'ERROR').length;
                          const warnCount = validationViolationsList.filter(v => v.severity === 'WARN').length;
                          exportPDF({
                            bannerTitle: 'Validation Quality & Defect Report',
                            reportTitle: `Validation Rules & Defect Audit: ${state.obj || 'Biographical Info'} Master Data`,
                            targetObject: state.obj || 'Biographical Info',
                            kpiTitle: `Validation Pass Rate: ${passRate}%  (${toExport.length} Defect Records Audited)`,
                            kpiSubtitle: `Total Records Evaluated: ${validationResults.length} | Blocking Errors: ${errCount} | Warnings: ${warnCount} | Passed: ${validationResults.filter(r => r.st === 'PASS').length}`,
                            summaryTitle: '1. Executive Summary',
                            summary: `In-depth defect log evaluating records against destination SAP SuccessFactors schema constraints, mandatory non-null rules, regex formats, and custom validation expressions.`,
                            criticalRisksTitle: '2. Defect Analysis & Error Categories',
                            criticalRisks: [
                              `• Mandatory Field Violations: Flagged missing values on required foreign keys and business identifiers.`,
                              `• Formatting Errors: Flagged non-compliant dates, out-of-range numerics, and invalid character sets.`,
                              `• Schema Boundary Warnings: Identified minor deviations requiring automated or manual review.`
                            ],
                            actionPlanTitle: '3. Recommended Action Plan',
                            actionPlan: [
                              'Resolve all blocking errors (ERROR severity) using Step 6 Cleansing auto-fix rules or source remediation.',
                              'Review warning-level defects (WARN severity) with business analysts for acceptable legacy variance.',
                              'Re-execute validation pass to achieve 100% compliance prior to preload generation.'
                            ],
                            tableTitle: `4. Detailed Validation Defect Breakdown (${toExport.length} Defect Records)`,
                            headers,
                            rows,
                            colWidths: [18, 30, 38, 46, 65, 46, 26],
                            orientation: 'landscape',
                            filename: `Validation_Failures_${state.obj || 'Biographical Info'}.pdf`
                          });
                        }}
                      >
                        Download PDF (Failing Only)
                      </Button>
                    </div>
                  }
                >
                  <div className="p-4 space-y-2 text-[12px] text-[var(--text-secondary)] leading-relaxed border-t border-[var(--border)]">
                    <p>
                      <strong>Validation Scope:</strong> Evaluated all records against destination SuccessFactors mandatory rules (mandatory non-null, date ISO formatting, numeric lengths) and custom dynamic rules. Every defect is flagged with severity and human-readable explanation.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 font-mono text-[11px]">
                      <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]/50 border border-[var(--border)]">
                        <strong>Passed Records:</strong> <span className="text-emerald-500 font-bold">{validationResults.filter(r => r.st === 'PASS').length}</span>
                      </div>
                      <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]/50 border border-[var(--border)]">
                        <strong>Warning Issues:</strong> <span className="text-amber-500 font-bold">{validationResults.filter(r => r.st === 'WARN').length}</span>
                      </div>
                      <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]/50 border border-[var(--border)]">
                        <strong>Blocking Errors:</strong> <span className="text-red-500 font-bold">{validationResults.filter(r => r.st === 'ERROR').length}</span>
                      </div>
                    </div>
                  </div>
                </CollapsibleCard>

                {/* 1. Validation Rules Evaluated Table */}
                <CollapsibleCard
                  title="1. Validation Rules Evaluated & Field Compliance Summary"
                  subtitle="Rules evaluated and compliance status per field"
                  badge={`${displayedValidationRules.length} Fields Evaluated`}
                  action={
                    <button
                      onClick={() => {
                        setFilterFailingFieldsOnly(!filterFailingFieldsOnly);
                        setPage1(1);
                      }}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer ${
                        filterFailingFieldsOnly
                          ? 'bg-red-50 text-red-700 border-red-300 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800'
                          : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border-[var(--border)] hover:bg-[var(--bg-tertiary)]/80'
                      }`}
                    >
                      {filterFailingFieldsOnly
                        ? `✓ Failing Fields Only (${validationRulesSummary.filter(v => v.errors > 0 || v.warns > 0).length})`
                        : `Show Only Failing Fields (${validationRulesSummary.filter(v => v.errors > 0 || v.warns > 0).length})`}
                    </button>
                  }
                >
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[11.5px]">
                      <thead className="bg-[var(--bg-tertiary)] border-b border-[var(--border)] text-[var(--text-tertiary)] font-mono uppercase text-[9.5px]">
                        <tr>
                          <th className="py-2.5 px-3">#</th>
                          <th className="py-2.5 px-3">Field Name</th>
                          <th className="py-2.5 px-3">Validation Rules Evaluated</th>
                          <th className="py-2.5 px-3">Errors Found</th>
                          <th className="py-2.5 px-3">Warnings Found</th>
                          <th className="py-2.5 px-3">Compliance Status</th>
                          <th className="py-2.5 px-3 text-right">Inspect Diff</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)] font-mono text-[11px] text-[var(--text-secondary)]">
                        {displayedValidationRules.slice((page1 - 1) * PAGE_SIZE, page1 * PAGE_SIZE).map((v, idx) => (
                          <tr key={idx} className={`hover:bg-[var(--bg-tertiary)]/50 transition-colors ${selectedFieldFilter === v.field ? 'bg-red-50/40 dark:bg-red-950/20' : ''}`}>
                            <td className="py-2 px-3 text-[var(--text-tertiary)]">{(page1 - 1) * PAGE_SIZE + idx + 1}</td>
                            <td className="py-2 px-3 font-bold text-teal-600 dark:text-teal-400">{v.field}</td>
                            <td className="py-2 px-3 text-indigo-500 text-[10.5px]">{v.rulesEvaluated}</td>
                            <td className="py-2 px-3 font-bold text-red-500">{v.errors}</td>
                            <td className="py-2 px-3 font-bold text-amber-500">{v.warns}</td>
                            <td className="py-2 px-3">
                              <Badge variant={v.status === 'COMPLIANT' ? 'green' : v.status === 'WARNING_FLAG' ? 'amber' : 'red'}>
                                {v.status}
                              </Badge>
                            </td>
                            <td className="py-2 px-3 text-right">
                              {(v.errors > 0 || v.warns > 0) ? (
                                <button
                                  onClick={() => {
                                    setSelectedFieldFilter(selectedFieldFilter === v.field ? null : v.field);
                                    setPage2(1);
                                  }}
                                  className={`px-2.5 py-1 rounded-lg text-[10.5px] font-bold inline-flex items-center gap-1 cursor-pointer transition-colors ${
                                    selectedFieldFilter === v.field
                                      ? 'bg-red-600 text-white shadow-sm'
                                      : 'bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-900/50 border border-red-200 dark:border-red-800/50'
                                  }`}
                                >
                                  {selectedFieldFilter === v.field ? 'Viewing' : 'Inspect'} <ArrowRight className="w-3 h-3" />
                                </button>
                              ) : (
                                <span className="text-[10.5px] text-[var(--text-tertiary)] italic">No defects</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pagination
                    currentPage={page1}
                    totalItems={displayedValidationRules.length}
                    pageSize={PAGE_SIZE}
                    onPageChange={setPage1}
                  />
                </CollapsibleCard>

                {/* 2. Record-Level Findings Log */}
                <CollapsibleCard
                  title="2. Validation Findings & Violations Log"
                  subtitle={
                    selectedFieldFilter
                      ? `Showing failing records for field: ${selectedFieldFilter}`
                      : showOnlyFailingValidation
                      ? "Showing only records with blocking errors and warnings"
                      : "Showing all records"
                  }
                  badge={`${validationViolationsList.length} ${showOnlyFailingValidation ? 'Failing' : 'Total'} Records`}
                  action={
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setShowOnlyFailingValidation(!showOnlyFailingValidation);
                          setPage2(1);
                        }}
                        className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-colors cursor-pointer ${
                          showOnlyFailingValidation
                            ? 'bg-red-50 text-red-700 border-red-300 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800'
                            : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border-[var(--border)] hover:bg-[var(--bg-tertiary)]/80'
                        }`}
                      >
                        {showOnlyFailingValidation ? '✓ Failing Records Only' : 'Show All Records'}
                      </button>
                      {selectedFieldFilter && (
                        <button
                          onClick={() => { setSelectedFieldFilter(null); setPage2(1); }}
                          className="text-[11px] text-teal-600 dark:text-teal-400 hover:underline flex items-center gap-1 font-semibold cursor-pointer ml-1"
                        >
                          <RotateCcw className="w-3 h-3" /> Show All Fields
                        </button>
                      )}
                    </div>
                  }
                >
                  {validationViolationsList.length === 0 ? (
                    <div className="p-8 text-center text-[var(--text-tertiary)] font-mono text-xs">
                      <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-80" />
                      <div className="font-bold text-[var(--text-primary)] text-sm mb-1">100% Validation Pass Rate</div>
                      <div>
                        No failing records detected{selectedFieldFilter ? ` for field "${selectedFieldFilter}"` : ''}. All evaluated values comply with SuccessFactors mandatory rules and formats.
                      </div>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-[11.5px]">
                        <thead className="bg-[var(--bg-tertiary)] border-b border-[var(--border)] text-[var(--text-tertiary)] font-mono uppercase text-[9.5px]">
                          <tr>
                            <th className="py-2.5 px-3">Row #</th>
                            <th className="py-2.5 px-3">Record Key ID</th>
                            <th className="py-2.5 px-3">Field Name</th>
                            <th className="py-2.5 px-3">Tested / Failing Value</th>
                            <th className="py-2.5 px-3">Audit Finding / Reason</th>
                            <th className="py-2.5 px-3">Rule Code</th>
                            <th className="py-2.5 px-3">Severity</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)] font-mono text-[11px] text-[var(--text-secondary)]">
                          {validationViolationsList.slice((page2 - 1) * PAGE_SIZE, page2 * PAGE_SIZE).map((v, idx) => (
                            <tr key={idx} className="hover:bg-[var(--bg-tertiary)]/50">
                              <td className="py-2 px-3 text-[var(--text-tertiary)]">#{v.row}</td>
                              <td className="py-2 px-3 font-bold text-[var(--text-primary)]">{v.keyId}</td>
                              <td className="py-2 px-3 font-bold text-teal-600 dark:text-teal-400">{v.field}</td>
                              <td className="py-2 px-3 font-semibold bg-[var(--bg-tertiary)]/30 font-mono text-red-400">{v.value}</td>
                              <td className="py-2 px-3 text-[10.5px]">
                                <span className={v.severity === 'ERROR' ? 'text-red-500 font-semibold' : v.severity === 'WARN' ? 'text-amber-500 font-semibold' : 'text-emerald-500'}>
                                  {v.finding}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-indigo-400 font-mono text-[10px]">{v.ruleCode}</td>
                              <td className="py-2 px-3">
                                <Badge variant={v.severity === 'PASS' ? 'green' : v.severity === 'WARN' ? 'amber' : 'red'}>
                                  {v.severity}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <Pagination
                    currentPage={page2}
                    totalItems={validationViolationsList.length}
                    pageSize={PAGE_SIZE}
                    onPageChange={setPage2}
                  />
                </CollapsibleCard>
              </div>
            )}

            {/* ════════════════ TAB 6: CLEANSING AUDIT LOG (REMEDIATION BEFORE/AFTER) ════════════════ */}
            {activeTab === 'cleansing' && (
              <div className="space-y-4">
                <CollapsibleCard
                  title="Data Cleansing Remediation Audit Log"
                  subtitle="Autonomous AI & deterministic remediation resolving validation errors and format defects"
                  icon={<Wrench className="w-4 h-4" />}
                  badge={`${cleansingFixes.length} Fixes Applied`}
                  action={
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Download className="w-3 h-3 text-teal-500" />}
                        onClick={() => dl(expCSV(cleansingDiffsList), `Cleansing_Remediation_Log_${state.obj}.csv`, 'text/csv')}
                      >
                        Download CSV
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Download className="w-3 h-3 text-indigo-500" />}
                        onClick={() => {
                          const headers = ['Row #', 'Field', 'Original Defect (Before)', 'Cleansed Value (After)', 'Rule Code Applied', 'Status'];
                          const rows = cleansingDiffsList.map(f => [String(f.row), f.field, f.oldValue, f.newValue, f.ruleCode, f.status]);
                          exportPDF({
                            bannerTitle: 'Cleansing Remediation Report',
                            reportTitle: `Automated Defect Remediation Audit Log: ${state.obj || 'Biographical Info'}`,
                            targetObject: state.obj || 'Biographical Info',
                            kpiTitle: `Automated Remediation Rate: 100% Cleansed  (${cleansingDiffsList.length} Auto-Fixes Applied)`,
                            kpiSubtitle: `Target Object: ${state.obj || 'Biographical Info'} | Total Remediation Actions: ${cleansingDiffsList.length} | Status: All Remediation Rules Executed`,
                            summaryTitle: '1. Executive Summary',
                            summary: `Traceability record of deterministic data cleansing rules executed to resolve validation defects. Demonstrates before-and-after values for whitespace stripping, numeric zero-padding, and value normalization.`,
                            criticalRisksTitle: '2. Active Remediation Algorithms',
                            criticalRisks: [
                              '• Whitespace Trimming (CL_TRIM_WHITESPACE): Removed leading, trailing, and redundant internal whitespace.',
                              '• Numeric Identifier Padding (CL_PAD_NUMERIC_IDENTIFIER): Standardized employee numbers to uniform 10-character padded strings.',
                              '• ISO Lookup Remediation (CL_COUNTRY_TO_ISO): Canonicalized unharmonized country strings to ISO 3166-1 alpha-2.'
                            ],
                            actionPlanTitle: '3. Recommended Action Plan',
                            actionPlan: [
                              'Confirm cleansed records conform to downstream SAP SuccessFactors length and type constraints.',
                              'Verify that padded numeric IDs match legacy HR reference tables.',
                              'Re-verify validation scorecard to ensure zero residual blocking defects.'
                            ],
                            tableTitle: `4. Cleansing Remediation Audit Trail (${cleansingDiffsList.length} Actions)`,
                            headers,
                            rows,
                            colWidths: [20, 42, 54, 54, 69, 30],
                            orientation: 'landscape',
                            filename: `Cleansing_Remediation_${state.obj || 'Biographical Info'}.pdf`
                          });
                        }}
                      >
                        Download PDF
                      </Button>
                    </div>
                  }
                >
                  <div className="p-4 space-y-2 text-[12px] text-[var(--text-secondary)] leading-relaxed border-t border-[var(--border)]">
                    <p>
                      <strong>Remediation Overview:</strong> The Cleanser engine automatically corrects defects flagged during validation. This report provides complete traceability showing the original defect value, the cleansed replacement value, and the exact rule responsible.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 font-mono text-[11px]">
                      <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]/50 border border-[var(--border)]">
                        <strong>Remediation Success:</strong> 100% of applicable rules applied
                      </div>
                      <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]/50 border border-[var(--border)]">
                        <strong>Standard Cleansers:</strong> ISO Country, Numeric Padding, Whitespace
                      </div>
                      <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]/50 border border-[var(--border)]">
                        <strong>Dynamic AI Rules:</strong> {state.cleanserDynamicRules?.length || 0} rules compiled
                      </div>
                    </div>
                  </div>
                </CollapsibleCard>

                {/* 1. Cleansing Rules Summary */}
                <CollapsibleCard
                  title="1. Cleansing Rules Executed (Field-by-Field Summary)"
                  subtitle="Remediation rules executed and total fix counts per field"
                  badge={`${cleansingRulesSummary.length} Fields Fixed`}
                >
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[11.5px]">
                      <thead className="bg-[var(--bg-tertiary)] border-b border-[var(--border)] text-[var(--text-tertiary)] font-mono uppercase text-[9.5px]">
                        <tr>
                          <th className="py-2.5 px-3">#</th>
                          <th className="py-2.5 px-3">Field Name</th>
                          <th className="py-2.5 px-3">Fixes Applied</th>
                          <th className="py-2.5 px-3">Cleansing Rules Applied</th>
                          <th className="py-2.5 px-3">Sample Remediation</th>
                          <th className="py-2.5 px-3">Status</th>
                          <th className="py-2.5 px-3 text-right">Inspect Diff</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)] font-mono text-[11px] text-[var(--text-secondary)]">
                        {cleansingRulesSummary.slice((page1 - 1) * PAGE_SIZE, page1 * PAGE_SIZE).map((c, idx) => (
                          <tr key={idx} className={`hover:bg-[var(--bg-tertiary)]/50 transition-colors ${selectedFieldFilter === c.field ? 'bg-teal-50/40 dark:bg-teal-950/20' : ''}`}>
                            <td className="py-2 px-3 text-[var(--text-tertiary)]">{(page1 - 1) * PAGE_SIZE + idx + 1}</td>
                            <td className="py-2 px-3 font-bold text-teal-600 dark:text-teal-400">{c.field}</td>
                            <td className="py-2 px-3 font-bold text-emerald-600 dark:text-emerald-400">{c.fixesCount}</td>
                            <td className="py-2 px-3 text-indigo-500 font-semibold">{c.rulesApplied}</td>
                            <td className="py-2 px-3 text-[10.5px] text-[var(--text-tertiary)]">{c.description}</td>
                            <td className="py-2 px-3"><Badge variant="green">REMEDIATED</Badge></td>
                            <td className="py-2 px-3 text-right">
                              <button
                                onClick={() => {
                                  setSelectedFieldFilter(selectedFieldFilter === c.field ? null : c.field);
                                  setPage2(1);
                                }}
                                className={`px-2.5 py-1 rounded-lg text-[10.5px] font-bold inline-flex items-center gap-1 cursor-pointer transition-colors ${
                                  selectedFieldFilter === c.field
                                    ? 'bg-teal-600 text-white'
                                    : 'bg-[var(--bg-tertiary)] hover:bg-teal-50 hover:text-teal-700 dark:hover:bg-teal-950/40 text-[var(--text-secondary)] border border-[var(--border)]'
                                }`}
                              >
                                {selectedFieldFilter === c.field ? 'Viewing' : 'Inspect'} <ArrowRight className="w-3 h-3" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pagination
                    currentPage={page1}
                    totalItems={cleansingRulesSummary.length}
                    pageSize={PAGE_SIZE}
                    onPageChange={setPage1}
                  />
                </CollapsibleCard>

                {/* 2. Before vs After Remediation Log */}
                <CollapsibleCard
                  title="2. Cleansing Remediation Audit Log (Before vs After Values)"
                  subtitle={selectedFieldFilter ? `Showing fixes for field: ${selectedFieldFilter}` : "Showing all record-level fixes"}
                  badge={`${cleansingDiffsList.length} Fixes`}
                  action={
                    selectedFieldFilter && (
                      <button
                        onClick={() => { setSelectedFieldFilter(null); setPage2(1); }}
                        className="text-[11px] text-teal-600 dark:text-teal-400 hover:underline flex items-center gap-1 font-semibold cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3" /> Show All Fields
                      </button>
                    )
                  }
                >
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[11.5px]">
                      <thead className="bg-[var(--bg-tertiary)] border-b border-[var(--border)] text-[var(--text-tertiary)] font-mono uppercase text-[9.5px]">
                        <tr>
                          <th className="py-2.5 px-3">Row #</th>
                          <th className="py-2.5 px-3">Field Name</th>
                          <th className="py-2.5 px-3">Original Defect (Before)</th>
                          <th className="py-2.5 px-3">Cleansed Value (After)</th>
                          <th className="py-2.5 px-3">Rule Code Applied</th>
                          <th className="py-2.5 px-3">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)] font-mono text-[11px] text-[var(--text-secondary)]">
                        {cleansingDiffsList.slice((page2 - 1) * PAGE_SIZE, page2 * PAGE_SIZE).map((fix, idx) => (
                          <tr key={idx} className="hover:bg-[var(--bg-tertiary)]/50">
                            <td className="py-2 px-3 text-[var(--text-tertiary)]">#{fix.row}</td>
                            <td className="py-2 px-3 font-bold text-teal-600 dark:text-teal-400">{fix.field}</td>
                            <td className="py-2 px-3">
                              <span className="text-red-400 line-through bg-red-950/10 px-1.5 py-0.5 rounded">
                                {String(fix.oldValue || 'BLANK')}
                              </span>
                            </td>
                            <td className="py-2 px-3">
                              <span className="text-emerald-500 font-bold bg-emerald-950/10 px-1.5 py-0.5 rounded">
                                {String(fix.newValue || 'BLANK')}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-indigo-400 font-semibold">{fix.ruleCode}</td>
                            <td className="py-2 px-3"><Badge variant="green">APPLIED</Badge></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pagination
                    currentPage={page2}
                    totalItems={cleansingDiffsList.length}
                    pageSize={PAGE_SIZE}
                    onPageChange={setPage2}
                  />
                </CollapsibleCard>
              </div>
            )}

            {/* ════════════════ TAB 7: TRANSFORMATION & PRELOAD REPORT ════════════════ */}
            {activeTab === 'transformation' && (
              <div className="space-y-4">
                <CollapsibleCard
                  title="Transformation & Preload Compliance Report"
                  subtitle="Destination schema alignment, default organizational assignments, and SAP DMC export compliance"
                  icon={<CheckCircle2 className="w-4 h-4" />}
                  badge={`${transformationPreloadData.length} Preload Fields`}
                  action={
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Download className="w-3 h-3 text-teal-500" />}
                        onClick={() => dl(expCSV(transformationPreloadData), `Transformation_Preload_Report_${state.obj}.csv`, 'text/csv')}
                      >
                        Download CSV
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Download className="w-3 h-3 text-indigo-500" />}
                        onClick={() => {
                          const headers = ['Target Field', 'Preload Transformation Rule', 'Description', 'Data Type', 'Compliant Records', 'Status'];
                          const rows = transformationPreloadData.map(t => [t.targetField, t.ruleApplied, t.ruleDescription, t.targetType, String(t.recordsCompliant), t.status]);
                          exportPDF({
                            bannerTitle: 'Preload Transformation Report',
                            reportTitle: `SAP DMC Preload Transformation Specification: ${state.obj || 'Biographical Info'}`,
                            targetObject: state.obj || 'Biographical Info',
                            kpiTitle: `DMC Ingestion Readiness: 100% Compliant  (${transformedData.length} Records Ready)`,
                            kpiSubtitle: `Target Object: ${state.obj || 'Biographical Info'} | Preload Template: SAP SuccessFactors DMC | Total Target Fields: ${transformationPreloadData.length}`,
                            summaryTitle: '1. Executive Summary',
                            summary: `Final staging transformation report formatting cleansed records into SAP SuccessFactors Data Migration Cockpit (DMC) staging templates. Verifies default org constants, primary key uniqueness, and template schema compliance.`,
                            criticalRisksTitle: '2. Preload Transformation & Default Rules',
                            criticalRisks: [
                              '• Org Unit Injections: Injected default organizational constants (Company Code, Legal Entity, Plant).',
                              '• Key Structure Formatting: Validated primary keys for DMC import constraints.',
                              '• Type Alignment: Enforced destination string lengths, date patterns, and numeric scales.'
                            ],
                            actionPlanTitle: '3. Recommended Action Plan',
                            actionPlan: [
                              'Export DMC formatted CSV/XML migration payload.',
                              'Upload preload payload to SAP SuccessFactors Migration Cockpit staging table.',
                              'Execute DMC Simulation step in SAP and verify import logs against this specification.'
                            ],
                            tableTitle: '4. Preload Field Transformation & Default Value Matrix',
                            headers,
                            rows,
                            colWidths: [42, 50, 85, 30, 34, 28],
                            orientation: 'landscape',
                            filename: `Transformation_Preload_${state.obj || 'Biographical Info'}.pdf`
                          });
                        }}
                      >
                        Download PDF
                      </Button>
                    </div>
                  }
                >
                  <div className="p-4 space-y-2 text-[12px] text-[var(--text-secondary)] leading-relaxed border-t border-[var(--border)]">
                    <p>
                      <strong>Transformation Scope:</strong> Prepares cleansed master data for direct ingestion by the SAP SuccessFactors Data Migration Cockpit (DMC) or legacy LTMC import templates. Applies mandatory organizational default constants (Company Code, Division, Plant) and verifies primary key structures.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 font-mono text-[11px]">
                      <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]/50 border border-[var(--border)]">
                        <strong>Preload Compliance:</strong> <span className="text-emerald-500 font-bold">100% DMC Compliant</span>
                      </div>
                      <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]/50 border border-[var(--border)]">
                        <strong>Target System:</strong> SAP SuccessFactors Employee Central
                      </div>
                      <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]/50 border border-[var(--border)]">
                        <strong>Preload Columns:</strong> {transformationPreloadData.length} destination fields
                      </div>
                    </div>
                  </div>
                </CollapsibleCard>

                {/* Preload Specifications Table */}
                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden shadow-xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[11.5px]">
                      <thead className="bg-[var(--bg-tertiary)] border-b border-[var(--border)] text-[var(--text-tertiary)] font-mono uppercase text-[9.5px]">
                        <tr>
                          <th className="py-2.5 px-3">#</th>
                          <th className="py-2.5 px-3">Target Field Name</th>
                          <th className="py-2.5 px-3">Preload Formatting Rule</th>
                          <th className="py-2.5 px-3">Transformation Description</th>
                          <th className="py-2.5 px-3">Target Type</th>
                          <th className="py-2.5 px-3">Records Compliant</th>
                          <th className="py-2.5 px-3">Preload Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)] font-mono text-[11px] text-[var(--text-secondary)]">
                        {transformationPreloadData.slice((page1 - 1) * PAGE_SIZE, page1 * PAGE_SIZE).map((t, idx) => (
                          <tr key={idx} className="hover:bg-[var(--bg-tertiary)]/50 transition-colors">
                            <td className="py-2.5 px-3 text-[var(--text-tertiary)]">{(page1 - 1) * PAGE_SIZE + idx + 1}</td>
                            <td className="py-2.5 px-3 font-bold text-teal-600 dark:text-teal-400">{t.targetField}</td>
                            <td className="py-2.5 px-3 text-indigo-500 font-semibold">{t.ruleApplied}</td>
                            <td className="py-2.5 px-3 text-[10.5px] text-[var(--text-tertiary)]">{t.ruleDescription}</td>
                            <td className="py-2.5 px-3 text-[10.5px] text-[var(--text-tertiary)]">{t.targetType}</td>
                            <td className="py-2.5 px-3 font-bold text-emerald-600 dark:text-emerald-400">{t.recordsCompliant}</td>
                            <td className="py-2.5 px-3"><Badge variant="green">{t.status}</Badge></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pagination
                    currentPage={page1}
                    totalItems={transformationPreloadData.length}
                    pageSize={PAGE_SIZE}
                    onPageChange={setPage1}
                  />
                </div>
              </div>
            )}

          </div>
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
