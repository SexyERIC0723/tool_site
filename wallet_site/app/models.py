from sqlmodel import SQLModel, Field, Column, JSON
from datetime import datetime
from typing import Dict, Any

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
