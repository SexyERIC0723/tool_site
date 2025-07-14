from fastapi import FastAPI, Form, BackgroundTasks, Depends, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
import zipfile, logging

from app.generator import generate_wallets
from app.auth import (
    create_nonce, verify_signature, gen_jwt, current_user,
    consume_nonce, pop_nonce,upsert_user
)

from app.service import list_jobs_by_user
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Solana Wallet Generator")

# ---------- 工具：把目录打成 zip ----------
def _zip_dir(dir_path: Path):
    """若未打包则创建 zip，返回 Path；已存在则直接返回"""
    zip_path = dir_path.with_suffix(".zip")
    if zip_path.exists():
        return zip_path
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for fp in dir_path.rglob("*"):
            zf.write(fp, fp.relative_to(dir_path))
    return zip_path

# ---------- 静态 & 首页 ----------
@app.get("/", include_in_schema=False)
def index():
    return FileResponse(Path("static/index.html"))
app.mount("/static", StaticFiles(directory="static"), name="static")

# ---------- 钱包登录相关 ----------
@app.get("/api/nonce")
def api_nonce(wallet: str):
    return {"nonce": create_nonce(wallet)}

@app.post("/api/login")
def api_login(wallet: str = Form(...),
              message: str = Form(...),
              signature: str = Form(...)):
    if not consume_nonce(wallet, message):  # 传递 message 参数
        raise HTTPException(400, "nonce expired or not requested")

    if not verify_signature(wallet, message, signature):
        raise HTTPException(400, "signature invalid")

    pop_nonce(wallet)             # ← 仅成功后才真正删除
    upsert_user(wallet)
    return {"token": gen_jwt(wallet)}

# ---------- 生成钱包 ----------
@app.post("/api/generate")
async def api_generate(
    num: int = Form(10),
    min_delay: float = Form(0.1),
    max_delay: float = Form(0.5),
    workers: int = Form(4),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    user: str = Depends(current_user),
):
    args = dict(num=num, min_delay=min_delay, max_delay=max_delay, workers=workers)
    job_id, pubkeys, out_dir = generate_wallets(args, user)   # 注意 generator 应返回 out_dir
    # 后台打 zip
    background_tasks.add_task(_zip_dir, Path(out_dir))
    return {"job_id": job_id, "count": len(pubkeys), "pubkeys": pubkeys}

# ---------- 历史 ----------
@app.get("/api/jobs")
def api_jobs(user: str = Depends(current_user)):
    jobs = list_jobs_by_user(user)
    return [
        {"job_id": j.id, "created": j.created.isoformat(timespec="seconds"), "count": j.count}
        for j in jobs
    ]

# ---------- 下载 ----------
@app.get("/download/{job_id}")
def dl(job_id: str, user: str = Depends(current_user)):
    jobs = {j.id: j for j in list_jobs_by_user(user)}
    if job_id not in jobs:
        raise HTTPException(404, "job_id not found")
    zip_path = _zip_dir(Path(jobs[job_id].path))
    return FileResponse(zip_path, filename=zip_path.name, media_type="application/zip")
