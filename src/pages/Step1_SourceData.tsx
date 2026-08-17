import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMigration } from '@/store/migration-store';
import { useToast } from '@/components/ui/toast';
import { useLoading } from '@/components/ui/loading-overlay';
import { SAMPLE } from '@/data/sample-data';
import { OBJS } from '@/data/sap-schemas';
import {
  Card, CardHeader, CardBody, Button, InfoBox, Badge, DataTable,
  PageLayout, PageGrid, GridCol, PageHeader, Divider, SidebarItem, Select, ConfirmModal
} from '@/components/shared';
import { Zap, ArrowRight, Link2, Database, LayoutTemplate, FileSpreadsheet, Layers, Cloud, HardDrive, Users, Building2, Package, Cable, Settings2, Download, FolderGit2, Plus, Edit3, Save, Trash2 } from 'lucide-react';

const objIcons = {
  users: <Users className="w-4 h-4 text-blue-500" />,
  building: <Building2 className="w-4 h-4 text-violet-500" />,
  package: <Package className="w-4 h-4 text-emerald-500" />
};

const SOURCES = [
  { key: 'EXCEL_CSV', icon: <FileSpreadsheet className="w-4 h-4 text-emerald-500" />, name: 'Excel / CSV File', sub: 'Flat file upload (.xlsx, .csv)' },
];

const DATASETS = [
  { title: 'Excel / CSV Data Source', desc: 'Flat file data source containing employee migration records for SuccessFactors', srcKey: 'EXCEL_CSV', objKey: 'Biographical Info' },
];

export function Step1SourceData() {
  const { state, dispatch } = useMigration();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { showLoad, hideLoad, tick } = useLoading();
  const [projects, setProjects] = useState<any[]>([]);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editProjectName, setEditProjectName] = useState('');
  const [editProjectDesc, setEditProjectDesc] = useState('');

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Connection State
  const [isTestingConn, setIsTestingConn] = useState(false);
  const [isFetchingSample, setIsFetchingSample] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/projects/list`);
      if (res.ok) {
        const data = await res.json();
        setProjects(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;
    setIsCreating(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/projects/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newProjectName, description: newProjectDesc })
      });
      if (res.ok) {
        const proj = await res.json();
        setProjects([proj, ...projects]);
        dispatch({ type: 'BATCH_UPDATE', updates: { projectId: proj.id, projectName: proj.name } });
        setNewProjectName('');
        setNewProjectDesc('');
        toast('Project created successfully', 'ok');
      } else {
        toast('Failed to create project', 'err');
      }
    } catch (err: any) {
      toast(err.message, 'err');
    } finally {
      setIsFetchingSample(false);
      // hideLoad();
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    showLoad('Uploading File...', `Parsing ${file.name}`, ['Reading columns...']);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/extract/upload`, {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || 'Failed to upload file');
      }

      const data = await res.json();
      dispatch({ type: 'SET_FIELD', field: 'headers', value: data.headers });
      dispatch({ type: 'SET_FIELD', field: 'uploadedData', value: data.data });
      toast(`Successfully loaded ${data.headers.length} columns and ${data.data.length} rows!`, 'ok');
    } catch (err: any) {
      toast(err.message, 'err');
    } finally {
      setIsUploading(false);
      hideLoad();
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleLoadOracle = async () => {
    setIsUploading(true);
    showLoad('Loading Oracle Extract...', 'Parsing Oracle.xlsx', ['Reading columns...']);
    try {
      const response = await fetch('/Oracle.xlsx');
      if (!response.ok) throw new Error('Failed to fetch Oracle.xlsx from public folder');

      const blob = await response.blob();
      const file = new File([blob], 'Oracle.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/extract/upload`, {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || 'Failed to upload file');
      }

      const data = await res.json();
      dispatch({ type: 'SET_FIELD', field: 'headers', value: data.headers });
      dispatch({ type: 'SET_FIELD', field: 'uploadedData', value: data.data });
      toast(`Successfully loaded ${data.headers.length} columns and ${data.data.length} rows from Oracle.xlsx!`, 'ok');
    } catch (err: any) {
      toast(err.message, 'err');
    } finally {
      setIsUploading(false);
      hideLoad();
    }
  };

  const handleUpdateProject = async () => {
    if (!state.projectId || !editProjectName.trim()) return;
    try {
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/projects/update/${state.projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editProjectName, description: editProjectDesc })
      });
      if (res.ok) {
        const proj = await res.json();
        setProjects(projects.map(p => p.id === proj.id ? proj : p));
        dispatch({ type: 'BATCH_UPDATE', updates: { projectName: proj.name } });
        toast('Project updated successfully', 'ok');
        setIsEditing(false);
      } else {
        const err = await res.json();
        toast(err.detail || 'Failed to update project', 'err');
      }
    } catch (err) {
      toast('Failed to update project', 'err');
    }
  };

  const startEditing = () => {
    const p = projects.find(p => p.id === state.projectId);
    if (p) {
      setEditProjectName(p.name);
      setEditProjectDesc(p.description || '');
      setIsEditing(true);
    }
  };

  const confirmDeleteProject = () => {
    if (!state.projectId) return;
    setShowDeleteConfirm(true);
  };

  const handleDeleteProject = async () => {
    if (!state.projectId) return;
    try {
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/projects/delete/${state.projectId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setProjects(projects.filter(p => p.id !== state.projectId));
        dispatch({ type: 'BATCH_UPDATE', updates: { projectId: null, projectName: null } });
        toast('Project deleted successfully', 'ok');
        setIsEditing(false);
        setShowDeleteConfirm(false);
      } else {
        const err = await res.json();
        toast(err.detail || 'Failed to delete project', 'err');
        setShowDeleteConfirm(false);
      }
    } catch (err) {
      toast('Failed to delete project', 'err');
      setShowDeleteConfirm(false);
    }
  };

  const pickSrc = (k: string) => dispatch({ type: 'SET_FIELD', field: 'src', value: k });
  const pickObj = (k: string) => dispatch({ type: 'SET_FIELD', field: 'obj', value: k });

  const testConn = async () => {
    if (!state.connUrl || !state.connUser || !state.connPass) {
      toast('Please fill in Base URL, Username, and Password', 'err');
      return;
    }

    setIsTestingConn(true);
    toast('Testing connection to SAP...', 'info');

    try {
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/connection/test_connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base_url: state.connUrl,
          client: state.connClient,
          username: state.connUser,
          password: state.connPass,
          system_type: state.src
        })
      });
      const data = await res.json();
      if (res.ok) {
        toast('Connection successful!', 'ok');
      } else {
        toast(`Connection failed: ${data.detail || 'Unknown error'}`, 'err');
      }
    } catch (err) {
      toast('Failed to reach backend', 'err');
    } finally {
      setIsTestingConn(false);
    }
  };

  const autoLoad = async () => {
    let data: Record<string, string>[] = [];

    if (state.src === 'SAP_ECC') {
      if (!state.connUrl || !state.connUser || !state.connPass) {
        toast('Please fill in Base URL, Username, and Password to fetch live data', 'err');
        return;
      }
      setIsFetchingSample(true);
      toast(`Fetching live ${state.obj || 'Biographical Info'} data from source...`, 'info');

      try {
        const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/extract/fetch_sample`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            base_url: state.connUrl,
            client: state.connClient,
            username: state.connUser,
            password: state.connPass,
            system_type: state.src,
            target_object: state.obj || 'Biographical Info'
          })
        });
        const resData = await res.json();
        if (res.ok) {
          data = resData.data;
          if (data.length === 0) {
            toast('No records found for this object.', 'info');
            setIsFetchingSample(false);
            return;
          }
        } else {
          toast(`Fetch failed: ${resData.detail || 'Unknown error'}`, 'err');
          setIsFetchingSample(false);
          return;
        }
      } catch (err) {
        toast('Failed to reach backend to fetch data', 'err');
        setIsFetchingSample(false);
        return;
      } finally {
        setIsFetchingSample(false);
      }
    } else {
      // Choose data based on selected target object
      if (state.obj === 'Employment Details') {
        data = SAMPLE.ORACLE_VENDOR;
      } else if (state.obj === 'Personal Info') {
        data = SAMPLE.EXCEL_MATERIAL;
      } else {
        data = SAMPLE.SAP_ECC_CUSTOMER;
      }
    }

    dispatch({
      type: 'BATCH_UPDATE',
      updates: {
        rawData: data,
        headers: Object.keys(data[0]),
      },
    });

    if (state.src === 'SAP_ECC') {
      toast(`Successfully loaded ${data.length} live records!`, 'ok');
    } else {
      toast(`Loaded ${data.length} sample records for ${state.obj || 'Biographical Info'}`, 'ok');
    }
  };

  const updateField = (field: string, value: string) => {
    dispatch({ type: 'SET_FIELD', field: field as keyof typeof state, value });
  };

  const has = state.rawData.length > 0;

  const nextDisabled = !state.src || !state.obj || !state.projectId || (state.src === 'SAP_ECC' && (!state.connUrl || !state.connUser || !state.connPass || state.rawData.length === 0));

  return (
    <PageLayout>
      <PageHeader title="Step 1 — Source & Data Connect" subtitle="Upload legacy ECC extracts or connect to source databases">
        <div title={nextDisabled ? "Complete all connection fields, select a project, and load sample data to proceed." : ""}>
          <Button variant="primary" icon={<ArrowRight className="w-3.5 h-3.5" />} onClick={() => navigate('/mapping')} disabled={nextDisabled}>
            Next: AI Mapping
          </Button>
        </div>
      </PageHeader>

      <PageGrid>
        {/* Left Column */}
        <GridCol span={3}>
          <Card>
            <CardHeader title="SOURCE SYSTEM" subtitle="Select data origin" />
            <CardBody className="p-2 space-y-1">
              {SOURCES.map((s) => (
                <SidebarItem key={s.key} active={state.src === s.key} onClick={() => pickSrc(s.key)} icon={s.icon} title={s.name} subtitle={s.sub} layoutIdGroup="source" />
              ))}
            </CardBody>
          </Card>

          {/* Removed SAP Target Object card */}
        </GridCol>

        {/* Middle Column */}
        <GridCol span={9}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Connection Config */}
            <Card>
              <CardHeader icon={<Cable className="w-4 h-4" />} title="Connection Config" />
              <CardBody className="space-y-3">
                <div>
                  <label className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1 block">Source System</label>
                  <Select
                    value={state.src}
                    onChange={(val) => pickSrc(val)}
                    options={[['EXCEL_CSV', 'Excel / CSV File']].map(([k, l]) => ({ value: k, label: l }))}
                  />
                </div>

                {state.src === 'SAP_ECC' && (
                  <>
                    <div className="grid grid-cols-4 gap-2.5">
                      <div className="col-span-3">
                        <label className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1 block">Base URL</label>
                        <input type="text" placeholder="https://host:port" value={state.connUrl} onChange={e => updateField('connUrl', e.target.value)} className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2 text-[12.5px] text-[var(--text-primary)] outline-none focus:border-primary-500 transition-colors" />
                      </div>
                      <div className="col-span-1">
                        <label className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1 block">Client</label>
                        <input type="text" placeholder="100" value={state.connClient} onChange={e => updateField('connClient', e.target.value)} className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2 text-[12.5px] text-[var(--text-primary)] outline-none focus:border-primary-500 transition-colors" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1 block">Username</label>
                        <input type="text" placeholder="sapuser" value={state.connUser} onChange={e => updateField('connUser', e.target.value)} className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2 text-[12.5px] text-[var(--text-primary)] outline-none focus:border-primary-500 transition-colors" />
                      </div>
                      <div>
                        <label className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1 block">Password</label>
                        <input type="password" placeholder="••••••••" value={state.connPass} onChange={e => updateField('connPass', e.target.value)} className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2 text-[12.5px] text-[var(--text-primary)] outline-none focus:border-primary-500 transition-colors" />
                      </div>
                    </div>
                  </>
                )}

                {(state.src === 'ORACLE_EBS') && (
                  <>
                    <div className="grid grid-cols-4 gap-2.5">
                      <div className="col-span-3">
                        <label className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1 block">Oracle Host URL</label>
                        <input type="text" value="jdbc:oracle:thin:@oracle-prod.internal:1521:EBSDB" disabled className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2 text-[12.5px] text-[var(--text-tertiary)] outline-none cursor-not-allowed opacity-70" />
                      </div>
                      <div className="col-span-1">
                        <label className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1 block">Port</label>
                        <input type="text" value="1521" disabled className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2 text-[12.5px] text-[var(--text-tertiary)] outline-none cursor-not-allowed opacity-70" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1 block">Username</label>
                        <input type="text" value="APPS" disabled className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2 text-[12.5px] text-[var(--text-tertiary)] outline-none cursor-not-allowed opacity-70" />
                      </div>
                      <div>
                        <label className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1 block">Password</label>
                        <input type="password" value="••••••••" disabled className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2 text-[12.5px] text-[var(--text-tertiary)] outline-none cursor-not-allowed opacity-70" />
                      </div>
                    </div>
                  </>
                )}

                {(state.src === 'EXCEL_CSV') && (
                  <div className="border-2 border-dashed border-[var(--border)] rounded-lg p-6 flex flex-col items-center justify-center text-center bg-[var(--bg-tertiary)]/50">
                    <Cloud className="w-8 h-8 text-[var(--text-tertiary)] mb-2" />
                    <p className="text-[12px] text-[var(--text-secondary)] font-medium">Drag and drop file here</p>
                    <p className="text-[11px] text-[var(--text-tertiary)] mb-3">or click to browse (.xlsx, .csv)</p>
                    <input
                      type="file"
                      accept=".csv, .xlsx, .xls"
                      className="hidden"
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                    />
                    <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                      {isUploading ? 'Uploading...' : 'Choose File'}
                    </Button>
                    {state.headers.length > 0 && (
                      <p className="text-[11px] text-emerald-500 mt-2 font-medium">✓ File uploaded ({state.headers.length} columns loaded)</p>
                    )}
                  </div>
                )}

                {state.src !== 'SAP_ECC' && state.src !== 'EXCEL_CSV' && state.src !== 'ORACLE_EBS' && (
                  <>
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1 block">Host/Server</label>
                        <input type="text" placeholder="192.168.1.100" className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2 text-[12.5px] text-[var(--text-primary)] outline-none focus:border-primary-500 transition-colors" />
                      </div>
                      <div>
                        <label className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1 block">Port</label>
                        <input type="text" placeholder="1521" className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2 text-[12.5px] text-[var(--text-primary)] outline-none focus:border-primary-500 transition-colors" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1 block">Database</label>
                        <input type="text" placeholder="ORCL" className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2 text-[12.5px] text-[var(--text-primary)] outline-none focus:border-primary-500 transition-colors" />
                      </div>
                      <div>
                        <label className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1 block">Username</label>
                        <input type="text" placeholder="dbuser" className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2 text-[12.5px] text-[var(--text-primary)] outline-none focus:border-primary-500 transition-colors" />
                      </div>
                    </div>
                    <div>
                      <label className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1 block">Table / View</label>
                      <input type="text" placeholder="VENDORS_V" className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2 text-[12.5px] text-[var(--text-primary)] outline-none focus:border-primary-500 transition-colors" />
                    </div>
                  </>
                )}

                {(state.src === 'SAP_ECC' || state.src === 'ORACLE_EBS') && (
                  <div className="flex gap-2 pt-1">
                    <Button
                      variant="secondary"
                      icon={<Cable className="w-3.5 h-3.5" />}
                      className="flex-1 justify-center"
                      disabled={isTestingConn || isFetchingSample || isUploading}
                      onClick={() => {
                        if (state.src === 'SAP_ECC') {
                          testConn();
                        } else {
                          toast('Connection to Oracle EBS successful!', 'ok');
                        }
                      }}
                    >
                      {isTestingConn ? 'Testing...' : 'Test Connection'}
                    </Button>
                    <Button
                      variant="warning"
                      icon={<Zap className="w-3.5 h-3.5" />}
                      className="flex-1"
                      disabled={isFetchingSample || isTestingConn || isUploading}
                      onClick={() => {
                        if (state.src === 'SAP_ECC') {
                          autoLoad();
                        } else {
                          handleLoadOracle();
                        }
                      }}
                    >
                      {isFetchingSample || isUploading ? 'Loading Data...' : 'Load Sample Data'}
                    </Button>
                  </div>
                )}
              </CardBody>
            </Card>

            {/* Project Workspace */}
            <Card>
              <CardHeader icon={<FolderGit2 className="w-4 h-4" />} title="Project Workspace" subtitle="Required for mapping" />
              <CardBody className="space-y-4">
                <div>
                  <label className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1.5 block">Target Object</label>
                  <Select
                    value={state.obj || ''}
                    onChange={(val) => pickObj(val)}
                    options={[
                      { value: '', label: '— Select a target object —' },
                      ...Object.entries(OBJS)
                        .filter(([k]) => !['BIOGRAPHICAL INFO', 'PERSONAL INFO', 'EMPLOYMENT DETAILS', 'JOB INFO', 'COMPENSATION INFO', 'PAY COMPONENT RECURRING', 'PAY COMPONENT NON RECURRING'].includes(k))
                        .map(([k, v]) => ({ value: k, label: `${v.label} (${v.module})` }))
                    ]}
                  />
                </div>
                <div>
                  <label className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1.5 block">Select Existing Project</label>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <Select
                        value={state.projectId || ''}
                        onChange={(val) => {
                          const p = projects.find(proj => proj.id === val);
                          dispatch({ type: 'BATCH_UPDATE', updates: { projectId: val, projectName: p ? p.name : null } });
                          setIsEditing(false);
                        }}
                        options={
                          projects.length === 0
                            ? [{ value: '', label: 'No projects found (Create one below)' }]
                            : [
                              { value: '', label: '— Select a project —' },
                              ...projects.map(p => ({ value: p.id, label: p.name }))
                            ]
                        }
                      />
                    </div>
                    {state.projectId && !isEditing && (
                      <div className="flex gap-1.5">
                        <Button variant="secondary" icon={<Edit3 className="w-3.5 h-3.5" />} onClick={startEditing}>
                          Edit
                        </Button>
                        <Button variant="danger" icon={<Trash2 className="w-3.5 h-3.5" />} onClick={confirmDeleteProject}>
                          Delete
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                {isEditing && state.projectId && (
                  <div className="space-y-2.5 p-3 rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)]/50">
                    <label className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] block">Edit Project</label>
                    <input
                      type="text"
                      placeholder="Project Name"
                      value={editProjectName}
                      onChange={e => setEditProjectName(e.target.value)}
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2 text-[12.5px] text-[var(--text-primary)] outline-none focus:border-primary-500 transition-colors"
                    />
                    <input
                      type="text"
                      placeholder="Description"
                      value={editProjectDesc}
                      onChange={e => setEditProjectDesc(e.target.value)}
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2 text-[12.5px] text-[var(--text-primary)] outline-none focus:border-primary-500 transition-colors"
                    />
                    <div className="flex gap-2 mt-2">
                      <Button variant="secondary" className="flex-1 justify-center" onClick={() => setIsEditing(false)}>Cancel</Button>
                      <Button variant="primary" icon={<Save className="w-3.5 h-3.5" />} className="flex-1 justify-center" onClick={handleUpdateProject} disabled={!editProjectName.trim()}>Save Changes</Button>
                    </div>
                  </div>
                )}

                <Divider />

                {!isEditing && (
                  <div className="space-y-2.5">
                    <label className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] block">Create New Project</label>
                    <input
                      type="text"
                      placeholder="Project Name (e.g. Acme Corp Migration)"
                      value={newProjectName}
                      onChange={e => setNewProjectName(e.target.value)}
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2 text-[12.5px] text-[var(--text-primary)] outline-none focus:border-primary-500 transition-colors"
                    />
                    <input
                      type="text"
                      placeholder="Description (Optional)"
                      value={newProjectDesc}
                      onChange={e => setNewProjectDesc(e.target.value)}
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2 text-[12.5px] text-[var(--text-primary)] outline-none focus:border-primary-500 transition-colors"
                    />
                    <Button
                      variant="secondary"
                      icon={<Plus className="w-3.5 h-3.5" />}
                      className="w-full justify-center mt-2"
                      onClick={handleCreateProject}
                      disabled={isCreating || !newProjectName.trim()}
                    >
                      {isCreating ? 'Creating...' : 'Create & Select Project'}
                    </Button>
                  </div>
                )}

                {!state.projectId && (
                  <InfoBox variant="warning" className="mt-2">
                    <strong>Action Required:</strong> You must select or create a project before you can proceed to AI Mapping.
                  </InfoBox>
                )}
              </CardBody>
            </Card>
          </div>

          {has && (
            <Card>
              <CardHeader title="Source Data Preview" subtitle={`${state.src} → ${OBJS[state.obj]?.label} | ${state.headers.length} columns`}>
                <Badge variant="neutral">{state.rawData.length} records</Badge>
                <Button variant="secondary" size="sm" icon={<Download className="w-3.5 h-3.5" />} onClick={() => {
                  import('@/lib/utils').then(({ expCSV, dl }) => {
                    dl(expCSV(state.rawData), 'raw_source_data.csv', 'text/csv');
                  });
                }}>Export</Button>
              </CardHeader>
              <CardBody>
                <DataTable rows={state.rawData} cols={state.headers} />
              </CardBody>
            </Card>
          )}
        </GridCol>
      </PageGrid>
      <ConfirmModal
        isOpen={showDeleteConfirm}
        title="Delete Project"
        message="Are you sure you want to delete this project? All associated mappings will be permanently deleted."
        confirmText="Delete Project"
        onConfirm={handleDeleteProject}
        onCancel={() => setShowDeleteConfirm(false)}
        isDestructive={true}
      />
    </PageLayout>
  );
}
