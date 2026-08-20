import React, { useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMigration } from '@/store/migration-store';
import { useToast } from '@/components/ui/toast';
import { useLoading } from '@/components/ui/loading-overlay';
import { OBJS } from '@/data/sap-schemas';
import { dl } from '@/lib/utils';
import { PageLayout, PageGrid, GridCol, Card, CardHeader, CardBody, Button, Badge, StatBox, StatsGrid, EmptyState } from '@/components/shared';
import { ArrowLeft, ArrowRight, Search, Download, Upload, ListChecks, Save, Sparkles, Plus, Trash2, Zap, FileText, Pencil, Check, X, ChevronDown, ChevronUp } from 'lucide-react';

const VALIDATE_API = import.meta.env.VITE_BACKEND_URL;

interface RuleFailure {
  idx: number;
  field: string;
  value: string;
  message: string;
  severity: string;
}

interface RuleReport {
  rule: string;
  label: string;
  description: string;
  is_dynamic?: boolean;
  totalChecked: number;
  failCount: number;
  passCount: number;
  failures: RuleFailure[];
}

type Source = 'harmonized' | 'upload';

export function Step5Validate() {
  const { state, dispatch } = useMigration();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { showLoad, tick, hideLoad } = useLoading();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [source, setSource] = useState<Source>('harmonized');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const report = (state.validationReport || []) as RuleReport[];
  const [uploadMeta, setUploadMeta] = useState<{ rows: number; cols: number } | null>(null);
  const [openActiveRulesAccordion, setOpenActiveRulesAccordion] = useState(false);
  const [openResultsAccordion, setOpenResultsAccordion] = useState(false);

  // Dynamic Rules State
  const [customPrompts, setCustomPrompts] = useState<string[]>(state.customPrompts || []);
  const [editedStandardRulePrompts, setEditedStandardRulePrompts] = useState<Record<string, string>>({}); // standardRuleId -> prompt text
  const [newPromptInput, setNewPromptInput] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState('');
  // Standard rule selection + overrides
  const STANDARD_RULES = [
    { id: 'REQUIRED_FIELDS', label: 'Required Fields', description: 'Must not be empty' },
    { id: 'FIELD_LENGTH', label: 'Field Length', description: 'Max char enforcement' },
    { id: 'COUNTRY_ISO', label: 'Country ISO', description: '2-3 letter format' },
    { id: 'CURRENCY_ISO', label: 'Currency ISO', description: '3-letter ISO 4217' },
    { id: 'NUMERIC_ID', label: 'Numeric IDs', description: 'KUNNR/LIFNR digits' },
    { id: 'EMAIL_FORMAT', label: 'Email Format', description: 'Valid @ format' },
    { id: 'DATE_FORMAT', label: 'Date Format', description: 'YYYYMMDD 8 digits' }
  ];

  const [selectedRules, setSelectedRules] = useState<Record<string, boolean>>(
    Object.fromEntries(STANDARD_RULES.map((r) => [r.id, true]))
  );
  const [standardEditingId, setStandardEditingId] = useState<string | null>(null);
  const [standardEditLabel, setStandardEditLabel] = useState('');
  const [standardEditDesc, setStandardEditDesc] = useState('');
  const [savedDynamicRules, setSavedDynamicRules] = useState<any[]>(state.dynamicRules || []);
  const [selectedDynamicRules, setSelectedDynamicRules] = useState<Record<string, boolean>>(
    Object.fromEntries((state.dynamicRules || []).map((r) => [r.id, true]))
  );
  // Track which standard rule is overridden by which dynamic rule (standardRuleId -> dynamicRuleId)
  const [standardRuleOverrides, setStandardRuleOverrides] = useState<Record<string, string>>({});
  const [appliedStandardRules, setAppliedStandardRules] = useState<string[] | null>(null);
  const [selectedRulesReceived, setSelectedRulesReceived] = useState<string[] | null>(null);

  // Load saved validation report and dynamic rules from Supabase on mount
  useEffect(() => {
    if (!state.projectId) {
      setSavedDynamicRules([]);
      setSelectedDynamicRules({});
      dispatch({ type: 'SET_FIELD', field: 'dynamicRules', value: [] });
      return;
    }

    const loadSaved = async () => {
      try {
        const objName = state.obj || 'Biographical Info';
        const res = await fetch(`${VALIDATE_API}/api/validate/load/${state.projectId}?target_object=${encodeURIComponent(objName)}`);
        if (res.ok) {
          const data = await res.json();
          const loadedRules = Array.isArray(data.dynamic_rules) ? data.dynamic_rules : [];
          
          setSavedDynamicRules(loadedRules);
          dispatch({ type: 'SET_FIELD', field: 'dynamicRules', value: loadedRules });
          setSelectedDynamicRules(
            Object.fromEntries(loadedRules.map((r: any) => [r.id, r.enabled !== false]))
          );

          if (data.status === 'success') {
            if (data.report && Array.isArray(data.report) && data.report.length > 0) {
              if (!state.validationReport || state.validationReport.length === 0) {
                dispatch({ type: 'SET_FIELD', field: 'validationReport', value: data.report });
                dispatch({ type: 'SET_FIELD', field: 'isValidatedSaved', value: true });
              }
            }
          }
        }
      } catch (err) {
        console.error('Failed to load saved validation from Supabase:', err);
      }
    };

    loadSaved();
  }, [state.projectId, state.obj, dispatch]);

  const handleAddPrompt = () => {
    if (!newPromptInput.trim()) return;
    const updated = [...customPrompts, newPromptInput.trim()];
    setCustomPrompts(updated);
    dispatch({ type: 'SET_FIELD', field: 'customPrompts', value: updated });
    setNewPromptInput('');
  };

  const handleRemovePrompt = (index: number) => {
    const updated = customPrompts.filter((_, i) => i !== index);
    setCustomPrompts(updated);
    dispatch({ type: 'SET_FIELD', field: 'customPrompts', value: updated });
    if (editingIndex === index) {
      setEditingIndex(null);
      setEditingText('');
    }
  };

  const handleStartEdit = (index: number) => {
    setEditingIndex(index);
    setEditingText(customPrompts[index]);
  };

  const handleSaveEdit = (index: number) => {
    if (!editingText.trim()) return;
    const updated = [...customPrompts];
    updated[index] = editingText.trim();
    setCustomPrompts(updated);
    dispatch({ type: 'SET_FIELD', field: 'customPrompts', value: updated });
    setEditingIndex(null);
    setEditingText('');
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
    setEditingText('');
  };

  const isRuleOverridden = (ruleTitle: string): boolean => {
    const overriddenList = ((state.stats as any)?.overridden_rules || []) as string[];
    const titleLower = ruleTitle.toLowerCase();
    if (titleLower.includes('country') && overriddenList.includes('COUNTRY_ISO')) return true;
    if (titleLower.includes('currency') && overriddenList.includes('CURRENCY_ISO')) return true;
    if (titleLower.includes('email') && overriddenList.includes('EMAIL_FORMAT')) return true;
    if (titleLower.includes('numeric') && overriddenList.includes('NUMERIC_ID')) return true;
    if (titleLower.includes('payment') && overriddenList.includes('PAYMENT_TERMS')) return true;
    return false;
  };

  const getPrimaryKeyValue = (row: Record<string, any> = {}, obj: string = state.obj) => {
    const targetObj = OBJS[obj];
    const sfKey = targetObj?.fields.find(f => f.key)?.n;
    const key = sfKey || 'person-id-external';
    const value = row?.[key] ?? row?.[key.toLowerCase()] ?? row?.[key.toUpperCase()] ?? row?.['user-id'] ?? row?.['person-id-external'] ?? row?.['KUNNR'] ?? row?.['ID'];
    return value !== undefined && value !== null && String(value).trim() ? String(value).trim() : '';
  };

  const has = state.validated.length > 0;
  const eR = state.validated.filter((v) => v.st === 'ERROR').length;
  const wR = state.validated.filter((v) => v.st === 'WARN').length;
  const pR = state.validated.filter((v) => v.st === 'PASS').length;

  const toggleSelectRule = (id: string) => setSelectedRules((s) => ({ ...s, [id]: !s[id] }));

  async function runValidation() {
    if (source === 'upload' && !uploadedFile) {
      toast('Choose a CSV file first', 'err');
      return;
    }
    if (source === 'harmonized' && !state.projectId) {
      toast('Project not found. Please start from Step 1.', 'err');
      return;
    }
    
    dispatch({ type: 'SET_FIELD', field: 'isValidatedSaved', value: false });

    showLoad('Validating…', `Checking SAP field rules${customPrompts.length > 0 ? ` + ${customPrompts.length} custom AI rules` : ''}`, [
      'Compiling custom AI rules via LLM (1 call)…',
      'Loading validation rules…',
      'Sending data to validation service…',
      `Applying standard & ${customPrompts.length} custom rules…`,
      'Grouping failures by rule…',
      'Generating unified report…',
    ]);
    [0, 1, 2, 3, 4, 5].forEach((i) => setTimeout(() => tick(i), 250 + i * 220));

    try {
      let data: any;
      
      // Combine custom prompts + edited standard rule prompts for LLM compilation
      const allPrompts = [
        ...customPrompts,
        ...Object.values(editedStandardRulePrompts)
      ];

      if (source === 'upload' && uploadedFile) {
        const fd = new FormData();
        fd.append('obj', state.obj);
        fd.append('file', uploadedFile);
        if (allPrompts.length > 0) {
          fd.append('custom_prompts_json', JSON.stringify(allPrompts));
        }
        // include only selected saved dynamic override rules
        const selectedDynRules = savedDynamicRules.filter((r) => selectedDynamicRules[r.id] !== false);
        if (selectedDynRules && selectedDynRules.length) {
          fd.append('dynamic_rules_json', JSON.stringify(selectedDynRules));
        }
        // include selected standard rules EXCLUDING overridden ones
        const selectedList = Object.keys(selectedRules)
          .filter((k) => selectedRules[k] && !standardRuleOverrides[k]);
        fd.append('selected_rules_json', JSON.stringify(selectedList));
        const res = await fetch(`${VALIDATE_API}/api/validate/upload-csv`, { method: 'POST', body: fd });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          throw new Error(e.detail || 'CSV validation failed');
        }
        data = await res.json();
        setUploadMeta({ rows: data.rows?.length || 0, cols: data.headers?.length || 0 });
      } else {
        const res = await fetch(`${VALIDATE_API}/api/validate/flow`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project_id: state.projectId,
            target_object: state.obj,
            custom_prompts: allPrompts,
            selected_rules: Object.keys(selectedRules).filter((k) => selectedRules[k] && !standardRuleOverrides[k]),
            dynamic_rules: savedDynamicRules.filter((r) => selectedDynamicRules[r.id] !== false) || []
          }),
        });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          throw new Error(e.detail || 'Validation failed');
        }
        data = await res.json();
        setUploadMeta(null);
      }

      const returnedDynRules = data.dynamic_rules || [];
      // Merge returned dynamic rules with existing saved dynamic rules without dropping unselected ones
      const existingIds = new Set(savedDynamicRules.map((r: any) => r.id));
      const newlyAddedRules = returnedDynRules.filter((r: any) => !existingIds.has(r.id));
      const combinedDynamicRules = [...savedDynamicRules, ...newlyAddedRules];

      setSavedDynamicRules(combinedDynamicRules);
      dispatch({
        type: 'BATCH_UPDATE',
        updates: {
          validated: data.validated,
          validationReport: data.report,
          dynamicRules: combinedDynamicRules,
          stats: { ...state.stats, errors: data.stats.errors, warns: data.stats.warns, passed: data.stats.passed },
        },
      });

      // Update selected dynamic rules state to include newly added ones
      setSelectedDynamicRules((d) => {
        const updated = { ...d };
        newlyAddedRules.forEach((r: any) => {
          if (r?.id && !(r.id in updated)) {
            updated[r.id] = true;
          }
        });
        return updated;
      });

      // Clear compiled custom prompts and edited standard prompts so they don't linger or duplicate
      if (allPrompts.length > 0) {
        setCustomPrompts([]);
        dispatch({ type: 'SET_FIELD', field: 'customPrompts', value: [] });
        setEditedStandardRulePrompts({});
      }

      // debug: show what server received and what it applied
      setSelectedRulesReceived(Array.isArray(data.selected_rules_received) ? data.selected_rules_received : null);
      setAppliedStandardRules(Array.isArray(data.applied_standard_rules) ? data.applied_standard_rules : null);
      console.debug('validate response selected_rules_received=', data.selected_rules_received, 'applied_standard_rules=', data.applied_standard_rules);
      hideLoad();
      toast(`Validation Complete: ${data.stats.passed} PASS · ${data.stats.errors} ERROR · ${data.stats.warns} WARN`, 'ok');
    } catch (err) {
      hideLoad();
      const msg = err instanceof Error ? err.message : 'Validation failed';
      toast(`${msg}`, 'err');
    }
  }

  const startEditStandard = (id: string, label: string, desc: string) => {
    setStandardEditingId(id);
    setStandardEditLabel(label);
    setStandardEditDesc(desc);
  };

  const saveEditStandard = (id: string) => {
    // Convert edited standard rule into a prompt for LLM compilation
    // Store it so it gets sent to backend for proper Python code generation
    
    const editedPrompt = `${standardEditLabel || id}: ${standardEditDesc || ''}`.trim();
    
    if (!editedPrompt) {
      toast('Please enter a rule description', 'err');
      return;
    }

    // Store this as an edited standard rule prompt
    setEditedStandardRulePrompts((p) => ({ ...p, [id]: editedPrompt }));

    // Disable the original standard rule
    setSelectedRules((s) => ({ ...s, [id]: false }));

    // Track this as an override (will create dynamic rule after LLM compilation)
    setStandardRuleOverrides((o) => ({ ...o, [id]: `EDITED_${id}` }));

    setStandardEditingId(null);
  };

  const deleteDynamicRule = async (rid: string) => {
    const remaining = savedDynamicRules.filter((r) => r.id !== rid);
    setSavedDynamicRules(remaining);
    dispatch({ type: 'SET_FIELD', field: 'dynamicRules', value: remaining });
    setSelectedDynamicRules((d) => {
      const updated = { ...d };
      delete updated[rid];
      return updated;
    });

    // If this was an override rule, re-enable the original standard rule
    const overriddenStandardId = Object.keys(standardRuleOverrides).find((k) => standardRuleOverrides[k] === rid);
    if (overriddenStandardId) {
      setSelectedRules((s) => ({ ...s, [overriddenStandardId]: true }));
      setStandardRuleOverrides((o) => {
        const updated = { ...o };
        delete updated[overriddenStandardId];
        return updated;
      });
    }

    // Persist deletion immediately to Supabase database
    if (state.projectId) {
      try {
        const res = await fetch(`${VALIDATE_API}/api/validate/rules/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project_id: state.projectId,
            target_object: state.obj || 'Biographical Info',
            rules: remaining
          })
        });
        if (res.ok) {
          toast('Rule deleted from database', 'ok');
        }
      } catch (err) {
        console.error('Failed to sync rule deletion with database:', err);
      }
    }
  };

  const handleClearAllDynamicRules = async () => {
    setSavedDynamicRules([]);
    dispatch({ type: 'SET_FIELD', field: 'dynamicRules', value: [] });
    setSelectedDynamicRules({});
    if (state.projectId) {
      try {
        const res = await fetch(`${VALIDATE_API}/api/validate/rules/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project_id: state.projectId,
            target_object: state.obj || 'Biographical Info',
            rules: []
          })
        });
        if (res.ok) {
          toast('All dynamic rules removed from database', 'ok');
        }
      } catch (err) {
        console.error('Failed to clear rules in database:', err);
      }
    }
  };

  const targetCols = React.useMemo(() => {
    if (state.mapping && state.mapping.length > 0) {
      return Array.from(new Set(state.mapping.map((m: any) => m.sap?.split('.').pop() || m.sap).filter(Boolean)));
    }
    return [];
  }, [state.mapping]);

  const toggleSelectDynamicRule = (rid: string) => {
    setSelectedDynamicRules((d) => {
      const nextState = !(d[rid] !== false);
      const updatedDict = { ...d, [rid]: nextState };

      setSavedDynamicRules((prevRules) => {
        const updatedRules = prevRules.map(r => r.id === rid ? { ...r, enabled: nextState } : r);
        dispatch({ type: 'SET_FIELD', field: 'dynamicRules', value: updatedRules });
        return updatedRules;
      });

      return updatedDict;
    });
  };

  const saveRulesToDB = async () => {
    if (!state.projectId) {
      toast('No project selected to save rules', 'err');
      return;
    }
    showLoad('Saving rules...', 'Compiling and saving dynamic rules to database');
    try {
      // Compile custom prompts + edited standard rule prompts into executable rules
      const allPrompts = [
        ...customPrompts,
        ...Object.values(editedStandardRulePrompts)
      ];
      
      let compiled: any[] = [];
      if (allPrompts.length > 0) {
        const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/validate/generate-rules`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompts: allPrompts, target_object: state.obj, actual_columns: targetCols })
        });
        if (!res.ok) throw new Error('Failed to compile prompts');
        const json = await res.json();
        compiled = json.rules || [];
      }

      const payloadRules = [
        ...savedDynamicRules,
        ...compiled
      ].map((r: any) => ({
        ...r,
        enabled: selectedDynamicRules[r.id] !== false
      }));

      const res2 = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/validate/rules/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: state.projectId, target_object: state.obj, rules: payloadRules })
      });
      const resJson = await res2.json().catch(() => (null));
      console.debug('save rules response:', resJson, 'status', res2.status);
      if (!res2.ok) {
        let msg = 'Failed to save rules';
        try {
          msg = (resJson && (resJson.detail || resJson.message)) || JSON.stringify(resJson) || msg;
        } catch (e) {}
        throw new Error(msg);
      }
      // update local saved rules state and migration store
      setSavedDynamicRules(payloadRules || []);
      dispatch({ type: 'SET_FIELD', field: 'dynamicRules', value: payloadRules || [] });
      // clear pending prompts
      setCustomPrompts([]);
      dispatch({ type: 'SET_FIELD', field: 'customPrompts', value: [] });
      setEditedStandardRulePrompts({});
      hideLoad();
      toast('Rules saved to database successfully!', 'ok');
    } catch (err: any) {
      hideLoad();
      toast(err.message || 'Failed to save rules', 'err');
    }
  };

  const saveDataToDB = async () => {
    if (!state.projectId) {
      toast('No project ID found. Please create a project first.', 'err');
      return;
    }
    if (!has) return;
    
    showLoad('Saving data...', 'Persisting validated records to database');
    try {
      const errorReport: any[] = [];
      state.validated.forEach((v) => {
        [...v.errs, ...v.warns].forEach((e) => {
          const isDyn = e.rule.startsWith('DYNAMIC_') || !['REQUIRED_FIELDS', 'FIELD_LENGTH', 'COUNTRY_ISO', 'CURRENCY_ISO', 'NUMERIC_ID', 'EMAIL_FORMAT', 'DATE_FORMAT'].includes(e.rule);
          let val = v.row[e.f];
          if (val === undefined) {
            const matchKey = Object.keys(v.row || {}).find((k) => k.toLowerCase() === (e.f || '').toLowerCase());
            val = matchKey ? v.row[matchKey] : '';
          }
          errorReport.push({
            rule_code: e.rule,
            rule_type: isDyn ? 'Dynamic AI Rule' : 'Standard SAP Rule',
            row_number: v.idx + 1,
            primary_key_value: getPrimaryKeyValue(v.row, state.obj),
            field_name: e.f,
            severity: e.sev,
            reason: e.m,
            invalid_value: String(val ?? '')
          });
        });
      });

      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/validate/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: state.projectId,
          target_object: state.obj,
          payload: errorReport,
          dynamic_rules: state.dynamicRules || []
        })
      });
      
      if (!res.ok) throw new Error('Failed to save data');
      
      hideLoad();
      dispatch({ type: 'SET_FIELD', field: 'isValidatedSaved', value: true });
      toast('Validated data saved to database successfully!', 'ok');
    } catch (err: any) {
      hideLoad();
      toast(err.message || 'Failed to save data', 'err');
    }
  };

  function expErrors(): string {
    const rows = ['Row Number,Primary Key Value,Rule Code,Rule Type,Field Name,Severity,Reason,Invalid Value'];
    state.validated.forEach((v) =>
      [...v.errs, ...v.warns].forEach((e) => {
        const isDyn = e.rule.startsWith('DYNAMIC_') || !['REQUIRED_FIELDS', 'FIELD_LENGTH', 'COUNTRY_ISO', 'CURRENCY_ISO', 'NUMERIC_ID', 'EMAIL_FORMAT', 'DATE_FORMAT'].includes(e.rule);
        const ruleType = isDyn ? 'Dynamic AI Rule' : 'Standard SAP Rule';
        
        let val = v.row[e.f];
        if (val === undefined) {
          const matchKey = Object.keys(v.row || {}).find((k) => k.toLowerCase() === (e.f || '').toLowerCase());
          val = matchKey ? v.row[matchKey] : '';
        }
        const pkValue = getPrimaryKeyValue(v.row, state.obj).replace(/"/g, "'");
        const cleanVal = String(val ?? '').replace(/"/g, "'");
        const cleanMsg = String(e.m ?? '').replace(/"/g, "'");
        rows.push(`${v.idx + 1},"${pkValue}","${e.rule}","${ruleType}","${e.f}","${e.sev}","${cleanMsg}","${cleanVal}"`);
      })
    );
    return rows.join('\n');
  }

  return (
    <PageLayout>
      <PageGrid>

      

      {/* Middle Column */}
      <GridCol span={6}>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">Step 5 — Data Validation</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">Validate against SuccessFactors field rules, required fields, data types, business rules</p>
        </div>

        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={() => { setSource('harmonized'); dispatch({ type: 'BATCH_UPDATE', updates: { validated: [], validationReport: [] } }); }}
            className={`
              px-3.5 py-1.5 rounded-lg text-[11.5px] font-semibold transition-all duration-200 border
              ${source === 'harmonized'
                ? 'bg-violet-600 text-white border-violet-600 shadow-md shadow-violet-600/20'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border-[var(--border)] hover:border-violet-300'}
            `}
          >
            ⚡ Flow
          </button>
          <button
            onClick={() => { setSource('upload'); dispatch({ type: 'BATCH_UPDATE', updates: { validated: [], validationReport: [] } }); }}
            className={`
              px-3.5 py-1.5 rounded-lg text-[11.5px] font-semibold transition-all duration-200 border
              ${source === 'upload'
                ? 'bg-violet-600 text-white border-violet-600 shadow-md shadow-violet-600/20'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border-[var(--border)] hover:border-violet-300'}
            `}
          >
            📄 Upload CSV
          </button>
        </div>

        {source === 'upload' && (
          <div className="flex items-center gap-2 mt-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => setUploadedFile(e.target.files?.[0] || null)}
            />
            <Button variant="secondary" size="sm" icon={<Upload className="w-3.5 h-3.5" />} onClick={() => fileInputRef.current?.click()}>
              {uploadedFile ? uploadedFile.name : 'Choose CSV File…'}
            </Button>
            {uploadMeta && (
              <span className="text-[10.5px] text-[var(--text-tertiary)]">
                Loaded {uploadMeta.rows} rows × {uploadMeta.cols} columns
              </span>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3 mt-4 mb-4">
          <Button variant="secondary" icon={<ArrowLeft className="w-3.5 h-3.5" />} onClick={() => navigate('/harmonize')}>Back</Button>
          <Button variant="warning" icon={<Search className="w-3.5 h-3.5" />} onClick={runValidation} disabled={source === 'upload' && !uploadedFile}>Run Validation</Button>
          <div title={!has ? "Run validation first before saving." : ""}>
            <Button variant="secondary" icon={<Save className="w-3.5 h-3.5" />} onClick={saveDataToDB} disabled={!has}>Save Report</Button>
          </div>
          <div title={!state.isValidatedSaved ? "You must save your data before proceeding to Step 6." : ""}>
            <Button variant="primary" icon={<ArrowRight className="w-3.5 h-3.5" />} onClick={() => navigate('/cleanse')} disabled={!state.isValidatedSaved}>Next: Cleanse</Button>
          </div>
        </div>

        {has && (
          <StatsGrid>
            <StatBox value={pR} label="PASS" subtitle={`${Math.round((pR / (state.validated.length || 1)) * 100)}%`} color="var(--color-success)" />
            <StatBox value={eR} label="ERRORS" subtitle="Blocks migration" color="var(--color-danger)" />
            <StatBox value={wR} label="WARNINGS" subtitle="Review needed" color="var(--color-warning)" />
            <StatBox value={state.validated.length} label="Total" color="var(--color-primary-500)" />
          </StatsGrid>
        )}

        {report.length > 0 && (
          <Card className="mb-4">
            <CardHeader title="Validation Report — Active Rules" subtitle="Executed Dynamic AI Rules & Standard SF Rules" icon={<ListChecks className="w-4 h-4" />}>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" icon={<Download className="w-3 h-3" />} onClick={() => dl(expErrors(), 'errors.csv', 'text/csv')}>Export Report</Button>
                {selectedRulesReceived && (
                  <div className="text-[12px] text-[var(--text-tertiary)] px-2 py-1 rounded bg-[var(--bg-tertiary)]/60">Received: {selectedRulesReceived.join(', ')}</div>
                )}
                {appliedStandardRules && (
                  <div className="text-[12px] text-[var(--text-tertiary)] px-2 py-1 rounded bg-[var(--bg-tertiary)]/60">Applied: {appliedStandardRules.join(', ')}</div>
                )}
                <button
                  onClick={() => setOpenActiveRulesAccordion(!openActiveRulesAccordion)}
                  className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] cursor-pointer transition-colors"
                  title={openActiveRulesAccordion ? "Collapse Report" : "Expand Report"}
                >
                  {openActiveRulesAccordion ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
              </div>
            </CardHeader>
            {openActiveRulesAccordion && (
              <CardBody className="space-y-2">
                {report.map((r) => (
                  <div key={r.rule} className={`px-3 py-2.5 rounded-xl border transition-all ${
                    r.is_dynamic
                      ? 'border-violet-300 dark:border-violet-700/60 bg-violet-50/20 dark:bg-violet-950/15'
                      : 'border-[var(--border)] bg-[var(--bg-tertiary)]/30'
                  }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-bold text-[var(--text-primary)]">{r.label}</span>
                        {r.is_dynamic && (
                          <span className="px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 text-[8.5px] font-bold flex items-center gap-1">
                            ⚡ AI Dynamic Rule (Overriding Priority)
                          </span>
                        )}
                        <span className="text-[10.5px] text-[var(--text-tertiary)]">{r.description}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {r.is_dynamic && (
                          <button
                            onClick={() => deleteDynamicRule(r.rule)}
                            className="text-[var(--text-tertiary)] hover:text-red-500 p-1 rounded hover:bg-red-500/10 transition-colors cursor-pointer"
                            title="Delete this dynamic rule from database"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <Badge variant={r.failCount > 0 ? 'red' : 'green'}>
                          {r.failCount > 0 ? `${r.failCount} failing` : 'All pass'}
                        </Badge>
                      </div>
                    </div>
                    {r.failures.length > 0 && (
                      <div className="mt-1.5 space-y-0.5">
                        {r.failures.slice(0, 4).map((f, i) => (
                          <div key={i} className="text-[10.5px] text-[var(--text-secondary)] font-mono">
                            #{f.idx + 1} {state.validated[f.idx]?.primary_key ? `[PK: ${state.validated[f.idx].primary_key}]` : ''} <strong>{f.field}</strong>="{String(f.value).slice(0, 24)}" — {f.message}
                          </div>
                        ))}
                        {r.failures.length > 4 && (
                          <div className="text-[10px] text-[var(--text-tertiary)]">
                            +{r.failures.length - 4} more — see exported report
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </CardBody>
            )}
          </Card>
        )}

        <Card>
          <CardHeader title="Validation Results">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setOpenResultsAccordion(!openResultsAccordion)}
                className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] cursor-pointer transition-colors"
                title={openResultsAccordion ? "Collapse Validation Results" : "Expand Validation Results"}
              >
                {openResultsAccordion ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            </div>
          </CardHeader>
          {openResultsAccordion && (
            <CardBody>
              {has ? (
                <div className="space-y-1.5">
                  {state.validated.slice(0, 12).map((v, i) => (
                    <div key={i} className="grid grid-cols-[80px_1fr_70px] gap-3 items-start px-3 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)]/30">
                      <div>
                        <div className="font-mono text-[11px] text-primary-600 dark:text-primary-400">#{v.idx + 1}</div>
                        <div className="text-[9.5px] text-[var(--text-tertiary)] mt-0.5 truncate">
                          {v.primary_key ? `PK: ${v.primary_key}` : Object.values(v.row || {}).filter(Boolean).slice(0, 2).map(String).join(' · ').slice(0, 28)}
                        </div>
                      </div>
                      <div className="space-y-0.5">
                        {v.errs.slice(0, 2).map((e, ei) => (
                          <div key={ei} className="text-[11px] text-red-600 dark:text-red-400">✗ <strong>{e.f}</strong>: {e.m}</div>
                        ))}
                        {v.warns.slice(0, 1).map((w, wi) => (
                          <div key={wi} className="text-[11px] text-amber-600 dark:text-amber-400">⚠ <strong>{w.f}</strong>: {w.m}</div>
                        ))}
                        {v.st === 'PASS' && <div className="text-[11px] text-emerald-600 dark:text-emerald-400">✓ All rules passed</div>}
                      </div>
                      <Badge variant={v.st === 'ERROR' ? 'red' : v.st === 'WARN' ? 'amber' : 'green'} className="justify-self-end">{v.st}</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState icon={<Search className="w-10 h-10 text-primary-500" />} message="Run validation to check field rules" />
              )}
            </CardBody>
          )}
        </Card>
      </GridCol>

      {/* Right Column */}
      <GridCol span={3} className="space-y-4">
        {/* Standard SuccessFactors Rules Card */}
        <Card>
          <CardHeader title="Standard SuccessFactors Rules" subtitle="Built-in field validations" icon={<ListChecks className="w-4 h-4" />} />
          <CardBody className="p-3 space-y-2">
            {STANDARD_RULES.map((r) => {
              const isEdited = !!editedStandardRulePrompts[r.id];
              const checked = selectedRules[r.id] !== false && !isEdited;
              return (
                <div 
                  key={r.id} 
                  className={`px-3 py-2.5 rounded-xl border transition-all ${
                    checked
                      ? 'border-[var(--border)] bg-[var(--bg-tertiary)]/50'
                      : isEdited
                      ? 'border-amber-200 dark:border-amber-900/40 bg-amber-50/20 dark:bg-amber-950/10 opacity-75'
                      : 'border-[var(--border)] bg-[var(--bg-tertiary)]/15 opacity-60'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <input 
                      type="checkbox" 
                      checked={!!checked} 
                      onChange={() => toggleSelectRule(r.id)} 
                      disabled={isEdited}
                      className="w-4 h-4 mt-0.5 cursor-pointer accent-violet-600 disabled:cursor-not-allowed" 
                    />
                    <div className="flex-1 min-w-0">
                      {standardEditingId === r.id ? (
                        <div className="flex flex-col gap-1.5">
                          <input 
                            value={standardEditLabel} 
                            onChange={(e) => setStandardEditLabel(e.target.value)} 
                            className="w-full px-2 py-1 text-[11px] rounded border border-violet-400 bg-[var(--bg-primary)] text-[var(--text-primary)]" 
                            placeholder="Rule label"
                          />
                          <input 
                            value={standardEditDesc} 
                            onChange={(e) => setStandardEditDesc(e.target.value)} 
                            className="w-full px-2 py-1 text-[10px] rounded border border-violet-400 bg-[var(--bg-primary)] text-[var(--text-secondary)]" 
                            placeholder="Rule description"
                          />
                          <div className="flex items-center justify-end gap-1 pt-1">
                            <button 
                              onClick={() => saveEditStandard(r.id)} 
                              className="px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 text-[10px] font-bold flex items-center gap-0.5 cursor-pointer transition-colors"
                            >
                              <Check className="w-3 h-3" /> Save
                            </button>
                            <button 
                              onClick={() => setStandardEditingId(null)} 
                              className="px-2 py-1 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--border)] text-[10px] flex items-center gap-0.5 cursor-pointer transition-colors"
                            >
                              <X className="w-3 h-3" /> Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className={`text-[11px] font-bold flex items-center gap-2 ${
                              checked 
                                ? 'text-emerald-600 dark:text-emerald-400' 
                                : isEdited
                                ? 'text-amber-700 dark:text-amber-300 line-through'
                                : 'text-[var(--text-tertiary)] line-through'
                            }`}>
                              {r.label}
                              {isEdited && (
                                <span className="px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-[8px] font-bold uppercase tracking-wider">
                                  Overridden
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-[var(--text-tertiary)] mt-0.5">{r.description}</div>
                          </div>
                          <button 
                            onClick={() => startEditStandard(r.id, r.label, r.description)} 
                            className="p-1 text-[var(--text-tertiary)] hover:text-violet-500 ml-1 shrink-0 transition-colors hover:bg-violet-500/10 rounded"
                            title="Edit rule"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </CardBody>
        </Card>

        {/* Dynamic AI Custom Rules Card — Displayed underneath Default Rules */}
        <Card className="border-violet-200 dark:border-violet-900/50 bg-gradient-to-br from-[var(--bg-primary)] to-violet-50/20 dark:to-violet-950/10">
          <CardHeader
            title="Dynamic AI Rules"
            subtitle="Custom business rules"
            icon={<Sparkles className="w-4 h-4 text-violet-600 dark:text-violet-400" />}
          >
            <Button variant="secondary" size="sm" icon={<Save className="w-3 h-3" />} onClick={saveRulesToDB}>Save Rules</Button>
          </CardHeader>
          <CardBody className="p-3 space-y-3">
            {/* Edited Standard Rules Section — PROMINENT */}
            {Object.keys(editedStandardRulePrompts).length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 px-3 py-2">
                  <span className="text-[11px] font-bold text-amber-700 dark:text-amber-300 uppercase tracking-wider">📝 Overridden Rules ({Object.keys(editedStandardRulePrompts).length})</span>
                  <span className="px-2 py-0.5 rounded-full text-[8px] font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200">
                    Will Compile
                  </span>
                </div>
                <div className="space-y-1.5 px-2">
                  {Object.entries(editedStandardRulePrompts).map(([standardId, prompt]) => (
                    <div key={standardId} className="flex items-start justify-between p-2.5 rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-950/20 gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-amber-700 dark:text-amber-300 font-bold text-[10.5px]">{standardId}</div>
                        <div className="text-[var(--text-secondary)] text-[10px] mt-1 line-clamp-2">{prompt}</div>
                      </div>
                      <button
                        onClick={() => {
                          setEditedStandardRulePrompts((p) => {
                            const updated = { ...p };
                            delete updated[standardId];
                            return updated;
                          });
                          setStandardRuleOverrides((o) => {
                            const updated = { ...o };
                            delete updated[standardId];
                            return updated;
                          });
                          setSelectedRules((s) => ({ ...s, [standardId]: true }));
                        }}
                        className="text-[var(--text-tertiary)] hover:text-red-500 p-1 rounded hover:bg-red-500/10 transition-colors cursor-pointer shrink-0"
                        title="Revert and re-enable standard rule"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Saved Dynamic Rules */}
            {savedDynamicRules.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-[11px] font-bold text-violet-700 dark:text-violet-300 uppercase tracking-wider">⚡ Saved Rules ({savedDynamicRules.length})</span>
                  <button
                    onClick={handleClearAllDynamicRules}
                    className="text-[10px] text-red-500 hover:text-red-600 font-semibold cursor-pointer"
                  >
                    Clear All
                  </button>
                </div>
                <div className="space-y-1.5 px-2 max-h-[180px] overflow-y-auto scrollbar-thin">
                  {savedDynamicRules.map((r) => (
                    <div key={r.id} className="flex items-start gap-2 p-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)]/40">
                      <input 
                        type="checkbox" 
                        checked={selectedDynamicRules[r.id] !== false} 
                        onChange={() => toggleSelectDynamicRule(r.id)} 
                        className="w-4 h-4 mt-0.5 cursor-pointer accent-violet-600" 
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-violet-600 dark:text-violet-400 font-bold text-[10.5px]">{r.label}</div>
                        <div className="text-[var(--text-secondary)] text-[10px] mt-0.5">{r.description}</div>
                      </div>
                      <button
                        onClick={() => deleteDynamicRule(r.id)}
                        className="text-[var(--text-tertiary)] hover:text-red-500 p-1 rounded hover:bg-red-500/10 transition-colors cursor-pointer shrink-0"
                        title="Delete rule"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Divider */}
            {(Object.keys(editedStandardRulePrompts).length > 0 || savedDynamicRules.length > 0) && (
              <div className="h-px bg-[var(--border)]" />
            )}

            {/* Add New Custom Prompt Section */}
            <div className="space-y-2">
              <div className="text-[11px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider px-3 py-2">Add Custom Rule</div>
              <div className="flex items-center gap-1.5 px-2">
                <input
                  type="text"
                  value={newPromptInput}
                  onChange={(e) => setNewPromptInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddPrompt()}
                  placeholder="e.g. Postal code must be 5 digits..."
                  className="flex-1 px-2.5 py-1.5 rounded-lg text-[11px] bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-violet-500 focus:border-violet-400 transition-all"
                />
                <Button variant="secondary" size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={handleAddPrompt}>
                  Add
                </Button>
              </div>
            </div>

            {/* List of Custom Prompts */}
            {customPrompts.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 px-3 py-2">
                  <span className="text-[11px] font-bold text-purple-700 dark:text-purple-300 uppercase tracking-wider">✨ Custom Prompts ({customPrompts.length})</span>
                </div>
                <div className="space-y-1.5 px-2 max-h-[200px] overflow-y-auto scrollbar-thin">
                  {customPrompts.map((p, idx) => (
                    <div key={idx} className="flex items-start gap-2 p-2.5 rounded-lg border border-purple-200 dark:border-purple-900/40 bg-purple-50/40 dark:bg-purple-950/20">
                      {editingIndex === idx ? (
                        <div className="flex items-center gap-1.5 w-full">
                          <span className="text-purple-600 font-bold shrink-0 text-[10px]">#{idx + 1}</span>
                          <input
                            type="text"
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveEdit(idx);
                              if (e.key === 'Escape') handleCancelEdit();
                            }}
                            className="flex-1 px-2 py-1 text-[10px] rounded bg-[var(--bg-primary)] border border-purple-400 text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-purple-500 font-medium"
                            autoFocus
                          />
                          <button
                            onClick={() => handleSaveEdit(idx)}
                            className="p-1 rounded text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 cursor-pointer shrink-0 transition-colors"
                            title="Save"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={handleCancelEdit}
                            className="p-1 rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] cursor-pointer shrink-0 transition-colors"
                            title="Cancel"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="flex gap-1.5 items-start flex-1">
                            <span className="text-purple-600 dark:text-purple-400 font-bold shrink-0 text-[10px]">✨</span>
                            <span className="text-[var(--text-primary)] font-medium text-[10px] leading-snug">#{idx + 1}. {p}</span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => handleStartEdit(idx)}
                              className="text-[var(--text-tertiary)] hover:text-purple-500 p-1 rounded hover:bg-purple-500/10 transition-colors cursor-pointer"
                              title="Edit"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => handleRemovePrompt(idx)}
                              className="text-[var(--text-tertiary)] hover:text-red-500 p-1 rounded hover:bg-red-500/10 transition-colors cursor-pointer"
                              title="Delete"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </GridCol>

      </PageGrid>
    </PageLayout>
  );
}
