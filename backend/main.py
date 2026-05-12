from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import init_db
from api.routers import flows, playground, auth

app = FastAPI(title="NodeList LLM API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    init_db()


app.include_router(auth.router, prefix="/api")
app.include_router(flows.router, prefix="/api")
app.include_router(playground.router, prefix="/api")


@app.get("/health")
def health():
    return {"status": "ok"}
