from fastapi import FastAPI, Form, BackgroundTasks, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
import zipfile, logging, json
from typing import List, Optional, Dict, Any

from app.generator import generate_wallets
from app.auth import (
    create_nonce, verify_signature, gen_jwt, current_user,
    consume_nonce, pop_nonce,upsert_user
)

from app.service import list_jobs_by_user
from app.wallet_service import (
    import_wallets_from_json, get_user_wallets, export_wallets,
    query_balances, delete_wallets, update_wallet_name
)
from app.transfer_service import TransferService
from app.models import Wallet, TransferRecord, BatchTransferTask

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Solana Wallet Generator")

# Pydantic 模型
class WalletName(BaseModel):
    name: str

class TransferRequest(BaseModel):
    from_address: str
    to_address: str
    amount: float
    memo: Optional[str] = None

class BatchTransferRequest(BaseModel):
    from_wallet_ids: List[int]
    to_address: str
    amount_per_wallet: float
    memo: Optional[str] = None

class AddressValidation(BaseModel):
    address: str

class TransferExecution(BaseModel):
    transfer_id: int
    signature: str

class BatchTransferExecution(BaseModel):
    batch_id: str
    results: List[Dict[str, Any]]

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

# ---------- 钱包管理 API ----------
@app.post("/api/wallets/import")
async def api_import_wallets(
    file: UploadFile = File(...),
    user: str = Depends(current_user)
):
    """导入钱包文件（JSON格式）"""
    if not file.filename.endswith('.json'):
        raise HTTPException(400, "只支持 JSON 文件")
    
    try:
        content = await file.read()
        file_content = content.decode('utf-8')
        imported = import_wallets_from_json(file_content, user)
        
        return {
            "status": "success",
            "imported": len([w for w in imported if w.get("status") == "success"]),
            "failed": len([w for w in imported if w.get("status") == "error"]),
            "details": imported
        }
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logging.error(f"导入钱包失败: {e}")
        raise HTTPException(500, "导入失败")

@app.get("/api/wallets")
def api_get_wallets(user: str = Depends(current_user)):
    """获取用户的所有钱包"""
    wallets = get_user_wallets(user)
    return [
        {
            "id": w.id,
            "public_key": w.public_key,
            "name": w.name,
            "source": w.source,
            "created": w.created.isoformat(timespec="seconds"),
            "balance": w.balance,
            "last_checked": w.last_checked.isoformat(timespec="seconds") if w.last_checked else None
        }
        for w in wallets
    ]

@app.post("/api/wallets/export")
def api_export_wallets(
    wallet_ids: List[int],
    user: str = Depends(current_user)
):
    """导出选中的钱包"""
    if not wallet_ids:
        raise HTTPException(400, "请选择要导出的钱包")
    
    export_data = export_wallets(wallet_ids, user)
    
    # 返回 JSON 文件
    return JSONResponse(
        content=export_data,
        headers={
            "Content-Disposition": f"attachment; filename=wallets_export_{len(export_data)}.json"
        }
    )

@app.post("/api/wallets/balances")
async def api_query_balances(
    wallet_ids: List[int],
    user: str = Depends(current_user)
):
    """查询选中钱包的余额"""
    if not wallet_ids:
        raise HTTPException(400, "请选择要查询的钱包")
    
    balances = await query_balances(wallet_ids, user)
    
    # 计算总余额
    total = sum(b for b in balances.values() if b is not None)
    
    return {
        "balances": balances,
        "total": total,
        "count": len(balances)
    }

@app.delete("/api/wallets")
def api_delete_wallets(
    wallet_ids: List[int],
    user: str = Depends(current_user)
):
    """删除选中的钱包"""
    if not wallet_ids:
        raise HTTPException(400, "请选择要删除的钱包")
    
    count = delete_wallets(wallet_ids, user)
    
    return {
        "status": "success",
        "deleted": count
    }

@app.put("/api/wallets/{wallet_id}")
def api_update_wallet_name(
    wallet_id: int,
    data: WalletName,
    user: str = Depends(current_user)
):
    """更新钱包名称"""
    try:
        update_wallet_name(wallet_id, user, data.name)
    except ValueError:
        raise HTTPException(404, "wallet not found")
    return {"status": "success"}

# ---------- 转账功能 API ----------
@app.post("/api/transfer/validate-address")
async def api_validate_address(
    data: AddressValidation,
    user: str = Depends(current_user)
):
    """验证Solana地址"""
    is_valid = await TransferService.validate_address(data.address)
    
    result = {"valid": is_valid}
    
    if is_valid:
        # 获取地址余额
        balance = await TransferService.get_balance(data.address)
        result["balance"] = balance
    
    return result

@app.get("/api/transfer/fee")
async def api_get_transfer_fee(user: str = Depends(current_user)):
    """获取转账手续费估算"""
    fee = await TransferService.estimate_fee()
    return {"fee": fee, "fee_lamports": int(fee * 1e9)}

@app.post("/api/transfer/prepare")
async def api_prepare_transfer(
    data: TransferRequest,
    user: str = Depends(current_user)
):
    """准备转账交易（返回交易信息，不执行）"""
    
    # 验证发送方地址
    if not await TransferService.validate_address(data.from_address):
        raise HTTPException(400, "无效的发送方地址")
    
    # 验证接收方地址
    if not await TransferService.validate_address(data.to_address):
        raise HTTPException(400, "无效的接收方地址")
    
    # 检查是否是用户的钱包
    wallet = TransferService.get_user_wallet_by_address(user, data.from_address)
    if not wallet:
        raise HTTPException(403, "该钱包不属于当前用户")
    
    # 获取余额
    balance = await TransferService.get_balance(data.from_address)
    if balance is None:
        raise HTTPException(500, "无法获取钱包余额")
    
    # 估算手续费
    fee = await TransferService.estimate_fee()
    
    # 检查余额是否足够
    if balance < data.amount + fee:
        raise HTTPException(400, f"余额不足。当前余额: {balance:.6f} SOL, 需要: {data.amount + fee:.6f} SOL")
    
    return {
        "from_address": data.from_address,
        "to_address": data.to_address,
        "amount": data.amount,
        "fee": fee,
        "total_required": data.amount + fee,
        "current_balance": balance,
        "remaining_balance": balance - data.amount - fee,
        "memo": data.memo,
        "wallet_name": wallet.name
    }

@app.post("/api/transfer/batch-prepare")
async def api_prepare_batch_transfer(
    data: BatchTransferRequest,
    user: str = Depends(current_user)
):
    """准备批量转账（返回交易信息，不执行）"""
    
    # 验证接收方地址
    if not await TransferService.validate_address(data.to_address):
        raise HTTPException(400, "无效的接收方地址")
    
    # 获取用户钱包
    wallets = TransferService.get_user_wallets_by_ids(user, data.from_wallet_ids)
    if len(wallets) != len(data.from_wallet_ids):
        raise HTTPException(403, "部分钱包不属于当前用户")
    
    # 估算手续费
    fee = await TransferService.estimate_fee()
    
    # 检查每个钱包的余额
    transfers = []
    total_amount = 0
    total_fee = 0
    insufficient_wallets = []
    
    for wallet in wallets:
        balance = await TransferService.get_balance(wallet.public_key)
        if balance is None:
            raise HTTPException(500, f"无法获取钱包 {wallet.public_key} 的余额")
        
        required = data.amount_per_wallet + fee
        
        transfer_info = {
            "wallet_id": wallet.id,
            "wallet_name": wallet.name,
            "from_address": wallet.public_key,
            "current_balance": balance,
            "transfer_amount": data.amount_per_wallet,
            "fee": fee,
            "total_required": required,
            "sufficient": balance >= required
        }
        
        if balance >= required:
            total_amount += data.amount_per_wallet
            total_fee += fee
        else:
            insufficient_wallets.append(transfer_info)
        
        transfers.append(transfer_info)
    
    return {
        "to_address": data.to_address,
        "amount_per_wallet": data.amount_per_wallet,
        "total_wallets": len(wallets),
        "sufficient_wallets": len(wallets) - len(insufficient_wallets),
        "insufficient_wallets": len(insufficient_wallets),
        "total_transfer_amount": total_amount,
        "total_fees": total_fee,
        "total_required": total_amount + total_fee,
        "transfers": transfers,
        "memo": data.memo
    }

# ---------- 转账执行和记录管理 API ----------
@app.post("/api/transfer/execute")
async def api_execute_transfer(
    data: TransferRequest,
    user: str = Depends(current_user)
):
    """执行单笔转账（创建转账记录，前端负责签名和广播）"""
    
    # 验证和准备转账
    prepare_result = await api_prepare_transfer(data, user)
    
    # 创建转账记录
    transfer_record = TransferService.create_transfer_record(
        owner=user,
        from_address=data.from_address,
        to_address=data.to_address,
        amount=data.amount,
        fee=prepare_result["fee"],
        memo=data.memo,
        transfer_type="single"
    )
    
    # 构建前端转账指令
    transfer_instruction = TransferService.build_transfer_instruction(
        from_pubkey=data.from_address,
        to_pubkey=data.to_address,
        amount_lamports=int(data.amount * 1e9)
    )
    
    # 获取最新区块哈希
    recent_blockhash = await TransferService.get_recent_blockhash()
    
    return {
        "transfer_id": transfer_record.id,
        "instruction": transfer_instruction,
        "recent_blockhash": recent_blockhash,
        "memo": data.memo,
        "status": "ready_for_signature"
    }

@app.post("/api/transfer/confirm")
async def api_confirm_transfer(
    data: TransferExecution,
    user: str = Depends(current_user)
):
    """确认转账已签名并广播"""
    
    # 更新转账记录
    TransferService.update_transfer_record(
        record_id=data.transfer_id,
        signature=data.signature,
        status="pending"
    )
    
    return {
        "status": "transaction_submitted",
        "signature": data.signature,
        "transfer_id": data.transfer_id
    }

@app.post("/api/transfer/batch-execute")
async def api_execute_batch_transfer(
    data: BatchTransferRequest,
    user: str = Depends(current_user)
):
    """执行批量转账"""
    
    # 验证和准备批量转账
    prepare_result = await api_prepare_batch_transfer(data, user)
    
    # 创建批量转账任务
    batch_task = TransferService.create_batch_transfer_task(
        owner=user,
        to_address=data.to_address,
        amount_per_wallet=data.amount_per_wallet,
        wallet_count=prepare_result["sufficient_wallets"],
        total_amount=prepare_result["total_transfer_amount"],
        total_fees=prepare_result["total_fees"],
        memo=data.memo
    )
    
    # 为每个有效钱包创建转账记录
    transfer_records = []
    transfer_instructions = []
    
    for transfer_info in prepare_result["transfers"]:
        if transfer_info["sufficient"]:
            # 创建转账记录
            record = TransferService.create_transfer_record(
                owner=user,
                from_address=transfer_info["from_address"],
                to_address=data.to_address,
                amount=data.amount_per_wallet,
                fee=transfer_info["fee"],
                memo=data.memo,
                transfer_type="batch",
                batch_id=batch_task.id
            )
            transfer_records.append(record)
            
            # 构建转账指令
            instruction = TransferService.build_transfer_instruction(
                from_pubkey=transfer_info["from_address"],
                to_pubkey=data.to_address,
                amount_lamports=int(data.amount_per_wallet * 1e9)
            )
            transfer_instructions.append({
                "transfer_id": record.id,
                "wallet_id": transfer_info["wallet_id"],
                "instruction": instruction
            })
    
    # 获取最新区块哈希
    recent_blockhash = await TransferService.get_recent_blockhash()
    
    return {
        "batch_id": batch_task.id,
        "transfer_instructions": transfer_instructions,
        "recent_blockhash": recent_blockhash,
        "total_transfers": len(transfer_instructions),
        "status": "ready_for_signature"
    }

@app.post("/api/transfer/batch-confirm")
async def api_confirm_batch_transfer(
    data: BatchTransferExecution,
    user: str = Depends(current_user)
):
    """确认批量转账已签名并广播"""
    
    successful_count = 0
    failed_count = 0
    
    # 更新每个转账记录
    for result in data.results:
        transfer_id = result.get("transfer_id")
        signature = result.get("signature")
        error = result.get("error")
        
        if signature and not error:
            TransferService.update_transfer_record(
                record_id=transfer_id,
                signature=signature,
                status="pending"
            )
            successful_count += 1
        else:
            TransferService.update_transfer_record(
                record_id=transfer_id,
                status="failed",
                error_message=error or "签名失败"
            )
            failed_count += 1
    
    # 更新批量转账任务状态
    status = "completed" if failed_count == 0 else "partially_completed"
    TransferService.update_batch_transfer_task(
        task_id=data.batch_id,
        successful_transfers=successful_count,
        failed_transfers=failed_count,
        status=status
    )
    
    return {
        "batch_id": data.batch_id,
        "successful_transfers": successful_count,
        "failed_transfers": failed_count,
        "status": status
    }

@app.get("/api/transfer/records")
def api_get_transfer_records(
    limit: int = 50,
    user: str = Depends(current_user)
):
    """获取用户转账记录"""
    records = TransferService.get_user_transfer_records(user, limit)
    
    return [
        {
            "id": r.id,
            "from_address": r.from_address,
            "to_address": r.to_address,
            "amount": r.amount,
            "fee": r.fee,
            "memo": r.memo,
            "signature": r.signature,
            "status": r.status,
            "transfer_type": r.transfer_type,
            "batch_id": r.batch_id,
            "created": r.created.isoformat(timespec="seconds"),
            "confirmed": r.confirmed.isoformat(timespec="seconds") if r.confirmed else None,
            "error_message": r.error_message,
            "block_height": r.block_height
        }
        for r in records
    ]

@app.get("/api/transfer/status/{signature}")
async def api_check_transfer_status(
    signature: str,
    user: str = Depends(current_user)
):
    """检查转账交易状态"""
    
    # 检查链上状态
    chain_status = await TransferService.check_transaction_status(signature)
    
    # 如果交易已确认，更新数据库记录
    if chain_status["confirmed"]:
        # 查找对应的转账记录并更新
        with get_session() as session:
            from sqlmodel import select
            records = session.exec(
                select(TransferRecord)
                .where(TransferRecord.signature == signature)
                .where(TransferRecord.owner == user)
            ).all()
            
            for record in records:
                if record.status != "confirmed":
                    TransferService.update_transfer_record(
                        record_id=record.id,
                        status="confirmed" if not chain_status["error"] else "failed",
                        error_message=str(chain_status["error"]) if chain_status["error"] else None,
                        block_height=chain_status["block_height"]
                    )
    
    return {
        "signature": signature,
        "confirmed": chain_status["confirmed"],
        "block_height": chain_status["block_height"],
        "error": chain_status["error"],
        "status": "confirmed" if chain_status["confirmed"] and not chain_status["error"] else 
                 "failed" if chain_status["error"] else "pending"
    }

@app.get("/api/transfer/batch/{batch_id}")
def api_get_batch_transfer_status(
    batch_id: str,
    user: str = Depends(current_user)
):
    """获取批量转账状态"""
    
    with get_session() as session:
        # 获取批量转账任务
        task = session.get(BatchTransferTask, batch_id)
        if not task or task.owner != user:
            raise HTTPException(404, "批量转账任务不存在")
        
        # 获取相关的转账记录
        records = session.exec(
            select(TransferRecord)
            .where(TransferRecord.batch_id == batch_id)
            .where(TransferRecord.owner == user)
        ).all()
        
        return {
            "batch_id": batch_id,
            "status": task.status,
            "total_wallets": task.total_wallets,
            "successful_transfers": task.successful_transfers,
            "failed_transfers": task.failed_transfers,
            "total_amount": task.total_amount,
            "total_fees": task.total_fees,
            "created": task.created.isoformat(timespec="seconds"),
            "completed": task.completed.isoformat(timespec="seconds") if task.completed else None,
            "records": [
                {
                    "id": r.id,
                    "from_address": r.from_address,
                    "amount": r.amount,
                    "signature": r.signature,
                    "status": r.status,
                    "error_message": r.error_message
                }
                for r in records
            ]
        }