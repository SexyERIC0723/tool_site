from pathlib import Path
from bulk_generate import batch_generate
from app.service import add_job
import uuid, tempfile

def generate_wallets(args: dict, owner: str):
    """
    生成钱包 → 写数据库 → 返回 (job_id, pubkeys, out_dir)
    """
    job_id  = uuid.uuid4().hex[:8]
    out_dir = Path(tempfile.gettempdir()) / f"wallet_job_{job_id}"
    out_dir.mkdir(parents=True, exist_ok=True)

    pubkeys = batch_generate(
        total=args["num"],
        min_d=args["min_delay"],
        max_d=args["max_delay"],
        workers=args["workers"],
        out_dir=str(out_dir),
    )

    add_job(job_id, out_dir, len(pubkeys), args, owner)
    return job_id, pubkeys, out_dir            # ★ 现在返回 3 个值
