#!/usr/bin/env python3
# bulk_generate.py  —— 批量生成 Solana 钱包：solana-keygen + Phantom 双兼容，带实时日志
import os, json, time, random, argparse, logging, base58
from logging.handlers import RotatingFileHandler
from concurrent.futures import ThreadPoolExecutor, as_completed

# ---------- 兼容导入 ----------
try:                                   # solana-py 0.30–0.35
    from solana.keypair import Keypair
    _NEW_API = False
except ModuleNotFoundError:            # ≥0.36
    from solders.keypair import Keypair
    _NEW_API = True

# ---------- Keypair 抽象 ----------
def _new_keypair():                    # ➜ Keypair
    return Keypair.generate() if (not _NEW_API and hasattr(Keypair, "generate")) else Keypair()

def _secret_bytes(kp):                 # ➜ bytes
    return kp.to_bytes() if hasattr(kp, "to_bytes") else kp.secret_key

def _pubkey_str(kp):                   # ➜ str
    return str(kp.pubkey() if hasattr(kp, "pubkey") else kp.public_key)

# ---------- 日志 ----------
def setup_logger(level: str, logfile="bulk_generate.log"):
    lg = logging.getLogger()
    lg.setLevel(level)
    fmt = logging.Formatter("[%(asctime)s | %(levelname)s | %(threadName)s] %(message)s",
                            "%Y-%m-%d %H:%M:%S")
    sh = logging.StreamHandler(); sh.setFormatter(fmt); lg.addHandler(sh)
    fh = RotatingFileHandler(logfile, maxBytes=2*1024*1024, backupCount=3, encoding="utf-8")
    fh.setFormatter(fmt); lg.addHandler(fh)

# ---------- 等待进度 ----------
def _wait(delay: float, idx: int, tick: float = 5.0):
    lg = logging.getLogger()
    lg.info("wallet #%d 正在等待中，总计 %.2f 秒…", idx, delay)
    remain = delay
    while remain > 0:
        step = min(tick, remain)
        time.sleep(step)
        remain -= step
        if remain > 0:
            lg.debug("wallet #%d 剩余 %.2f 秒", idx, remain)

# ---------- 单个生成 ----------
def gen_one(idx: int, out_dir: str, min_d: float, max_d: float):
    lg = logging.getLogger()
    kp = _new_keypair()
    secret_bytes = _secret_bytes(kp)
    secret_list  = list(secret_bytes)
    pubkey       = _pubkey_str(kp)
    b58_secret   = base58.b58encode(secret_bytes).decode()

    # ① solana-keygen 兼容文件
    with open(os.path.join(out_dir, f"wallet_{idx}.json"), "w") as f:
        json.dump(secret_list, f)

    # ② 附带信息文件
    with open(os.path.join(out_dir, f"wallet_{idx}_info.json"), "w") as f:
        json.dump({
            "secret_key"        : secret_list,
            "secret_key_base58" : b58_secret,
            "public_key"        : pubkey
        }, f, indent=2)

    lg.info("生成完成 #%d → %s", idx, pubkey)
    _wait(random.uniform(min_d, max_d), idx)
    return pubkey

# ---------- 批量 ----------
def batch_generate(total, min_d, max_d, workers, out_dir):
    lg = logging.getLogger()
    os.makedirs(out_dir, exist_ok=True)
    lg.info("开始生成 %d 个钱包（线程=%d，间隔 %.2f–%.2f 秒）", total, workers, min_d, max_d)

    pubs = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(gen_one, i, out_dir, min_d, max_d): i for i in range(total)}
        for fut in as_completed(futures):
            try:
                pubs.append(fut.result())
            except Exception as e:
                lg.error("wallet #%d 失败: %s", futures[fut], e, exc_info=True)

    lg.info("✅ 全部完成，共 %d 个钱包；文件位于 %s/", len(pubs), out_dir)
    return pubs

# ---------- CLI ----------
if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="批量生成 Solana 钱包，双格式输出 + 实时日志")
    ap.add_argument("-n", "--num", type=int, default=100, help="生成数量")
    ap.add_argument("--min-delay", type=float, default=0.1, help="最小间隔秒")
    ap.add_argument("--max-delay", type=float, default=0.5, help="最大间隔秒")
    ap.add_argument("-w", "--workers", type=int, default=4, help="并发线程数")
    ap.add_argument("-o", "--out", default="wallets", help="输出目录")
    ap.add_argument("--log-level", default="INFO",
                    choices=["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"])
    args = ap.parse_args()

    if args.min_delay < 0 or args.max_delay < 0:
        raise ValueError("延迟必须为非负数")
    if args.min_delay > args.max_delay:
        raise ValueError("min-delay 不能大于 max-delay")

    setup_logger(args.log_level)
    batch_generate(args.num, args.min_delay, args.max_delay, args.workers, args.out)
