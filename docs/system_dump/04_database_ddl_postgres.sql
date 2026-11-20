-- ============================================================
-- PostgreSQL 15+ DDL translated from [MangaLibrary]
-- Generated at: 2026-11-18T09:56:46.505560Z
-- Notes:
--   1. Identifiers keep exact PascalCase/camelCase quotes matching data_jsonl_gz JSON keys.
--   2. Binary image BLOB columns (Covers.image_data, MangaCover.ImageData) are omitted by design.
--   3. MangaRelated.RelatedId & CreatorRelationship.RelatedId have unvalidated orphans in MangaDex
--      history, so no strict FK constraint is enforced on RelatedId.
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS "Covers" (
    -- omitted binary image column: "image_data" (varbinary(max))
    "cover_id" UUID NOT NULL,
    "manga_id" UUID NOT NULL,
    "type" VARCHAR(50),
    "description" TEXT,
    "volume" VARCHAR(50),
    "fileName" VARCHAR(255),
    "locale" VARCHAR(10),
    "createdAt" TIMESTAMPTZ,
    "updatedAt" TIMESTAMPTZ,
    "version" INTEGER,
    "rel_user_id" UUID,
    "url" VARCHAR(500),
    CONSTRAINT "PK_Covers" PRIMARY KEY ("cover_id")
);

CREATE TABLE IF NOT EXISTS "Creator" (
    "CreatorId" UUID NOT NULL,
    "Type" VARCHAR(50),
    "Name" VARCHAR(500),
    "ImageUrl" TEXT,
    "BiographyEn" TEXT,
    "BiographyJa" TEXT,
    "BiographyPtBr" TEXT,
    "CreatedAt" TIMESTAMP,
    "UpdatedAt" TIMESTAMP,
    CONSTRAINT "PK_Creator" PRIMARY KEY ("CreatorId")
);

CREATE TABLE IF NOT EXISTS "Manga" (
    "MangaId" UUID NOT NULL,
    "Type" VARCHAR(50),
    "TitleEn" VARCHAR(500),
    "ChapterNumbersResetOnNewVolume" BOOLEAN,
    "ContentRating" VARCHAR(50),
    "CreatedAt" TIMESTAMP,
    "UpdatedAt" TIMESTAMP,
    "IsLocked" BOOLEAN,
    "LastChapter" VARCHAR(50),
    "LastVolume" VARCHAR(50),
    "LatestUploadedChapter" VARCHAR(50),
    "OriginalLanguage" VARCHAR(10),
    "PublicationDemographic" VARCHAR(50),
    "State" VARCHAR(50),
    "Status" VARCHAR(50),
    "Year" INTEGER,
    "OfficialLinks" TEXT,
    CONSTRAINT "PK_Manga" PRIMARY KEY ("MangaId")
);

CREATE TABLE IF NOT EXISTS "MangaCover" (
    -- omitted binary image column: "ImageData" (varbinary(max))
    "MangaId" UUID NOT NULL,
    "CoverId" UUID NOT NULL,
    "FileName" VARCHAR(255) NOT NULL,
    "DownloadDate" TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    CONSTRAINT "PK_MangaCover" PRIMARY KEY ("MangaId", "CoverId", "FileName")
);

CREATE TABLE IF NOT EXISTS "MangaCovers" (
    "cover_id" VARCHAR(50) NOT NULL,
    "manga_id" UUID NOT NULL,
    "file_name" VARCHAR(300),
    "description" TEXT,
    "volume" VARCHAR(50),
    "locale" VARCHAR(20),
    "created_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ,
    "version" INTEGER,
    "image_url" VARCHAR(1000),
    "file_path" VARCHAR(1000),
    "downloaded_at" TIMESTAMPTZ,
    "raw_json" TEXT,
    "inserted_at" TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT "PK_MangaCovers" PRIMARY KEY ("cover_id")
);

CREATE TABLE IF NOT EXISTS "MangaTopicAnalysis" (
    "MangaId" UUID NOT NULL,
    "TopicId" INTEGER,
    "OriginalTags" TEXT,
    CONSTRAINT "PK_MangaTopicAnalysis" PRIMARY KEY ("MangaId")
);

CREATE TABLE IF NOT EXISTS "Tag" (
    "TagId" UUID NOT NULL,
    "GroupName" VARCHAR(100),
    "NameEn" VARCHAR(200),
    CONSTRAINT "PK_Tag" PRIMARY KEY ("TagId")
);

CREATE TABLE IF NOT EXISTS "User" (
    "UserId" UUID NOT NULL,
    "Username" VARCHAR(100) NOT NULL,
    "Email" VARCHAR(255) NOT NULL,
    "PasswordHash" VARCHAR(255) NOT NULL,
    "Avatar" TEXT,
    "Role" VARCHAR(20) NOT NULL,
    "IsLocked" BOOLEAN,
    "CreatedAt" TIMESTAMP,
    "Bio" VARCHAR(500),
    "DisplayName" VARCHAR(100),
    "AvatarObjectKey" VARCHAR(500),
    "UpdatedAt" TIMESTAMP,
    "IsVerified" BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT "PK_User" PRIMARY KEY ("UserId")
);

CREATE TABLE IF NOT EXISTS "Chapter" (
    "ChapterId" UUID NOT NULL,
    "MangaId" UUID NOT NULL,
    "Type" VARCHAR(50),
    "Volume" VARCHAR(50),
    "ChapterNumber" VARCHAR(50),
    "Title" TEXT,
    "TranslatedLang" VARCHAR(10),
    "Pages" INTEGER,
    "PublishAt" TIMESTAMP,
    "ReadableAt" TIMESTAMP,
    "IsUnavailable" BOOLEAN,
    "CreatedAt" TIMESTAMP,
    "UpdatedAt" TIMESTAMP,
    CONSTRAINT "PK_Chapter" PRIMARY KEY ("ChapterId")
);

CREATE TABLE IF NOT EXISTS "ChatRoom" (
    "RoomId" UUID NOT NULL DEFAULT gen_random_uuid(),
    "Type" VARCHAR(20) NOT NULL DEFAULT 'direct',
    "Name" VARCHAR(200),
    "AvatarUrl" VARCHAR(500),
    "CreatedBy" UUID,
    "CreatedAt" TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    "UpdatedAt" TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    CONSTRAINT "PK_ChatRoom" PRIMARY KEY ("RoomId")
);

CREATE TABLE IF NOT EXISTS "CreatorRelationship" (
    "Id" SERIAL,
    "CreatorId" UUID NOT NULL,
    "RelatedId" UUID NOT NULL,
    "RelatedType" VARCHAR(50),
    CONSTRAINT "PK_CreatorRelationship" PRIMARY KEY ("Id")
);

CREATE TABLE IF NOT EXISTS "Friendship" (
    "UserId" UUID NOT NULL,
    "FriendId" UUID NOT NULL,
    "Status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "CreatedAt" TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    CONSTRAINT "PK_Friendship" PRIMARY KEY ("UserId", "FriendId")
);

CREATE TABLE IF NOT EXISTS "List" (
    "ListId" UUID NOT NULL,
    "UserId" UUID NOT NULL,
    "Name" VARCHAR(200),
    "Description" TEXT,
    "IsPublic" BOOLEAN,
    "Slug" VARCHAR(255),
    "Visibility" VARCHAR(20) NOT NULL,
    "CreatedAt" TIMESTAMP NOT NULL,
    "UpdatedAt" TIMESTAMP NOT NULL,
    "FollowerCount" INTEGER NOT NULL DEFAULT 0,
    "ItemCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PK_List" PRIMARY KEY ("ListId")
);

CREATE TABLE IF NOT EXISTS "MangaAltTitle" (
    "AltTitleId" SERIAL,
    "MangaId" UUID NOT NULL,
    "LangCode" VARCHAR(10),
    "AltTitle" TEXT,
    CONSTRAINT "PK_MangaAltTitle" PRIMARY KEY ("AltTitleId")
);

CREATE TABLE IF NOT EXISTS "MangaAvailableLanguage" (
    "LangId" SERIAL,
    "MangaId" UUID NOT NULL,
    "LangCode" VARCHAR(10),
    CONSTRAINT "PK_MangaAvailableLanguage" PRIMARY KEY ("LangId")
);

CREATE TABLE IF NOT EXISTS "MangaDescription" (
    "DescriptionId" SERIAL,
    "MangaId" UUID NOT NULL,
    "LangCode" VARCHAR(10),
    "Description" TEXT,
    CONSTRAINT "PK_MangaDescription" PRIMARY KEY ("DescriptionId")
);

CREATE TABLE IF NOT EXISTS "MangaLink" (
    "LinkId" SERIAL,
    "MangaId" UUID NOT NULL,
    "Provider" VARCHAR(20),
    "Url" TEXT,
    CONSTRAINT "PK_MangaLink" PRIMARY KEY ("LinkId")
);

CREATE TABLE IF NOT EXISTS "MangaRelated" (
    "MangaId" UUID NOT NULL,
    "RelatedId" UUID NOT NULL,
    "Type" VARCHAR(50) NOT NULL,
    "Related" VARCHAR(50),
    "FetchedAt" TIMESTAMP,
    CONSTRAINT "PK_MangaRelated" PRIMARY KEY ("MangaId", "RelatedId", "Type")
);

CREATE TABLE IF NOT EXISTS "MangaStatistics" (
    "StatisticId" UUID NOT NULL,
    "MangaId" UUID NOT NULL,
    "Source" VARCHAR(50),
    "Follows" INTEGER,
    "AverageRating" DOUBLE PRECISION,
    "BayesianRating" DOUBLE PRECISION,
    "UnavailableChapters" INTEGER,
    "FetchedAt" TIMESTAMP,
    CONSTRAINT "PK_MangaStatistics" PRIMARY KEY ("StatisticId")
);

CREATE TABLE IF NOT EXISTS "MangaTag" (
    "MangaId" UUID NOT NULL,
    "TagId" UUID NOT NULL,
    CONSTRAINT "PK_MangaTag" PRIMARY KEY ("MangaId", "TagId")
);

CREATE TABLE IF NOT EXISTS "Rating" (
    "RatingId" UUID NOT NULL,
    "UserId" UUID NOT NULL,
    "MangaId" UUID NOT NULL,
    "Score" INTEGER,
    CONSTRAINT "PK_Rating" PRIMARY KEY ("RatingId")
);

CREATE TABLE IF NOT EXISTS "UserMangaStatus" (
    "UserId" UUID NOT NULL,
    "MangaId" UUID NOT NULL,
    "Status" VARCHAR(30) NOT NULL,
    "UpdatedAt" TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    CONSTRAINT "PK_UserMangaStatus" PRIMARY KEY ("UserId", "MangaId")
);

CREATE TABLE IF NOT EXISTS "UserPresence" (
    "UserId" UUID NOT NULL,
    "IsOnline" BOOLEAN DEFAULT FALSE,
    "LastSeenAt" TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    CONSTRAINT "PK_UserPresence" PRIMARY KEY ("UserId")
);

CREATE TABLE IF NOT EXISTS "ChatMessage" (
    "MessageId" UUID NOT NULL DEFAULT gen_random_uuid(),
    "RoomId" UUID NOT NULL,
    "SenderId" UUID NOT NULL,
    "Content" TEXT,
    "MessageType" VARCHAR(20) DEFAULT 'text',
    "MediaUrl" VARCHAR(500),
    "ReplyToId" UUID,
    "Status" VARCHAR(20) DEFAULT 'sent',
    "CreatedAt" TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    "EditedAt" TIMESTAMP,
    "IsDeleted" BOOLEAN DEFAULT FALSE,
    CONSTRAINT "PK_ChatMessage" PRIMARY KEY ("MessageId")
);

CREATE TABLE IF NOT EXISTS "ChatRoomMember" (
    "RoomId" UUID NOT NULL,
    "UserId" UUID NOT NULL,
    "JoinedAt" TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    "Role" VARCHAR(20) DEFAULT 'member',
    "LastReadAt" TIMESTAMP,
    "Nickname" VARCHAR(100),
    "IsMuted" BOOLEAN DEFAULT FALSE,
    CONSTRAINT "PK_ChatRoomMember" PRIMARY KEY ("RoomId", "UserId")
);

CREATE TABLE IF NOT EXISTS "Comment" (
    "CommentId" UUID NOT NULL,
    "UserId" UUID NOT NULL,
    "MangaId" UUID NOT NULL,
    "ChapterId" UUID,
    "Content" TEXT,
    "CreatedAt" TIMESTAMP,
    "UpdatedAt" TIMESTAMP,
    "IsDeleted" BOOLEAN,
    "IsSpoiler" BOOLEAN NOT NULL DEFAULT FALSE,
    "LikeCount" INTEGER NOT NULL DEFAULT 0,
    "DislikeCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PK_Comment" PRIMARY KEY ("CommentId")
);

CREATE TABLE IF NOT EXISTS "ListFollower" (
    "ListId" UUID NOT NULL,
    "UserId" UUID NOT NULL,
    "FollowedAt" TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    CONSTRAINT "PK_ListFollower" PRIMARY KEY ("ListId", "UserId")
);

CREATE TABLE IF NOT EXISTS "ListManga" (
    "ListId" UUID NOT NULL,
    "MangaId" UUID NOT NULL,
    "AddedAt" TIMESTAMP,
    "Position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PK_ListManga" PRIMARY KEY ("ListId", "MangaId")
);

CREATE TABLE IF NOT EXISTS "ReadingHistory" (
    "HistoryId" UUID NOT NULL,
    "UserId" UUID NOT NULL,
    "MangaId" UUID NOT NULL,
    "ChapterId" UUID NOT NULL,
    "LastPageRead" INTEGER,
    "ReadAt" TIMESTAMP,
    CONSTRAINT "PK_ReadingHistory" PRIMARY KEY ("HistoryId")
);

CREATE TABLE IF NOT EXISTS "CommentReaction" (
    "ReactionId" UUID NOT NULL,
    "CommentId" UUID NOT NULL,
    "UserId" UUID NOT NULL,
    "Type" VARCHAR(10) NOT NULL,
    "CreatedAt" TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    CONSTRAINT "PK_CommentReaction" PRIMARY KEY ("ReactionId")
);

CREATE TABLE IF NOT EXISTS "Report" (
    "ReportId" UUID NOT NULL,
    "UserId" UUID NOT NULL,
    "CommentId" UUID NOT NULL,
    "Reason" TEXT,
    "Status" VARCHAR(50),
    "CreatedAt" TIMESTAMP,
    CONSTRAINT "PK_Report" PRIMARY KEY ("ReportId")
);

-- ── Foreign Keys ──────────────────────────────────────────────
ALTER TABLE "Chapter" ADD CONSTRAINT "FK__Chapter__MangaId__08B54D69" FOREIGN KEY ("MangaId") REFERENCES "Manga" ("MangaId");
ALTER TABLE "ChatRoom" ADD CONSTRAINT "FK__ChatRoom__Create__0B91BA14" FOREIGN KEY ("CreatedBy") REFERENCES "User" ("UserId");
ALTER TABLE "CreatorRelationship" ADD CONSTRAINT "FK__CreatorRe__Creat__1332DBDC" FOREIGN KEY ("CreatorId") REFERENCES "Creator" ("CreatorId");
ALTER TABLE "Friendship" ADD CONSTRAINT "FK__Friendshi__Frien__14270015" FOREIGN KEY ("FriendId") REFERENCES "User" ("UserId");
ALTER TABLE "Friendship" ADD CONSTRAINT "FK__Friendshi__UserI__151B244E" FOREIGN KEY ("UserId") REFERENCES "User" ("UserId");
ALTER TABLE "List" ADD CONSTRAINT "FK__List__UserId__160F4887" FOREIGN KEY ("UserId") REFERENCES "User" ("UserId");
ALTER TABLE "MangaAltTitle" ADD CONSTRAINT "FK__MangaAltT__Manga__1AD3FDA4" FOREIGN KEY ("MangaId") REFERENCES "Manga" ("MangaId");
ALTER TABLE "MangaAvailableLanguage" ADD CONSTRAINT "FK__MangaAvai__Manga__1BC821DD" FOREIGN KEY ("MangaId") REFERENCES "Manga" ("MangaId");
ALTER TABLE "MangaDescription" ADD CONSTRAINT "FK__MangaDesc__Manga__1CBC4616" FOREIGN KEY ("MangaId") REFERENCES "Manga" ("MangaId");
ALTER TABLE "MangaLink" ADD CONSTRAINT "FK__MangaLink__Manga__1DB06A4F" FOREIGN KEY ("MangaId") REFERENCES "Manga" ("MangaId");
ALTER TABLE "MangaRelated" ADD CONSTRAINT "FK__MangaRela__Manga__1EA48E88" FOREIGN KEY ("MangaId") REFERENCES "Manga" ("MangaId");
ALTER TABLE "MangaStatistics" ADD CONSTRAINT "FK__MangaStat__Manga__1F98B2C1" FOREIGN KEY ("MangaId") REFERENCES "Manga" ("MangaId");
ALTER TABLE "MangaTag" ADD CONSTRAINT "FK__MangaTag__MangaI__208CD6FA" FOREIGN KEY ("MangaId") REFERENCES "Manga" ("MangaId");
ALTER TABLE "MangaTag" ADD CONSTRAINT "FK__MangaTag__TagId__2180FB33" FOREIGN KEY ("TagId") REFERENCES "Tag" ("TagId");
ALTER TABLE "Rating" ADD CONSTRAINT "FK__Rating__MangaId__22751F6C" FOREIGN KEY ("MangaId") REFERENCES "Manga" ("MangaId");
ALTER TABLE "Rating" ADD CONSTRAINT "FK__Rating__UserId__236943A5" FOREIGN KEY ("UserId") REFERENCES "User" ("UserId");
ALTER TABLE "UserMangaStatus" ADD CONSTRAINT "FK_UserMangaStatus_Manga" FOREIGN KEY ("MangaId") REFERENCES "Manga" ("MangaId") ON DELETE CASCADE;
ALTER TABLE "UserMangaStatus" ADD CONSTRAINT "FK_UserMangaStatus_User" FOREIGN KEY ("UserId") REFERENCES "User" ("UserId") ON DELETE CASCADE;
ALTER TABLE "UserPresence" ADD CONSTRAINT "FK__UserPrese__UserI__29221CFB" FOREIGN KEY ("UserId") REFERENCES "User" ("UserId");
ALTER TABLE "ChatMessage" ADD CONSTRAINT "FK__ChatMessa__RoomI__09A971A2" FOREIGN KEY ("RoomId") REFERENCES "ChatRoom" ("RoomId") ON DELETE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "FK__ChatMessa__Sende__0A9D95DB" FOREIGN KEY ("SenderId") REFERENCES "User" ("UserId");
ALTER TABLE "ChatRoomMember" ADD CONSTRAINT "FK__ChatRoomM__RoomI__0C85DE4D" FOREIGN KEY ("RoomId") REFERENCES "ChatRoom" ("RoomId") ON DELETE CASCADE;
ALTER TABLE "ChatRoomMember" ADD CONSTRAINT "FK__ChatRoomM__UserI__0D7A0286" FOREIGN KEY ("UserId") REFERENCES "User" ("UserId");
ALTER TABLE "Comment" ADD CONSTRAINT "FK__Comment__Chapter__0E6E26BF" FOREIGN KEY ("ChapterId") REFERENCES "Chapter" ("ChapterId");
ALTER TABLE "Comment" ADD CONSTRAINT "FK__Comment__MangaId__0F624AF8" FOREIGN KEY ("MangaId") REFERENCES "Manga" ("MangaId");
ALTER TABLE "Comment" ADD CONSTRAINT "FK__Comment__UserId__10566F31" FOREIGN KEY ("UserId") REFERENCES "User" ("UserId");
ALTER TABLE "ListFollower" ADD CONSTRAINT "FK_ListFollower_List" FOREIGN KEY ("ListId") REFERENCES "List" ("ListId");
ALTER TABLE "ListFollower" ADD CONSTRAINT "FK_ListFollower_User" FOREIGN KEY ("UserId") REFERENCES "User" ("UserId");
ALTER TABLE "ListManga" ADD CONSTRAINT "FK__ListManga__ListI__18EBB532" FOREIGN KEY ("ListId") REFERENCES "List" ("ListId");
ALTER TABLE "ListManga" ADD CONSTRAINT "FK__ListManga__Manga__19DFD96B" FOREIGN KEY ("MangaId") REFERENCES "Manga" ("MangaId");
ALTER TABLE "ReadingHistory" ADD CONSTRAINT "FK__ReadingHi__Chapt__245D67DE" FOREIGN KEY ("ChapterId") REFERENCES "Chapter" ("ChapterId");
ALTER TABLE "ReadingHistory" ADD CONSTRAINT "FK__ReadingHi__Manga__25518C17" FOREIGN KEY ("MangaId") REFERENCES "Manga" ("MangaId");
ALTER TABLE "ReadingHistory" ADD CONSTRAINT "FK__ReadingHi__UserI__2645B050" FOREIGN KEY ("UserId") REFERENCES "User" ("UserId");
ALTER TABLE "CommentReaction" ADD CONSTRAINT "FK_CommentReaction_Comment" FOREIGN KEY ("CommentId") REFERENCES "Comment" ("CommentId");
ALTER TABLE "CommentReaction" ADD CONSTRAINT "FK_CommentReaction_User" FOREIGN KEY ("UserId") REFERENCES "User" ("UserId");
ALTER TABLE "Report" ADD CONSTRAINT "FK__Report__CommentI__2739D489" FOREIGN KEY ("CommentId") REFERENCES "Comment" ("CommentId");
ALTER TABLE "Report" ADD CONSTRAINT "FK__Report__UserId__282DF8C2" FOREIGN KEY ("UserId") REFERENCES "User" ("UserId");

-- ── Secondary & Unique Indexes ────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_Rating_User_Manga" ON "Rating" ("UserId" ASC, "MangaId" ASC);
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_ReadingHistory_User_Manga_Chapter" ON "ReadingHistory" ("UserId" ASC, "MangaId" ASC, "ChapterId" ASC);
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_CommentReaction_Comment_User_Type" ON "CommentReaction" ("CommentId" ASC, "UserId" ASC, "Type" ASC);
