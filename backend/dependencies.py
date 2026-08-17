from fastapi import Depends, HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt
import os
import logging

logger = logging.getLogger(__name__)

security = HTTPBearer()

def get_current_user(credentials: HTTPAuthorizationCredentials = Security(security)):
    token = credentials.credentials
    secret = os.environ.get("SUPABASE_JWT_SECRET")
    
    if not secret:
        logger.error("SUPABASE_JWT_SECRET is not set in environment variables.")
        raise HTTPException(status_code=500, detail="Internal server error configuration missing")
    
    try:
        # Supabase JWTs are signed with the project's JWT Secret using HS256 algorithm
        # We set audience to 'authenticated' as that's what Supabase Auth uses for valid user sessions
        decoded_token = jwt.decode(
            token, 
            secret, 
            algorithms=["HS256"], 
            audience="authenticated"
        )
        
        user_id = decoded_token.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token structure")
            
        return user_id
        
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError as e:
        logger.error(f"JWT Validation error: {e}")
        raise HTTPException(status_code=401, detail="Invalid authentication credentials")
