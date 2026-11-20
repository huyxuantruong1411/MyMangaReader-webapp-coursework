import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  CONTRACT_NAME,
  CONTRACT_VERSION,
  type ContentRating,
  type ContractValidationIssue,
  type ContractValidationResult,
  type MangaReaderPackageV2,
  type ReaderMediaRef,
} from "./types.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(currentDir, "../schemas/manga-reader-package.v2.0.schema.json");

let cachedSchema: Record<string, unknown> | null = null;

export function loadContractV2Schema(): Record<string, unknown> {
  if (!cachedSchema) {
    cachedSchema = JSON.parse(readFileSync(schemaPath, "utf-8")) as Record<string, unknown>;
  }
  return cachedSchema;
}

const ajv = new Ajv2020.default({
  allErrors: true,
  strict: false,
});
addFormats.default(ajv);

const compiledValidator = ajv.compile<MangaReaderPackageV2>(loadContractV2Schema());

const SAFE_BUCKET_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const ALLOWED_LINK_PROTOCOLS = new Set(["http:", "https:"]);

function validateMediaRef(
  media: ReaderMediaRef,
  path: string,
  issues: ContractValidationIssue[],
): void {
  if (!SAFE_BUCKET_PATTERN.test(media.bucket)) {
    issues.push({
      code: "UNSAFE_MEDIA_REFERENCE",
      path: `${path}.bucket`,
      message: `Bucket '${media.bucket}' does not satisfy S3 bucket naming rules.`,
    });
  }
  if (
    media.object_key.startsWith("/") ||
    media.object_key.includes("\\") ||
    media.object_key.includes("\0") ||
    media.object_key.split("/").some((segment) => segment === "..")
  ) {
    issues.push({
      code: "UNSAFE_MEDIA_REFERENCE",
      path: `${path}.object_key`,
      message: `Object key '${media.object_key}' contains disallowed path traversal or control characters.`,
    });
  }
}

export function isContentRatingSafe(rating: ContentRating | undefined): boolean {
  // Canonical rule: `unknown` MUST NEVER be treated as `safe`.
  return rating === "safe";
}

export function validateMangaReaderPackageV2(payload: unknown): ContractValidationResult {
  const issues: ContractValidationIssue[] = [];

  if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
    const raw = payload as Record<string, unknown>;
    if (raw["contract_name"] !== undefined && raw["contract_name"] !== CONTRACT_NAME) {
      issues.push({
        code: "UNSUPPORTED_CONTRACT_VERSION",
        path: "/contract_name",
        message: `Unsupported contract_name '${String(raw["contract_name"])}'. Expected '${CONTRACT_NAME}'.`,
      });
    }
    if (raw["contract_version"] !== undefined && raw["contract_version"] !== CONTRACT_VERSION) {
      issues.push({
        code: "UNSUPPORTED_CONTRACT_VERSION",
        path: "/contract_version",
        message: `Unsupported contract_version '${String(raw["contract_version"])}'. Expected '${CONTRACT_VERSION}'.`,
      });
    }
    if (issues.length > 0) {
      return { valid: false, isMetadataOnly: raw["chapters"] === undefined, issues };
    }
  }

  const schemaOk = compiledValidator(payload);
  if (!schemaOk) {
    for (const err of compiledValidator.errors ?? []) {
      issues.push({
        code: "SCHEMA_VIOLATION",
        path: err.instancePath || "/",
        message: err.message ?? "Schema validation failed",
      });
    }
    return { valid: false, isMetadataOnly: false, issues };
  }

  const pkg = payload as MangaReaderPackageV2;
  const isMetadataOnly = pkg.chapters === undefined;

  if (pkg.manga.primary_cover) {
    validateMediaRef(pkg.manga.primary_cover, "/manga/primary_cover", issues);
  }
  for (const [idx, cover] of (pkg.manga.cover_arts ?? []).entries()) {
    validateMediaRef(cover.media, `/manga/cover_arts/${idx}/media`, issues);
  }
  for (const [idx, link] of (pkg.manga.links ?? []).entries()) {
    try {
      const parsed = new URL(link.url);
      if (!ALLOWED_LINK_PROTOCOLS.has(parsed.protocol)) {
        issues.push({
          code: "UNSAFE_LINK_SCHEME",
          path: `/manga/links/${idx}/url`,
          message: `Disallowed URL scheme '${parsed.protocol}'.`,
        });
      }
    } catch {
      issues.push({
        code: "UNSAFE_LINK_SCHEME",
        path: `/manga/links/${idx}/url`,
        message: `Invalid URL '${link.url}'.`,
      });
    }
  }

  if (pkg.chapters !== undefined) {
    const seenChapterIds = new Set<string>();
    for (const [cIdx, chapter] of pkg.chapters.entries()) {
      if (chapter.pool_manga_id !== pkg.manga.pool_manga_id) {
        issues.push({
          code: "CHAPTER_MANGA_MISMATCH",
          path: `/chapters/${cIdx}/pool_manga_id`,
          message: `Chapter '${chapter.pool_chapter_id}' references pool_manga_id '${chapter.pool_manga_id}', expected '${pkg.manga.pool_manga_id}'.`,
        });
      }
      if (seenChapterIds.has(chapter.pool_chapter_id)) {
        issues.push({
          code: "DUPLICATE_CHAPTER_ID",
          path: `/chapters/${cIdx}/pool_chapter_id`,
          message: `Duplicate pool_chapter_id '${chapter.pool_chapter_id}'.`,
        });
      }
      seenChapterIds.add(chapter.pool_chapter_id);

      const pages = chapter.pages ?? [];
      if (chapter.page_count !== undefined && chapter.page_count !== pages.length) {
        issues.push({
          code: "PAGE_COUNT_MISMATCH",
          path: `/chapters/${cIdx}/page_count`,
          message: `Chapter '${chapter.pool_chapter_id}' page_count (${chapter.page_count}) does not match pages.length (${pages.length}).`,
        });
      }

      const seenPageUids = new Set<string>();
      const pageNumbers = pages.map((p) => p.page_number).sort((a, b) => a - b);
      for (let i = 0; i < pageNumbers.length; i += 1) {
        if (pageNumbers[i] !== i + 1) {
          issues.push({
            code: "NONCONTIGUOUS_PAGE_NUMBERS",
            path: `/chapters/${cIdx}/pages`,
            message: `Chapter '${chapter.pool_chapter_id}' page_number values must be contiguous 1..${pages.length}.`,
          });
          break;
        }
      }

      for (const [pIdx, page] of pages.entries()) {
        if (seenPageUids.has(page.page_uid)) {
          issues.push({
            code: "DUPLICATE_PAGE_UID",
            path: `/chapters/${cIdx}/pages/${pIdx}/page_uid`,
            message: `Duplicate page_uid '${page.page_uid}' in chapter '${chapter.pool_chapter_id}'.`,
          });
        }
        seenPageUids.add(page.page_uid);
        validateMediaRef(page.media, `/chapters/${cIdx}/pages/${pIdx}/media`, issues);
      }
    }
  }

  return {
    valid: issues.length === 0,
    isMetadataOnly,
    issues,
    data: issues.length === 0 ? pkg : undefined,
  };
}
