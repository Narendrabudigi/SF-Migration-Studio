from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from services.supabase_client import supabase_service
import logging

logger = logging.getLogger(__name__)

router = APIRouter()

class AuthRequest(BaseModel):
    email: str
    password: str

@router.post("/signup")
def signup(req: AuthRequest):
    client = supabase_service.get_client()
    try:
        res = client.auth.admin.create_user({
            "email": req.email, 
            "password": req.password,
            "email_confirm": True
        })
        if res.user:
            return {"status": "success", "user_id": res.user.id}
        raise HTTPException(status_code=400, detail="Signup failed in storage")
    except Exception as e:
        logger.error(f"Signup error: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/login")
def login(req: AuthRequest):
    client = supabase_service.get_client()
    try:
        res = client.auth.sign_in_with_password({"email": req.email, "password": req.password})
        if res.user and res.session:
            return {
                "status": "success",
                "user_id": res.user.id,
                "access_token": res.session.access_token
            }
    except Exception as e:
        logger.error(f"Login error: {e}")
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    raise HTTPException(status_code=401, detail="Login failed")
