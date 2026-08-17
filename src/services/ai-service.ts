// ═══════════════════════════════════════════════════════
// AI SERVICE — Connects to our FastAPI Backend
// ═══════════════════════════════════════════════════════

export async function getSAPSchema(objectName: string): Promise<any> {
  const token = localStorage.getItem('access_token');
  const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/schema?object_name=${objectName}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  });
  
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.detail || 'Failed to fetch SAP schema');
  }
  
  return res.json();
}

export async function generateMapping(sourceSystem: string, targetObject: string, sourceFields: string[]): Promise<any> {
  const token = localStorage.getItem('access_token');
  const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/map`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ sourceSystem, targetObject, sourceFields })
  });
  
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.detail || 'Mapping generation failed');
  }
  
  return res.json();
}

export async function correctMapping(sourceSystem: string, sourceFieldName: string, sapFieldId: string, transformRule: string): Promise<any> {
  const token = localStorage.getItem('access_token');
  const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/map/correct`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ sourceSystem, sourceFieldName, sapFieldId, transformRule })
  });
  
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.detail || 'Correction failed');
  }
  
  return res.json();
}

export async function ai(prompt: string, aiLog: any[], maxTok = 1000): Promise<string> {
  const token = localStorage.getItem('access_token');
  const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/sap/prompt`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ prompt })
  });
  
  if (!res.ok) throw new Error('AI prompt failed');
  const data = await res.json();
  const text = data.content || '';
  
  aiLog.push({
    ts: new Date().toISOString(),
    p: prompt.slice(0, 120) + '…',
    r: text.slice(0, 250) + '…',
  });
  return text;
}

export function parseAI(t: string): Record<string, unknown> | Record<string, unknown>[] | null {
  const c = t.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const a = c.search(/[[\{]/);
  const b = Math.max(c.lastIndexOf(']'), c.lastIndexOf('}')) + 1;
  try {
    return JSON.parse(c.slice(a, b));
  } catch {
    return null;
  }
}
