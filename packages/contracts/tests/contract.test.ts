import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CONTRACT_SCHEMA_ID,
  isContentRatingSafe,
  loadContractV2Schema,
  validateMangaReaderPackageV2,
} from "../src/index.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(currentDir, "../fixtures");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(fixturesDir, name), "utf-8"));
}

describe("manga-reader-package:2.0 contract suite", () => {
  it("loads Draft 2020-12 JSON schema with pinned $id", () => {
    const schema = loadContractV2Schema();
    expect(schema["$schema"]).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema["$id"]).toBe(CONTRACT_SCHEMA_ID);
  });

  it("validates a complete v2.0 package fixture (ETL-003)", () => {
    const result = validateMangaReaderPackageV2(loadFixture("valid-full-package.v2.0.json"));
    expect(result.valid).toBe(true);
    expect(result.isMetadataOnly).toBe(false);
    expect(result.issues).toHaveLength(0);
    expect(result.data?.manga.pool_manga_id).toBe("pm_01j9examplemanga000001");
  });

  it("validates metadata-only package without deleting chapters (ADR-012 / ETL-007)", () => {
    const result = validateMangaReaderPackageV2(
      loadFixture("valid-metadata-only-package.v2.0.json"),
    );
    expect(result.valid).toBe(true);
    expect(result.isMetadataOnly).toBe(true);
    expect(isContentRatingSafe(result.data?.manga.content_rating)).toBe(false);
  });

  it("rejects unsupported contract version with actionable code (ETL-004)", () => {
    const result = validateMangaReaderPackageV2(loadFixture("invalid-unsupported-version.json"));
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe("UNSUPPORTED_CONTRACT_VERSION");
  });

  it("rejects extra nested properties under additionalProperties:false (ETL-005)", () => {
    const result = validateMangaReaderPackageV2(loadFixture("invalid-extra-nested-property.json"));
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "SCHEMA_VIOLATION")).toBe(true);
  });

  it("rejects non-contiguous page numbers (ETL-012)", () => {
    const result = validateMangaReaderPackageV2(loadFixture("invalid-noncontiguous-pages.json"));
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "NONCONTIGUOUS_PAGE_NUMBERS")).toBe(true);
  });

  it("treats unknown content_rating as NOT safe (ETL-008)", () => {
    expect(isContentRatingSafe("safe")).toBe(true);
    expect(isContentRatingSafe("unknown")).toBe(false);
    expect(isContentRatingSafe("suggestive")).toBe(false);
    expect(isContentRatingSafe(undefined)).toBe(false);
  });
});
