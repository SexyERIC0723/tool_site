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

# 钱包管理模型
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

# 转账记录模型
class TransferRecord(SQLModel, table=True):
    id: int = Field(primary_key=True)
    owner: str = Field(foreign_key="user.wallet", index=True)  # 发起转账的用户
    from_address: str = Field(index=True)  # 发送方地址
    to_address: str = Field(index=True)  # 接收方地址
    amount: float  # 转账金额（SOL）
    fee: float  # 手续费（SOL）
    memo: Optional[str] = None  # 转账备注
    signature: Optional[str] = Field(index=True)  # 交易签名/hash
    status: str = Field(default="pending", index=True)  # 状态：pending/confirmed/failed
    error_message: Optional[str] = None  # 错误信息（如果失败）
    created: datetime = Field(default_factory=datetime.utcnow)
    confirmed: Optional[datetime] = None  # 确认时间
    block_height: Optional[int] = None  # 区块高度
    transfer_type: str = "single"  # 转账类型：single/batch
    batch_id: Optional[str] = None  # 批量转账ID（用于关联同一批次的转账）

# 批量转账任务模型
class BatchTransferTask(SQLModel, table=True):
    id: str = Field(primary_key=True)  # 批量转账任务ID
    owner: str = Field(foreign_key="user.wallet", index=True)
    to_address: str  # 目标地址
    amount_per_wallet: float  # 每个钱包转账金额
    total_wallets: int  # 总钱包数
    successful_transfers: int = 0  # 成功转账数
    failed_transfers: int = 0  # 失败转账数
    total_amount: float  # 总转账金额
    total_fees: float  # 总手续费
    status: str = "pending"  # 状态：pending/processing/completed/failed
    memo: Optional[str] = None
    created: datetime = Field(default_factory=datetime.utcnow)
    completed: Optional[datetime] = None
    error_message: Optional[str] = None