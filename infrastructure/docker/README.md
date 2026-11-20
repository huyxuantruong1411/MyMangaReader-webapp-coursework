# Local Infrastructure & Docker Guide

This project is designed to start with **zero Docker containers required** in default `local-dev` / `memory` / `sqlite` mode, while seamlessly leveraging the host machine's existing local services when desired:

1. **Existing Local SQL Server 2022 (`MSSQLSERVER`):** Hosts `QL_DocTruyen` natively (Windows Authentication via `ODBC Driver 17 for SQL Server`).
2. **Existing Local MinIO (`mangalibrary-minio`):** Already running on `http://127.0.0.1:9010` (Console `http://127.0.0.1:9011`) using `elestio/minio:latest`. Use a dedicated bucket `manga-reader-media` to keep project data isolated.
3. **Existing Local Memurai (Redis):** Already running on `127.0.0.1:6379`. Use Redis DB index `/1` with key prefix `mreader:`.

## Optional Standalone Containers

If you run on a machine without native Memurai or MinIO, use the opt-in profiles in `docker-compose.dev.yml` (ports `9020/9021` and `6380` avoid conflicts with existing host services):

```powershell
# Ensure bind-mount folder exists on Drive D:
New-Item -ItemType Directory -Force -Path storage/local-dev/minio-data

# Start standalone MinIO (reuses local elestio/minio:latest image)
docker compose -f infrastructure/docker/docker-compose.dev.yml --profile minio up -d

# Start standalone Redis (pulls redis:7-alpine only if requested)
docker compose -f infrastructure/docker/docker-compose.dev.yml --profile redis up -d
```

## Service Health Check Script

Run the Windows environment checker anytime:

```powershell
powershell -ExecutionPolicy Bypass -File infrastructure/scripts/check-local-services.ps1
```
