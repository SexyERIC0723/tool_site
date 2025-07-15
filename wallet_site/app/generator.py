from pathlib import Path
from bulk_generate import batch_generate
from app.service import add_job
from app.wallet_service import add_wallet
import uuid, tempfile, json, base58

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

    # 将生成的钱包保存到数据库
    for idx, pubkey in enumerate(pubkeys):
        # 读取生成的钱包文件
        info_file = out_dir / f"wallet_{idx}_info.json"
        if info_file.exists():
            with open(info_file, 'r') as f:
                wallet_info = json.load(f)
                secret_key_b58 = wallet_info.get("secret_key_base58")
                
                # 保存到数据库
                add_wallet(
                    public_key=pubkey,
                    secret_key=secret_key_b58,
                    owner=owner,
                    name=f"Generated #{idx+1}",
                    source="generated"
                )

    add_job(job_id, out_dir, len(pubkeys), args, owner)
    return job_id, pubkeys, out_dir            # ★ 现在返回 3 个值