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
import { Zap, ArrowRight, Link2, Database, LayoutTemplate, FileSpreadsheet, Layers, Cloud, HardDrive, Users, Building2, Package, Cable, Settings2, Download, FolderGit2, Plus, Edit3, Save, Trash2, CheckCircle2 } from 'lucide-react';

interface StagedFile {
  file: File;
  filename: string;
  headers: string[];
  sample_rows: any[];
  row_count: number;
  columns_count: number;
}

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

  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [baseFileName, setBaseFileName] = useState<string>('');
  const [baseKey, setBaseKey] = useState<string>('');
  const [joinKeys, setJoinKeys] = useState<Record<string, string>>({}); // { [filename]: joinKey }

  const findBestKeyMatch = (headers: string[], targetKeyName: string = ''): string => {
    if (!headers || headers.length === 0) return '';
    if (targetKeyName) {
      const exact = headers.find(h => h.toLowerCase() === targetKeyName.toLowerCase());
      if (exact) return exact;
      const cleanTarget = targetKeyName.toLowerCase().replace(/[^a-z0-9]/g, '');
      const cleanMatch = headers.find(h => h.toLowerCase().replace(/[^a-z0-9]/g, '') === cleanTarget);
      if (cleanMatch) return cleanMatch;
    }
    const priorityKeywords = ['person_id_external', 'userid', 'user_id', 'employee_id', 'empid', 'id', 'code', 'number', 'num'];
    for (const kw of priorityKeywords) {
      const match = headers.find(h => h.toLowerCase().includes(kw));
      if (match) return match;
    }
    return headers[0];
  };

  const handleFilesSelected = async (fileList: FileList | File[] | null) => {
    if (!fileList || fileList.length === 0) return;
    const filesArray = Array.from(fileList);

    setIsUploading(true);
    showLoad('Inspecting Files...', `Analyzing ${filesArray.length} file(s) schema`, ['Detecting header rows...']);

    const formData = new FormData();
    filesArray.forEach(f => formData.append('files', f));

    try {
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/extract/upload-preview`, {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ detail: 'Preview failed' }));
        throw new Error(errData.detail || 'Failed to preview files');
      }

      const resData = await res.json();
      const previewedList: StagedFile[] = (resData.files || []).map((pf: any, idx: number) => ({
        file: filesArray[idx] || filesArray.find(f => f.name === pf.filename) || filesArray[0],
        filename: pf.filename,
        headers: pf.headers || [],
        sample_rows: pf.sample_rows || [],
        row_count: pf.row_count || 0,
        columns_count: pf.columns_count || (pf.headers ? pf.headers.length : 0),
      }));

      // Combine with existing staged files (replace matching filenames, append new ones)
      const existingMap = new Map(stagedFiles.map(f => [f.filename, f]));
      previewedList.forEach(pf => existingMap.set(pf.filename, pf));
      const combinedList = Array.from(existingMap.values());

      setStagedFiles(combinedList);

      if (combinedList.length > 0) {
        const currentBase = baseFileName && combinedList.some(f => f.filename === baseFileName)
          ? baseFileName
          : combinedList[0].filename;
        setBaseFileName(currentBase);

        const baseFileObj = combinedList.find(f => f.filename === currentBase);
        const currentBaseKey = baseKey && baseFileObj?.headers.includes(baseKey)
          ? baseKey
          : findBestKeyMatch(baseFileObj?.headers || []);
        setBaseKey(currentBaseKey);

        const updatedJoinKeys: Record<string, string> = { ...joinKeys };
        combinedList.filter(f => f.filename !== currentBase).forEach(sec => {
          if (!updatedJoinKeys[sec.filename] || !sec.headers.includes(updatedJoinKeys[sec.filename])) {
            updatedJoinKeys[sec.filename] = findBestKeyMatch(sec.headers, currentBaseKey);
          }
        });
        setJoinKeys(updatedJoinKeys);

        // If only 1 file is staged, auto load directly
        if (combinedList.length === 1) {
          await executeMergeDirect(combinedList, currentBase, currentBaseKey, {});
        } else {
          toast(`Staged ${combinedList.length} files. Configure your Primary & Join Keys below to merge!`, 'info');
        }
      }
    } catch (err: any) {
      toast(err.message || 'Error processing files', 'err');
    } finally {
      setIsUploading(false);
      hideLoad();
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleBaseFileChange = (newBaseName: string) => {
    setBaseFileName(newBaseName);
    const baseObj = stagedFiles.find(f => f.filename === newBaseName);
    if (baseObj) {
      const newBaseKey = findBestKeyMatch(baseObj.headers);
      setBaseKey(newBaseKey);
      const updatedJoinKeys: Record<string, string> = {};
      stagedFiles.filter(f => f.filename !== newBaseName).forEach(sec => {
        updatedJoinKeys[sec.filename] = findBestKeyMatch(sec.headers, newBaseKey);
      });
      setJoinKeys(updatedJoinKeys);
    }
  };

  const handleBaseKeyChange = (newKey: string) => {
    setBaseKey(newKey);
    const updatedJoinKeys: Record<string, string> = { ...joinKeys };
    stagedFiles.filter(f => f.filename !== baseFileName).forEach(sec => {
      updatedJoinKeys[sec.filename] = findBestKeyMatch(sec.headers, newKey);
    });
    setJoinKeys(updatedJoinKeys);
  };

  const executeMergeDirect = async (
    filesList: StagedFile[],
    baseName: string,
    currentBaseKey: string,
    currentJoinKeys: Record<string, string>
  ) => {
    if (filesList.length === 0) return;

    setIsUploading(true);
    showLoad('Merging Datasets...', `Performing relational Left Join on ${filesList.length} files`, ['Combining fields & deduplicating keys...']);

    const formData = new FormData();
    filesList.forEach(sf => formData.append('files', sf.file));

    const joinConfigs = filesList
      .filter(sf => sf.filename !== baseName)
      .map(sf => ({
        file_name: sf.filename,
        base_key: currentBaseKey,
        join_key: currentJoinKeys[sf.filename] || currentBaseKey
      }));

    formData.append('join_config_json', JSON.stringify(joinConfigs));
    formData.append('base_file', baseName);

    try {
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/extract/upload-merge`, {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ detail: 'Merge failed' }));
        throw new Error(errData.detail || 'Failed to merge datasets');
      }

      const data = await res.json();
      dispatch({
        type: 'BATCH_UPDATE',
        updates: {
          rawData: data.data,
          headers: data.headers,
          uploadedData: data.data
        }
      });
      toast(`Successfully merged ${filesList.length} files into ${data.headers.length} columns and ${data.data.length} records!`, 'ok');
    } catch (err: any) {
      toast(err.message || 'Merge failed', 'err');
    } finally {
      setIsUploading(false);
      hideLoad();
    }
  };

  const handleMergeClick = () => {
    executeMergeDirect(stagedFiles, baseFileName, baseKey, joinKeys);
  };

  const handleRemoveStagedFile = (filename: string) => {
    const remaining = stagedFiles.filter(f => f.filename !== filename);
    setStagedFiles(remaining);
    if (remaining.length > 0) {
      if (baseFileName === filename) {
        handleBaseFileChange(remaining[0].filename);
      }
    } else {
      setBaseFileName('');
      setBaseKey('');
      setJoinKeys({});
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

  const handleLoadOracle = () => {
    const data = SAMPLE.ORACLE_VENDOR || [];
    if (data.length > 0) {
      dispatch({
        type: 'BATCH_UPDATE',
        updates: {
          rawData: data,
          headers: Object.keys(data[0]),
          uploadedData: data
        }
      });
      toast(`Loaded ${data.length} sample records for Oracle EBS`, 'ok');
    }
  };

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
                  <div className="space-y-3">
                    {/* Multi-file dropzone */}
                    <div
                      className="border-2 border-dashed border-[var(--border)] rounded-lg p-5 flex flex-col items-center justify-center text-center bg-[var(--bg-tertiary)]/50 hover:border-primary-400 transition-colors cursor-pointer"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Cloud className="w-7 h-7 text-[var(--text-tertiary)] mb-1.5" />
                      <p className="text-[12px] text-[var(--text-secondary)] font-medium">Drag & drop files or click to browse</p>
                      <p className="text-[10.5px] text-[var(--text-tertiary)] mb-2.5">Upload 1 or more files (.xlsx, .xls, .csv) for single or multi-table join</p>
                      <input
                        type="file"
                        accept=".csv, .xlsx, .xls"
                        multiple
                        className="hidden"
                        ref={fileInputRef}
                        onChange={(e) => handleFilesSelected(e.target.files)}
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          fileInputRef.current?.click();
                        }}
                        disabled={isUploading}
                      >
                        {isUploading ? 'Inspecting Files...' : 'Choose File(s)'}
                      </Button>
                    </div>

                    {/* Staged Files List */}
                    {stagedFiles.length > 0 && (
                      <div className="space-y-2 p-3 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)]">
                        <div className="flex items-center justify-between text-[11px] font-bold text-[var(--text-primary)]">
                          <span className="flex items-center gap-1.5">
                            <Layers className="w-3.5 h-3.5 text-primary-500" />
                            Staged Files ({stagedFiles.length})
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              fileInputRef.current?.click();
                            }}
                            disabled={isUploading}
                            className="flex items-center gap-1 text-[10.5px] font-semibold text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 transition-colors cursor-pointer px-2 py-0.5 rounded bg-primary-50 dark:bg-primary-950/40 border border-primary-200 dark:border-primary-900/40"
                          >
                            <Plus className="w-3 h-3" />
                            <span>Add File</span>
                          </button>
                        </div>

                        <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1">
                          {stagedFiles.map((sf) => (
                            <div key={sf.filename} className="flex items-center justify-between p-2 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border)] text-[11px]">
                              <div className="flex items-center gap-2 truncate">
                                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                                <span className="font-semibold text-[var(--text-primary)] truncate" title={sf.filename}>{sf.filename}</span>
                                <span className="text-[9.5px] px-1.5 py-0.5 rounded bg-[var(--bg-primary)] text-[var(--text-tertiary)] border border-[var(--border)]">
                                  {sf.columns_count} cols · {sf.row_count} rows
                                </span>
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemoveStagedFile(sf.filename);
                                }}
                                className="text-[var(--text-tertiary)] hover:text-red-500 p-1 transition-colors"
                                title="Remove file"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            fileInputRef.current?.click();
                          }}
                          disabled={isUploading}
                          className="w-full py-1.5 px-2.5 border border-dashed border-[var(--border)] rounded-md text-[10.5px] font-medium text-[var(--text-secondary)] hover:text-primary-600 hover:border-primary-400 dark:hover:text-primary-400 transition-colors flex items-center justify-center gap-1.5 bg-[var(--bg-tertiary)]/40 hover:bg-[var(--bg-tertiary)] cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5 text-primary-500" />
                          <span>Add another file (.xlsx, .xls, .csv)</span>
                        </button>

                        {/* Multi-File Relational Join Configuration */}
                        {stagedFiles.length > 1 && (
                          <div className="pt-2.5 mt-2 border-t border-[var(--border)] space-y-2.5">
                            <div className="text-[10.5px] font-bold uppercase tracking-wider text-primary-600 dark:text-primary-400 flex items-center gap-1">
                              <Link2 className="w-3.5 h-3.5" />
                              Relational Join Configuration (Left Join)
                            </div>

                            {/* Base Table & Primary Key */}
                            <div className="grid grid-cols-2 gap-2 p-2 rounded-md bg-[var(--bg-primary)] border border-primary-200 dark:border-primary-900/40">
                              <div>
                                <label className="text-[9.5px] font-bold text-[var(--text-tertiary)] uppercase block mb-1">
                                  Base Table (PK Table)
                                </label>
                                <Select
                                  value={baseFileName}
                                  onChange={handleBaseFileChange}
                                  options={stagedFiles.map(f => ({ value: f.filename, label: f.filename }))}
                                />
                              </div>
                              <div>
                                <label className="text-[9.5px] font-bold text-[var(--text-tertiary)] uppercase block mb-1">
                                  Primary Key (Base Key)
                                </label>
                                <Select
                                  value={baseKey}
                                  onChange={handleBaseKeyChange}
                                  options={(stagedFiles.find(f => f.filename === baseFileName)?.headers || []).map(h => ({
                                    value: h,
                                    label: h
                                  }))}
                                />
                              </div>
                            </div>

                            {/* Foreign Key for each Secondary Table */}
                            <div className="space-y-2">
                              {stagedFiles.filter(f => f.filename !== baseFileName).map(sec => (
                                <div key={sec.filename} className="p-2 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border)] space-y-1">
                                  <div className="flex items-center justify-between text-[10px] font-semibold text-[var(--text-secondary)]">
                                    <span>Join Table: <strong className="text-[var(--text-primary)]">{sec.filename}</strong></span>
                                    {joinKeys[sec.filename] && (
                                      <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-mono">⚡ Auto-matched</span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] text-[var(--text-tertiary)] whitespace-nowrap">Foreign Key:</span>
                                    <div className="flex-1">
                                      <Select
                                        value={joinKeys[sec.filename] || ''}
                                        onChange={(val) => setJoinKeys(prev => ({ ...prev, [sec.filename]: val }))}
                                        options={sec.headers.map(h => ({ value: h, label: h }))}
                                      />
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>

                            {/* Merge Execution Button */}
                            <Button
                              variant="primary"
                              size="sm"
                              icon={<Zap className="w-3.5 h-3.5" />}
                              className="w-full justify-center mt-1"
                              disabled={isUploading || !baseKey}
                              onClick={handleMergeClick}
                            >
                              {isUploading ? 'Merging Datasets...' : 'Join & Merge Datasets'}
                            </Button>
                          </div>
                        )}
                      </div>
                    )}

                    {state.headers.length > 0 && (
                      <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 text-[11px] text-emerald-700 dark:text-emerald-300 font-medium flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                        <span>Merged Dataset Ready ({state.headers.length} columns, {state.rawData.length} rows loaded)</span>
                      </div>
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
