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
import { Zap, ArrowRight, Link2, Database, LayoutTemplate, FileSpreadsheet, Layers, Cloud, HardDrive, Users, Building2, Package, Cable, Settings2, Download, FolderGit2, Plus, Edit3, Save, Trash2, CheckCircle2, X } from 'lucide-react';

interface StagedFile {
  file: File;
  filename: string;
  headers: string[];
  sample_rows: any[];
  row_count: number;
  columns_count: number;
  size: string;
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
    if (state.src === 'EXCEL_CSV' && stagedFiles.length === 0) {
      dispatch({
        type: 'BATCH_UPDATE',
        updates: { rawData: [], headers: [], uploadedData: [], uploadedFileName: '' }
      });
    }
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

interface KeyCondition {
  left_key: string;
  right_key: string;
}

interface SecondaryJoinConfig {
  file_name: string;
  join_with: string;
  key_conditions: KeyCondition[];
}

  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [baseFileName, setBaseFileName] = useState<string>('');
  const [joinConfigs, setJoinConfigs] = useState<Record<string, SecondaryJoinConfig>>({});

  const ERP_KEY_SYNONYMS: Record<string, string[]> = {
    customer: ['kunnr', 'customerid', 'customer_id', 'cust_id', 'custid', 'customer', 'account_num', 'account_number', 'customerno', 'customer_no', 'client_id', 'client_no'],
    company_code: ['bukrs', 'company_code', 'companycode', 'cocode', 'co_code', 'comp_code', 'legal_entity', 'company', 'comp_id', 'compid'],
    employee: ['pernr', 'person_id_external', 'person_id', 'userid', 'user_id', 'employee_id', 'empid', 'emp_id', 'staff_id'],
    material: ['matnr', 'material_id', 'mat_id', 'item_id', 'item_code', 'product_id', 'sku'],
    vendor: ['lifnr', 'vendor_id', 'supplier_id', 'supp_id', 'vendor_num'],
    sales_org: ['vkorg', 'sales_org', 'sales_organization', 'salesorg'],
    order: ['vbeln', 'order_id', 'sales_order', 'order_num'],
    plant: ['werks', 'plant', 'plant_id', 'facility'],
    address: ['address_id', 'addressid', 'addr_id', 'addrid'],
  };

  const findAllMatchingKeyPairs = (parentHeaders: string[], childHeaders: string[]): KeyCondition[] => {
    if (!parentHeaders.length || !childHeaders.length) {
      return [{ left_key: parentHeaders[0] || '', right_key: childHeaders[0] || '' }];
    }

    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const matchedPairs: KeyCondition[] = [];
    const usedParent = new Set<string>();
    const usedChild = new Set<string>();

    // 1. Exact matches (case-insensitive)
    for (const ph of parentHeaders) {
      if (usedParent.has(ph)) continue;
      const exact = childHeaders.find(ch => !usedChild.has(ch) && ch.toLowerCase() === ph.toLowerCase());
      if (exact) {
        matchedPairs.push({ left_key: ph, right_key: exact });
        usedParent.add(ph);
        usedChild.add(exact);
      }
    }

    // 2. Normalized matches (e.g. CustID <-> Cust_ID, CoCode <-> Co_Code)
    for (const ph of parentHeaders) {
      if (usedParent.has(ph)) continue;
      const normP = norm(ph);
      const normMatch = childHeaders.find(ch => !usedChild.has(ch) && norm(ch) === normP);
      if (normMatch) {
        matchedPairs.push({ left_key: ph, right_key: normMatch });
        usedParent.add(ph);
        usedChild.add(normMatch);
      }
    }

    // 3. ERP synonym groups (e.g. Customer, Company Code, Employee, etc.)
    for (const group of Object.values(ERP_KEY_SYNONYMS)) {
      const parentMatches = parentHeaders.filter(ph => {
        if (usedParent.has(ph)) return false;
        const np = norm(ph);
        return group.some(syn => np === syn || np.includes(syn) || syn.includes(np));
      });

      const childMatches = childHeaders.filter(ch => {
        if (usedChild.has(ch)) return false;
        const nc = norm(ch);
        return group.some(syn => nc === syn || nc.includes(syn) || syn.includes(nc));
      });

      const pairCount = Math.min(parentMatches.length, childMatches.length);
      for (let i = 0; i < pairCount; i++) {
        const ph = parentMatches[i];
        const ch = childMatches[i];
        if (!usedParent.has(ph) && !usedChild.has(ch)) {
          matchedPairs.push({ left_key: ph, right_key: ch });
          usedParent.add(ph);
          usedChild.add(ch);
        }
      }
    }

    // 4. Common key/ID indicators if no match found yet
    if (matchedPairs.length === 0) {
      const idKeywords = ['id', 'key', 'code', 'num', 'number'];
      for (const kw of idKeywords) {
        const pId = parentHeaders.find(ph => !usedParent.has(ph) && norm(ph).includes(kw));
        const cId = childHeaders.find(ch => !usedChild.has(ch) && norm(ch).includes(kw));
        if (pId && cId) {
          matchedPairs.push({ left_key: pId, right_key: cId });
          usedParent.add(pId);
          usedChild.add(cId);
          break;
        }
      }
    }

    if (matchedPairs.length === 0) {
      matchedPairs.push({
        left_key: parentHeaders[0] || '',
        right_key: childHeaders[0] || ''
      });
    }

    return matchedPairs;
  };

  const formatFileSize = (bytes: number): string => {
    if (!bytes) return '0 KB';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
      const previewedList: StagedFile[] = (resData.files || []).map((pf: any, idx: number) => {
        const fileObj = filesArray[idx] || filesArray.find(f => f.name === pf.filename) || filesArray[0];
        return {
          file: fileObj,
          filename: pf.filename,
          headers: pf.headers || [],
          sample_rows: pf.sample_rows || [],
          row_count: pf.row_count || 0,
          columns_count: pf.columns_count || (pf.headers ? pf.headers.length : 0),
          size: formatFileSize(fileObj?.size || pf.file_size || 0),
        };
      });

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
        const baseHeaders = baseFileObj?.headers || [];

        const updatedConfigs: Record<string, SecondaryJoinConfig> = { ...joinConfigs };
        combinedList.forEach((sec) => {
          if (sec.filename !== currentBase) {
            const targetParent = updatedConfigs[sec.filename]?.join_with || currentBase;
            const parentObj = combinedList.find(f => f.filename === targetParent);
            const parentHeaders = parentObj?.headers || baseHeaders;

            if (!updatedConfigs[sec.filename] || updatedConfigs[sec.filename].key_conditions.length === 0) {
              const matchedPairs = findAllMatchingKeyPairs(parentHeaders, sec.headers);
              updatedConfigs[sec.filename] = {
                file_name: sec.filename,
                join_with: targetParent,
                key_conditions: matchedPairs,
              };
            }
          }
        });
        setJoinConfigs(updatedConfigs);

        // If only 1 file is staged, auto load directly
        if (combinedList.length === 1) {
          await executeMergeDirect(combinedList, currentBase, {});
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
    if (!baseObj) return;

    const updatedConfigs: Record<string, SecondaryJoinConfig> = {};
    stagedFiles.filter(f => f.filename !== newBaseName).forEach(sec => {
      const prevJoinWith = joinConfigs[sec.filename]?.join_with;
      const targetParent = (prevJoinWith && prevJoinWith !== sec.filename && stagedFiles.some(f => f.filename === prevJoinWith))
        ? prevJoinWith
        : newBaseName;
      const parentObj = stagedFiles.find(f => f.filename === targetParent);
      const parentHeaders = parentObj?.headers || baseObj.headers;
      const matchedPairs = findAllMatchingKeyPairs(parentHeaders, sec.headers);

      updatedConfigs[sec.filename] = {
        file_name: sec.filename,
        join_with: targetParent,
        key_conditions: matchedPairs
      };
    });
    setJoinConfigs(updatedConfigs);
  };

  const updateJoinParent = (secFilename: string, newParent: string) => {
    const parentObj = stagedFiles.find(f => f.filename === newParent);
    const parentHeaders = parentObj?.headers || [];
    const secObj = stagedFiles.find(f => f.filename === secFilename);
    const secHeaders = secObj?.headers || [];

    const matchedPairs = findAllMatchingKeyPairs(parentHeaders, secHeaders);
    setJoinConfigs(prev => ({
      ...prev,
      [secFilename]: {
        file_name: secFilename,
        join_with: newParent,
        key_conditions: matchedPairs
      }
    }));
  };

  const updateKeyCondition = (secFilename: string, condIdx: number, field: 'left_key' | 'right_key', val: string) => {
    setJoinConfigs(prev => {
      const current = prev[secFilename] || { file_name: secFilename, join_with: baseFileName, key_conditions: [] };
      const nextConds = current.key_conditions.map((c, i) => i === condIdx ? { ...c, [field]: val } : c);
      return {
        ...prev,
        [secFilename]: { ...current, key_conditions: nextConds }
      };
    });
  };

  const addCompositeKeyCondition = (secFilename: string) => {
    setJoinConfigs(prev => {
      const current = prev[secFilename] || { file_name: secFilename, join_with: baseFileName, key_conditions: [] };
      const parentName = current.join_with || baseFileName;
      const parentObj = stagedFiles.find(f => f.filename === parentName);
      const parentHeaders = parentObj?.headers || [];
      const secObj = stagedFiles.find(f => f.filename === secFilename);
      const secHeaders = secObj?.headers || [];

      const usedLeft = new Set(current.key_conditions.map(c => c.left_key).filter(Boolean));
      const usedRight = new Set(current.key_conditions.map(c => c.right_key).filter(Boolean));

      const unusedParent = parentHeaders.filter(h => !usedLeft.has(h));
      const unusedChild = secHeaders.filter(h => !usedRight.has(h));

      const candidatePairs = findAllMatchingKeyPairs(
        unusedParent.length > 0 ? unusedParent : parentHeaders,
        unusedChild.length > 0 ? unusedChild : secHeaders
      );

      const nextPair = candidatePairs[0] || {
        left_key: unusedParent[0] || parentHeaders[0] || '',
        right_key: unusedChild[0] || secHeaders[0] || ''
      };

      return {
        ...prev,
        [secFilename]: {
          ...current,
          key_conditions: [...current.key_conditions, nextPair]
        }
      };
    });
  };

  const removeCompositeKeyCondition = (secFilename: string, condIdx: number) => {
    setJoinConfigs(prev => {
      const current = prev[secFilename];
      if (!current || current.key_conditions.length <= 1) return prev;
      return {
        ...prev,
        [secFilename]: {
          ...current,
          key_conditions: current.key_conditions.filter((_, i) => i !== condIdx)
        }
      };
    });
  };

  const executeMergeDirect = async (
    filesList: StagedFile[],
    baseName: string,
    configs: Record<string, SecondaryJoinConfig>
  ) => {
    if (filesList.length === 0) return;

    const isMultiFile = filesList.length > 1;

    setIsUploading(true);
    showLoad(
      isMultiFile ? 'Merging Datasets...' : 'Loading Dataset...',
      isMultiFile ? `Performing relational Left Join on ${filesList.length} files` : `Loading records from ${baseName}`,
      isMultiFile ? ['Combining fields & resolving composite keys...'] : ['Parsing CSV headers & initializing data table...']
    );

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

    try {
      const formData = new FormData();
      filesList.forEach(sf => formData.append('files', sf.file));

      const configsArray = filesList
        .filter(sf => sf.filename !== baseName)
        .map(sf => {
          const cfg = configs[sf.filename] || {
            file_name: sf.filename,
            join_with: baseName,
            key_conditions: findAllMatchingKeyPairs(
              filesList.find(f => f.filename === baseName)?.headers || [],
              sf.headers
            )
          };
          return {
            file_name: sf.filename,
            join_with: cfg.join_with || baseName,
            key_conditions: (cfg.key_conditions || []).filter(c => c.left_key && c.right_key)
          };
        });

      formData.append('join_config_json', JSON.stringify(configsArray));
      formData.append('base_file', baseName);

      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/extract/upload-merge`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ detail: isMultiFile ? 'Merge failed' : 'Failed to load dataset' }));
        throw new Error(errData.detail || (isMultiFile ? 'Failed to merge datasets' : 'Failed to load dataset'));
      }

      const data = await res.json();
      dispatch({
        type: 'BATCH_UPDATE',
        updates: {
          rawData: data.data,
          headers: data.headers,
          uploadedData: data.data,
          uploadedFileName: baseName,
          extracted: [],
          extractedTables: [],
          edaStats: [],
          reportMetrics: null,
          complianceData: [],
          aiReport: null,
          isDataSaved: false,
        }
      });
      if (isMultiFile) {
        toast(`Successfully merged ${filesList.length} files into ${data.headers.length} columns and ${data.data.length} records!`, 'ok');
      } else {
        toast(`Successfully loaded ${data.headers.length} columns and ${data.data.length} records!`, 'ok');
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        toast(isMultiFile ? 'Merge timed out after 60 seconds. Try simplifying your join keys or reducing file sizes.' : 'Loading timed out after 60 seconds.', 'err');
      } else {
        toast(err.message || (isMultiFile ? 'Merge failed' : 'Failed to load dataset'), 'err');
      }
    } finally {
      setIsUploading(false);
      hideLoad();
    }
  };

  const handleMergeClick = () => {
    executeMergeDirect(stagedFiles, baseFileName, joinConfigs);
  };

  const handleRemoveStagedFile = (filename: string) => {
    const remaining = stagedFiles.filter(f => f.filename !== filename);
    setStagedFiles(remaining);
    const updatedConfigs = { ...joinConfigs };
    delete updatedConfigs[filename];
    setJoinConfigs(updatedConfigs);

    if (baseFileName === filename && remaining.length > 0) {
      handleBaseFileChange(remaining[0].filename);
    } else if (remaining.length === 0) {
      setBaseFileName('');
      dispatch({
        type: 'BATCH_UPDATE',
        updates: {
          rawData: [],
          headers: [],
          uploadedData: [],
          uploadedFileName: '',
        }
      });
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

  const pickSrc = (k: string) => {
    dispatch({ type: 'SET_FIELD', field: 'src', value: k });
    if (k === 'EXCEL_CSV' && stagedFiles.length === 0) {
      dispatch({
        type: 'BATCH_UPDATE',
        updates: { rawData: [], headers: [], uploadedData: [], uploadedFileName: '' }
      });
    }
  };
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

  const has = state.rawData.length > 0 && (state.src !== 'EXCEL_CSV' || stagedFiles.length > 0);

  const nextDisabled = !state.src || !state.obj || !state.projectId ||
    (state.src === 'EXCEL_CSV' && (stagedFiles.length === 0 || state.rawData.length === 0)) ||
    (state.src === 'SAP_ECC' && (!state.connUrl || !state.connUser || !state.connPass || state.rawData.length === 0));

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

                    {/* Staged Files List & Key Modeling */}
                    {stagedFiles.length > 0 && (
                      <div className="space-y-3 pt-1">
                        {/* Staged Files List - Matching exact screenshot */}
                        <div className="space-y-2">
                          {stagedFiles.map((sf) => (
                            <div
                              key={sf.filename}
                              className="flex items-center justify-between p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/60 shadow-xs hover:border-emerald-300 transition-colors"
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/40">
                                  <FileSpreadsheet className="w-4 h-4" />
                                </div>
                                <div>
                                  <div className="text-[13px] font-bold text-gray-900 dark:text-gray-100">{sf.filename}</div>
                                  <div className="text-[11px] text-gray-400">
                                    {sf.size} <span className="mx-1">•</span> <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{sf.columns_count} columns</span>
                                  </div>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemoveStagedFile(sf.filename);
                                }}
                                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors cursor-pointer"
                                title="Remove file"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                        </div>

                        {/* Divider Line */}
                        <hr className="border-gray-200 dark:border-gray-800 my-3" />

                        {/* Multi-File Relational Join Configuration (Data Modeling) */}
                        {stagedFiles.length > 1 && (
                          <div className="space-y-3 pt-1">
                            {/* Section Header */}
                            <div className="flex items-center gap-2">
                              <Link2 className="w-4 h-4 text-emerald-500" />
                              <span className="text-[13px] font-bold text-gray-900 dark:text-gray-100">
                                Key Join Configuration (Data Modeling)
                              </span>
                            </div>

                            {/* PRIMARY / BASE TABLE (MASTER TABLE) */}
                            <div className="p-3.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 space-y-1.5 shadow-xs">
                              <label className="text-[9.5px] font-mono font-bold uppercase tracking-wider text-gray-400 block">
                                PRIMARY / BASE TABLE (MASTER TABLE)
                              </label>
                              <select
                                value={baseFileName}
                                onChange={(e) => handleBaseFileChange(e.target.value)}
                                className="w-full px-3 py-2 rounded-lg text-[12.5px] font-semibold bg-gray-50 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-emerald-500 cursor-pointer"
                              >
                                {stagedFiles.map(f => (
                                  <option key={f.filename} value={f.filename}>{f.filename}</option>
                                ))}
                              </select>
                            </div>

                            {/* Secondary Table Join Cards */}
                            <div className="space-y-3.5 pt-1">
                              {stagedFiles.filter(f => f.filename !== baseFileName).map((sec) => {
                                const config = joinConfigs[sec.filename] || {
                                  file_name: sec.filename,
                                  join_with: baseFileName,
                                  key_conditions: [{ left_key: '', right_key: '' }]
                                };

                                const keyConditions = (config.key_conditions && config.key_conditions.length > 0)
                                  ? config.key_conditions
                                  : [{ left_key: '', right_key: '' }];

                                const parentName = config.join_with || baseFileName;
                                const parentObj = stagedFiles.find(f => f.filename === parentName);
                                const parentHeaders = parentObj?.headers || [];
                                const secHeaders = sec.headers || [];

                                const availableParents = Array.from(new Set([
                                  baseFileName,
                                  ...stagedFiles.map(f => f.filename),
                                ])).filter(p => p && p !== sec.filename);

                                return (
                                  <div
                                    key={sec.filename}
                                    className="p-4 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/60 shadow-xs space-y-3"
                                  >
                                    {/* Card Header */}
                                    <div className="flex items-center justify-between flex-wrap gap-2">
                                      <div className="flex items-center gap-2">
                                        <Layers className="w-4 h-4 text-emerald-500" />
                                        <span className="text-[13px] font-bold text-gray-900 dark:text-gray-100">
                                          Join: {sec.filename}
                                        </span>
                                      </div>

                                      <div className="flex items-center gap-2.5">
                                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-800/60 text-[11px]">
                                          <span className="text-gray-400 font-mono">Join With:</span>
                                          <select
                                            value={config.join_with || baseFileName}
                                            onChange={(e) => updateJoinParent(sec.filename, e.target.value)}
                                            className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-900 dark:text-gray-100 focus:outline-none cursor-pointer"
                                          >
                                            {availableParents.map(p => (
                                              <option key={p} value={p}>
                                                {p === baseFileName ? `${p} (Base)` : p}
                                              </option>
                                            ))}
                                          </select>
                                        </div>

                                        {keyConditions.length > 1 && (
                                          <span className="px-2 py-0.5 rounded text-[9.5px] font-mono font-bold uppercase tracking-wider bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                                            {keyConditions.length} KEY CONDITIONS
                                          </span>
                                        )}

                                        <span className="text-[10px] font-mono font-bold tracking-wider text-gray-400 uppercase">
                                          LEFT JOIN
                                        </span>
                                      </div>
                                    </div>

                                    {/* Condition Box */}
                                    <div className="p-3.5 rounded-xl border border-gray-200 dark:border-gray-700/80 bg-gray-50/40 dark:bg-gray-800/30 space-y-3">
                                      {keyConditions.map((cond, cIdx) => (
                                        <React.Fragment key={cIdx}>
                                          {cIdx > 0 && (
                                            <div className="flex items-center justify-center pt-1 pb-0.5">
                                              <span className="px-2.5 py-0.5 rounded-full text-[9px] font-extrabold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 uppercase tracking-wider shadow-2xs">
                                                AND (COMPOSITE KEY)
                                              </span>
                                            </div>
                                          )}
                                          <div className="flex items-center gap-3">
                                            {/* Left Dropdown (Parent Key) */}
                                            <div className="flex-1 min-w-0 space-y-1">
                                              <label className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 block truncate">
                                                {parentName} {config.key_conditions.length > 1 ? `Key #${cIdx + 1}` : 'Key'}
                                              </label>
                                              <select
                                                value={cond.left_key || ''}
                                                onChange={(e) => updateKeyCondition(sec.filename, cIdx, 'left_key', e.target.value)}
                                                className="w-full px-3 py-2 rounded-lg text-[12px] font-semibold bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-emerald-500 cursor-pointer shadow-xs"
                                              >
                                                <option value="">Select {parentName} Key...</option>
                                                {parentHeaders.map(h => (
                                                  <option key={h} value={h}>{h}</option>
                                                ))}
                                              </select>
                                            </div>

                                            {/* Arrow */}
                                            <div className="shrink-0 pt-4 text-emerald-500 font-bold text-base">
                                              ➔
                                            </div>

                                            {/* Right Dropdown (Child Key) */}
                                            <div className="flex-1 min-w-0 space-y-1">
                                              <label className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 block truncate">
                                                {sec.filename} {config.key_conditions.length > 1 ? `Key #${cIdx + 1}` : 'Foreign Key'}
                                              </label>
                                              <select
                                                value={cond.right_key || ''}
                                                onChange={(e) => updateKeyCondition(sec.filename, cIdx, 'right_key', e.target.value)}
                                                className="w-full px-3 py-2 rounded-lg text-[12px] font-semibold bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-emerald-500 cursor-pointer shadow-xs"
                                              >
                                                <option value="">Select {sec.filename} Key...</option>
                                                {secHeaders.map(h => (
                                                  <option key={h} value={h}>{h}</option>
                                                ))}
                                              </select>
                                            </div>

                                            {/* Delete Condition Button / Spacer */}
                                            {keyConditions.length > 1 && cIdx > 0 ? (
                                              <div className="shrink-0 pt-4">
                                                <button
                                                  type="button"
                                                  onClick={() => removeCompositeKeyCondition(sec.filename, cIdx)}
                                                  className="p-1.5 rounded-lg text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors cursor-pointer"
                                                  title="Remove key condition"
                                                >
                                                  <Trash2 className="w-4 h-4 text-red-500" />
                                                </button>
                                              </div>
                                            ) : keyConditions.length > 1 ? (
                                              <div className="shrink-0 pt-4 w-7" />
                                            ) : null}
                                          </div>
                                        </React.Fragment>
                                      ))}
                                    </div>

                                    {/* Add Composite Key Condition Button */}
                                    <div>
                                      <button
                                        type="button"
                                        onClick={() => addCompositeKeyCondition(sec.filename)}
                                        className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800/80 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                                      >
                                        <Plus className="w-3.5 h-3.5 text-emerald-600" />
                                        <span>Add Composite Key Condition</span>
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                            {/* Bottom Action Button */}
                            <div className="pt-2">
                              <Button
                                variant="primary"
                                size="lg"
                                icon={<Link2 className="w-4 h-4" />}
                                className="w-full justify-center py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-[13px] rounded-xl shadow-sm cursor-pointer"
                                disabled={isUploading || stagedFiles.length === 0}
                                onClick={handleMergeClick}
                              >
                                {isUploading ? (stagedFiles.length > 1 ? 'Merging Datasets…' : 'Loading Dataset…') : `Merge & Load ${stagedFiles.length} Tables`}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {state.headers.length > 0 && (state.src !== 'EXCEL_CSV' || stagedFiles.length > 0) && (
                      <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 text-[11px] text-emerald-700 dark:text-emerald-300 font-medium flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                        <span>{stagedFiles.length > 1 ? 'Merged Dataset Ready' : 'Dataset Loaded Successfully'} ({state.headers.length} columns, {state.rawData.length} rows loaded)</span>
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
