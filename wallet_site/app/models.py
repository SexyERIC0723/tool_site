from sqlmodel import SQLModel, Field, Column, JSON
from datetime import datetime
from typing import Dict, Any, Optional

class User(SQLModel, table=True):
    wallet: str = Field(primary_key=True, index=True)  # 公钥字符串

class Job(SQLModel, table=True):
    id: str = Field(primary_key=True, index=True)
    owner: str = Field(foreign_key="user.wallet")       # ★ 归属
    created: datetime = Field(default_factory=datetime.utcnow)
    params: Dict[str, Any] = Field(default_factory=dict,
                                   sa_column=Column(JSON))
    path: str
    count: int

# 新增钱包管理模型
class Wallet(SQLModel, table=True):
    id: int = Field(primary_key=True)
    public_key: str = Field(index=True)  # 钱包公钥
    owner: str = Field(foreign_key="user.wallet", index=True)  # 所属用户
    name: Optional[str] = None  # 钱包名称（可选）
    secret_key: str  # 加密存储的私钥（base58格式）
    created: datetime = Field(default_factory=datetime.utcnow)
    balance: Optional[float] = None  # 缓存的余额（SOL）
    last_checked: Optional[datetime] = None  # 最后查询余额时间
    source: str = "generated"  # 来源：generated/imported