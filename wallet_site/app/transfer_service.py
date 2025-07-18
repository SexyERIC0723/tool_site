import json
import base58
import logging
import uuid
from datetime import datetime
from typing import List, Dict, Any, Optional
import httpx
from sqlmodel import select

from app.db import get_session
from app.models import Wallet, TransferRecord, BatchTransferTask

logger = logging.getLogger(__name__)

# Solana RPC 端点
SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com"

class TransferService:
    """Solana转账服务"""
    
    @staticmethod
    async def validate_address(address: str) -> bool:
        """验证Solana地址格式"""
        try:
            # 简单验证：base58格式且长度为32字节
            decoded = base58.b58decode(address)
            return len(decoded) == 32
        except Exception:
            return False
    
    @staticmethod
    async def get_balance(address: str) -> Optional[float]:
        """获取地址余额"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    SOLANA_RPC_URL,
                    json={
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "getBalance",
                        "params": [address]
                    },
                    timeout=10.0
                )
                
                if response.status_code == 200:
                    data = response.json()
                    if "result" in data:
                        balance_lamports = data["result"]["value"]
                        return balance_lamports / 1e9  # 转换为SOL
                        
        except Exception as e:
            logger.error(f"获取余额失败 {address}: {e}")
            
        return None
    
    @staticmethod
    async def estimate_fee() -> float:
        """估算转账手续费"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    SOLANA_RPC_URL,
                    json={
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "getRecentBlockhash"
                    },
                    timeout=10.0
                )
                
                if response.status_code == 200:
                    # Solana转账手续费通常是5000 lamports
                    return 5000 / 1e9  # 0.000005 SOL
                    
        except Exception as e:
            logger.error(f"估算手续费失败: {e}")
            
        return 0.000005  # 默认手续费
    
    @staticmethod
    def get_user_wallet_by_address(owner: str, public_key: str) -> Optional[Wallet]:
        """根据地址获取用户钱包"""
        with get_session() as session:
            return session.exec(
                select(Wallet)
                .where(Wallet.owner == owner)
                .where(Wallet.public_key == public_key)
            ).first()
    
    @staticmethod
    def get_user_wallets_by_ids(owner: str, wallet_ids: List[int]) -> List[Wallet]:
        """根据ID获取用户钱包"""
        with get_session() as session:
            return session.exec(
                select(Wallet)
                .where(Wallet.owner == owner)
                .where(Wallet.id.in_(wallet_ids))
            ).all()
    
    @staticmethod
    def create_transfer_record(
        owner: str,
        from_address: str,
        to_address: str,
        amount: float,
        fee: float,
        memo: Optional[str] = None,
        transfer_type: str = "single",
        batch_id: Optional[str] = None
    ) -> TransferRecord:
        """创建转账记录"""
        with get_session() as session:
            record = TransferRecord(
                owner=owner,
                from_address=from_address,
                to_address=to_address,
                amount=amount,
                fee=fee,
                memo=memo,
                transfer_type=transfer_type,
                batch_id=batch_id
            )
            session.add(record)
            session.commit()
            session.refresh(record)
            return record
    
    @staticmethod
    def update_transfer_record(
        record_id: int,
        signature: Optional[str] = None,
        status: Optional[str] = None,
        error_message: Optional[str] = None,
        block_height: Optional[int] = None
    ):
        """更新转账记录"""
        with get_session() as session:
            record = session.get(TransferRecord, record_id)
            if record:
                if signature:
                    record.signature = signature
                if status:
                    record.status = status
                    if status == "confirmed":
                        record.confirmed = datetime.utcnow()
                if error_message:
                    record.error_message = error_message
                if block_height:
                    record.block_height = block_height
                
                session.add(record)
                session.commit()
    
    @staticmethod
    def get_user_transfer_records(owner: str, limit: int = 50) -> List[TransferRecord]:
        """获取用户转账记录"""
        with get_session() as session:
            # 修复SQLAlchemy错误：使用正确的查询语法
            records = session.exec(
                select(TransferRecord)
                .where(TransferRecord.owner == owner)
                .order_by(TransferRecord.created.desc())
                .limit(limit)
            ).all()
            return list(records)
    
    @staticmethod
    def create_batch_transfer_task(
        owner: str,
        to_address: str,
        amount_per_wallet: float,
        wallet_count: int,
        total_amount: float,
        total_fees: float,
        memo: Optional[str] = None
    ) -> BatchTransferTask:
        """创建批量转账任务"""
        task_id = uuid.uuid4().hex[:12]
        
        with get_session() as session:
            task = BatchTransferTask(
                id=task_id,
                owner=owner,
                to_address=to_address,
                amount_per_wallet=amount_per_wallet,
                total_wallets=wallet_count,
                total_amount=total_amount,
                total_fees=total_fees,
                memo=memo
            )
            session.add(task)
            session.commit()
            session.refresh(task)
            return task
    
    @staticmethod
    def update_batch_transfer_task(
        task_id: str,
        successful_transfers: Optional[int] = None,
        failed_transfers: Optional[int] = None,
        status: Optional[str] = None,
        error_message: Optional[str] = None
    ):
        """更新批量转账任务"""
        with get_session() as session:
            task = session.get(BatchTransferTask, task_id)
            if task:
                if successful_transfers is not None:
                    task.successful_transfers = successful_transfers
                if failed_transfers is not None:
                    task.failed_transfers = failed_transfers
                if status:
                    task.status = status
                    if status == "completed":
                        task.completed = datetime.utcnow()
                if error_message:
                    task.error_message = error_message
                
                session.add(task)
                session.commit()
    
    @staticmethod
    async def check_transaction_status(signature: str) -> Dict[str, Any]:
        """检查交易状态"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    SOLANA_RPC_URL,
                    json={
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "getSignatureStatuses",
                        "params": [[signature], {"searchTransactionHistory": True}]
                    },
                    timeout=10.0
                )
                
                if response.status_code == 200:
                    data = response.json()
                    if "result" in data and data["result"]["value"][0]:
                        status_info = data["result"]["value"][0]
                        return {
                            "confirmed": status_info.get("confirmationStatus") == "finalized",
                            "block_height": status_info.get("slot"),
                            "error": status_info.get("err")
                        }
                        
        except Exception as e:
            logger.error(f"检查交易状态失败 {signature}: {e}")
            
        return {"confirmed": False, "block_height": None, "error": None}
    
    @staticmethod
    async def get_recent_blockhash() -> Optional[str]:
        """获取最新区块哈希"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    SOLANA_RPC_URL,
                    json={
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "getRecentBlockhash"
                    },
                    timeout=10.0
                )
                
                if response.status_code == 200:
                    data = response.json()
                    if "result" in data:
                        return data["result"]["value"]["blockhash"]
                        
        except Exception as e:
            logger.error(f"获取区块哈希失败: {e}")
            
        return None
    
    @staticmethod
    def build_transfer_instruction(from_pubkey: str, to_pubkey: str, amount_lamports: int) -> Dict[str, Any]:
        """构建转账指令（前端使用）"""
        return {
            "type": "transfer",
            "fromPubkey": from_pubkey,
            "toPubkey": to_pubkey,
            "lamports": amount_lamports,
            "programId": "11111111111111111111111111111112"  # System Program
        }