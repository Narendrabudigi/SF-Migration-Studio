import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

# Disable Uvicorn access logs to prevent console spam
logging.getLogger("uvicorn.access").disabled = True

app = FastAPI(title="SAP Migration Studio Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/health")
def health_check():
    return {"status": "ok", "message": "Backend is running."}

from routers.mapping import router as mapping_router
from routers.auth import router as auth_router
from routers.project import router as project_router
from routers.connection import router as connection_router
from routers.extract import router as extract_router
from routers.harmonization import router as harmonize_router
from routers.validate import router as validate_router
from routers.cleanser import router as cleanser_router
from routers.transform import router as transform_router

app.include_router(mapping_router, prefix="/api/sap")
app.include_router(project_router, prefix="/api/sap/projects")
app.include_router(connection_router)
app.include_router(extract_router)
app.include_router(harmonize_router, prefix="/api/sap")
app.include_router(validate_router, prefix="/api")
app.include_router(cleanser_router, prefix="/api/sap/cleanser")
app.include_router(transform_router, prefix="/api/sap/transform")
app.include_router(auth_router, prefix="/api/auth")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
