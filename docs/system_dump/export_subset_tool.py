"""Create a compact portable SQLite DB or JSONL slice of Manga with MinIO covers.

Uses ONLY Python stdlib (no external dependencies required).
Usage:
  python export_subset_tool.py --out curated_manga.sqlite --max-manga 1000
"""
import argparse, gzip, json, sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def find_files(manifest, table_name):
    for t in manifest["tables"]:
        if t["table_name"] == table_name:
            return t["columns"], [ROOT / f["path"] for f in t["files"]]
    return [], []

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--out", default="curated_manga.sqlite")
    p.add_argument("--only-minio-covers", action="store_true", default=True)
    p.add_argument("--max-manga", type=int, default=1000)
    args = p.parse_args()

    manifest = json.loads((ROOT / "data_manifest.json").read_text(encoding="utf-8"))
    target_manga_ids = set()

    # 1. Pick manga IDs that have local covers/ objects in Covers table
    _, cover_files = find_files(manifest, "Covers")
    for fpath in cover_files:
        with gzip.open(fpath, "rt", encoding="utf-8") as gz:
            for line in gz:
                row = json.loads(line)
                url = row.get("url") or ""
                if not args.only_minio_covers or url.startswith("covers/"):
                    target_manga_ids.add(row["manga_id"])
                    if len(target_manga_ids) >= args.max_manga:
                        break
        if len(target_manga_ids) >= args.max_manga:
            break

    print(f"Selected {len(target_manga_ids)} manga IDs.")
    out_path = Path(args.out)
    if out_path.exists():
        out_path.unlink()
    db = sqlite3.connect(out_path)

    filter_keys = {
        "Tag": None,
        "Manga": "MangaId",
        "MangaStatistics": "MangaId",
        "MangaDescription": "MangaId",
        "MangaAltTitle": "MangaId",
        "MangaTag": "MangaId",
        "MangaAvailableLanguage": "MangaId",
        "Covers": "manga_id",
        "Chapter": "MangaId",
    }

    for tname, filter_col in filter_keys.items():
        cols, files = find_files(manifest, tname)
        if not cols:
            continue
        db.execute(f'CREATE TABLE "{tname}" ({", ".join(chr(34)+c+chr(34)+" TEXT" for c in cols)})')
        sql = f'INSERT INTO "{tname}" VALUES ({",".join(["?"]*len(cols))})'
        batch, count = [], 0
        for fpath in files:
            with gzip.open(fpath, "rt", encoding="utf-8") as gz:
                for line in gz:
                    obj = json.loads(line)
                    if filter_col and obj.get(filter_col) not in target_manga_ids:
                        continue
                    batch.append([None if obj.get(c) is None else str(obj.get(c)) for c in cols])
                    if len(batch) >= 5000:
                        db.executemany(sql, batch)
                        count += len(batch)
                        batch.clear()
        if batch:
            db.executemany(sql, batch)
            count += len(batch)
        db.commit()
        print(f"  wrote {tname}: {count} rows")
    db.close()
    print(f"Saved portable SQLite subset -> {out_path}")

if __name__ == "__main__":
    main()
