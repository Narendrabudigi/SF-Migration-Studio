from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from services.supabase_client import supabase_service

router = APIRouter()

class CreateProjectRequest(BaseModel):
    name: str
    description: Optional[str] = ""

class ProjectResponse(BaseModel):
    id: str
    name: str
    description: Optional[str] = ""

@router.get("/list", response_model=List[ProjectResponse])
def list_projects():
    client = supabase_service.get_client()
    res = client.table("projects").select("id, name, description").order("created_at", desc=True).execute()
    
    projects = []
    for r in res.data:
        projects.append(ProjectResponse(
            id=r["id"],
            name=r["name"],
            description=r.get("description", "")
        ))
    return projects

@router.post("/create", response_model=ProjectResponse)
def create_project(req: CreateProjectRequest):
    client = supabase_service.get_client()
    
    insert_data = {
        "name": req.name,
        "description": req.description
    }
    
    try:
        res = client.table("projects").insert(insert_data).execute()
        if not res.data:
            raise HTTPException(500, "Failed to create project")
            
        r = res.data[0]
        return ProjectResponse(
            id=r["id"],
            name=r["name"],
            description=r.get("description", "")
        )
    except Exception as e:
        if "unique constraint" in str(e).lower() or "projects_name_key" in str(e):
            raise HTTPException(400, "A project with this name already exists")
        raise HTTPException(500, str(e))

@router.put("/update/{project_id}", response_model=ProjectResponse)
def update_project(project_id: str, req: CreateProjectRequest):
    client = supabase_service.get_client()
    
    update_data = {
        "name": req.name,
        "description": req.description,
        "updated_at": "now()"
    }
    
    try:
        res = client.table("projects").update(update_data).eq("id", project_id).execute()
        if not res.data:
            raise HTTPException(404, "Project not found")
            
        r = res.data[0]
        return ProjectResponse(
            id=r["id"],
            name=r["name"],
            description=r.get("description", "")
        )
    except Exception as e:
        if "unique constraint" in str(e).lower() or "projects_name_key" in str(e):
            raise HTTPException(400, "A project with this name already exists")
        raise HTTPException(500, str(e))

@router.delete("/delete/{project_id}")
def delete_project(project_id: str):
    client = supabase_service.get_client()
    
    try:
        # Note: mappings are automatically deleted due to ON DELETE CASCADE on the foreign key
        res = client.table("projects").delete().eq("id", project_id).execute()
        if not res.data:
            raise HTTPException(404, "Project not found or already deleted")
            
        return {"status": "success", "message": "Project deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))
