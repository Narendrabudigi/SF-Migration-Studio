from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import requests
import logging
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

router = APIRouter(prefix="/api/sap/connection", tags=["Connection"])

class ConnectionRequest(BaseModel):
    base_url: str
    client: str
    username: str
    password: str
    system_type: str

@router.post("/test_connection")
def test_connection(req: ConnectionRequest):
    if not req.base_url:
        raise HTTPException(status_code=400, detail="Base URL is required")
        
    try:
        # Strip trailing slash if present
        base_url = req.base_url.rstrip('/')
        
        # S/4HANA Business Partner OData metadata endpoint
        # Using this instead of ping so we can actually verify API access
        test_url = f"{base_url}/sap/opu/odata/sap/API_BUSINESS_PARTNER/$metadata"
        
        if req.client:
            test_url += f"?sap-client={req.client}"
            
        print(f"Testing connection to: {test_url}")
        
        # We bypass system proxies which often cause timeouts on internal SAP networks
        session = requests.Session()
        session.trust_env = False
        
        res = session.get(
            test_url,
            auth=(req.username, req.password),
            timeout=30,
            verify=False
        )
        
        if res.status_code == 200:
            return {"status": "success", "message": "Successfully connected to SAP API."}
        elif res.status_code in [401, 403]:
            raise HTTPException(status_code=401, detail=f"Server reached but authentication failed (Status {res.status_code})")
        else:
            raise HTTPException(status_code=400, detail=f"Failed to connect. Server returned status {res.status_code}")
            
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=408, detail="Connection timed out. Check if the server is accessible and running.")
    except requests.exceptions.ConnectionError:
        raise HTTPException(status_code=503, detail="Connection refused. Verify the host and port are correct.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
