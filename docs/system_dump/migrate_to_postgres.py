"""Load system_dump into PostgreSQL 15+ in topological FK order.

Usage:
  pip install psycopg[binary]
  python migrate_to_postgres.py --dsn "postgresql://user:pass@localhost:5432/mangalibrary"
"""
import argparse, gzip, json
from pathlib import Path
import psycopg

ROOT = Path(__file__).resolve().parent

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--dsn", required=True, help="PostgreSQL connection string")
    p.add_argument("--skip-legacy", action="store_true", help="Skip unmapped MangaCover/MangaCovers/MangaTopicAnalysis tables")
    args = p.parse_args()

    manifest = json.loads((ROOT / "data_manifest.json").read_text(encoding="utf-8"))
    ddl = (ROOT / "04_database_ddl_postgres.sql").read_text(encoding="utf-8")

    # Note: execute DDL up to Foreign Keys first for fastest bulk load, then add FKs/Indexes, OR run full DDL first.
    with psycopg.connect(args.dsn, autocommit=False) as conn:
        with conn.cursor() as cur:
            print("[1/2] Creating schema from 04_database_ddl_postgres.sql...")
            cur.execute(ddl)
        conn.commit()

        for tbl in manifest["tables"]:
            if args.skip_legacy and tbl.get("is_legacy_unmapped_in_orm"):
                continue
            tname = tbl["table_name"]
            cols = tbl["columns"]
            if not cols or tbl["exported_rows"] == 0:
                continue
            quoted_cols = ", ".join(f'"{c}"' for c in cols)
            placeholders = ", ".join(["%s"] * len(cols))
            sql = f'INSERT INTO "{tname}" ({quoted_cols}) VALUES ({placeholders}) ON CONFLICT DO NOTHING'

            loaded = 0
            with conn.cursor() as cur:
                for finfo in tbl["files"]:
                    fpath = ROOT / finfo["path"]
                    batch = []
                    with gzip.open(fpath, "rt", encoding="utf-8") as gz:
                        for line in gz:
                            obj = json.loads(line)
                            batch.append([obj.get(c) for c in cols])
                            if len(batch) >= 5000:
                                cur.executemany(sql, batch)
                                loaded += len(batch)
                                batch.clear()
                    if batch:
                        cur.executemany(sql, batch)
                        loaded += len(batch)
            conn.commit()
            print(f"[2/2] Loaded {tname}: {loaded} rows")

if __name__ == "__main__":
    main()
