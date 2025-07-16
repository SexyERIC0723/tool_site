from pathlib import Path
from typing import List, Dict, Any
from sqlmodel import select
from app.db import engine, get_session
from app.models import Job, User, Wallet, TransferRecord, BatchTransferTask

# 第一次启动建表
Job.metadata.create_all(engine)
User.metadata.create_all(engine)
Wallet.metadata.create_all(engine)
TransferRecord.metadata.create_all(engine)
BatchTransferTask.metadata.create_all(engine)

# add_job 里增加 owner
def add_job(job_id, path, count, params, owner):
    with get_session() as ses:
        ses.add(Job(id=job_id, owner=owner,
                    path=str(path), count=count, params=params))
        ses.commit()

def list_jobs_by_user(owner: str):
    with get_session() as ses:
        return ses.exec(select(Job).where(Job.owner == owner)
                        .order_by(Job.created.desc())).all()


def get_job(jid: str) -> Job | None:
    with get_session() as ses:
        return ses.get(Job, jid)