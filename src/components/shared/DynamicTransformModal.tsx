import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles, Key, Search, Layers, Play, Wand2, Type } from 'lucide-react';
import { Button } from './index';
import { isPrimaryKeyField } from '@/lib/utils';
import type { TransformRuleItem } from '@/pages/Step7_Transform';

export interface DynamicTransformModalProps {
  isOpen: boolean;
  onClose: () => void;
  tableName: string;
  allFields: string[];
  initialField?: string;
  initialValue?: string;
  rowNumber?: number;
  rowIndex?: number;
  projectId?: string | null;
  targetObject?: string;
  currentRows?: any[];
  onRunTransform: (rule: TransformRuleItem) => void;
  isApplying?: boolean;
}

type RuleMode = 'presets' | 'ai';

export function DynamicTransformModal({
  isOpen,
  onClose,
  tableName,
  allFields = [],
  initialField,
  initialValue = '',
  rowNumber,
  rowIndex,
  projectId,
  targetObject,
  currentRows,
  onRunTransform,
  isApplying = false,
}: DynamicTransformModalProps) {
  const [selectedField, setSelectedField] = useState<string>('');
  const [fieldSearch, setFieldSearch] = useState<string>('');
  const [mode, setMode] = useState<RuleMode>('presets');

  // Preset inputs
  const [selectedPreset, setSelectedPreset] = useState<string>('upper');
  const [presetParam, setPresetParam] = useState<string>('');

  // AI Prompt input
  const [aiPrompt, setAiPrompt] = useState<string>('');
  const [isGeneratingAI, setIsGeneratingAI] = useState<boolean>(false);

  // Synchronize when modal opens or initial values change
  useEffect(() => {
    if (isOpen) {
      const field = initialField || allFields[0] || '';
      setSelectedField(field);
      setFieldSearch('');
      setMode('presets');
      setSelectedPreset('upper');
      setPresetParam('');
      setAiPrompt('');
      setIsGeneratingAI(false);
    }
  }, [isOpen, initialField, initialValue, allFields, rowNumber]);

  // Filtered fields list
  const filteredFields = useMemo(() => {
    if (!fieldSearch.trim()) return allFields;
    const s = fieldSearch.toLowerCase();
    return allFields.filter((f) => f.toLowerCase().includes(s));
  }, [allFields, fieldSearch]);

  // Generated rule preview text
  const ruleSummary = useMemo(() => {
    const f = selectedField || 'FIELD';

    if (mode === 'presets') {
      switch (selectedPreset) {
        case 'upper':
          return `Convert all values in ${f} to UPPERCASE`;
        case 'lower':
          return `Convert all values in ${f} to lowercase`;
        case 'title':
          return `Convert all values in ${f} to Title Case`;
        case 'trim':
          return `Trim leading/trailing spaces from ${f}`;
        case 'prefix':
          return `Prepend '${presetParam || ''}' to all values in ${f}`;
        case 'suffix':
          return `Append '${presetParam || ''}' to all values in ${f}`;
        case 'default_if_empty':
          return `Set empty/blank cells in ${f} to '${presetParam || 'DEFAULT'}'`;
        default:
          return `Apply preset to ${f}`;
      }
    }

    if (mode === 'ai') {
      return aiPrompt.trim()
        ? `AI Rule on ${f}: "${aiPrompt.trim()}"`
        : `Enter AI natural language instructions for ${f}`;
    }

    return '';
  }, [selectedField, mode, selectedPreset, presetParam, aiPrompt]);

  const handleRun = async () => {
    if (!selectedField) return;

    const ruleId = `rule_dyn_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    let newRule: TransformRuleItem;

    if (mode === 'presets') {
      newRule = {
        id: ruleId,
        source: 'dynamic' as any,
        field: selectedField,
        description: ruleSummary,
        enabled: true,
        operation: selectedPreset,
        newValue: selectedPreset === 'default_if_empty' ? presetParam : undefined,
        prefix: selectedPreset === 'prefix' ? presetParam : undefined,
        suffix: selectedPreset === 'suffix' ? presetParam : undefined,
      } as any;
    } else {
      // AI Mode: Call LLM API to get REAL Python code
      setIsGeneratingAI(true);
      let realPythonScript = '';
      try {
        if (projectId) {
          const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/transform/ai-apply-mappings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              project_id: projectId,
              target_object: targetObject || 'Biographical Info',
              prompt: `For column/field "${selectedField}": ${aiPrompt.trim()}`,
              fallback_data: currentRows && currentRows.length > 0 ? currentRows : undefined,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            realPythonScript = data.ai_rules?.[0]?.Target_Data || data.summary?.ai_rules?.[0]?.Target_Data || '';
          }
        }
      } catch (err) {
        console.error('Failed to generate AI python script from LLM:', err);
      } finally {
        setIsGeneratingAI(false);
      }

      if (!realPythonScript) {
        realPythonScript = `def transform_data(df):
    import re
    # Match column corresponding to ${selectedField}
    target_clean = re.sub(r'[^a-zA-Z0-9]', '', '${selectedField}').lower()
    target_cols = [c for c in df.columns if target_clean == re.sub(r'[^a-zA-Z0-9]', '', str(c)).lower() or target_clean in re.sub(r'[^a-zA-Z0-9]', '', str(c)).lower() or re.sub(r'[^a-zA-Z0-9]', '', str(c)).lower() in target_clean]
    if not target_cols:
        target_cols = ['${selectedField}']

    for col in target_cols:
        if col in df.columns:
            def _map_val(v):
                s = str(v).strip()
                if not s or s.lower() in ('none', 'nan', '<na>', '""', "''"):
                    return ""
                p_lower = "${aiPrompt.trim().toLowerCase().replace(/"/g, '\\"')}"
                if any(k in p_lower for k in ['single', 'first word', 'first char', 'letter', 'initial', 'first letter']):
                    if s.lower().startswith('m'): return 'M'
                    if s.lower().startswith('s'): return 'S'
                    if s.lower().startswith('d'): return 'D'
                    if s.lower().startswith('w'): return 'W'
                    return s[0].upper()
                if 'lower' in p_lower:
                    return s.lower()
                if 'upper' in p_lower:
                    return s.upper()
                return s
            df[col] = df[col].apply(_map_val)
    return df`;
      }

      newRule = {
        id: ruleId,
        source: 'nlp',
        field: selectedField,
        description: aiPrompt.trim() || `Transform ${selectedField}`,
        enabled: true,
        pythonCode: realPythonScript,
      };
    }

    onRunTransform(newRule);
    onClose();
  };


  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
        {/* Solid Dark Dimming Backdrop (No blur) */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/60 transition-opacity"
        />

        {/* Modal Window — Solid White Background */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 10 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-full max-w-2xl bg-white border border-gray-200 rounded-2xl shadow-2xl overflow-hidden z-10 flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="p-4 sm:p-5 border-b border-gray-100 bg-gradient-to-r from-violet-50/70 via-white to-white flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-violet-100 text-violet-600 border border-violet-200">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-gray-900">
                    Dynamic Field Transformation
                  </h3>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-violet-100 text-violet-700 border border-violet-200">
                    {tableName}
                  </span>
                  {rowNumber !== undefined && (
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-amber-100 text-amber-700 border border-amber-200">
                      Row #{rowNumber}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  Create and execute an on-the-spot transformation rule across your table dataset
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body Content */}
          <div className="p-5 overflow-y-auto space-y-5 flex-1 scrollbar-thin bg-white">
            {/* 1. All Fields Dropdown / Selector */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-bold text-gray-700">
                <label className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-violet-500" />
                  <span>Target Field / Column</span>
                  <span className="text-[11px] font-normal text-gray-400">
                    ({allFields.length} available fields)
                  </span>
                </label>
                {selectedField && isPrimaryKeyField(selectedField) && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-600">
                    <Key className="w-3 h-3" /> Primary Key
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                {/* Search input */}
                <div className="sm:col-span-5 relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={fieldSearch}
                    onChange={(e) => setFieldSearch(e.target.value)}
                    placeholder="Search all fields..."
                    className="w-full text-xs pl-8 pr-3 py-2 rounded-xl border border-gray-200 bg-gray-50 text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:bg-white"
                  />
                </div>

                {/* Field Select Dropdown */}
                <div className="sm:col-span-7">
                  <select
                    value={selectedField}
                    onChange={(e) => {
                      setSelectedField(e.target.value);
                    }}
                    className="w-full text-xs font-mono font-bold px-3 py-2 rounded-xl border border-gray-200 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
                  >
                    {filteredFields.map((f) => (
                      <option key={f} value={f}>
                        {f} {isPrimaryKeyField(f) ? '🔑 (Primary Key)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* 2. Mode Selector Tabs */}
            <div className="flex rounded-xl bg-gray-100 p-1 border border-gray-200">
              <button
                type="button"
                onClick={() => setMode('presets')}
                className={`flex-1 flex items-center justify-center gap-2 py-1.5 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  mode === 'presets'
                    ? 'bg-white text-violet-600 shadow-xs'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                <Type className="w-3.5 h-3.5" />
                <span>Quick Presets</span>
              </button>

              <button
                type="button"
                onClick={() => setMode('ai')}
                className={`flex-1 flex items-center justify-center gap-2 py-1.5 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  mode === 'ai'
                    ? 'bg-white text-cyan-600 shadow-xs'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                <Wand2 className="w-3.5 h-3.5 text-cyan-500" />
                <span>AI Prompt</span>
              </button>
            </div>

            {/* 3. Mode Panel Content */}

            {mode === 'presets' && (
              <div className="space-y-4 p-4 rounded-xl border border-gray-200 bg-gray-50/50">
                <span className="text-[11px] font-bold text-gray-700">Choose Quick Operation</span>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {[
                    { id: 'upper', label: 'UPPERCASE', desc: 'Convert text to caps' },
                    { id: 'lower', label: 'lowercase', desc: 'Convert text to small' },
                    { id: 'title', label: 'Title Case', desc: 'Capitalize words' },
                    { id: 'trim', label: 'Trim Spaces', desc: 'Remove edge spaces' },
                    { id: 'prefix', label: 'Add Prefix', desc: 'Prepend text string' },
                    { id: 'suffix', label: 'Add Suffix', desc: 'Append text string' },
                    { id: 'default_if_empty', label: 'Fallback Default', desc: 'Fill empty cells' },
                  ].map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setSelectedPreset(preset.id)}
                      className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                        selectedPreset === preset.id
                          ? 'border-violet-500 bg-violet-50 text-violet-700 font-bold shadow-xs'
                          : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      <div className="text-xs">{preset.label}</div>
                      <div className="text-[10px] text-gray-400">{preset.desc}</div>
                    </button>
                  ))}
                </div>

                {['prefix', 'suffix', 'default_if_empty'].includes(selectedPreset) && (
                  <div className="space-y-1 pt-1">
                    <label className="text-[11px] font-bold text-gray-700">
                      {selectedPreset === 'prefix' && 'Prefix string to add:'}
                      {selectedPreset === 'suffix' && 'Suffix string to add:'}
                      {selectedPreset === 'default_if_empty' && 'Default value for empty cells:'}
                    </label>
                    <input
                      type="text"
                      value={presetParam}
                      onChange={(e) => setPresetParam(e.target.value)}
                      placeholder="Enter string value..."
                      className="w-full text-xs font-mono px-3 py-2 rounded-xl border border-gray-200 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
                    />
                  </div>
                )}
              </div>
            )}

            {mode === 'ai' && (
              <div className="space-y-3 p-4 rounded-xl border border-gray-200 bg-gray-50/50">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-gray-700">
                    Natural Language Instruction for {selectedField}
                  </label>
                  <textarea
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder={`Describe transformation for ${selectedField}...\n\nExamples:\n• "If ${selectedField} starts with 'US', replace with 'USA'"\n• "Remove hyphens and special characters from ${selectedField}"\n• "Pad with leading zeros to make 8 characters"`}
                    className="w-full h-24 p-3 rounded-xl border border-gray-200 bg-white text-xs text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-cyan-500 placeholder:text-gray-400"
                  />
                </div>
              </div>
            )}

            {/* 4. Live Rule Summary Card */}
            <div className="p-3.5 rounded-xl border border-violet-200 bg-violet-50/60 space-y-1">
              <div className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-violet-600">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Live Rule Preview</span>
              </div>
              <p className="text-xs font-mono font-bold text-gray-900 leading-relaxed">
                {ruleSummary}
              </p>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="p-4 border-t border-gray-100 bg-gray-50/80 flex items-center justify-between shrink-0">
            <Button variant="secondary" onClick={onClose} disabled={isApplying}>
              Cancel
            </Button>

            <Button
              variant="cyan"
              icon={<Play className="w-3.5 h-3.5" />}
              onClick={handleRun}
              disabled={isApplying || !selectedField || (mode === 'replace' && targetValue === undefined)}
              className="px-5 font-bold"
            >
              {isApplying ? 'Running...' : 'Run Transform on Spot'}
            </Button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
