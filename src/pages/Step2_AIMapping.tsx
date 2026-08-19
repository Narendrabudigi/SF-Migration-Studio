import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMigration } from '@/store/migration-store';
import { useToast } from '@/components/ui/toast';
import { useLoading } from '@/components/ui/loading-overlay';
import { OBJS } from '@/data/sap-schemas';
import { TRANSFORMS } from '@/data/lookup-maps';
import { generateMapping, correctMapping, getSAPSchema } from '@/services/ai-service';
import { dl, expCSV } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { PageLayout, PageGrid, GridCol, Card, CardHeader, CardBody, Button, Badge, StatBox, StatsGrid, PageHeader, Divider, EmptyState, AIResponse, Select } from '@/components/shared';
import { ArrowRight, Download, Bot, ArrowLeft, RefreshCw, Edit3, Save, X, CheckCircle2 } from 'lucide-react';
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
  const [editingMapSrc, setEditingMapSrc] = useState<{ index: number, value: string } | null>(null);
  const [stagedMaps, setStagedMaps] = useState<{ src: string, sap: string }[]>([]);


  const [sapFields, setSapFields] = useState<any[]>([]);
  const [isLoadingSchema, setIsLoadingSchema] = useState(true);

  React.useEffect(() => {
    async function fetchSchema() {
      setIsLoadingSchema(true);
      const targetObj = state.obj || 'Biographical Info';
      let fields: any[] = [];

      try {
        const res = await getSAPSchema(targetObj);
        if (res && res.fields && res.fields.length > 0) {
          fields = res.fields.map((f: any) => ({
            ...f,
            field_name: f.sf_structure ? `${f.sf_structure}.${f.field_name}` : (f.sap_structure ? `${f.sap_structure}.${f.field_name}` : f.field_name)
          }));
        }
      } catch (err) {
        console.warn('Backend schema fetch failed, using frontend schema:', err);
      }

      // Fallback to OBJS schema if DB returned no fields
      if (fields.length === 0 && OBJS[targetObj]) {
        fields = OBJS[targetObj].fields.map((f) => ({
          field_name: `${OBJS[targetObj].tcode}.${f.n}`,
          field_description: f.d,
          is_mandatory: f.req,
          sf_structure: OBJS[targetObj].tcode,
          data_type: f.t,
          field_length: f.len,
        }));
      }

      setSapFields(fields);

      // Auto-populate Source Fields based on Source System
      if (state.src === 'SAP_ECC') {
        if (!state.connUrl || !state.connUser || !state.connPass) {
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
              target_object: targetObj
            })
          });
          if (schemaRes.ok) {
            const schemaData = await schemaRes.json();
            dispatch({ type: 'SET_FIELD', field: 'headers', value: schemaData.fields || [] });
          }
        } catch (err) {
          // ignore
        }
      }
      setIsLoadingSchema(false);
    }
    fetchSchema();
  }, [state.obj, state.src]);

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
      const objName = state.obj || 'Biographical Info';
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
      const objName = state.obj || 'Biographical Info';
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

      // Filter loaded mappings so only source fields present in the uploaded Excel data are retained
      const validLoadedMappings = enrichedMappings.filter((m: any) => {
        if (!m.src) return false;
        if (state.headers.length === 0) return true;
        const cleanSrc = m.src.replace(/^\[\d+\]\s*/, '').trim();
        return state.headers.some(h => h === m.src || h.replace(/^\[\d+\]\s*/, '').trim() === cleanSrc);
      });

      dispatch({ type: 'SET_FIELD', field: 'mapping', value: validLoadedMappings });
      dispatch({ type: 'SET_FIELD', field: 'isMappingSaved', value: true });

      toast(`Loaded ${enrichedMappings.length} mappings from history!`, 'ok');
    } catch (err: any) {
      hideLoad();
      toast(err.message, 'err');
    }
  };

  const effectiveHeaders = React.useMemo(() => {
    if (state.uploadedData && state.uploadedData.length > 0) {
      return Object.keys(state.uploadedData[0]);
    }
    return state.headers || [];
  }, [state.uploadedData, state.headers]);

  const obj = OBJS[state.obj];
  const validMappings = state.mapping.filter(m => m.sap && m.sap.trim() !== "");
  const hi = validMappings.filter((m) => m.conf >= 80).length;
  const needsReview = validMappings.length - hi;

  const mappedSources = state.mapping.map(m => m.src);
  const mappedSaps = state.mapping.map(m => m.sap);
  const unmappedSourceList = effectiveHeaders.filter(h => !mappedSources.includes(h));
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
    OBJS[state.obj].fields.forEach((f) => {
      const syns = sem[f.n] || [f.n];
      let best: string | null = null, bs = 0;
      effectiveHeaders.forEach((h) => {
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
      `Fetching SF Target Schema from Database…`,
      `Applying Known Source Matches…`,
      `Checking LLM Cache & User Overrides…`,
      `Generating missing mappings via AI…`,
    ]);
    setTimeout(() => tick(0, 'Backend connected'), 400);
    setTimeout(() => tick(1, 'SF target schema fetched'), 900);
    setTimeout(() => tick(2, 'Known source matches applied'), 1300);
    setTimeout(() => tick(3, 'Cache & Overrides applied'), 1600);
    try {
      const objName = state.obj || 'Biographical Info';
      const data = await generateMapping(state.src, objName, effectiveHeaders);
      const mapping = data.mappings || [];

      // Retain exact source fields uploaded from Step 1 without injecting un-uploaded fields

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
      await correctMapping(state.src, src, sap, tr);
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
            <CardHeader title={`Source Fields (${effectiveHeaders.length})`} subtitle={state.src} />
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
              {effectiveHeaders.filter(f => f.toLowerCase().includes(sourceSearch.toLowerCase())).map((f, i) => (
                <div key={`${f}-${i}`} className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[var(--bg-tertiary)] text-[10px] font-mono text-[var(--text-secondary)]">
                  <span>{f}</span>
                  {state.mapping.find((m) => m.src === f) && <Badge variant="green" className="text-[8px]">mapped</Badge>}
                </div>
              ))}
              {effectiveHeaders.length === 0 && (
                <div className="text-[10px] text-[var(--text-tertiary)] text-center py-4">No source fields loaded.</div>
              )}
            </CardBody>
          </Card>

          {/* Target Fields Card */}
          <Card className="flex flex-col flex-1 min-h-0">
            <CardHeader title={`SF Target (${sapFields.length})`} subtitle={obj?.label || state.obj || 'Biographical Info'} />
            <div className="px-3 pt-2">
              <input
                type="text"
                placeholder="Search SF target fields..."
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
                sapFields.filter(f => f.field_name.toLowerCase().includes(targetSearch.toLowerCase()) || (f.field_description && f.field_description.toLowerCase().includes(targetSearch.toLowerCase()))).map((f, i) => (
                  <div key={`${f.field_name}-${i}`} className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-tertiary)]/50 border border-[var(--border-light)]">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] text-teal-600 dark:text-teal-400">{f.field_name}</span>
                      {f.is_mandatory ? <Badge variant="red" className="text-[8px]">REQ</Badge> :
                        state.mapping.find((m) => m.sap === f.field_name) ? <Badge variant="green" className="text-[8px]">✓</Badge> : null}
                    </div>
                    <div className="text-[9.5px] text-[var(--text-tertiary)]">{f.field_description || f.sf_structure || f.sap_structure}</div>
                  </div>
                ))
              )}
            </CardBody>
          </Card>
        </GridCol>

        {/* Middle Column */}
        <GridCol span={9}>
          <PageHeader title="Step 2 — AI-Powered Field Mapping" subtitle="AI Engine semantically maps source fields to SuccessFactors (SF) target fields with confidence scoring">
            <Button variant="secondary" icon={<ArrowLeft className="w-3.5 h-3.5" />} onClick={() => navigate('/')}>Back</Button>
            <div title={state.headers.length === 0 ? "You must load Source Fields in Step 1 before generating an AI Mapping." : ""}>
              <Button variant="cyan" icon={<Bot className="w-3.5 h-3.5" />} onClick={doAIMap} disabled={state.headers.length === 0}>Generate AI Mapping</Button>
            </div>
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
              <StatBox value={validMappings.length} label="Fields Mapped" color="var(--color-primary-500)" />
              <StatBox value={hi} label="High Conf ≥80%" color="var(--color-success)" />
              <StatBox value={needsReview} label="Needs Review <80%" color="var(--color-warning)" />
              <StatBox value={unmappedSource} label="Unmapped Source" color="var(--color-danger)" />
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
                  <div className="grid grid-cols-[1fr_30px_1fr_70px_140px_28px] gap-2 px-2 pb-2 mb-2 border-b border-[var(--border)] font-mono text-[9px] uppercase tracking-wider text-[var(--text-tertiary)]">
                    <span>Source</span><span></span><span>SF Field</span><span>Conf</span><span>Transform</span><span></span>
                  </div>
                  {/* Rows */}
                  <div className="space-y-1.5 max-h-[calc(100vh-250px)] overflow-y-auto scrollbar-thin scrollbar-thumb-[var(--border-light)] scrollbar-track-transparent pr-2">
                    {[...state.mapping]
                      .filter(m => (m.src && m.src.toLowerCase().includes(mappingSearch.toLowerCase())) || (m.sap && m.sap.toLowerCase().includes(mappingSearch.toLowerCase())) || (m.sapLabel && m.sapLabel.toLowerCase().includes(mappingSearch.toLowerCase())))
                      .sort((a, b) => {
                        if (a.req === b.req) return 0;
                        return a.req ? -1 : 1;
                      }).map((m, i) => {
                        const c = m.conf || 0;
                        const cc = c >= 80 ? '#10b981' : c >= 60 ? '#f59e0b' : '#ef4444'; // emerald-500, amber-500, red-500
                        const borderCls = c >= 80 ? 'border-emerald-200 dark:border-emerald-800/30' : c >= 60 ? 'border-amber-200 dark:border-amber-800/30' : 'border-red-200 dark:border-red-800/30';
                        return (
                          <div key={i} className={cn('grid grid-cols-[1fr_30px_1fr_70px_140px_28px] gap-2 items-center px-3 py-2 rounded-xl border bg-[var(--bg-tertiary)]/30 group', borderCls)}>
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
                            <div>
                              <div className="font-mono text-[11px] text-teal-600 dark:text-teal-400 flex items-center gap-1.5">
                                {m.sap}
                                {m.req && <Badge variant="red" className="text-[8px] px-1 font-bold">M</Badge>}
                              </div>
                              <div className="text-[9.5px] text-[var(--text-tertiary)]">{m.sapLabel}</div>
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5">
                                <div className="flex-1 h-1 rounded-full bg-[var(--border)] overflow-hidden">
                                  <div className="h-full rounded-full" style={{ width: `${c}%`, background: cc }} />
                                </div>
                                <span className="font-mono text-[10px] font-bold" style={{ color: cc }}>{c}%</span>
                              </div>
                            </div>
                            <Select
                              size="sm"
                              value={m.tr || 'none'}
                              onChange={(val) => updateTransform(m.src, m.sap, val)}
                              className="w-[110px]"
                              options={Object.entries(TRANSFORMS).map(([k, v]) => ({ value: k, label: v.label }))}
                            />
                            <button
                              onClick={() => removeMapping(i)}
                              className="w-6 h-6 flex items-center justify-center rounded-lg border border-[var(--border)] hover:border-red-300 text-[var(--text-tertiary)] hover:text-red-500 transition-colors cursor-pointer"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        );
                      })}

                    {stagedMaps.map((staged, idx) => (
                      <div key={idx} className="grid grid-cols-[1fr_30px_1fr_70px_140px_28px] gap-2 items-center px-3 py-2 rounded-xl border border-primary-500 bg-[var(--bg-tertiary)]/50 mb-2">
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
                        <div className="flex items-center gap-1 justify-center">
                          <button onClick={() => {
                            const updated = [...stagedMaps];
                            updated.splice(idx, 1);
                            setStagedMaps(updated);
                          }} className="text-red-500 hover:text-red-400 transition-colors"><X className="w-4 h-4" /></button>
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
                <EmptyState icon={<Bot className="w-10 h-10" />} message={`Click Generate AI Mapping — The AI Engine will semantically match your ${state.headers.length} source fields to SuccessFactors ${obj?.label || state.obj} field definitions`} />
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
    </PageLayout>
  );
}
