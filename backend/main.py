from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from database import init_db
from api.routers import admin, assets, billing, branding, flows, playground, auth, image, text, video
from storage import storage

app = FastAPI(title="NodeList LLM API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3002",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3002",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    init_db()


app.include_router(auth.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(billing.router, prefix="/api")
app.include_router(branding.router, prefix="/api")
app.include_router(assets.router, prefix="/api")
app.include_router(flows.router, prefix="/api")
app.include_router(playground.router, prefix="/api")
app.include_router(image.router, prefix="/api")
app.include_router(text.router, prefix="/api")
app.include_router(video.router, prefix="/api")
app.mount("/uploads", StaticFiles(directory=storage.root), name="uploads")


@app.get("/health")
def health():
    return {"status": "ok"}
