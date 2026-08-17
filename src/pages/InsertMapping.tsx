import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/components/ui/toast';
import { useLoading } from '@/components/ui/loading-overlay';
import { PageLayout, PageGrid, GridCol, Card, CardHeader, CardBody, Button, PageHeader, Select } from '@/components/shared';
import { ArrowLeft, Save, Plus, Trash2, Database } from 'lucide-react';

export function InsertMapping() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { showLoad, hideLoad } = useLoading();

  const [systems, setSystems] = useState<any[]>([]);
  const [objects, setObjects] = useState<any[]>([]);
  const [sapFields, setSapFields] = useState<any[]>([]);

  const [selectedSystem, setSelectedSystem] = useState<string>('');
  const [selectedObject, setSelectedObject] = useState<string>('');
  const [objectName, setObjectName] = useState<string>('');

  const [rows, setRows] = useState<{ id: string, sap_field_id: string, oracle_ebs_table: string, oracle_ebs_field_name: string }[]>([
    { id: crypto.randomUUID(), sap_field_id: '', oracle_ebs_table: '', oracle_ebs_field_name: '' }
  ]);

  useEffect(() => {
    async function loadMasterData() {
      try {
        const sysRes = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/systems`);
        const sysData = await sysRes.json();
        setSystems(sysData.systems || []);

        const objRes = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/objects`);
        const objData = await objRes.json();
        setObjects(objData.objects || []);
      } catch (err) {
        toast('Failed to load master data', 'err');
      }
    }
    loadMasterData();
  }, []);

  useEffect(() => {
    if (!selectedObject) {
      setSapFields([]);
      return;
    }
    
    const obj = objects.find(o => o.id === selectedObject);
    if (obj) {
      setObjectName(obj.name);
      fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/schema?object_name=${obj.name}`)
        .then(res => res.json())
        .then(data => {
          setSapFields(data.fields || []);
        })
        .catch(() => toast('Failed to load SAP fields', 'err'));
    }
  }, [selectedObject, objects]);

  const addRow = () => {
    setRows([...rows, { id: crypto.randomUUID(), sap_field_id: '', oracle_ebs_table: '', oracle_ebs_field_name: '' }]);
  };

  const removeRow = (id: string) => {
    setRows(rows.filter(r => r.id !== id));
  };

  const updateRow = (id: string, field: string, value: string) => {
    setRows(rows.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const saveMappings = async () => {
    if (!selectedSystem || !selectedObject) {
      toast('Please select a Source System and SAP Object', 'err');
      return;
    }

    const validRows = rows.filter(r => r.sap_field_id && r.oracle_ebs_field_name);
    if (validRows.length === 0) {
      toast('Please complete at least one row with SAP Field and Oracle Field Name', 'err');
      return;
    }

    showLoad('Saving Source Fields...', 'Inserting into database');
    try {
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/source_fields`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceSystemId: selectedSystem,
          objectId: selectedObject,
          fields: validRows
        })
      });

      if (!res.ok) throw new Error('Failed to save');
      const data = await res.json();
      hideLoad();
      toast(`Successfully inserted ${data.inserted} field mappings!`, 'ok');
      
      // Reset form
      setRows([{ id: crypto.randomUUID(), sap_field_id: '', oracle_ebs_table: '', oracle_ebs_field_name: '' }]);
    } catch (err: any) {
      hideLoad();
      toast(err.message, 'err');
    }
  };

  return (
    <PageLayout>
      <PageGrid>
        <GridCol span={12}>
          <PageHeader title="Source Field Data Dictionary Entry" subtitle="Directly insert custom Oracle EBS to SuccessFactors mappings into the database">
            <Button variant="secondary" icon={<ArrowLeft className="w-3.5 h-3.5" />} onClick={() => navigate('/')}>Back</Button>
            <Button variant="primary" icon={<Save className="w-3.5 h-3.5" />} onClick={saveMappings}>Save to Database</Button>
          </PageHeader>

          <Card className="mb-6 overflow-visible z-20">
            <CardHeader title="1. Select Context" subtitle="Choose the source system and target SF object" />
            <CardBody className="p-4 grid grid-cols-2 gap-6 overflow-visible">
              <div>
                <label className="block text-[11px] font-bold text-[var(--text-secondary)] mb-1.5 uppercase tracking-wider">Source System</label>
                <Select
                  value={selectedSystem}
                  onChange={setSelectedSystem}
                  options={[{ value: '', label: 'Select Source System...' }, ...systems.map(s => ({ value: s.id, label: s.name }))]}
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-[var(--text-secondary)] mb-1.5 uppercase tracking-wider">Target SF Object</label>
                <Select
                  value={selectedObject}
                  onChange={setSelectedObject}
                  options={[{ value: '', label: 'Select Target Object...' }, ...objects.map(o => ({ value: o.id, label: o.name }))]}
                  className="w-full"
                  disabled={!selectedSystem}
                />
              </div>
            </CardBody>
          </Card>

          <Card className="overflow-visible z-10">
            <CardHeader title="2. Map Fields" subtitle="Add mapping rows" />
            <CardBody className="p-4 overflow-visible">
              {/* Header Row */}
              <div className="grid grid-cols-[1fr_1fr_1fr_40px] gap-4 px-2 pb-2 mb-3 border-b border-[var(--border)] font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
                <span>SF Target Field</span>
                <span>Oracle Table</span>
                <span>Oracle Field Name</span>
                <span></span>
              </div>

              {/* Dynamic Rows */}
              <div className="space-y-3">
                {rows.map((row, i) => (
                  <div key={row.id} className="grid grid-cols-[1fr_1fr_1fr_40px] gap-4 items-center bg-[var(--bg-tertiary)] p-2 rounded-xl border border-[var(--border-light)]">
                    <Select
                      value={row.sap_field_id}
                      onChange={(v) => updateRow(row.id, 'sap_field_id', v)}
                      options={[{ value: '', label: 'Select SF Field...' }, ...sapFields.map(f => ({ value: f.id, label: `${f.sf_structure || f.sap_structure || ''}.${f.field_name} - ${f.field_description || ''}` }))]}
                      disabled={!selectedObject}
                      searchable
                    />
                    
                    <input
                      type="text"
                      placeholder="e.g. HZ_CUST_ACCOUNTS"
                      value={row.oracle_ebs_table}
                      onChange={(e) => updateRow(row.id, 'oracle_ebs_table', e.target.value)}
                      className="w-full rounded-md border border-[var(--border-light)] bg-[var(--bg)] px-3 py-2 text-[12px] text-[var(--text-primary)] outline-none focus:border-primary-500 transition-colors"
                    />

                    <input
                      type="text"
                      placeholder="e.g. ACCOUNT_NUMBER"
                      value={row.oracle_ebs_field_name}
                      onChange={(e) => updateRow(row.id, 'oracle_ebs_field_name', e.target.value)}
                      className="w-full rounded-md border border-[var(--border-light)] bg-[var(--bg)] px-3 py-2 text-[12px] text-[var(--text-primary)] outline-none focus:border-primary-500 transition-colors"
                    />

                    <button
                      onClick={() => removeRow(row.id)}
                      disabled={rows.length === 1}
                      className="w-8 h-8 flex items-center justify-center rounded-lg border border-[var(--border)] hover:border-red-300 text-[var(--text-tertiary)] hover:text-red-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-4 pt-4 border-t border-[var(--border)]">
                <Button variant="secondary" icon={<Plus className="w-4 h-4" />} onClick={addRow}>Add Row</Button>
              </div>
            </CardBody>
          </Card>
        </GridCol>
      </PageGrid>
    </PageLayout>
  );
}
