import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button, Badge } from '@/components/shared';
import { useToast } from '@/components/ui/toast';
import {
  FileSpreadsheet,
  Download,
  Upload,
  CheckCircle2,
  AlertTriangle,
  X,
  ArrowRight,
  RotateCcw,
  Loader2,
  Database,
  Layers
} from 'lucide-react';

interface TargetObjectImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (objectName: string) => void;
}

interface ParsedField {
  table_name: string;
  field_name: string;
  label: string;
  type: string;
  is_mandatory: boolean;
  enabled?: string;
}

interface ValidationResponse {
  valid: boolean;
  detected_table_name: string;
  suggested_object_name: string;
  total_fields: number;
  mandatory_count: number;
  preview: ParsedField[];
  fields: ParsedField[];
  error?: string;
  missing_columns?: string[];
}

export function TargetObjectImportModal({
  isOpen,
  onClose,
  onSuccess,
}: TargetObjectImportModalProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<'upload' | 'preview'>('upload');
  const [isUploading, setIsUploading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [missingColumns, setMissingColumns] = useState<string[]>([]);

  const [parsedData, setParsedData] = useState<ValidationResponse | null>(null);
  const [targetObjectName, setTargetObjectName] = useState('');
  const [targetObjectDescription, setTargetObjectDescription] = useState('');

  const resetState = () => {
    setStep('upload');
    setIsUploading(false);
    setIsImporting(false);
    setValidationError(null);
    setMissingColumns([]);
    setParsedData(null);
    setTargetObjectName('');
    setTargetObjectDescription('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  // 1. Download official sample template
  const handleDownloadTemplate = () => {
    try {
      const downloadUrl = `${import.meta.env.VITE_BACKEND_URL}/api/sap/target-objects/template`;
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.setAttribute('download', 'SuccessFactors_Target_Object_Template.xlsx');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast('Standard template downloaded successfully', 'ok');
    } catch (err: any) {
      toast('Failed to initiate template download', 'err');
    }
  };

  // 2. Validate uploaded sheet
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.toLowerCase();
    if (!ext.endsWith('.xlsx') && !ext.endsWith('.xls')) {
      setValidationError('Please upload an Excel spreadsheet file (.xlsx or .xls).');
      return;
    }

    setIsUploading(true);
    setValidationError(null);
    setMissingColumns([]);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/target-objects/validate-sheet`, {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok || !data.valid) {
        setValidationError(data.error || 'The uploaded file is not in standard format.');
        setMissingColumns(data.missing_columns || []);
        setIsUploading(false);
        return;
      }

      // Valid template format
      setParsedData(data);
      const suggested = data.suggested_object_name || data.detected_table_name || 'Target Object';
      setTargetObjectName(suggested);
      setTargetObjectDescription('');
      setStep('preview');
      toast(`Successfully validated ${data.total_fields} target fields!`, 'ok');
    } catch (err: any) {
      setValidationError('Failed to validate the spreadsheet. Please verify backend connectivity.');
    } finally {
      setIsUploading(false);
    }
  };

  // 3. Confirm import and persist into sf_objects & sf_fields
  const handleConfirmImport = async () => {
    if (!targetObjectName.trim()) {
      toast('Please enter a Target Object Name.', 'err');
      return;
    }
    if (!parsedData || !parsedData.fields || parsedData.fields.length === 0) {
      toast('No field records available to import.', 'err');
      return;
    }

    setIsImporting(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/target-objects/confirm-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          object_name: targetObjectName.trim(),
          description: targetObjectDescription.trim(),
          fields: parsedData.fields,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to import target object.');
      }

      toast(data.message || `Imported ${data.fields_imported} fields for '${targetObjectName}'!`, 'ok');
      onSuccess(targetObjectName.trim());
      handleClose();
    } catch (err: any) {
      toast(err.message || 'Failed to confirm target object import.', 'err');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/50 backdrop-blur-xs"
            onClick={handleClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: 'spring', duration: 0.35, bounce: 0.1 }}
            className="relative w-full max-w-2xl overflow-hidden rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border)] shadow-2xl z-10 flex flex-col max-h-[90vh]"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[var(--bg-tertiary)]/40">
              <div className="flex items-center gap-3">
                <div className="size-9 rounded-xl bg-teal-500/10 border border-teal-500/20 text-teal-600 dark:text-teal-400 flex items-center justify-center shrink-0">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[var(--text-primary)]">
                    Upload Target Object & Fields
                  </h3>
                  <p className="text-[11.5px] text-[var(--text-tertiary)]">
                    Import custom SuccessFactors objects & fields dynamically using standard Excel format
                  </p>
                </div>
              </div>
              <button
                onClick={handleClose}
                className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5 flex-1">
              {/* Template Download Notification Card */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 rounded-xl border border-teal-500/20 bg-teal-500/5 text-xs text-[var(--text-secondary)]">
                <div className="space-y-0.5">
                  <div className="font-semibold text-teal-600 dark:text-teal-400 flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5" />
                    Standard Format Required
                  </div>
                  <div className="text-[11px] text-[var(--text-tertiary)]">
                    Workbook must contain columns: <strong className="font-mono text-[var(--text-secondary)]">Table Name, Field Name, LABEL, TYPE, SAP REQUIRED, Enabled</strong>
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Download className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />}
                  onClick={handleDownloadTemplate}
                  className="shrink-0"
                >
                  Download Template (.xlsx)
                </Button>
              </div>

              {/* STEP 1: UPLOAD VIEW */}
              {step === 'upload' && (
                <div className="space-y-4">
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-3 ${
                      isUploading
                        ? 'border-teal-500 bg-teal-500/5 cursor-wait'
                        : 'border-[var(--border)] hover:border-teal-500/60 hover:bg-[var(--bg-tertiary)]/40'
                    }`}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      onChange={handleFileChange}
                      disabled={isUploading}
                    />

                    <div className="size-12 rounded-2xl bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center">
                      {isUploading ? (
                        <Loader2 className="w-6 h-6 animate-spin" />
                      ) : (
                        <Upload className="w-6 h-6" />
                      )}
                    </div>

                    <div className="space-y-1">
                      <p className="text-xs font-bold text-[var(--text-primary)]">
                        {isUploading ? 'Validating spreadsheet format...' : 'Click to browse or drag & drop target specification sheet'}
                      </p>
                      <p className="text-[11px] text-[var(--text-tertiary)] font-mono">
                        Supports Excel (.xlsx, .xls) files
                      </p>
                    </div>
                  </div>

                  {/* Format Validation Error Banner */}
                  {validationError && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 text-xs space-y-2.5"
                    >
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        <div>
                          <div className="font-bold">Not in Standard Format</div>
                          <div className="text-[11.5px] mt-0.5 leading-relaxed text-red-600/90 dark:text-red-400/90">
                            {validationError}
                          </div>
                        </div>
                      </div>

                      {missingColumns.length > 0 && (
                        <div className="text-[11px] font-mono bg-red-500/10 p-2 rounded-lg border border-red-500/20">
                          Missing headers: <strong>{missingColumns.join(', ')}</strong>
                        </div>
                      )}

                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[11px] text-[var(--text-tertiary)]">
                          Please format your spreadsheet using the standard template:
                        </span>
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={<Download className="w-3.5 h-3.5 text-teal-600" />}
                          onClick={handleDownloadTemplate}
                        >
                          Download Sample Template
                        </Button>
                      </div>
                    </motion.div>
                  )}
                </div>
              )}

              {/* STEP 2: OBJECT NAME INPUT & PREVIEW */}
              {step === 'preview' && parsedData && (
                <div className="space-y-4">
                  {/* Summary Bar */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 font-mono text-[11px]">
                    <div className="p-3 rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)]/50 space-y-0.5">
                      <span className="text-[10px] text-[var(--text-tertiary)] uppercase font-bold">Detected Table</span>
                      <div className="text-sm font-bold text-teal-600 dark:text-teal-400">
                        {parsedData.detected_table_name}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)]/50 space-y-0.5">
                      <span className="text-[10px] text-[var(--text-tertiary)] uppercase font-bold">Total Fields</span>
                      <div className="text-sm font-bold text-[var(--text-primary)]">
                        {parsedData.total_fields} fields
                      </div>
                    </div>
                    <div className="p-3 rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)]/50 space-y-0.5">
                      <span className="text-[10px] text-[var(--text-tertiary)] uppercase font-bold">Mandatory Fields</span>
                      <div className="text-sm font-bold text-amber-500">
                        {parsedData.mandatory_count} required
                      </div>
                    </div>
                  </div>

                  {/* Object Name Input Form */}
                  <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)]/30 space-y-3">
                    <div>
                      <label className="block text-[11px] font-mono font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                        Target Object Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={targetObjectName}
                        onChange={(e) => setTargetObjectName(e.target.value)}
                        placeholder="e.g. Job Information (EmpJob)"
                        className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] text-[13px] font-semibold text-[var(--text-primary)] focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                      />
                      <p className="text-[10.5px] text-[var(--text-tertiary)] mt-1">
                        This name will appear in the Target Object dropdown across all migration steps.
                      </p>
                    </div>

                    <div>
                      <label className="block text-[11px] font-mono font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                        Description (Optional)
                      </label>
                      <input
                        type="text"
                        value={targetObjectDescription}
                        onChange={(e) => setTargetObjectDescription(e.target.value)}
                        placeholder="e.g. Employee Central Biographical Info"
                        className="w-full px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] text-xs text-[var(--text-secondary)] focus:outline-none focus:border-teal-500"
                      />
                    </div>
                  </div>

                  {/* Preview Table */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-[var(--text-tertiary)] font-mono">
                      <span>Field Definitions Preview (Showing first {parsedData.preview.length} of {parsedData.total_fields})</span>
                      <span className="text-emerald-500 font-bold">✓ Standard Format Verified</span>
                    </div>
                    <div className="rounded-xl border border-[var(--border)] overflow-hidden max-h-56 overflow-y-auto">
                      <table className="w-full text-left text-[11px] font-mono">
                        <thead className="bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] uppercase text-[9.5px] sticky top-0 border-b border-[var(--border)]">
                          <tr>
                            <th className="py-2 px-3">Table</th>
                            <th className="py-2 px-3">Field Name</th>
                            <th className="py-2 px-3">Label</th>
                            <th className="py-2 px-3">Type</th>
                            <th className="py-2 px-3">Mandatory</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)] text-[var(--text-secondary)]">
                          {parsedData.preview.map((f, i) => (
                            <tr key={i} className="hover:bg-[var(--bg-tertiary)]/40">
                              <td className="py-1.5 px-3 text-[var(--text-tertiary)]">{f.table_name}</td>
                              <td className="py-1.5 px-3 font-bold text-teal-600 dark:text-teal-400">{f.field_name}</td>
                              <td className="py-1.5 px-3 text-[var(--text-primary)] truncate max-w-[160px]">{f.label}</td>
                              <td className="py-1.5 px-3 text-[10px] text-indigo-400">{f.type}</td>
                              <td className="py-1.5 px-3">
                                <Badge variant={f.is_mandatory ? 'red' : 'neutral'}>
                                  {f.is_mandatory ? 'REQUIRED' : 'OPTIONAL'}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--border)] bg-[var(--bg-tertiary)]/40">
              {step === 'preview' ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<RotateCcw className="w-3.5 h-3.5" />}
                    onClick={() => {
                      setStep('upload');
                      setValidationError(null);
                    }}
                    disabled={isImporting}
                  >
                    Back to Upload
                  </Button>
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={handleClose} disabled={isImporting}>
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      icon={isImporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                      onClick={handleConfirmImport}
                      disabled={isImporting || !targetObjectName.trim()}
                    >
                      {isImporting ? 'Importing Fields...' : 'Confirm & Import to Target Objects'}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="w-full flex justify-end">
                  <Button variant="secondary" size="sm" onClick={handleClose} disabled={isUploading}>
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
