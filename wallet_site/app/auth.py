import os, secrets, time, json, base58, nacl.signing
from typing import Optional
from jose import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer
from datetime import datetime, timedelta
from app.db import get_session
from app.models import User
import logging

JWT_SECRET = os.getenv("JWT_SECRET", secrets.token_hex(32))
ALGO = "HS256"
TOKEN_EXPIRE_MIN = 60 * 24  # 1 day

bearer_scheme = HTTPBearer()

# -------- nonce --------
_NONCE_TTL = 300          # 5 分钟
_nonce_cache: dict[str, tuple[str, float]] = {}  # wallet -> (nonce, expire_ts)

def create_nonce(wallet: str) -> str:
    nonce = secrets.token_hex(8)
    _nonce_cache[wallet] = (nonce, time.time() + _NONCE_TTL)  # 存储 nonce 和过期时间
    return nonce


def pop_nonce(wallet: str): 
    _nonce_cache.pop(wallet, None)

def verify_signature(wallet: str, message: str, sig_b58: str) -> bool:
    try:
        sig = base58.b58decode(sig_b58)
        if len(sig) != 64:
            return False
        vk  = nacl.signing.VerifyKey(base58.b58decode(wallet))
        vk.verify(message.encode(), signature=sig)   # ★ 指定关键字参数
        return True
    except Exception:
        return False

def upsert_user(wallet: str):
    from app.db import get_session
    with get_session() as ses:
        user = ses.get(User, wallet)
        if not user:
            ses.add(User(wallet=wallet))
            ses.commit()

def gen_jwt(wallet: str) -> str:
    payload = {
        "sub": wallet,
        "exp": datetime.utcnow() + timedelta(minutes=TOKEN_EXPIRE_MIN)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=ALGO)

def decode_jwt(token: str) -> Optional[str]:
    try:
        data = jwt.decode(token, JWT_SECRET, algorithms=[ALGO])
        return data["sub"]
    except jwt.JWTError:
        return None

async def current_user(credentials=Depends(bearer_scheme)) -> str:
    wallet = decode_jwt(credentials.credentials)
    if not wallet:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Invalid token")
    return wallet

def consume_nonce(wallet: str, message: str = None) -> bool:
    """检查 nonce 是否有效"""
    cache_data = _nonce_cache.get(wallet)
    logging.info(f"consume_nonce - wallet: {wallet}, cache_data: {cache_data}")
    
    if not cache_data:
        logging.info("consume_nonce - no cache data found")
        return False
    
    nonce, expire_ts = cache_data
    current_time = time.time()
    logging.info(f"consume_nonce - nonce: {nonce}, expire_ts: {expire_ts}, current_time: {current_time}")
    
    if expire_ts <= current_time:
        logging.info("consume_nonce - nonce expired")
        return False
    
    # 如果提供了 message，可以验证 nonce 是否在消息中
    if message:
        expected = f"Nonce: {nonce}"
        logging.info(f"consume_nonce - checking message, expected: '{expected}', message: '{message}'")
        if expected not in message:
            logging.info("consume_nonce - nonce not found in message")
            return False
    
    logging.info("consume_nonce - success")
    return True
