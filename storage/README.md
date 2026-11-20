# Object Storage & Media Delivery Architecture (`storage/`)

## 1. Critical Media Identity Rule (`ADR-018`)

The canonical identity of every cover art image, chapter page image, and user avatar is:

```text
(bucket, object_key)
```

- **NEVER** persist temporary signed URLs, CDN URLs, or upstream provider URLs as permanent media identities.
- `ReaderMediaRef` in `manga-reader-package:2.0` supplies `(bucket, object_key)` alongside verified metadata (`content_type`, `width`, `height`, `file_size`, `md5_hash`, `sha256`).
- Runtime URLs (presigned S3/CDN URLs or authorized backend proxy URLs) are generated dynamically by `MediaUrlSigner` **only after** enforcing `mangas.visibility_status = 'PUBLIC'` (or appropriate admin/self permissions).

## 2. Security Validation Rules

Every `object_key` and `bucket` passes strict validation before storage access:
1. `bucket` must match S3 bucket rules (3–63 chars, lowercase alphanumeric + hyphens) and belong to `S3_ALLOWED_BUCKETS`.
2. `object_key` must reject path traversal (`..`), null bytes, control characters, backslashes, and leading slashes.
3. Uploaded files (e.g., Reader avatars in Phase 2) must validate decoded MIME type (JPG/PNG/WebP), pixel dimensions, and byte size against `config.settings` — never trust file extensions.

## 3. Storage Adapters (Development vs. Production)

| Mode (`STORAGE_BACKEND`) | Implementation | Description |
|---|---|---|
| `local-dev` *(default)* | `LocalDevStorageAdapter` | Stores objects under `storage/local-dev/<bucket>/<object_key>` (gitignored). Zero external credentials required for local dev & CI tests. **Not for production.** |
| `minio` | `MinioS3StorageAdapter` | Connects to the existing local MinIO container (`mangalibrary-minio` at `http://127.0.0.1:9010`, console `http://127.0.0.1:9011`). Use a dedicated bucket `manga-reader-media` so existing coursework objects in `manga-media` (`1,116` objects) are never overwritten. |
| `s3` | `MinioS3StorageAdapter` | Any S3-compatible production store (AWS S3, Cloudflare R2, MinIO cluster) paired with a CDN edge. |

## 4. Garbage Collection Safety (`M-004` / `ADR-011`)

When a manga is deleted or an avatar is replaced:
1. Never synchronously delete storage objects during an Admin HTTP request.
2. Enqueue a media GC job via the transactional outbox.
3. Only delete `(bucket, object_key)` from object storage when `COUNT(*)` of active references across `chapter_pages`, `manga_cover_arts`, `mangas.primary_cover_media_id`, and `readers` is strictly `0` and the configured retention window has elapsed.
