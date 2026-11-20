export const CONTRACT_NAME = "manga-reader-package" as const;
export const CONTRACT_VERSION = "2.0" as const;
export const CONTRACT_SCHEMA_ID = "urn:manga-datalake:contract:manga-reader-package:2.0" as const;

export type PublicationStatus = "ongoing" | "completed" | "hiatus" | "cancelled" | "unknown";
export type ContentRating = "safe" | "suggestive" | "erotica" | "pornographic" | "unknown";
export type PublicationDemographic =
  "shounen" | "shoujo" | "seinen" | "josei" | "kodomo" | "unknown";
export type CreatorRole = "author" | "artist";
export type TagGroup = "genre" | "theme" | "format" | "content" | "other";

export interface ReaderMediaRef {
  bucket: string;
  object_key: string;
  content_type?: string | null;
  width?: number | null;
  height?: number | null;
  file_size?: number;
  md5_hash?: string | null;
  sha256?: string | null;
}

export interface ReaderCreator {
  creator_id: string;
  slug: string;
  name: string;
  role: CreatorRole;
  mangadex_id?: string | null;
  biography?: Record<string, string>;
  links?: Record<string, string>;
}

export interface ReaderTag {
  slug: string;
  source_tag_id?: string | null;
  mangadex_id?: string | null;
  group?: TagGroup;
  name: { en: string } & Record<string, string>;
}

export interface ReaderCoverArt {
  cover_id?: string | null;
  volume?: string | null;
  locale?: string | null;
  description?: string | null;
  media: ReaderMediaRef;
}

export interface ReaderLink {
  site: string;
  url: string;
}

export interface ReaderLineage {
  pool_revision?: number;
  source_metadata_revision?: number;
  manifest_sha256?: string;
  published_at?: string | null;
  updated_at?: string | null;
}

export interface ReaderMangaStats {
  chapter_count?: number;
  page_count?: number;
  total_size_bytes?: number;
  languages?: string[];
}

export interface ReaderPage {
  page_uid: string;
  page_number: number;
  filename: string;
  media: ReaderMediaRef;
}

export interface ReaderChapter {
  pool_chapter_id: string;
  pool_manga_id: string;
  source_chapter_id: string;
  chapter_number: string;
  chapter_numeric?: number;
  volume?: string | null;
  title?: string;
  language?: string;
  scanlation_group?: string | null;
  publish_at?: string | null;
  source?: string;
  source_id?: string | null;
  page_count?: number;
  total_size_bytes?: number;
  pages_revision?: number;
  manifest_sha256?: string;
  updated_at?: string | null;
  pages?: ReaderPage[];
}

export interface ReaderManga {
  pool_manga_id: string;
  slug: string;
  source_manga_id: string;
  mangadex_id?: string | null;
  title: string;
  alt_titles?: string[];
  description?: string;
  status?: PublicationStatus;
  content_rating?: ContentRating;
  publication_demographic?: PublicationDemographic;
  original_language?: string | null;
  year?: number | null;
  published_start_date?: string | null;
  published_end_date?: string | null;
  official_volumes?: number | null;
  official_chapters?: number | null;
  creators?: ReaderCreator[];
  tags?: ReaderTag[];
  links?: ReaderLink[];
  primary_cover?: ReaderMediaRef | null;
  cover_arts?: ReaderCoverArt[];
  stats?: ReaderMangaStats;
  lineage?: ReaderLineage;
}

export interface MangaReaderPackageV2 {
  contract_name?: typeof CONTRACT_NAME;
  contract_version?: typeof CONTRACT_VERSION;
  exported_at: string;
  manga: ReaderManga;
  chapters?: ReaderChapter[];
}

export interface ContractValidationIssue {
  code:
    | "UNSUPPORTED_CONTRACT_VERSION"
    | "SCHEMA_VIOLATION"
    | "CHAPTER_MANGA_MISMATCH"
    | "DUPLICATE_CHAPTER_ID"
    | "DUPLICATE_PAGE_UID"
    | "NONCONTIGUOUS_PAGE_NUMBERS"
    | "PAGE_COUNT_MISMATCH"
    | "UNSAFE_MEDIA_REFERENCE"
    | "UNSAFE_LINK_SCHEME";
  path: string;
  message: string;
}

export interface ContractValidationResult {
  valid: boolean;
  isMetadataOnly: boolean;
  issues: ContractValidationIssue[];
  data?: MangaReaderPackageV2;
}
