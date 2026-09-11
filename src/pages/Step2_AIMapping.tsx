import React, { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMigration } from '@/store/migration-store';
import { useToast } from '@/components/ui/toast';
import { useLoading } from '@/components/ui/loading-overlay';
import { OBJS } from '@/data/sap-schemas';
import { TRANSFORMS } from '@/data/lookup-maps';
import { generateMapping, correctMapping, getSAPSchema } from '@/services/ai-service';
import { dl, expCSV } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { PageLayout, PageGrid, GridCol, Card, CardHeader, CardBody, Button, Badge, StatBox, StatsGrid, PageHeader, EmptyState, AIResponse, Select } from '@/components/shared';
import { ArrowRight, Download, Bot, ArrowLeft, Edit3, Save, X, CheckCircle2, Upload, AlertTriangle, Check, Search, FileSpreadsheet } from 'lucide-react';
import type { MappingEntry } from '@/store/migration-store';

export function Step2AIMapping() {
  const { state, dispatch } = useMigration();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { showLoad, tick, hideLoad } = useLoading();
  const [aiOutput, setAiOutput] = useState('');
  const [sourceSearch, setSourceSearch] = useState('');
  const [targetSearch, setTargetSearch] = useState('');
  const [mappingSearch, setMappingSearch] = useState('');
  const [editingMapSrc, setEditingMapSrc] = useState<{ index: number; value: string } | null>(null);
  const [stagedMaps, setStagedMaps] = useState<{ src: string; sap: string }[]>([]);

  // Manual Mapping Upload & Edit State
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [editingMapping, setEditingMapping] = useState<{
    index: number;
    src: string;
    sap: string;
    tr: string;
    note?: string;
  } | null>(null);

  const [sapFields, setSapFields] = useState<any[]>([]);
  const [isLoadingSchema, setIsLoadingSchema] = useState(true);

  React.useEffect(() => {
    async function fetchSchema() {
      setIsLoadingSchema(true);
      try {
        // Map frontend key to backend DB name
        const objName = state.obj === 'CUSTOMER' ? 'Customer' : state.obj === 'VENDOR' ? 'Vendor' : state.obj === 'MATERIAL' ? 'Material' : (state.obj || 'Customer');
        const res = await getSAPSchema(objName);
        const fields = (res && res.fields ? res.fields : []).map((f: any) => ({
          ...f,
          field_name: f.sap_structure ? `${f.sap_structure}.${f.field_name}` : f.field_name
        }));
        setSapFields(fields);

        // Auto-populate Source Fields based on Source System
        if (state.src === 'SAP_ECC') {
          if (!state.connUrl || !state.connUser || !state.connPass) {
            dispatch({ type: 'SET_FIELD', field: 'headers', value: [] });
            setIsLoadingSchema(false);
            return;
          }

          try {
            const schemaRes = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/extract/fetch_schema`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                base_url: state.connUrl,
                client: state.connClient,
                username: state.connUser,
                password: state.connPass,
                system_type: state.src,
                target_object: state.obj || 'CUSTOMER'
              })
            });
            if (schemaRes.ok) {
              const schemaData = await schemaRes.json();
              dispatch({ type: 'SET_FIELD', field: 'headers', value: schemaData.fields || [] });
            } else {
              toast('Failed to fetch source schema from SAP', 'err');
              dispatch({ type: 'SET_FIELD', field: 'headers', value: [] });
            }
          } catch (err) {
            toast('Failed to reach backend to fetch source schema', 'err');
            dispatch({ type: 'SET_FIELD', field: 'headers', value: [] });
          }
        }
      } catch (err) {
        setSapFields([]);
      } finally {
        setIsLoadingSchema(false);
      }
    }
    fetchSchema();
  }, [state.obj, state.src]);

  const isFieldMandatory = useCallback((sapFieldName?: string, mapEntryReq?: boolean) => {
    if (mapEntryReq === true) return true;
    if (!sapFieldName || !sapFields || sapFields.length === 0) return false;
    const cleanSap = sapFieldName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const baseSap = (sapFieldName.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    const matched = sapFields.find((sf: any) => {
      const fn = String(sf.field_name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const baseFn = (String(sf.field_name || '').split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return fn === cleanSap || baseFn === baseSap || fn === baseSap || baseFn === cleanSap;
    });
    return Boolean(matched?.is_mandatory);
  }, [sapFields]);

  const handleSaveMapSrcEdit = (index: number, oldName: string) => {
    if (!editingMapSrc || !editingMapSrc.value.trim() || editingMapSrc.value === oldName) {
      setEditingMapSrc(null);
      dispatch({ type: 'SET_FIELD', field: 'isMappingSaved', value: false });
      return;
    }
    const newName = editingMapSrc.value.trim();

    // Update all mappings that used the old name
    const newMappings = state.mapping.map(m =>
      m.src === oldName ? { ...m, src: newName } : m
    );
    dispatch({ type: 'SET_FIELD', field: 'mapping', value: newMappings });
    dispatch({ type: 'SET_FIELD', field: 'isMappingSaved', value: false });

    // Synchronize with the Source Fields list on the left
    const newHeaders = state.headers.map(h => h === oldName ? newName : h);
    dispatch({ type: 'SET_FIELD', field: 'headers', value: newHeaders });

    setEditingMapSrc(null);
  };

  const removeMap = (sap: string) => {
    dispatch({ type: 'SET_FIELD', field: 'mapping', value: state.mapping.filter((m) => m.sap !== sap) });
    dispatch({ type: 'SET_FIELD', field: 'isMappingSaved', value: false });
  };

  const saveMappings = async () => {
    if (!state.projectId) {
      toast('You must select a project in Step 1 to save mappings.', 'err');
      return;
    }

    showLoad('Saving Mappings...', 'Persisting mapping rules to database', ['Connecting to backend...', 'Upserting mapping history...']);
    setTimeout(() => tick(0, 'Connected'), 300);

    try {
      const objName = state.obj === 'CUSTOMER' ? 'Customer' : state.obj === 'VENDOR' ? 'Vendor' : state.obj === 'MATERIAL' ? 'Material' : (state.obj || 'Customer');
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/map/save_all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: state.projectId,
          sourceSystem: state.src,
          targetObject: objName,
          mappings: state.mapping
        })
      });
      if (!res.ok) throw new Error('Failed to save mappings');

      const data = await res.json();
      hideLoad();
      toast(`Successfully saved ${data.inserted} mapped fields!`, 'ok');
      dispatch({ type: 'SET_FIELD', field: 'isMappingSaved', value: true });
    } catch (err: any) {
      hideLoad();
      toast(err.message, 'err');
    }
  };

  const loadMappings = async () => {
    if (!state.projectId) {
      toast('You must select a project in Step 1 to load mappings.', 'err');
      return;
    }

    showLoad('Loading Mappings...', 'Retrieving your mapping history', ['Connecting to backend...', 'Fetching user corrected mappings...']);
    setTimeout(() => tick(0, 'Connected'), 300);

    try {
      const objName = state.obj === 'CUSTOMER' ? 'Customer' : state.obj === 'VENDOR' ? 'Vendor' : state.obj === 'MATERIAL' ? 'Material' : (state.obj || 'Customer');
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/map/history?project_id=${state.projectId}&source_system=${state.src}&target_object=${objName}`);
      if (!res.ok) throw new Error('Failed to fetch history');

      const data = await res.json();
      hideLoad();

      if (!data.mappings || data.mappings.length === 0) {
        toast('No previous mappings found for this system and object.', 'ok');
        return;
      }

      // Enrich the loaded mappings with req and sapLabel from the current sapFields schema
      const enrichedMappings = data.mappings.map((m: any) => {
        const sapDef = sapFields.find(f => f.field_name === m.sap);
        return {
          ...m,
          req: sapDef ? sapDef.is_mandatory : false,
          sapLabel: sapDef ? sapDef.field_description : ''
        };
      });

      // Ensure all loaded source fields are added to headers if they don't exist
      const newHeaders = new Set(state.headers);
      enrichedMappings.forEach((m: any) => {
        if (m.src) newHeaders.add(m.src);
      });

      dispatch({ type: 'SET_FIELD', field: 'headers', value: Array.from(newHeaders) });
      dispatch({ type: 'SET_FIELD', field: 'mapping', value: enrichedMappings });
      dispatch({ type: 'SET_FIELD', field: 'isMappingSaved', value: true });

      toast(`Loaded ${enrichedMappings.length} mappings from history!`, 'ok');
    } catch (err: any) {
      hideLoad();
      toast(err.message, 'err');
    }
  };

  const isTargetValid = useCallback((targetField: string) => {
    if (!targetField || !targetField.trim()) return false;
    const clean = targetField.trim().toLowerCase();
    const base = clean.split('.').pop() || clean;
    return sapFields.some(f => {
      const fName = (f.field_name || '').toLowerCase();
      const fBase = fName.split('.').pop() || fName;
      return fName === clean || fBase === base || fBase === clean;
    });
  }, [sapFields]);

  const handleUploadMapping = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    showLoad('Uploading Mapping Sheet...', `Reading ${file.name} and parsing mapping rows...`, [
      'Reading file...',
      'Matching schema fields...',
      'Assigning mappings...'
    ]);
    setTimeout(() => tick(0, 'Reading file...'), 200);

    try {
      const formData = new FormData();
      formData.append('file', file);

      let parsedMappings: any[] = [];

      // Try backend endpoint first
      try {
        const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/upload_mapping`, {
          method: 'POST',
          body: formData,
        });
        if (res.ok) {
          const json = await res.json();
          parsedMappings = json.mappings || [];
        }
      } catch (backendErr) {
        console.warn('Backend upload_mapping failed, using local parse fallback:', backendErr);
      }

      // Fallback for CSV if backend not available
      if (parsedMappings.length === 0 && (file.name.endsWith('.csv') || file.name.endsWith('.txt'))) {
        const text = await file.text();
        parsedMappings = parseCSVMapping(text);
      }

      if (parsedMappings.length === 0) {
        throw new Error('No valid mapping rows found in the uploaded file.');
      }

      setTimeout(() => tick(1, 'Matching SF target fields...'), 500);

      // Enrich mappings with SF schema definitions
      const enriched = parsedMappings.map(m => {
        const sapClean = (m.sap || '').trim();
        const matchedDef = sapFields.find(f => {
          const fn = (f.field_name || '').toLowerCase();
          const base = fn.split('.').pop() || fn;
          const targetClean = sapClean.toLowerCase();
          const targetBase = targetClean.split('.').pop() || targetClean;
          return fn === targetClean || base === targetBase || base === targetClean;
        });

        return {
          src: m.src || '',
          sap: m.sap || '',
          tr: m.tr || 'trim',
          conf: m.conf || 100,
          req: matchedDef ? matchedDef.is_mandatory : false,
          sapLabel: matchedDef ? (matchedDef.field_description || matchedDef.sap_structure) : (m.sapLabel || ''),
          note: m.note || 'Uploaded from sheet'
        };
      });

      // Update source headers
      const newHeaders = new Set(state.headers);
      enriched.forEach(m => {
        if (m.src && m.src.trim()) newHeaders.add(m.src.trim());
      });

      setTimeout(() => tick(2, 'Finalizing...'), 800);

      setTimeout(() => {
        hideLoad();
        dispatch({ type: 'SET_FIELD', field: 'headers', value: Array.from(newHeaders) });
        dispatch({ type: 'SET_FIELD', field: 'mapping', value: enriched });
        dispatch({ type: 'SET_FIELD', field: 'isMappingSaved', value: false });

        const invalidCount = enriched.filter(m => !isTargetValid(m.sap)).length;
        if (invalidCount > 0) {
          toast(`Uploaded ${enriched.length} mappings. ⚠️ ${invalidCount} target field(s) not in schema (highlighted in red).`, 'warning');
        } else {
          toast(`Successfully uploaded ${enriched.length} mappings!`, 'ok');
        }
      }, 1000);

    } catch (err: any) {
      hideLoad();
      toast(err.message || 'Failed to upload mapping file', 'err');
    } finally {
      if (uploadInputRef.current) uploadInputRef.current.value = '';
    }
  };

  const handleSaveMappingEdit = () => {
    if (!editingMapping) return;
    const { index, src, sap, tr, note } = editingMapping;
    if (!src.trim() && !sap.trim()) {
      toast('Both source and target fields cannot be empty.', 'err');
      return;
    }

    const matchedDef = sapFields.find(f => {
      const fn = (f.field_name || '').toLowerCase();
      const base = fn.split('.').pop() || fn;
      const targetClean = (sap || '').trim().toLowerCase();
      const targetBase = targetClean.split('.').pop() || targetClean;
      return fn === targetClean || base === targetBase || base === targetClean;
    });

    const updated = [...state.mapping];
    const targetValid = isTargetValid(sap);
    updated[index] = {
      ...updated[index],
      src: src.trim(),
      sap: sap.trim(),
      tr: tr || 'trim',
      req: matchedDef ? matchedDef.is_mandatory : false,
      sapLabel: matchedDef ? (matchedDef.field_description || matchedDef.sap_structure) : (updated[index]?.sapLabel || ''),
      conf: targetValid ? Math.max(updated[index]?.conf || 0, 95) : 0,
      note: note || updated[index]?.note || 'Edited'
    };

    // Ensure source field is in headers
    if (src.trim() && !state.headers.includes(src.trim())) {
      dispatch({ type: 'SET_FIELD', field: 'headers', value: [...state.headers, src.trim()] });
    }

    dispatch({ type: 'SET_FIELD', field: 'mapping', value: updated });
    dispatch({ type: 'SET_FIELD', field: 'isMappingSaved', value: false });
    setEditingMapping(null);
    toast('Mapping updated successfully!', 'ok');
  };

  function parseCSVMapping(csvText: string): any[] {
    const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length < 2) return [];

    const parseRow = (line: string) => {
      const result: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current.trim());
      return result;
    };

    const headers = parseRow(lines[0]).map(h => h.toLowerCase().replace(/[\s_\-]+/g, ''));
    let srcIdx = headers.findIndex(h => h.includes('src') || h.includes('source') || h.includes('legacy'));
    let tgtIdx = headers.findIndex(h => h.includes('target') || h.includes('sap') || h.includes('sf') || h.includes('destination'));
    let trIdx = headers.findIndex(h => h.includes('tr') || h.includes('transform') || h.includes('rule'));
    let lblIdx = headers.findIndex(h => h.includes('label') || h.includes('desc'));

    if (srcIdx === -1) srcIdx = 0;
    if (tgtIdx === -1) tgtIdx = 1;

    const rows: any[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseRow(lines[i]);
      const src = cols[srcIdx] || '';
      const tgt = cols[tgtIdx] || '';
      const tr = (trIdx !== -1 && cols[trIdx]) ? cols[trIdx].toLowerCase() : 'trim';
      const label = (lblIdx !== -1 && cols[lblIdx]) ? cols[lblIdx] : '';

      if (src || tgt) {
        rows.push({
          src,
          sap: tgt,
          tr: tr || 'trim',
          conf: 100,
          sapLabel: label,
          note: 'Uploaded from CSV'
        });
      }
    }
    return rows;
  }

  const obj = OBJS[state.obj];
  const validMappings = state.mapping.filter(m => m.sap && m.sap.trim() !== "");
  const invalidTargetMappings = state.mapping.filter(m => !isTargetValid(m.sap));
  const invalidTargetCount = invalidTargetMappings.length;
  const hi = validMappings.filter((m) => m.conf >= 80 && isTargetValid(m.sap)).length;
  const needsReview = validMappings.filter((m) => isTargetValid(m.sap) && m.conf < 80).length;

  const mappedSources = state.mapping.map(m => m.src);
  const mappedSaps = state.mapping.map(m => m.sap);
  const unmappedSourceList = state.headers.filter(h => !mappedSources.includes(h));
  const unmappedSapList = sapFields.filter(f => !mappedSaps.includes(f.field_name));

  // Calculate unmapped source fields instead of target fields
  const unmappedSource = unmappedSourceList.length;

  // -- Auto map fallback (same as original)
  function autoMap(): MappingEntry[] {
    const sem: Record<string, string[]> = {
      'KUNNR': ['KUNNR', 'PARTY_NUMBER', 'CUST_ID', 'ID', 'CUSTOMER_NO', 'ACCOUNTNUM'],
      'LIFNR': ['LIFNR', 'PARTY_NUMBER', 'VENDOR_ID', 'SUPPLIER_ID'],
      'NAME1': ['NAME1', 'PARTY_NAME', 'CUSTOMER_NAME', 'VENDOR_NAME', 'NAME', 'DESCRIPTION', 'MAKTX'],
      'LAND1': ['LAND1', 'COUNTRY_CODE', 'COUNTRY', 'LAND'],
      'ORT01': ['ORT01', 'CITY', 'TOWN'],
      'PSTLZ': ['PSTLZ', 'POSTAL_CODE', 'ZIP', 'POSTCODE'],
      'REGIO': ['REGIO', 'STATE', 'PROVINCE', 'REGION'],
      'STRAS': ['STRAS', 'ADDRESS1', 'ADDRESS', 'STREET'],
      'TELF1': ['TELF1', 'PHONE', 'TELEPHONE'],
      'SMTP_ADDR': ['SMTP_ADDR', 'EMAIL', 'MAIL'],
      'WAERS': ['WAERS', 'CURRENCY_CODE', 'CURRENCY', 'CURR'],
      'ZTERM': ['ZTERM', 'PAYMENT_TERMS', 'PAY_TERMS'],
      'STCD1': ['STCD1', 'TAX_NUMBER', 'TAX_ID', 'TAXNUMBER'],
      'BUKRS': ['BUKRS', 'COMPANY_CODE'],
      'VKORG': ['VKORG', 'SALES_ORG'],
      'EKORG': ['EKORG', 'PURCH_ORG'],
      'MATNR': ['MATNR', 'ID', 'MATERIAL_NUMBER', 'ITEM_CODE', 'PART_NO'],
      'MAKTX': ['MAKTX', 'DESCRIPTION', 'NAME', 'MATERIAL_DESC'],
      'MEINS': ['MEINS', 'BASE_UOM', 'UNIT', 'UOM'],
      'MTART': ['MTART', 'MATERIAL_TYPE'],
      'MBRSH': ['MBRSH', 'INDUSTRY'],
      'WERKS': ['WERKS', 'PLANT'],
      'LGORT': ['LGORT', 'STORAGE_LOC', 'STORAGE_LOCATION'],
      'BRGEW': ['BRGEW', 'GROSS_WEIGHT'],
      'NTGEW': ['NTGEW', 'NET_WEIGHT'],
      'GEWEI': ['GEWEI', 'WEIGHT_UNIT'],
    };
    const res: MappingEntry[] = [];
    if (OBJS[state.obj] && OBJS[state.obj].fields) {
      OBJS[state.obj].fields.forEach((f) => {
        const syns = sem[f.n] || [f.n];
        let best: string | null = null, bs = 0;
        state.headers.forEach((h) => {
          const hu = h.toUpperCase(), fn = f.n.toUpperCase();
          let sc = 0;
          if (hu === fn || syns.map((s) => s.toUpperCase()).includes(hu)) sc = 90;
          else if (hu.includes(fn) || fn.includes(hu)) sc = 72;
          if (sc > bs) { bs = sc; best = h; }
        });
        if (best && bs >= 40) {
          const tr = inferTr(best, f.n, f.t);
          res.push({ src: best, sap: f.n, sapLabel: f.l, conf: bs, tr, note: 'Auto-mapped', req: f.req });
        }
      });
    }
    return res;
  }

  function inferTr(s: string, t: string, tp: string): string {
    const su = s.toUpperCase();
    if (['KUNNR', 'LIFNR'].includes(t)) return 'pad10';
    if (t === 'LAND1' || su.includes('COUNTRY')) return 'country';
    if (tp === 'CUKY' || t === 'WAERS') return 'currency';
    if (t === 'ZTERM' || su.includes('PAYMENT')) return 'payterm';
    if (t === 'MTART') return 'mattype';
    if (tp === 'DATS' || su.includes('DATE')) return 'date8';
    return 'trim';
  }

  async function doAIMap() {
    showLoad('AI Field Mapping…', 'AI analyzing semantic field relationships', [
      `Connecting to Backend API…`,
      `Fetching SAP Schema from Database…`,
      `Applying Known Source Matches…`,
      `Checking LLM Cache & User Overrides…`,
      `Generating missing mappings via AI…`,
    ]);
    setTimeout(() => tick(0, 'Backend connected'), 400);
    setTimeout(() => tick(1, 'SAP schema fetched'), 900);
    setTimeout(() => tick(2, 'Known source matches applied'), 1300);
    setTimeout(() => tick(3, 'Cache & Overrides applied'), 1600);
    try {
      const objName = state.obj === 'CUSTOMER' ? 'Customer' : state.obj === 'VENDOR' ? 'Vendor' : state.obj === 'MATERIAL' ? 'Material' : (state.obj || 'Customer');
      const data = await generateMapping(state.src || 'SAP_ECC', objName, state.headers);
      const mapping = data.mappings || [];

      // If Step 1 was skipped, infer the source headers directly from the AI's generated mapping
      if (state.headers.length === 0) {
        const inferredHeaders = Array.from(new Set(mapping.map((m: any) => m.src).filter(Boolean)));
        dispatch({ type: 'SET_FIELD', field: 'headers', value: inferredHeaders as string[] });
      }

      setTimeout(() => tick(4, 'Transforms assigned'), 2200);
      setTimeout(() => {
        hideLoad();
        dispatch({ type: 'SET_FIELD', field: 'mapping', value: mapping });
        dispatch({ type: 'SET_FIELD', field: 'isMappingSaved', value: true });
        setAiOutput(`Hybrid Mapping Complete — ${mapping.length} fields mapped\n\nHigh confidence (≥80%): ${mapping.filter((m: any) => m.conf >= 80).map((m: any) => m.sap).join(', ')}\n\nTransforms assigned: ${mapping.filter((m: any) => m.tr && m.tr !== 'none').map((m: any) => m.sap + '=' + m.tr).join(', ')}`);
        toast(`Mapped ${mapping.length} fields · ${mapping.filter((m: any) => m.conf >= 80).length} high confidence`, 'ok');
      }, 2600);
    } catch (err: any) {
      hideLoad();
      toast(`AI mapping failed: ${err.message}`, 'err');
    }
  }

  function exportMap() {
    if (!state.mapping.length) return;
    const csv = 'Source Field,SAP Field,Label,Confidence,Transform,Required,Note\n' +
      state.mapping.map((m) => `${m.src},${m.sap},"${m.sapLabel || ''}",${m.conf},${m.tr},${m.req ? 'Yes' : 'No'},"${m.note || ''}"`).join('\n');
    dl(csv, 'field_mapping.csv', 'text/csv');
    toast('Mapping exported', 'ok');
  }

  function removeMapping(index: number) {
    const newMapping = [...state.mapping];
    newMapping.splice(index, 1);
    dispatch({ type: 'SET_FIELD', field: 'mapping', value: newMapping });
    dispatch({ type: 'SET_FIELD', field: 'isMappingSaved', value: false });
  }

  async function updateTransform(src: string, sap: string, tr: string) {
    const newMapping = state.mapping.map(m => m.src === src ? { ...m, tr } : m);
    dispatch({ type: 'SET_FIELD', field: 'mapping', value: newMapping });
    dispatch({ type: 'SET_FIELD', field: 'isMappingSaved', value: false });

    try {
      await correctMapping(state.src || 'SAP_ECC', src, sap, tr);
      toast('Correction saved to user profile', 'ok');
    } catch (err: any) {
      toast(`Failed to save correction: ${err.message}`, 'err');
    }
  }

  return (
    <PageLayout>
      <PageGrid>

        {/* Left Column */}
        <GridCol span={3} className="flex flex-col gap-4 h-[calc(100vh-40px)]">
          {/* Source Fields Card */}
          <Card className="flex flex-col flex-1 min-h-0">
            <CardHeader title={`Source Fields (${state.headers.length})`} subtitle={state.src} />
            <div className="px-3 pt-2">
              <input
                type="text"
                placeholder="Search source fields..."
                value={sourceSearch}
                onChange={(e) => setSourceSearch(e.target.value)}
                className="w-full rounded-md border border-[var(--border-light)] bg-[var(--bg-tertiary)] px-2.5 py-1.5 text-[10.5px] text-[var(--text-primary)] outline-none focus:border-primary-500 transition-colors"
              />
            </div>
            <CardBody className="p-3 space-y-2 flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[var(--border-light)] scrollbar-track-transparent">
              {state.headers.filter(f => f.toLowerCase().includes(sourceSearch.toLowerCase())).map((f, i) => {
                const mapItem = state.mapping.find((m) => m.src === f);
                const isReq = mapItem ? isFieldMandatory(mapItem.sap, mapItem.req) : false;
                return (
                  <div key={`${f}-${i}`} className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[var(--bg-tertiary)] text-[10px] font-mono text-[var(--text-secondary)]">
                    <span className="truncate pr-2">{f}</span>
                    {mapItem && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge variant="green" className="text-[8px]">mapped</Badge>
                        {isReq && (
                          <span className="text-[9px] font-bold text-red-500 uppercase tracking-wide">
                            req
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {state.headers.length === 0 && (
                <div className="text-[10px] text-[var(--text-tertiary)] text-center py-4">No source fields loaded.</div>
              )}
            </CardBody>
          </Card>

          {/* Target Fields Card */}
          <Card className="flex flex-col flex-1 min-h-0">
            <CardHeader title={`SF Target (${sapFields.length})`} subtitle={obj?.label || state.obj} />
            <div className="px-3 pt-2">
              <input
                type="text"
                placeholder="Search SF fields..."
                value={targetSearch}
                onChange={(e) => setTargetSearch(e.target.value)}
                className="w-full rounded-md border border-[var(--border-light)] bg-[var(--bg-tertiary)] px-2.5 py-1.5 text-[10.5px] text-[var(--text-primary)] outline-none focus:border-primary-500 transition-colors"
              />
            </div>
            <CardBody className="p-3 space-y-2 flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[var(--border-light)] scrollbar-track-transparent">
              {isLoadingSchema ? (
                <div className="px-2.5 py-1.5 rounded-lg text-[10px] text-[var(--text-tertiary)]">Loading schema from DB...</div>
              ) : sapFields.length === 0 ? (
                <div className="px-2.5 py-1.5 rounded-lg text-[10px] text-[var(--text-tertiary)]">No fields found for this object in DB.</div>
              ) : (
                sapFields.filter(f => (f.field_name && f.field_name.toLowerCase().includes(targetSearch.toLowerCase())) || (f.field_description && f.field_description.toLowerCase().includes(targetSearch.toLowerCase()))).map((f, i) => (
                  <div key={`${f.field_name}-${i}`} className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-tertiary)]/50 border border-[var(--border-light)]">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] text-teal-600 dark:text-teal-400">{f.field_name}</span>
                      {f.is_mandatory ? <Badge variant="red" className="text-[8px]">REQ</Badge> :
                        state.mapping.find((m) => m.sap === f.field_name) ? <Badge variant="green" className="text-[8px]">✓</Badge> : null}
                    </div>
                    <div className="text-[9.5px] text-[var(--text-tertiary)]">{f.field_description || f.sap_structure}</div>
                  </div>
                ))
              )}
            </CardBody>
          </Card>
        </GridCol>

        {/* Middle Column */}
        <GridCol span={9}>
          <PageHeader title="Step 2 — AI-Powered Field Mapping" subtitle="AI Engine semantically maps source fields to SuccessFactors fields with confidence scoring">
            <Button variant="secondary" icon={<ArrowLeft className="w-3.5 h-3.5" />} onClick={() => navigate('/')}>Back</Button>
            <div title={state.headers.length === 0 ? "You must load Source Fields in Step 1 before generating an AI Mapping." : ""}>
              <Button variant="cyan" icon={<Bot className="w-3.5 h-3.5" />} onClick={doAIMap} disabled={state.headers.length === 0}>Generate AI Mapping</Button>
            </div>
            <Button variant="secondary" icon={<Upload className="w-3.5 h-3.5" />} onClick={() => uploadInputRef.current?.click()}>
              Upload Mapping
            </Button>
            <input
              ref={uploadInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={handleUploadMapping}
            />
            <div title={!state.mapping.length ? "Generate an AI Mapping first before saving." : ""}>
              <Button variant="secondary" icon={<Save className="w-3.5 h-3.5" />} onClick={saveMappings} disabled={!state.mapping.length}>Save Mappings</Button>
            </div>
            <Button variant="secondary" icon={<Download className="w-3.5 h-3.5" />} onClick={loadMappings}>Load Mappings</Button>
            <div title={!state.isMappingSaved ? "You must save your mappings before extracting." : ""}>
              <Button variant="primary" icon={<ArrowRight className="w-3.5 h-3.5" />} onClick={() => navigate('/extract')} disabled={!state.isMappingSaved}>Next: Extract</Button>
            </div>
          </PageHeader>

          {validMappings.length > 0 && (
            <StatsGrid>
              <StatBox value={state.mapping.length} label="Total Mapped" color="var(--color-primary-500)" />
              <StatBox value={hi} label="High Conf ≥80%" color="var(--color-success)" />
              <StatBox value={needsReview} label="Needs Review <80%" color="var(--color-warning)" />
              {invalidTargetCount > 0 && (
                <StatBox value={invalidTargetCount} label="Invalid Target Fields" subtitle="Highlighted in red" color="var(--color-danger)" />
              )}
              <StatBox value={unmappedSource} label="Unmapped Source" color="var(--color-teal)" />
            </StatsGrid>
          )}

          <Card>
            <CardHeader title={`Field Mapping Table (${validMappings.length} Mappings)`} subtitle="AI-generated · edit transforms inline">
              {validMappings.length > 0 && (
                <div className="flex items-center gap-2 ml-auto">
                  <Button variant="secondary" size="sm" icon={<Download className="w-3 h-3" />} onClick={() => dl(expCSV(validMappings), 'mappings.csv', 'text/csv')}>Export</Button>
                  <div className="w-px h-4 bg-[var(--border)] mx-1" />
                  <Badge variant="green">≥80%</Badge>
                  <Badge variant="amber">60-79%</Badge>
                  <Badge variant="red">&lt;60%</Badge>
                </div>
              )}
            </CardHeader>
            <div className="px-3 pt-2">
              <input
                type="text"
                placeholder="Search mapped fields (Source or SF)..."
                value={mappingSearch}
                onChange={(e) => setMappingSearch(e.target.value)}
                className="w-full rounded-md border border-[var(--border-light)] bg-[var(--bg-tertiary)] px-2.5 py-1.5 text-[10.5px] text-[var(--text-primary)] outline-none focus:border-primary-500 transition-colors"
              />
            </div>
            <CardBody>
              {state.mapping.length > 0 ? (
                <>
                  {/* Header */}
                  <div className="grid grid-cols-[1fr_24px_1.2fr_65px_120px_70px] gap-2 px-2 pb-2 mb-2 border-b border-[var(--border)] font-mono text-[9px] uppercase tracking-wider text-[var(--text-tertiary)]">
                    <span>Source</span><span></span><span>SF Target Field</span><span>Conf</span><span>Transform</span><span className="text-right pr-2">Actions</span>
                  </div>
                  {/* Rows */}
                  <div className="space-y-1.5 max-h-[calc(100vh-250px)] overflow-y-auto scrollbar-thin scrollbar-thumb-[var(--border-light)] scrollbar-track-transparent pr-2">
                    {[...state.mapping]
                      .filter(m => (m.src && m.src.toLowerCase().includes(mappingSearch.toLowerCase())) || (m.sap && m.sap.toLowerCase().includes(mappingSearch.toLowerCase())) || (m.sapLabel && m.sapLabel.toLowerCase().includes(mappingSearch.toLowerCase())))
                      .sort((a, b) => {
                        const aValid = isTargetValid(a.sap);
                        const bValid = isTargetValid(b.sap);
                        if (!aValid && bValid) return -1;
                        if (aValid && !bValid) return 1;
                        if (a.req === b.req) return 0;
                        return a.req ? -1 : 1;
                      }).map((m, i) => {
                        const targetValid = isTargetValid(m.sap);
                        const c = m.conf || 0;
                        const cc = !targetValid ? '#ef4444' : c >= 80 ? '#10b981' : c >= 60 ? '#f59e0b' : '#ef4444';
                        const borderCls = !targetValid
                          ? 'border-red-500/90 dark:border-red-500/80 bg-red-50/80 dark:bg-red-950/40 shadow-xs shadow-red-500/10'
                          : c >= 80
                            ? 'border-emerald-200 dark:border-emerald-800/30'
                            : c >= 60
                              ? 'border-amber-200 dark:border-amber-800/30'
                              : 'border-red-200 dark:border-red-800/30';
                        return (
                          <div key={i} className={cn('grid grid-cols-[1fr_24px_1.2fr_65px_120px_70px] gap-2 items-center px-3 py-2 rounded-xl border bg-[var(--bg-tertiary)]/30 group transition-all', borderCls)}>
                            <div className="min-w-0">
                              {editingMapSrc?.index === state.mapping.indexOf(m) ? (
                                <input
                                  type="text"
                                  autoFocus
                                  value={editingMapSrc.value}
                                  onChange={e => setEditingMapSrc({ ...editingMapSrc, value: e.target.value })}
                                  onBlur={() => handleSaveMapSrcEdit(state.mapping.indexOf(m), m.src)}
                                  onKeyDown={e => { if (e.key === 'Enter') handleSaveMapSrcEdit(state.mapping.indexOf(m), m.src); if (e.key === 'Escape') setEditingMapSrc(null); }}
                                  className="bg-[var(--bg)] border border-primary-500 rounded px-1 py-0.5 outline-none w-full text-[11px] font-mono text-[var(--text-primary)]"
                                />
                              ) : (
                                <div className="flex items-center min-w-0">
                                  <div className="font-mono text-[11px] text-primary-600 dark:text-primary-400 truncate">{m.src || <i className="text-[var(--text-tertiary)]">—</i>}</div>
                                  <button onClick={() => setEditingMapSrc({ index: state.mapping.indexOf(m), value: m.src })} className="opacity-0 group-hover:opacity-100 ml-1 p-1 shrink-0 text-[var(--text-tertiary)] hover:text-primary-500 transition-opacity">
                                    <Edit3 className="w-3 h-3" />
                                  </button>
                                </div>
                              )}
                              <div className="text-[9.5px] text-[var(--text-tertiary)] truncate">{m.srcType || 'source'}</div>
                            </div>
                            <div className="text-center text-[var(--text-tertiary)]">→</div>
                            <div className="min-w-0">
                              <div className={cn("font-mono text-[11px] flex items-center gap-1.5 flex-wrap", !targetValid ? "text-red-600 dark:text-red-400 font-bold" : "text-teal-600 dark:text-teal-400")}>
                                <span className="truncate">{m.sap || <i className="text-red-500 font-bold">(Target Field Missing)</i>}</span>
                                {isFieldMandatory(m.sap, m.req) && <Badge variant="red" className="text-[8px] px-1 font-bold">REQ</Badge>}
                                {!targetValid && (
                                  <Badge variant="red" className="text-[8px] px-1.5 py-0.2 font-bold flex items-center gap-0.5 shrink-0">
                                    <AlertTriangle className="w-2.5 h-2.5" /> Not in Schema
                                  </Badge>
                                )}
                              </div>
                              <div className={cn("text-[9.5px] truncate", !targetValid ? "text-red-500 font-semibold" : "text-[var(--text-tertiary)]")}>
                                {!targetValid ? "Target field not in SF schema. Click Edit to assign." : m.sapLabel}
                              </div>
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5">
                                <div className="flex-1 h-1 rounded-full bg-[var(--border)] overflow-hidden">
                                  <div className="h-full rounded-full" style={{ width: `${!targetValid ? 100 : c}%`, background: cc }} />
                                </div>
                                <span className="font-mono text-[10px] font-bold" style={{ color: cc }}>
                                  {!targetValid ? 'ERR' : `${c}%`}
                                </span>
                              </div>
                            </div>
                            <Select
                              size="sm"
                              value={m.tr || 'none'}
                              onChange={(val) => updateTransform(m.src, m.sap, val)}
                              className="w-[110px]"
                              options={Object.entries(TRANSFORMS).map(([k, v]) => ({ value: k, label: v.label }))}
                            />
                            <div className="flex items-center gap-1 justify-end">
                              <button
                                onClick={() => setEditingMapping({
                                  index: state.mapping.indexOf(m),
                                  src: m.src || '',
                                  sap: m.sap || '',
                                  tr: m.tr || 'trim',
                                  note: m.note || ''
                                })}
                                className="w-7 h-7 flex items-center justify-center rounded-lg border border-[var(--border)] hover:border-primary-400 text-[var(--text-secondary)] hover:text-primary-500 hover:bg-[var(--bg-tertiary)] transition-colors cursor-pointer shrink-0"
                                title="Edit Mapping"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => removeMapping(state.mapping.indexOf(m))}
                                className="w-7 h-7 flex items-center justify-center rounded-lg border border-[var(--border)] hover:border-red-300 text-[var(--text-tertiary)] hover:text-red-500 hover:bg-red-50/50 dark:hover:bg-red-950/30 transition-colors cursor-pointer shrink-0"
                                title="Remove Mapping"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}

                    {stagedMaps.map((staged, idx) => (
                      <div key={idx} className="grid grid-cols-[1fr_24px_1.2fr_65px_120px_70px] gap-2 items-center px-3 py-2 rounded-xl border border-primary-500 bg-[var(--bg-tertiary)]/50 mb-2">
                        <Select
                          size="sm"
                          searchable
                          value={staged.src}
                          onChange={(v) => {
                            const updated = [...stagedMaps];
                            updated[idx].src = v;
                            setStagedMaps(updated);
                          }}
                          options={[{ value: '', label: 'Select Source...' }, ...unmappedSourceList.map(s => ({ value: s, label: s }))]}
                        />
                        <div className="text-center text-[var(--text-tertiary)]">→</div>
                        <Select
                          size="sm"
                          searchable
                          value={staged.sap}
                          onChange={(v) => {
                            const updated = [...stagedMaps];
                            updated[idx].sap = v;
                            setStagedMaps(updated);
                          }}
                          options={[{ value: '', label: 'Select Target...' }, ...unmappedSapList.map(s => ({ value: s.field_name, label: s.field_name }))]}
                        />
                        <div className="text-center font-mono text-[10px] text-emerald-500">100%</div>
                        <div className="text-center text-[10px] text-[var(--text-tertiary)]">none</div>
                        <div className="flex items-center gap-1 justify-end">
                          <button onClick={() => {
                            const updated = [...stagedMaps];
                            updated.splice(idx, 1);
                            setStagedMaps(updated);
                          }} className="w-7 h-7 flex items-center justify-center text-red-500 hover:text-red-400 transition-colors"><X className="w-4 h-4" /></button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex justify-center gap-3 mt-3 pb-2">
                    <Button variant="secondary" size="sm" onClick={() => setStagedMaps([...stagedMaps, { src: '', sap: '' }])}>+ Add Row</Button>
                    {stagedMaps.length > 0 && (
                      <Button variant="primary" size="sm" icon={<CheckCircle2 className="w-3.5 h-3.5" />} onClick={() => {
                        // Validate all rows
                        const validRows = stagedMaps.filter(m => m.src && m.sap);
                        if (validRows.length !== stagedMaps.length) {
                          toast('Some rows are missing a source or target. Please complete or remove them.', 'err');
                          return;
                        }

                        const newEntries = validRows.map(m => {
                          const f = sapFields.find(x => x.field_name === m.sap);
                          return {
                            src: m.src,
                            sap: m.sap,
                            conf: 100,
                            tr: 'none',
                            req: f?.is_mandatory,
                            sapLabel: f?.field_description,
                            note: 'Manual'
                          };
                        });

                        dispatch({ type: 'SET_FIELD', field: 'mapping', value: [...state.mapping, ...newEntries] });
                        setStagedMaps([]);
                        dispatch({ type: 'SET_FIELD', field: 'isMappingSaved', value: false });
                      }}>Add {stagedMaps.length} to Table</Button>
                    )}
                  </div>
                </>
              ) : (
                <EmptyState icon={<Bot className="w-10 h-10" />} message={`Click Generate AI Mapping — The AI Engine will semantically match your ${state.headers.length} source fields to SF ${obj?.label || 'Biographical Info'} field definitions`} />
              )}
            </CardBody>
          </Card>

          {aiOutput && (
            <Card>
              <CardHeader icon={<Bot className="w-4 h-4" />} title="AI Analysis Output" />
              <CardBody><AIResponse>{aiOutput}</AIResponse></CardBody>
            </Card>
          )}
        </GridCol>

      </PageGrid>

      {/* Edit Mapping Modal */}
      {editingMapping && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
              <div>
                <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                  <Edit3 className="w-4 h-4 text-primary-500" />
                  Edit Field Mapping
                </h3>
                <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                  Update source and target SuccessFactors schema assignment
                </p>
              </div>
              <button
                onClick={() => setEditingMapping(null)}
                className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              {/* Source Field */}
              <div>
                <label className="block text-[10.5px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider mb-1.5">
                  Source Field Name
                </label>
                <div className="space-y-1.5">
                  <Select
                    size="sm"
                    searchable
                    value={state.headers.includes(editingMapping.src) ? editingMapping.src : ''}
                    onChange={(v) => { if (v) setEditingMapping({ ...editingMapping, src: v }); }}
                    options={[
                      { value: '', label: 'Select from available source headers...' },
                      ...state.headers.map(h => ({ value: h, label: h }))
                    ]}
                  />
                  <input
                    type="text"
                    value={editingMapping.src}
                    onChange={(e) => setEditingMapping({ ...editingMapping, src: e.target.value })}
                    placeholder="Or type custom source field name..."
                    className="w-full text-[11px] font-mono rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-[var(--text-primary)] outline-none focus:border-primary-500 transition-colors"
                  />
                </div>
              </div>

              {/* Target SF Field */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[10.5px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider">
                    SuccessFactors Target Field
                  </label>
                  {isTargetValid(editingMapping.sap) ? (
                    <Badge variant="green" className="text-[9px] font-bold flex items-center gap-1">
                      <Check className="w-2.5 h-2.5" /> Target in Schema
                    </Badge>
                  ) : (
                    <Badge variant="red" className="text-[9px] font-bold flex items-center gap-1">
                      <AlertTriangle className="w-2.5 h-2.5" /> Not in Schema
                    </Badge>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Select
                    size="sm"
                    searchable
                    value={editingMapping.sap}
                    onChange={(v) => setEditingMapping({ ...editingMapping, sap: v })}
                    options={[
                      { value: '', label: 'Select valid target schema field...' },
                      ...sapFields.map(f => ({
                        value: f.field_name,
                        label: `${f.field_name} ${f.field_description ? `(${f.field_description})` : ''} ${f.is_mandatory ? '[REQ]' : ''}`
                      }))
                    ]}
                  />
                  <input
                    type="text"
                    value={editingMapping.sap}
                    onChange={(e) => setEditingMapping({ ...editingMapping, sap: e.target.value })}
                    placeholder="Or type target field name (e.g. PerPerson.personIdExternal)..."
                    className={cn(
                      "w-full text-[11px] font-mono rounded-lg border px-3 py-2 text-[var(--text-primary)] outline-none transition-colors",
                      isTargetValid(editingMapping.sap)
                        ? "border-[var(--border)] bg-[var(--bg-primary)] focus:border-primary-500"
                        : "border-red-500 bg-red-50/20 dark:bg-red-950/20 focus:border-red-500 text-red-600 dark:text-red-400"
                    )}
                  />
                  {!isTargetValid(editingMapping.sap) && (
                    <p className="text-[10px] text-red-500 font-sans">
                      ⚠️ This field does not match any field in the target schema. Select from the dropdown above to resolve.
                    </p>
                  )}
                </div>
              </div>

              {/* Transform Rule */}
              <div>
                <label className="block text-[10.5px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider mb-1.5">
                  Transformation Rule
                </label>
                <Select
                  size="sm"
                  value={editingMapping.tr || 'none'}
                  onChange={(v) => setEditingMapping({ ...editingMapping, tr: v })}
                  options={Object.entries(TRANSFORMS).map(([k, v]) => ({ value: k, label: `${v.label} (${k})` }))}
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-[10.5px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider mb-1.5">
                  Mapping Notes / Description
                </label>
                <input
                  type="text"
                  value={editingMapping.note || ''}
                  onChange={(e) => setEditingMapping({ ...editingMapping, note: e.target.value })}
                  placeholder="Optional notes or documentation..."
                  className="w-full text-[11px] rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-[var(--text-primary)] outline-none focus:border-primary-500 transition-colors"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 p-4 border-t border-[var(--border)] bg-[var(--bg-tertiary)]/40">
              <Button variant="secondary" size="sm" onClick={() => setEditingMapping(null)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" icon={<Check className="w-3.5 h-3.5" />} onClick={handleSaveMappingEdit}>
                Save Changes
              </Button>
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  );
}
