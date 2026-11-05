"""从 ECDICT 的 ecdict.csv 构建本地离线词库 data/ecdict.db。

只保留"值得离线"的词：牛津 3000 / 各类考试词表 / 有 BNC 或 COCA 词频的词，
避免把 340 万条生僻词全塞进来（那是 100MB+，查不着也用不上）。

用法：
  python scripts/import_ecdict.py              # 默认读 data/ecdict.csv
  python scripts/import_ecdict.py --all        # 全量（不筛词频，库会大很多）
  python scripts/import_ecdict.py --csv X --out Y
"""

from __future__ import annotations

import argparse
import csv
import os
import sqlite3
import sys
import time
from pathlib import Path

csv.field_size_limit(10 * 1024 * 1024)

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CSV = ROOT / "data" / "ecdict.csv"
DEFAULT_OUT = ROOT / "data" / "ecdict.db"


def keep(row: dict, keep_all: bool) -> bool:
    word = (row.get("word") or "").strip()
    if not word or len(word) > 48:
        return False
    if not (row.get("translation") or row.get("definition")):
        return False
    if keep_all:
        return True
    if row.get("oxford") in ("1", 1):
        return True
    if (row.get("collins") or 0) not in (0, "0", ""):
        return True
    if (row.get("tag") or "").strip():
        return True
    try:
        if int(row.get("bnc") or 0) > 0 or int(row.get("frq") or 0) > 0:
            return True
    except (TypeError, ValueError):
        pass
    return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", default=str(DEFAULT_CSV))
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--all", action="store_true", help="不按词频筛，全量导入")
    args = ap.parse_args()

    csv_path = Path(args.csv)
    out_path = Path(args.out)
    if not csv_path.exists():
        print(f"找不到 {csv_path}，先下载 ecdict.csv（66MB）")
        return 1

    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_path.with_suffix(".db.tmp")
    if tmp.exists():
        tmp.unlink()

    conn = sqlite3.connect(tmp)
    conn.execute(
        "CREATE TABLE dict (word TEXT PRIMARY KEY, phonetic TEXT, definition TEXT, "
        "translation TEXT, pos TEXT, collins INTEGER, oxford INTEGER, tag TEXT, "
        "bnc INTEGER, frq INTEGER, exchange TEXT)"
    )

    t0 = time.time()
    total = kept = 0
    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        batch = []
        for row in reader:
            total += 1
            if not keep(row, args.all):
                continue
            word = (row.get("word") or "").strip().lower()

            def num(key: str) -> int:
                try:
                    return int(row.get(key) or 0)
                except (TypeError, ValueError):
                    return 0

            batch.append(
                (
                    word,
                    (row.get("phonetic") or "").strip(),
                    (row.get("definition") or "").replace("\\n", "\n").strip(),
                    (row.get("translation") or "").replace("\\n", "\n").strip(),
                    (row.get("pos") or "").strip(),
                    num("collins"),
                    num("oxford"),
                    (row.get("tag") or "").strip(),
                    num("bnc"),
                    num("frq"),
                    (row.get("exchange") or "").strip(),
                )
            )
            if len(batch) >= 5000:
                conn.executemany("INSERT OR REPLACE INTO dict VALUES (?,?,?,?,?,?,?,?,?,?,?)", batch)
                kept += len(batch)
                batch.clear()
        if batch:
            conn.executemany("INSERT OR REPLACE INTO dict VALUES (?,?,?,?,?,?,?,?,?,?,?)", batch)
            kept += len(batch)

    conn.execute("CREATE INDEX idx_dict_word ON dict(word)")
    conn.execute("PRAGMA journal_mode=WAL")
    conn.commit()
    conn.execute("VACUUM")
    conn.commit()
    conn.close()

    os.replace(tmp, out_path)
    size = out_path.stat().st_size / 1024 / 1024
    print(f"读入 {total} 行，保留 {kept} 词，输出 {out_path}（{size:.1f} MB），耗时 {time.time()-t0:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
