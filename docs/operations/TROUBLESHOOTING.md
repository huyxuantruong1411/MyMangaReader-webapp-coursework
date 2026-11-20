# Local Environment Troubleshooting Guide

## 1. PowerShell 5.1 Rejects `&&` Command Chaining
- **Symptom:** `The token '&&' is not a valid statement separator in this version.`
- **Cause:** Windows PowerShell 5.1 does not support bash-style `&&` (unlike PowerShell 7+ or `cmd.exe`).
- **Fix:** Use `pnpm` scripts (which execute via `cmd.exe`), or chain PowerShell commands with `;` and `$ErrorActionPreference = 'Stop'`.

## 2. SQL Server Connection Refused on `127.0.0.1:1433`
- **Symptom:** TCP connection to `127.0.0.1:1433` fails even though `MSSQLSERVER` Windows service is running.
- **Cause:** Local SQL Server Express often listens on Shared Memory / Named Pipes without TCP/IP enabled on port 1433.
- **Fix:** Use ODBC Driver 17 with `@localhost` and `Trusted_Connection=yes`:
  ```ini
  DATABASE_URL="mssql+aioodbc://@localhost/QL_DocTruyen?driver=ODBC+Driver+17+for+SQL+Server&Trusted_Connection=yes&TrustServerCertificate=yes&MARS_Connection=yes"
  ```
  Verify connectivity with:
  ```powershell
  sqlcmd -S localhost -d QL_DocTruyen -E -C -Q "SELECT 1"
  ```

## 3. Low Disk Space on Drive `C:`
- **Symptom:** Docker Desktop or package installs warn about Drive `C:` space.
- **Fix:**
  - `apps/api/pyproject.toml` pins `uv`'s cache to `apps/api/.uv-cache` (on `D:`).
  - `.npmrc` pins `pnpm`'s store to `.pnpm-store` (on `D:`).
  - Avoid pulling large Docker images (`mcr.microsoft.com/mssql/server`, Elasticsearch). Reuse local SQL Server 2022, native Memurai (`:6379`), and existing `elestio/minio:latest` (`:9010`).

## 4. Backend Starts in `dev-fallback` Mode
- **Symptom:** `GET /api/v1/health/ready` reports `"mode": "dev-fallback"` for database, cache, or storage.
- **Cause:** Expected default behavior when running without `.env` overrides for MSSQL/Redis/MinIO.
- **Fix:** Follow `docs/operations/LOCAL_SETUP.md` §2 Option B to point `.env` at live local services. Note that `APP_ENV=production` intentionally refuses `dev-fallback` cache/storage adapters and default JWT secrets.

## 5. Port Collisions (`8000`, `8010`, `9000`, `9010`)
- **Context:** Other projects on this host use ports `8000`, `8010` (`manga_backend`), `9000`, and `9010` (`mangalibrary-minio`).
- **Fix:** This application defaults to backend port `8020` (`API_PORT`) and frontend Vite port `5173`. If either is occupied, update `API_PORT` in `.env` and `server.proxy["/api"].target` in `apps/web/vite.config.ts`.

## 6. `mypy` or `pytest` Cannot Import `manga_reader`
- **Symptom:** `ModuleNotFoundError: No module named 'manga_reader'`.
- **Fix:** Always invoke Python tools via `uv --project apps/api run ...` (or re-run `uv --project apps/api sync`) so the editable `src/manga_reader` package in `apps/api/.venv` is installed.
