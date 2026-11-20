-- ============================================================
-- Live MSSQL DDL generated from [MangaLibrary]
-- Generated at: 2026-11-18T09:56:46.504883Z
-- Ordered topologically by FK dependencies (excludes sysdiagrams)
-- ============================================================

CREATE TABLE [dbo].[Covers] (
    [cover_id] uniqueidentifier NOT NULL,
    [manga_id] uniqueidentifier NOT NULL,
    [type] nvarchar(50) NULL,
    [description] nvarchar(max) NULL,
    [volume] nvarchar(50) NULL,
    [fileName] nvarchar(255) NULL,
    [locale] nvarchar(10) NULL,
    [createdAt] datetimeoffset(7) NULL,
    [updatedAt] datetimeoffset(7) NULL,
    [version] int NULL,
    [rel_user_id] uniqueidentifier NULL,
    [url] nvarchar(500) NULL,
    [image_data] varbinary(max) NULL,
    CONSTRAINT [PK_Covers] PRIMARY KEY CLUSTERED ([cover_id] ASC)
);
GO

CREATE TABLE [dbo].[Creator] (
    [CreatorId] uniqueidentifier NOT NULL,
    [Type] nvarchar(50) NULL,
    [Name] nvarchar(500) NULL,
    [ImageUrl] nvarchar(max) NULL,
    [BiographyEn] nvarchar(max) NULL,
    [BiographyJa] nvarchar(max) NULL,
    [BiographyPtBr] nvarchar(max) NULL,
    [CreatedAt] datetime2(7) NULL,
    [UpdatedAt] datetime2(7) NULL,
    CONSTRAINT [PK_Creator] PRIMARY KEY CLUSTERED ([CreatorId] ASC)
);
GO

CREATE TABLE [dbo].[Manga] (
    [MangaId] uniqueidentifier NOT NULL,
    [Type] nvarchar(50) NULL,
    [TitleEn] nvarchar(500) NULL,
    [ChapterNumbersResetOnNewVolume] bit NULL,
    [ContentRating] nvarchar(50) NULL,
    [CreatedAt] datetime2(7) NULL,
    [UpdatedAt] datetime2(7) NULL,
    [IsLocked] bit NULL,
    [LastChapter] nvarchar(50) NULL,
    [LastVolume] nvarchar(50) NULL,
    [LatestUploadedChapter] nvarchar(50) NULL,
    [OriginalLanguage] nvarchar(10) NULL,
    [PublicationDemographic] nvarchar(50) NULL,
    [State] nvarchar(50) NULL,
    [Status] nvarchar(50) NULL,
    [Year] int NULL,
    [OfficialLinks] nvarchar(max) NULL,
    CONSTRAINT [PK_Manga] PRIMARY KEY CLUSTERED ([MangaId] ASC)
);
GO

CREATE TABLE [dbo].[MangaCover] (
    [MangaId] uniqueidentifier NOT NULL,
    [CoverId] uniqueidentifier NOT NULL,
    [FileName] nvarchar(255) NOT NULL,
    [DownloadDate] datetime2(7) NOT NULL DEFAULT (getdate()),
    [ImageData] varbinary(max) NOT NULL,
    CONSTRAINT [PK_MangaCover] PRIMARY KEY CLUSTERED ([MangaId] ASC, [CoverId] ASC, [FileName] ASC)
);
GO

CREATE TABLE [dbo].[MangaCovers] (
    [cover_id] nvarchar(50) NOT NULL,
    [manga_id] uniqueidentifier NOT NULL,
    [file_name] nvarchar(300) NULL,
    [description] nvarchar(max) NULL,
    [volume] nvarchar(50) NULL,
    [locale] nvarchar(20) NULL,
    [created_at] datetimeoffset(7) NULL,
    [updated_at] datetimeoffset(7) NULL,
    [version] int NULL,
    [image_url] nvarchar(1000) NULL,
    [file_path] nvarchar(1000) NULL,
    [downloaded_at] datetimeoffset(7) NULL,
    [raw_json] nvarchar(max) NULL,
    [inserted_at] datetimeoffset(7) NULL DEFAULT (sysutcdatetime()),
    CONSTRAINT [PK_MangaCovers] PRIMARY KEY CLUSTERED ([cover_id] ASC)
);
GO

CREATE TABLE [dbo].[MangaTopicAnalysis] (
    [MangaId] uniqueidentifier NOT NULL,
    [TopicId] int NULL,
    [OriginalTags] nvarchar(max) NULL,
    CONSTRAINT [PK_MangaTopicAnalysis] PRIMARY KEY CLUSTERED ([MangaId] ASC)
);
GO

CREATE TABLE [dbo].[Tag] (
    [TagId] uniqueidentifier NOT NULL,
    [GroupName] nvarchar(100) NULL,
    [NameEn] nvarchar(200) NULL,
    CONSTRAINT [PK_Tag] PRIMARY KEY CLUSTERED ([TagId] ASC)
);
GO

CREATE TABLE [dbo].[User] (
    [UserId] uniqueidentifier NOT NULL,
    [Username] nvarchar(100) NOT NULL,
    [Email] nvarchar(255) NOT NULL,
    [PasswordHash] nvarchar(255) NOT NULL,
    [Avatar] nvarchar(max) NULL,
    [Role] nvarchar(20) NOT NULL,
    [IsLocked] bit NULL,
    [CreatedAt] datetime2(7) NULL,
    [Bio] nvarchar(500) NULL,
    [DisplayName] nvarchar(100) NULL,
    [AvatarObjectKey] nvarchar(500) NULL,
    [UpdatedAt] datetime2(7) NULL,
    [IsVerified] bit NOT NULL DEFAULT ((0)),
    CONSTRAINT [PK_User] PRIMARY KEY CLUSTERED ([UserId] ASC)
);
GO

CREATE TABLE [dbo].[Chapter] (
    [ChapterId] uniqueidentifier NOT NULL,
    [MangaId] uniqueidentifier NOT NULL,
    [Type] nvarchar(50) NULL,
    [Volume] nvarchar(50) NULL,
    [ChapterNumber] nvarchar(50) NULL,
    [Title] nvarchar(max) NULL,
    [TranslatedLang] nvarchar(10) NULL,
    [Pages] int NULL,
    [PublishAt] datetime2(7) NULL,
    [ReadableAt] datetime2(7) NULL,
    [IsUnavailable] bit NULL,
    [CreatedAt] datetime2(7) NULL,
    [UpdatedAt] datetime2(7) NULL,
    CONSTRAINT [PK_Chapter] PRIMARY KEY CLUSTERED ([ChapterId] ASC)
);
GO

CREATE TABLE [dbo].[ChatRoom] (
    [RoomId] uniqueidentifier NOT NULL DEFAULT (newid()),
    [Type] nvarchar(20) NOT NULL DEFAULT ('direct'),
    [Name] nvarchar(200) NULL,
    [AvatarUrl] nvarchar(500) NULL,
    [CreatedBy] uniqueidentifier NULL,
    [CreatedAt] datetime2(7) NULL DEFAULT (sysutcdatetime()),
    [UpdatedAt] datetime2(7) NULL DEFAULT (sysutcdatetime()),
    CONSTRAINT [PK_ChatRoom] PRIMARY KEY CLUSTERED ([RoomId] ASC)
);
GO

CREATE TABLE [dbo].[CreatorRelationship] (
    [Id] int IDENTITY(1,1) NOT NULL,
    [CreatorId] uniqueidentifier NOT NULL,
    [RelatedId] uniqueidentifier NOT NULL,
    [RelatedType] nvarchar(50) NULL,
    CONSTRAINT [PK_CreatorRelationship] PRIMARY KEY CLUSTERED ([Id] ASC)
);
GO

CREATE TABLE [dbo].[Friendship] (
    [UserId] uniqueidentifier NOT NULL,
    [FriendId] uniqueidentifier NOT NULL,
    [Status] nvarchar(20) NOT NULL DEFAULT ('pending'),
    [CreatedAt] datetime2(7) NULL DEFAULT (sysutcdatetime()),
    CONSTRAINT [PK_Friendship] PRIMARY KEY CLUSTERED ([UserId] ASC, [FriendId] ASC)
);
GO

CREATE TABLE [dbo].[List] (
    [ListId] uniqueidentifier NOT NULL,
    [UserId] uniqueidentifier NOT NULL,
    [Name] nvarchar(200) NULL,
    [Description] nvarchar(max) NULL,
    [IsPublic] bit NULL,
    [Slug] nvarchar(255) NULL,
    [Visibility] nvarchar(20) NOT NULL,
    [CreatedAt] datetime2(7) NOT NULL,
    [UpdatedAt] datetime2(7) NOT NULL,
    [FollowerCount] int NOT NULL DEFAULT ((0)),
    [ItemCount] int NOT NULL DEFAULT ((0)),
    CONSTRAINT [PK_List] PRIMARY KEY CLUSTERED ([ListId] ASC)
);
GO

CREATE TABLE [dbo].[MangaAltTitle] (
    [AltTitleId] int IDENTITY(1,1) NOT NULL,
    [MangaId] uniqueidentifier NOT NULL,
    [LangCode] nvarchar(10) NULL,
    [AltTitle] nvarchar(max) NULL,
    CONSTRAINT [PK_MangaAltTitle] PRIMARY KEY CLUSTERED ([AltTitleId] ASC)
);
GO

CREATE TABLE [dbo].[MangaAvailableLanguage] (
    [LangId] int IDENTITY(1,1) NOT NULL,
    [MangaId] uniqueidentifier NOT NULL,
    [LangCode] nvarchar(10) NULL,
    CONSTRAINT [PK_MangaAvailableLanguage] PRIMARY KEY CLUSTERED ([LangId] ASC)
);
GO

CREATE TABLE [dbo].[MangaDescription] (
    [DescriptionId] int IDENTITY(1,1) NOT NULL,
    [MangaId] uniqueidentifier NOT NULL,
    [LangCode] nvarchar(10) NULL,
    [Description] nvarchar(max) NULL,
    CONSTRAINT [PK_MangaDescription] PRIMARY KEY CLUSTERED ([DescriptionId] ASC)
);
GO

CREATE TABLE [dbo].[MangaLink] (
    [LinkId] int IDENTITY(1,1) NOT NULL,
    [MangaId] uniqueidentifier NOT NULL,
    [Provider] nvarchar(20) NULL,
    [Url] nvarchar(max) NULL,
    CONSTRAINT [PK_MangaLink] PRIMARY KEY CLUSTERED ([LinkId] ASC)
);
GO

CREATE TABLE [dbo].[MangaRelated] (
    [MangaId] uniqueidentifier NOT NULL,
    [RelatedId] uniqueidentifier NOT NULL,
    [Type] nvarchar(50) NOT NULL,
    [Related] nvarchar(50) NULL,
    [FetchedAt] datetime2(7) NULL,
    CONSTRAINT [PK_MangaRelated] PRIMARY KEY CLUSTERED ([MangaId] ASC, [RelatedId] ASC, [Type] ASC)
);
GO

CREATE TABLE [dbo].[MangaStatistics] (
    [StatisticId] uniqueidentifier NOT NULL,
    [MangaId] uniqueidentifier NOT NULL,
    [Source] nvarchar(50) NULL,
    [Follows] int NULL,
    [AverageRating] float NULL,
    [BayesianRating] float NULL,
    [UnavailableChapters] int NULL,
    [FetchedAt] datetime2(7) NULL,
    CONSTRAINT [PK_MangaStatistics] PRIMARY KEY CLUSTERED ([StatisticId] ASC)
);
GO

CREATE TABLE [dbo].[MangaTag] (
    [MangaId] uniqueidentifier NOT NULL,
    [TagId] uniqueidentifier NOT NULL,
    CONSTRAINT [PK_MangaTag] PRIMARY KEY CLUSTERED ([MangaId] ASC, [TagId] ASC)
);
GO

CREATE TABLE [dbo].[Rating] (
    [RatingId] uniqueidentifier NOT NULL,
    [UserId] uniqueidentifier NOT NULL,
    [MangaId] uniqueidentifier NOT NULL,
    [Score] int NULL,
    CONSTRAINT [PK_Rating] PRIMARY KEY CLUSTERED ([RatingId] ASC)
);
GO

CREATE TABLE [dbo].[UserMangaStatus] (
    [UserId] uniqueidentifier NOT NULL,
    [MangaId] uniqueidentifier NOT NULL,
    [Status] nvarchar(30) NOT NULL,
    [UpdatedAt] datetime2(7) NOT NULL DEFAULT (getutcdate()),
    CONSTRAINT [PK_UserMangaStatus] PRIMARY KEY CLUSTERED ([UserId] ASC, [MangaId] ASC)
);
GO

CREATE TABLE [dbo].[UserPresence] (
    [UserId] uniqueidentifier NOT NULL,
    [IsOnline] bit NULL DEFAULT ((0)),
    [LastSeenAt] datetime2(7) NULL DEFAULT (sysutcdatetime()),
    CONSTRAINT [PK_UserPresence] PRIMARY KEY CLUSTERED ([UserId] ASC)
);
GO

CREATE TABLE [dbo].[ChatMessage] (
    [MessageId] uniqueidentifier NOT NULL DEFAULT (newid()),
    [RoomId] uniqueidentifier NOT NULL,
    [SenderId] uniqueidentifier NOT NULL,
    [Content] nvarchar(max) NULL,
    [MessageType] nvarchar(20) NULL DEFAULT ('text'),
    [MediaUrl] nvarchar(500) NULL,
    [ReplyToId] uniqueidentifier NULL,
    [Status] nvarchar(20) NULL DEFAULT ('sent'),
    [CreatedAt] datetime2(7) NULL DEFAULT (sysutcdatetime()),
    [EditedAt] datetime2(7) NULL,
    [IsDeleted] bit NULL DEFAULT ((0)),
    CONSTRAINT [PK_ChatMessage] PRIMARY KEY CLUSTERED ([MessageId] ASC)
);
GO

CREATE TABLE [dbo].[ChatRoomMember] (
    [RoomId] uniqueidentifier NOT NULL,
    [UserId] uniqueidentifier NOT NULL,
    [JoinedAt] datetime2(7) NULL DEFAULT (sysutcdatetime()),
    [Role] nvarchar(20) NULL DEFAULT ('member'),
    [LastReadAt] datetime2(7) NULL,
    [Nickname] nvarchar(100) NULL,
    [IsMuted] bit NULL DEFAULT ((0)),
    CONSTRAINT [PK_ChatRoomMember] PRIMARY KEY CLUSTERED ([RoomId] ASC, [UserId] ASC)
);
GO

CREATE TABLE [dbo].[Comment] (
    [CommentId] uniqueidentifier NOT NULL,
    [UserId] uniqueidentifier NOT NULL,
    [MangaId] uniqueidentifier NOT NULL,
    [ChapterId] uniqueidentifier NULL,
    [Content] nvarchar(max) NULL,
    [CreatedAt] datetime2(7) NULL,
    [UpdatedAt] datetime2(7) NULL,
    [IsDeleted] bit NULL,
    [IsSpoiler] bit NOT NULL DEFAULT ((0)),
    [LikeCount] int NOT NULL DEFAULT ((0)),
    [DislikeCount] int NOT NULL DEFAULT ((0)),
    CONSTRAINT [PK_Comment] PRIMARY KEY CLUSTERED ([CommentId] ASC)
);
GO

CREATE TABLE [dbo].[ListFollower] (
    [ListId] uniqueidentifier NOT NULL,
    [UserId] uniqueidentifier NOT NULL,
    [FollowedAt] datetime2(7) NOT NULL DEFAULT (sysutcdatetime()),
    CONSTRAINT [PK_ListFollower] PRIMARY KEY CLUSTERED ([ListId] ASC, [UserId] ASC)
);
GO

CREATE TABLE [dbo].[ListManga] (
    [ListId] uniqueidentifier NOT NULL,
    [MangaId] uniqueidentifier NOT NULL,
    [AddedAt] datetime2(7) NULL,
    [Position] int NOT NULL DEFAULT ((0)),
    CONSTRAINT [PK_ListManga] PRIMARY KEY CLUSTERED ([ListId] ASC, [MangaId] ASC)
);
GO

CREATE TABLE [dbo].[ReadingHistory] (
    [HistoryId] uniqueidentifier NOT NULL,
    [UserId] uniqueidentifier NOT NULL,
    [MangaId] uniqueidentifier NOT NULL,
    [ChapterId] uniqueidentifier NOT NULL,
    [LastPageRead] int NULL,
    [ReadAt] datetime2(7) NULL,
    CONSTRAINT [PK_ReadingHistory] PRIMARY KEY CLUSTERED ([HistoryId] ASC)
);
GO

CREATE TABLE [dbo].[CommentReaction] (
    [ReactionId] uniqueidentifier NOT NULL,
    [CommentId] uniqueidentifier NOT NULL,
    [UserId] uniqueidentifier NOT NULL,
    [Type] nvarchar(10) NOT NULL,
    [CreatedAt] datetime2(7) NOT NULL DEFAULT (sysutcdatetime()),
    CONSTRAINT [PK_CommentReaction] PRIMARY KEY CLUSTERED ([ReactionId] ASC)
);
GO

CREATE TABLE [dbo].[Report] (
    [ReportId] uniqueidentifier NOT NULL,
    [UserId] uniqueidentifier NOT NULL,
    [CommentId] uniqueidentifier NOT NULL,
    [Reason] nvarchar(max) NULL,
    [Status] nvarchar(50) NULL,
    [CreatedAt] datetime2(7) NULL,
    CONSTRAINT [PK_Report] PRIMARY KEY CLUSTERED ([ReportId] ASC)
);
GO

-- ── Foreign Key Constraints ───────────────────────────────────
ALTER TABLE [dbo].[Chapter] ADD CONSTRAINT [FK__Chapter__MangaId__08B54D69] FOREIGN KEY ([MangaId]) REFERENCES [dbo].[Manga] ([MangaId]);
ALTER TABLE [dbo].[ChatRoom] ADD CONSTRAINT [FK__ChatRoom__Create__0B91BA14] FOREIGN KEY ([CreatedBy]) REFERENCES [dbo].[User] ([UserId]);
ALTER TABLE [dbo].[CreatorRelationship] ADD CONSTRAINT [FK__CreatorRe__Creat__1332DBDC] FOREIGN KEY ([CreatorId]) REFERENCES [dbo].[Creator] ([CreatorId]);
ALTER TABLE [dbo].[Friendship] ADD CONSTRAINT [FK__Friendshi__Frien__14270015] FOREIGN KEY ([FriendId]) REFERENCES [dbo].[User] ([UserId]);
ALTER TABLE [dbo].[Friendship] ADD CONSTRAINT [FK__Friendshi__UserI__151B244E] FOREIGN KEY ([UserId]) REFERENCES [dbo].[User] ([UserId]);
ALTER TABLE [dbo].[List] ADD CONSTRAINT [FK__List__UserId__160F4887] FOREIGN KEY ([UserId]) REFERENCES [dbo].[User] ([UserId]);
ALTER TABLE [dbo].[MangaAltTitle] ADD CONSTRAINT [FK__MangaAltT__Manga__1AD3FDA4] FOREIGN KEY ([MangaId]) REFERENCES [dbo].[Manga] ([MangaId]);
ALTER TABLE [dbo].[MangaAvailableLanguage] ADD CONSTRAINT [FK__MangaAvai__Manga__1BC821DD] FOREIGN KEY ([MangaId]) REFERENCES [dbo].[Manga] ([MangaId]);
ALTER TABLE [dbo].[MangaDescription] ADD CONSTRAINT [FK__MangaDesc__Manga__1CBC4616] FOREIGN KEY ([MangaId]) REFERENCES [dbo].[Manga] ([MangaId]);
ALTER TABLE [dbo].[MangaLink] ADD CONSTRAINT [FK__MangaLink__Manga__1DB06A4F] FOREIGN KEY ([MangaId]) REFERENCES [dbo].[Manga] ([MangaId]);
ALTER TABLE [dbo].[MangaRelated] ADD CONSTRAINT [FK__MangaRela__Manga__1EA48E88] FOREIGN KEY ([MangaId]) REFERENCES [dbo].[Manga] ([MangaId]);
ALTER TABLE [dbo].[MangaStatistics] ADD CONSTRAINT [FK__MangaStat__Manga__1F98B2C1] FOREIGN KEY ([MangaId]) REFERENCES [dbo].[Manga] ([MangaId]);
ALTER TABLE [dbo].[MangaTag] ADD CONSTRAINT [FK__MangaTag__MangaI__208CD6FA] FOREIGN KEY ([MangaId]) REFERENCES [dbo].[Manga] ([MangaId]);
ALTER TABLE [dbo].[MangaTag] ADD CONSTRAINT [FK__MangaTag__TagId__2180FB33] FOREIGN KEY ([TagId]) REFERENCES [dbo].[Tag] ([TagId]);
ALTER TABLE [dbo].[Rating] ADD CONSTRAINT [FK__Rating__MangaId__22751F6C] FOREIGN KEY ([MangaId]) REFERENCES [dbo].[Manga] ([MangaId]);
ALTER TABLE [dbo].[Rating] ADD CONSTRAINT [FK__Rating__UserId__236943A5] FOREIGN KEY ([UserId]) REFERENCES [dbo].[User] ([UserId]);
ALTER TABLE [dbo].[UserMangaStatus] ADD CONSTRAINT [FK_UserMangaStatus_Manga] FOREIGN KEY ([MangaId]) REFERENCES [dbo].[Manga] ([MangaId]) ON DELETE CASCADE;
ALTER TABLE [dbo].[UserMangaStatus] ADD CONSTRAINT [FK_UserMangaStatus_User] FOREIGN KEY ([UserId]) REFERENCES [dbo].[User] ([UserId]) ON DELETE CASCADE;
ALTER TABLE [dbo].[UserPresence] ADD CONSTRAINT [FK__UserPrese__UserI__29221CFB] FOREIGN KEY ([UserId]) REFERENCES [dbo].[User] ([UserId]);
ALTER TABLE [dbo].[ChatMessage] ADD CONSTRAINT [FK__ChatMessa__RoomI__09A971A2] FOREIGN KEY ([RoomId]) REFERENCES [dbo].[ChatRoom] ([RoomId]) ON DELETE CASCADE;
ALTER TABLE [dbo].[ChatMessage] ADD CONSTRAINT [FK__ChatMessa__Sende__0A9D95DB] FOREIGN KEY ([SenderId]) REFERENCES [dbo].[User] ([UserId]);
ALTER TABLE [dbo].[ChatRoomMember] ADD CONSTRAINT [FK__ChatRoomM__RoomI__0C85DE4D] FOREIGN KEY ([RoomId]) REFERENCES [dbo].[ChatRoom] ([RoomId]) ON DELETE CASCADE;
ALTER TABLE [dbo].[ChatRoomMember] ADD CONSTRAINT [FK__ChatRoomM__UserI__0D7A0286] FOREIGN KEY ([UserId]) REFERENCES [dbo].[User] ([UserId]);
ALTER TABLE [dbo].[Comment] ADD CONSTRAINT [FK__Comment__Chapter__0E6E26BF] FOREIGN KEY ([ChapterId]) REFERENCES [dbo].[Chapter] ([ChapterId]);
ALTER TABLE [dbo].[Comment] ADD CONSTRAINT [FK__Comment__MangaId__0F624AF8] FOREIGN KEY ([MangaId]) REFERENCES [dbo].[Manga] ([MangaId]);
ALTER TABLE [dbo].[Comment] ADD CONSTRAINT [FK__Comment__UserId__10566F31] FOREIGN KEY ([UserId]) REFERENCES [dbo].[User] ([UserId]);
ALTER TABLE [dbo].[ListFollower] ADD CONSTRAINT [FK_ListFollower_List] FOREIGN KEY ([ListId]) REFERENCES [dbo].[List] ([ListId]);
ALTER TABLE [dbo].[ListFollower] ADD CONSTRAINT [FK_ListFollower_User] FOREIGN KEY ([UserId]) REFERENCES [dbo].[User] ([UserId]);
ALTER TABLE [dbo].[ListManga] ADD CONSTRAINT [FK__ListManga__ListI__18EBB532] FOREIGN KEY ([ListId]) REFERENCES [dbo].[List] ([ListId]);
ALTER TABLE [dbo].[ListManga] ADD CONSTRAINT [FK__ListManga__Manga__19DFD96B] FOREIGN KEY ([MangaId]) REFERENCES [dbo].[Manga] ([MangaId]);
ALTER TABLE [dbo].[ReadingHistory] ADD CONSTRAINT [FK__ReadingHi__Chapt__245D67DE] FOREIGN KEY ([ChapterId]) REFERENCES [dbo].[Chapter] ([ChapterId]);
ALTER TABLE [dbo].[ReadingHistory] ADD CONSTRAINT [FK__ReadingHi__Manga__25518C17] FOREIGN KEY ([MangaId]) REFERENCES [dbo].[Manga] ([MangaId]);
ALTER TABLE [dbo].[ReadingHistory] ADD CONSTRAINT [FK__ReadingHi__UserI__2645B050] FOREIGN KEY ([UserId]) REFERENCES [dbo].[User] ([UserId]);
ALTER TABLE [dbo].[CommentReaction] ADD CONSTRAINT [FK_CommentReaction_Comment] FOREIGN KEY ([CommentId]) REFERENCES [dbo].[Comment] ([CommentId]);
ALTER TABLE [dbo].[CommentReaction] ADD CONSTRAINT [FK_CommentReaction_User] FOREIGN KEY ([UserId]) REFERENCES [dbo].[User] ([UserId]);
ALTER TABLE [dbo].[Report] ADD CONSTRAINT [FK__Report__CommentI__2739D489] FOREIGN KEY ([CommentId]) REFERENCES [dbo].[Comment] ([CommentId]);
ALTER TABLE [dbo].[Report] ADD CONSTRAINT [FK__Report__UserId__282DF8C2] FOREIGN KEY ([UserId]) REFERENCES [dbo].[User] ([UserId]);
GO

-- ── Secondary & Unique Indexes ───────────────────────────────
CREATE UNIQUE NONCLUSTERED INDEX [UQ_Rating_User_Manga] ON [dbo].[Rating] ([UserId] ASC, [MangaId] ASC);
CREATE UNIQUE NONCLUSTERED INDEX [UQ_ReadingHistory_User_Manga_Chapter] ON [dbo].[ReadingHistory] ([UserId] ASC, [MangaId] ASC, [ChapterId] ASC);
CREATE UNIQUE NONCLUSTERED INDEX [UQ_CommentReaction_Comment_User_Type] ON [dbo].[CommentReaction] ([CommentId] ASC, [UserId] ASC, [Type] ASC);
GO
