import json
import base58
import logging
from datetime import datetime
from typing import List, Dict, Any, Optional
from pathlib import Path
import httpx
from sqlmodel import select

from app.db import get_session
from app.models import Wallet

logger = logging.getLogger(__name__)

# Solana RPC 端点（可以通过环境变量配置）
SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com"

def add_wallet(public_key: str, secret_key: str, owner: str, name: Optional[str] = None, source: str = "generated") -> Wallet:
    """添加钱包到数据库"""
    with get_session() as session:
        wallet = Wallet(
            public_key=public_key,
            secret_key=secret_key,
            owner=owner,
            name=name,
            source=source
        )
        session.add(wallet)
        session.commit()
        # 不需要 refresh，因为会话即将关闭
        return wallet

def import_wallets_from_json(file_content: str, owner: str) -> List[Dict[str, Any]]:
    """从 JSON 文件导入钱包
    支持两种格式：
    1. solana-keygen 格式：[私钥字节数组]
    2. 扩展格式：{"secret_key": [...], "public_key": "...", ...}
    """
    imported = []
    try:
        data = json.loads(file_content)
        
        # 处理单个钱包
        if isinstance(data, list) and all(isinstance(x, int) for x in data):
            # solana-keygen 格式
            secret_bytes = bytes(data)
            secret_b58 = base58.b58encode(secret_bytes).decode()
            
            # 重建公钥
            from solders.keypair import Keypair
            kp = Keypair.from_bytes(secret_bytes)
            public_key = str(kp.pubkey())
            
            wallet = add_wallet(public_key, secret_b58, owner, source="imported")
            imported.append({
                "public_key": public_key,
                "status": "success"
            })
            
        elif isinstance(data, dict):
            # 扩展格式
            if "secret_key" in data:
                secret_list = data["secret_key"]
                secret_bytes = bytes(secret_list)
                secret_b58 = base58.b58encode(secret_bytes).decode()
                
                if "public_key" in data:
                    public_key = data["public_key"]
                else:
                    # 从私钥重建公钥
                    from solders.keypair import Keypair
                    kp = Keypair.from_bytes(secret_bytes)
                    public_key = str(kp.pubkey())
                
                wallet = add_wallet(public_key, secret_b58, owner, 
                                  name=data.get("name"), source="imported")
                imported.append({
                    "public_key": public_key,
                    "status": "success"
                })
                
        elif isinstance(data, list):
            # 批量导入
            for idx, item in enumerate(data):
                try:
                    if isinstance(item, list):
                        # solana-keygen 格式数组
                        secret_bytes = bytes(item)
                        secret_b58 = base58.b58encode(secret_bytes).decode()
                        
                        from solders.keypair import Keypair
                        kp = Keypair.from_bytes(secret_bytes)
                        public_key = str(kp.pubkey())
                        
                        wallet = add_wallet(public_key, secret_b58, owner, source="imported")
                        imported.append({
                            "public_key": public_key,
                            "status": "success"
                        })
                    elif isinstance(item, dict) and "secret_key" in item:
                        # 扩展格式
                        secret_list = item["secret_key"]
                        secret_bytes = bytes(secret_list)
                        secret_b58 = base58.b58encode(secret_bytes).decode()
                        
                        if "public_key" in item:
                            public_key = item["public_key"]
                        else:
                            from solders.keypair import Keypair
                            kp = Keypair.from_bytes(secret_bytes)
                            public_key = str(kp.pubkey())
                        
                        wallet = add_wallet(public_key, secret_b58, owner, 
                                          name=item.get("name"), source="imported")
                        imported.append({
                            "public_key": public_key,
                            "status": "success"
                        })
                except Exception as e:
                    imported.append({
                        "index": idx,
                        "status": "error",
                        "error": str(e)
                    })
                    
    except Exception as e:
        logger.error(f"导入钱包失败: {e}")
        raise ValueError(f"无效的钱包文件格式: {e}")
    
    return imported

def get_user_wallets(owner: str) -> List[Wallet]:
    """获取用户的所有钱包"""
    with get_session() as session:
        return session.exec(
            select(Wallet)
            .where(Wallet.owner == owner)
            .order_by(Wallet.created.desc())
        ).all()

def export_wallets(wallet_ids: List[int], owner: str) -> List[Dict[str, Any]]:
    """导出指定的钱包"""
    with get_session() as session:
        wallets = session.exec(
            select(Wallet)
            .where(Wallet.owner == owner)
            .where(Wallet.id.in_(wallet_ids))
        ).all()
        
        export_data = []
        for wallet in wallets:
            # 将 base58 私钥转回字节数组
            secret_bytes = base58.b58decode(wallet.secret_key)
            export_data.append({
                "public_key": wallet.public_key,
                "secret_key": list(secret_bytes),
                "secret_key_base58": wallet.secret_key,
                "name": wallet.name,
                "created": wallet.created.isoformat()
            })
        
        return export_data

async def query_balances(wallet_ids: List[int], owner: str) -> Dict[str, float]:
    """查询指定钱包的余额"""
    with get_session() as session:
        wallets = session.exec(
            select(Wallet)
            .where(Wallet.owner == owner)
            .where(Wallet.id.in_(wallet_ids))
        ).all()
        
        balances = {}
        
        async with httpx.AsyncClient() as client:
            for wallet in wallets:
                try:
                    # Solana RPC 调用获取余额
                    response = await client.post(
                        SOLANA_RPC_URL,
                        json={
                            "jsonrpc": "2.0",
                            "id": 1,
                            "method": "getBalance",
                            "params": [wallet.public_key]
                        }
                    )
                    
                    if response.status_code == 200:
                        data = response.json()
                        if "result" in data:
                            # 余额以 lamports 返回，需要转换为 SOL (1 SOL = 10^9 lamports)
                            balance_lamports = data["result"]["value"]
                            balance_sol = balance_lamports / 1e9
                            balances[wallet.public_key] = balance_sol
                            
                            # 更新数据库中的余额缓存
                            wallet.balance = balance_sol
                            wallet.last_checked = datetime.utcnow()
                        else:
                            balances[wallet.public_key] = None
                    else:
                        balances[wallet.public_key] = None
                        
                except Exception as e:
                    logger.error(f"查询钱包 {wallet.public_key} 余额失败: {e}")
                    balances[wallet.public_key] = None
        
        # 保存更新的余额
        session.commit()
        
        return balances

def delete_wallets(wallet_ids: List[int], owner: str) -> int:
    """删除指定的钱包"""
    with get_session() as session:
        wallets = session.exec(
            select(Wallet)
            .where(Wallet.owner == owner)
            .where(Wallet.id.in_(wallet_ids))
        ).all()
        
        count = len(wallets)
        for wallet in wallets:
            session.delete(wallet)
        
        session.commit()
        return count
    
def update_wallet_name(wallet_id: int, owner: str, name: str) -> Wallet:
    """更新钱包名称"""
    with get_session() as session:
        wallet = session.get(Wallet, wallet_id)
        if not wallet or wallet.owner != owner:
            raise ValueError("wallet not found")

        wallet.name = name
        session.add(wallet)
        session.commit()
        session.refresh(wallet)
        return wallet