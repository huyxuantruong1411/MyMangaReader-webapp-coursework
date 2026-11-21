import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { CatalogPagination } from "../../components/CatalogPagination";
import {
  EngagementFunnelChart,
  GenreRadarChart,
  InteractiveDonutChart,
  InteractiveTrendChart,
  StorytellingNarrativeCard,
  buildReaderDataStory,
} from "../../components/DataStoryCharts";
import { EmptyState, LoadingState } from "../../components/StateViews";
import { UserAvatar } from "../../components/UserAvatar";
import { useAuth } from "../../hooks/useAuth";
import { ApiClientError, apiClient, type ReaderSettingsData } from "../../services/apiClient";

type SettingsTab = "profile" | "security" | "reader" | "ratings" | "stats";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatRatingAction(
  actionType: "CREATE" | "UPDATE" | "REMOVE",
  prev: number | null,
  next: number | null,
): string {
  if (actionType === "CREATE") return `Rated ${next ?? "—"}/10`;
  if (actionType === "UPDATE") return `Updated rating from ${prev ?? "—"} to ${next ?? "—"}/10`;
  return `Removed rating (previously ${prev ?? "—"}/10)`;
}

export function AccountSettingsPage() {
  const { user, refreshProfile } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<SettingsTab>("profile");
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  // Profile form
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [birthDate, setBirthDate] = useState(user?.birthDate ?? "");
  const [isBirthDatePublic, setIsBirthDatePublic] = useState(Boolean(user?.isBirthDatePublic));
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  // Password form
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  // Rating History pagination & filter
  const [ratingPage, setRatingPage] = useState(1);
  const [ratingSearch, setRatingSearch] = useState("");
  const [ratingActionFilter, setRatingActionFilter] = useState<"" | "CREATE" | "UPDATE" | "REMOVE">(
    "",
  );

  useEffect(() => {
    if (!avatarFile || typeof URL.createObjectURL !== "function") {
      setAvatarPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(avatarFile);
    setAvatarPreviewUrl(url);
    return () => {
      if (typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(url);
      }
    };
  }, [avatarFile]);

  // Reader settings form
  const readerSettingsQuery = useQuery({
    queryKey: ["reader", "settings"],
    queryFn: () => apiClient.getReaderSettings(),
    enabled: tab === "reader",
  });
  const [readerForm, setReaderForm] = useState<ReaderSettingsData>({
    displayMode: "VERTICAL_WEBTOON",
    readingDirection: "LTR",
    fitMode: "FIT_WIDTH",
    preloadPageCount: 3,
  });
  const [readerBgTheme, setReaderBgTheme] = useState<"black" | "dark" | "gray" | "light">(() => {
    try {
      const saved = window.localStorage.getItem("mr_reader_bg_theme");
      if (saved === "black" || saved === "dark" || saved === "gray" || saved === "light") {
        return saved;
      }
    } catch {
      /* ignore storage errors */
    }
    return "black";
  });
  const [readerPageGap, setReaderPageGap] = useState<"none" | "compact" | "wide">(() => {
    try {
      const saved = window.localStorage.getItem("mr_reader_page_gap");
      if (saved === "none" || saved === "compact" || saved === "wide") {
        return saved;
      }
    } catch {
      /* ignore storage errors */
    }
    return "none";
  });
  const [readerSoloCover, setReaderSoloCover] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem("mr_reader_solo_cover") !== "false";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    const incoming = readerSettingsQuery.data?.data;
    if (incoming) {
      setReaderForm((prev) => ({
        displayMode: incoming.displayMode ?? prev.displayMode,
        readingDirection: incoming.readingDirection ?? prev.readingDirection,
        fitMode: incoming.fitMode ?? prev.fitMode,
        preloadPageCount:
          typeof incoming.preloadPageCount === "number"
            ? incoming.preloadPageCount
            : prev.preloadPageCount,
      }));
    }
  }, [readerSettingsQuery.data]);

  const ratingsQuery = useQuery({
    queryKey: ["account", "rating-history", ratingPage],
    queryFn: () => apiClient.getMyRatingHistory(ratingPage, 20),
    enabled: tab === "ratings",
  });

  const filteredRatings = useMemo(() => {
    const rows = ratingsQuery.data?.data ?? [];
    const q = ratingSearch.trim().toLowerCase();
    return rows.filter((row) => {
      if (ratingActionFilter && row.actionType !== ratingActionFilter) return false;
      if (q && !row.mangaTitle.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [ratingsQuery.data, ratingSearch, ratingActionFilter]);

  const statsQuery = useQuery({
    queryKey: ["account", "reading-statistics"],
    queryFn: () => apiClient.getMyReadingStatistics(),
    enabled: tab === "stats",
  });

  async function handleSaveProfile(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    try {
      await apiClient.updateProfile({
        displayName: displayName.trim(),
        bio,
        birthDate: birthDate || null,
        isBirthDatePublic,
      });
      await refreshProfile();
      setMessage({ tone: "ok", text: "Profile updated successfully." });
    } catch (err) {
      setMessage({
        tone: "err",
        text: err instanceof ApiClientError ? err.message : "Failed to update profile.",
      });
    }
  }

  function handleSelectAvatarFile(file: File | null) {
    if (!file) {
      setAvatarFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setMessage({ tone: "err", text: "Image file must be 5 MB or smaller." });
      return;
    }
    setMessage(null);
    setAvatarFile(file);
  }

  async function handleUploadAvatar(e: FormEvent) {
    e.preventDefault();
    if (!avatarFile) return;
    setAvatarBusy(true);
    setMessage(null);
    try {
      await apiClient.uploadAvatar(avatarFile);
      await refreshProfile();
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
      setAvatarFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setMessage({ tone: "ok", text: "Avatar image uploaded and updated." });
    } catch (err) {
      setMessage({
        tone: "err",
        text: err instanceof ApiClientError ? err.message : "Avatar upload failed.",
      });
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    try {
      await apiClient.changePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setMessage({
        tone: "ok",
        text: "Password updated. All other active sessions have been revoked.",
      });
    } catch (err) {
      setMessage({
        tone: "err",
        text: err instanceof ApiClientError ? err.message : "Password change failed.",
      });
    }
  }

  async function handleSaveReaderSettings(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    try {
      try {
        window.localStorage.setItem("mr_reader_bg_theme", readerBgTheme);
        window.localStorage.setItem("mr_reader_page_gap", readerPageGap);
        window.localStorage.setItem("mr_reader_solo_cover", String(readerSoloCover));
      } catch {
        /* ignore storage errors */
      }
      await apiClient.updateReaderSettings(readerForm);
      void queryClient.invalidateQueries({ queryKey: ["reader", "settings"] });
      setMessage({
        tone: "ok",
        text: "Reader Experience Studio preferences saved and synced to the chapter viewer.",
      });
    } catch (err) {
      setMessage({
        tone: "err",
        text: err instanceof ApiClientError ? err.message : "Could not save reader settings.",
      });
    }
  }

  const tabs: Array<{ id: SettingsTab; label: string }> = [
    { id: "profile", label: "Profile & Avatar" },
    { id: "security", label: "Password & Security" },
    { id: "reader", label: "Reader Preferences" },
    { id: "ratings", label: "Rating History" },
    { id: "stats", label: "My Reading Stats" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "var(--mr-text-primary)" }}>
          Account &amp; Reader Settings
        </h1>
        <p className="text-xs" style={{ color: "var(--mr-text-secondary)" }}>
          Manage your profile, avatar, password, reader engine defaults, rating audit trail, and
          reading statistics.
        </p>
      </div>

      <div
        className="flex flex-wrap gap-2 border-b pb-2"
        style={{ borderColor: "var(--mr-border-subtle)" }}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTab(t.id);
              setMessage(null);
            }}
            className="cursor-pointer rounded-[var(--mr-radius-sm)] px-3 py-1.5 text-sm font-medium"
            style={{
              backgroundColor: tab === t.id ? "var(--mr-bg-elevated)" : "transparent",
              color: tab === t.id ? "var(--mr-accent)" : "var(--mr-text-secondary)",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {message ? (
        <p
          role="status"
          className="rounded-[var(--mr-radius-sm)] border px-3 py-2 text-xs font-medium"
          style={{
            borderColor: message.tone === "ok" ? "var(--mr-success)" : "var(--mr-danger)",
            color: message.tone === "ok" ? "var(--mr-success)" : "var(--mr-danger)",
          }}
        >
          {message.text}
        </p>
      ) : null}

      {tab === "profile" ? (
        <div className="grid gap-6 md:grid-cols-2">
          <form
            onSubmit={handleSaveProfile}
            className="space-y-4 rounded-[var(--mr-radius-lg)] border p-5"
            style={{
              backgroundColor: "var(--mr-bg-surface)",
              borderColor: "var(--mr-border-subtle)",
            }}
          >
            <h2 className="text-base font-semibold">Profile Details</h2>
            <div>
              <label className="mb-1 block text-xs font-medium">Display Name</label>
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full rounded border px-3 py-2 text-sm"
                style={{
                  backgroundColor: "var(--mr-bg-elevated)",
                  borderColor: "var(--mr-border-subtle)",
                  color: "var(--mr-text-primary)",
                }}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Bio</label>
              <textarea
                rows={3}
                maxLength={500}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                className="w-full rounded border px-3 py-2 text-sm"
                style={{
                  backgroundColor: "var(--mr-bg-elevated)",
                  borderColor: "var(--mr-border-subtle)",
                  color: "var(--mr-text-primary)",
                }}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Birth Date</label>
              <input
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                className="w-full rounded border px-3 py-2 text-sm"
                style={{
                  backgroundColor: "var(--mr-bg-elevated)",
                  borderColor: "var(--mr-border-subtle)",
                  color: "var(--mr-text-primary)",
                }}
              />
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={isBirthDatePublic}
                onChange={(e) => setIsBirthDatePublic(e.target.checked)}
              />
              <span>Show my birth date publicly on my profile</span>
            </label>
            <button
              type="submit"
              className="cursor-pointer rounded-[var(--mr-radius-sm)] px-4 py-2 text-sm font-semibold text-white"
              style={{ backgroundColor: "var(--mr-accent)" }}
            >
              Save Profile
            </button>
          </form>

          <div
            className="space-y-4 rounded-[var(--mr-radius-lg)] border p-5"
            style={{
              backgroundColor: "var(--mr-bg-surface)",
              borderColor: "var(--mr-border-subtle)",
            }}
          >
            <h2 className="text-base font-semibold">Avatar Image</h2>

            <div className="flex flex-wrap items-center gap-5">
              <div className="text-center">
                <UserAvatar
                  src={user?.avatarUrl}
                  name={user?.displayName || user?.username || "U"}
                  size="lg"
                />
                <p className="mt-1 text-[11px]" style={{ color: "var(--mr-text-muted)" }}>
                  Current Avatar
                </p>
              </div>

              {avatarPreviewUrl ? (
                <>
                  <span className="text-sm font-semibold" style={{ color: "var(--mr-text-muted)" }}>
                    →
                  </span>
                  <div className="text-center">
                    <UserAvatar
                      src={avatarPreviewUrl}
                      name={user?.displayName || user?.username || "U"}
                      size="lg"
                    />
                    <p className="mt-1 text-[11px]" style={{ color: "var(--mr-accent)" }}>
                      Selected Preview
                    </p>
                  </div>
                </>
              ) : null}

              <div className="min-w-0 flex-1 space-y-1 text-xs">
                <p className="font-medium" style={{ color: "var(--mr-text-primary)" }}>
                  {user?.displayName} (@{user?.username})
                </p>
                <p style={{ color: "var(--mr-text-secondary)" }}>
                  Choose or drop an image file from your device to set as your profile picture.
                  Supported formats: PNG, JPG, or WebP up to 5 MB.
                </p>
              </div>
            </div>

            <form onSubmit={handleUploadAvatar} className="space-y-3">
              <input
                ref={fileInputRef}
                type="file"
                aria-label="Choose avatar image file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => handleSelectAvatarFile(e.target.files?.[0] ?? null)}
                className="sr-only"
              />

              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragActive(false);
                  handleSelectAvatarFile(e.dataTransfer.files?.[0] ?? null);
                }}
                className="cursor-pointer rounded-[var(--mr-radius-md)] border-2 border-dashed p-5 text-center transition"
                style={{
                  borderColor: dragActive ? "var(--mr-accent)" : "var(--mr-border-strong)",
                  backgroundColor: "var(--mr-bg-elevated)",
                }}
              >
                <p className="text-xs font-semibold" style={{ color: "var(--mr-text-primary)" }}>
                  Click to choose an image file, or drag &amp; drop here
                </p>
                <p className="mt-1 text-[11px]" style={{ color: "var(--mr-text-muted)" }}>
                  PNG, JPG, or WebP · Automatically resized cleanly up to 512×512
                </p>
                {avatarFile ? (
                  <p
                    className="mt-2 inline-block rounded px-2 py-0.5 font-mono text-[11px]"
                    style={{
                      backgroundColor: "var(--mr-bg-surface)",
                      color: "var(--mr-accent)",
                    }}
                  >
                    {avatarFile.name} ({formatFileSize(avatarFile.size)})
                  </p>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={avatarBusy}
                  onClick={() => fileInputRef.current?.click()}
                  className="cursor-pointer rounded-[var(--mr-radius-sm)] border px-3 py-2 text-xs font-semibold disabled:opacity-50"
                  style={{
                    borderColor: "var(--mr-border-strong)",
                    color: "var(--mr-text-primary)",
                  }}
                >
                  Choose Image File...
                </button>
                <button
                  type="submit"
                  disabled={!avatarFile || avatarBusy}
                  className="cursor-pointer rounded-[var(--mr-radius-sm)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  style={{ backgroundColor: "var(--mr-accent)" }}
                >
                  {avatarBusy ? "Uploading..." : "Upload Avatar"}
                </button>
                {avatarFile ? (
                  <button
                    type="button"
                    disabled={avatarBusy}
                    onClick={() => handleSelectAvatarFile(null)}
                    className="cursor-pointer rounded-[var(--mr-radius-sm)] border px-3 py-2 text-xs"
                    style={{ borderColor: "var(--mr-border-strong)" }}
                  >
                    Clear Selection
                  </button>
                ) : null}
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {tab === "security" ? (
        <form
          onSubmit={handleChangePassword}
          className="max-w-md space-y-4 rounded-[var(--mr-radius-lg)] border p-5"
          style={{
            backgroundColor: "var(--mr-bg-surface)",
            borderColor: "var(--mr-border-subtle)",
          }}
        >
          <h2 className="text-base font-semibold">Change Password</h2>
          <div>
            <label className="mb-1 block text-xs font-medium">Current Password</label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full rounded border px-3 py-2 text-sm"
              style={{
                backgroundColor: "var(--mr-bg-elevated)",
                borderColor: "var(--mr-border-subtle)",
                color: "var(--mr-text-primary)",
              }}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">New Strong Password</label>
            <input
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded border px-3 py-2 text-sm"
              style={{
                backgroundColor: "var(--mr-bg-elevated)",
                borderColor: "var(--mr-border-subtle)",
                color: "var(--mr-text-primary)",
              }}
            />
          </div>
          <button
            type="submit"
            className="cursor-pointer rounded-[var(--mr-radius-sm)] px-4 py-2 text-sm font-semibold text-white"
            style={{ backgroundColor: "var(--mr-accent)" }}
          >
            Update Password
          </button>
        </form>
      ) : null}

      {tab === "reader" ? (
        readerSettingsQuery.isLoading ? (
          <LoadingState variant="dashboard" label="Loading Reader Experience Studio..." />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
            <form
              onSubmit={handleSaveReaderSettings}
              className="space-y-5 rounded-[var(--mr-radius-lg)] border p-5"
              style={{
                backgroundColor: "var(--mr-bg-surface)",
                borderColor: "var(--mr-border-subtle)",
              }}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <span
                    className="inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wider uppercase"
                    style={{
                      backgroundColor: "var(--mr-bg-elevated)",
                      color: "var(--mr-accent)",
                    }}
                  >
                    Reader Experience Studio
                  </span>
                  <h2 className="mt-1 text-base font-bold">Default Reader Settings</h2>
                  <p className="text-xs" style={{ color: "var(--mr-text-muted)" }}>
                    Customize layout engine, flow direction, visual canvas, and preloading pipeline
                    across every chapter you open.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setReaderForm({
                      displayMode: "VERTICAL_WEBTOON",
                      readingDirection: "LTR",
                      fitMode: "FIT_WIDTH",
                      preloadPageCount: 3,
                    });
                    setReaderBgTheme("black");
                    setReaderPageGap("none");
                    setReaderSoloCover(true);
                  }}
                  className="cursor-pointer rounded border px-2.5 py-1 text-xs font-medium"
                  style={{
                    borderColor: "var(--mr-border-strong)",
                    color: "var(--mr-text-secondary)",
                  }}
                >
                  Reset Defaults
                </button>
              </div>

              {/* Display Mode visual cards + synced select */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="reader-display-mode" className="text-xs font-semibold">
                    Display Mode
                  </label>
                  <select
                    id="reader-display-mode"
                    value={readerForm.displayMode}
                    onChange={(e) =>
                      setReaderForm((prev) => ({
                        ...prev,
                        displayMode: e.target.value as ReaderSettingsData["displayMode"],
                      }))
                    }
                    className="rounded border px-2 py-1 text-xs"
                    style={{
                      backgroundColor: "var(--mr-bg-elevated)",
                      borderColor: "var(--mr-border-subtle)",
                      color: "var(--mr-text-primary)",
                    }}
                  >
                    <option value="VERTICAL_WEBTOON">Vertical Scroll (Webtoon)</option>
                    <option value="SINGLE_PAGE">Single Page</option>
                    <option value="DOUBLE_PAGE">Double Page Spread</option>
                  </select>
                </div>
                <div className="grid gap-2.5 sm:grid-cols-3">
                  {(
                    [
                      {
                        value: "VERTICAL_WEBTOON",
                        title: "Webtoon Strip",
                        desc: "Continuous vertical scroll ideal for manhwa & long strips.",
                        icon: "↕",
                      },
                      {
                        value: "SINGLE_PAGE",
                        title: "Single Page",
                        desc: "Classic one-page-at-a-time focus with crisp page turns.",
                        icon: "▯",
                      },
                      {
                        value: "DOUBLE_PAGE",
                        title: "Double Spread",
                        desc: "Side-by-side two-page book view for wide monitors.",
                        icon: "▯▯",
                      },
                    ] as const
                  ).map((opt) => {
                    const active = readerForm.displayMode === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() =>
                          setReaderForm((prev) => ({ ...prev, displayMode: opt.value }))
                        }
                        className="cursor-pointer rounded-[var(--mr-radius-md)] border p-3 text-left transition"
                        style={{
                          backgroundColor: active ? "var(--mr-bg-elevated)" : "var(--mr-bg-canvas)",
                          borderColor: active ? "var(--mr-accent)" : "var(--mr-border-subtle)",
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-bold">{opt.title}</span>
                          <span
                            className="font-mono text-xs font-bold"
                            style={{ color: active ? "var(--mr-accent)" : "var(--mr-text-muted)" }}
                          >
                            {opt.icon}
                          </span>
                        </div>
                        <p
                          className="mt-1 text-[11px] leading-snug"
                          style={{ color: "var(--mr-text-muted)" }}
                        >
                          {opt.desc}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Direction & Fit Mode */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="reader-direction" className="text-xs font-semibold">
                      Reading Direction
                    </label>
                    <select
                      id="reader-direction"
                      value={readerForm.readingDirection}
                      onChange={(e) =>
                        setReaderForm((prev) => ({
                          ...prev,
                          readingDirection: e.target
                            .value as ReaderSettingsData["readingDirection"],
                        }))
                      }
                      className="rounded border px-2 py-1 text-xs"
                      style={{
                        backgroundColor: "var(--mr-bg-elevated)",
                        borderColor: "var(--mr-border-subtle)",
                        color: "var(--mr-text-primary)",
                      }}
                    >
                      <option value="LTR">Left-to-Right (LTR)</option>
                      <option value="RTL">Right-to-Left (RTL)</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        { value: "LTR", title: "LTR →", desc: "Western / Manhwa" },
                        { value: "RTL", title: "← RTL", desc: "Traditional Manga" },
                      ] as const
                    ).map((d) => {
                      const active = readerForm.readingDirection === d.value;
                      return (
                        <button
                          key={d.value}
                          type="button"
                          onClick={() =>
                            setReaderForm((prev) => ({ ...prev, readingDirection: d.value }))
                          }
                          className="cursor-pointer rounded border px-3 py-2 text-left text-xs"
                          style={{
                            backgroundColor: active
                              ? "var(--mr-bg-elevated)"
                              : "var(--mr-bg-canvas)",
                            borderColor: active ? "var(--mr-accent)" : "var(--mr-border-subtle)",
                          }}
                        >
                          <p className="font-bold">{d.title}</p>
                          <p className="text-[11px]" style={{ color: "var(--mr-text-muted)" }}>
                            {d.desc}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="reader-fit-mode" className="text-xs font-semibold">
                      Fit Mode
                    </label>
                    <select
                      id="reader-fit-mode"
                      value={readerForm.fitMode}
                      onChange={(e) =>
                        setReaderForm((prev) => ({
                          ...prev,
                          fitMode: e.target.value as ReaderSettingsData["fitMode"],
                        }))
                      }
                      className="rounded border px-2 py-1 text-xs"
                      style={{
                        backgroundColor: "var(--mr-bg-elevated)",
                        borderColor: "var(--mr-border-subtle)",
                        color: "var(--mr-text-primary)",
                      }}
                    >
                      <option value="FIT_WIDTH">Fit Width</option>
                      <option value="FIT_HEIGHT">Fit Height</option>
                      <option value="ORIGINAL">Original Size</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        { value: "FIT_WIDTH", label: "Fit Width" },
                        { value: "FIT_HEIGHT", label: "Fit Height" },
                        { value: "ORIGINAL", label: "Original" },
                      ] as const
                    ).map((f) => {
                      const active = readerForm.fitMode === f.value;
                      return (
                        <button
                          key={f.value}
                          type="button"
                          onClick={() => setReaderForm((prev) => ({ ...prev, fitMode: f.value }))}
                          className="cursor-pointer rounded border px-2 py-2.5 text-center text-xs font-semibold"
                          style={{
                            backgroundColor: active
                              ? "var(--mr-bg-elevated)"
                              : "var(--mr-bg-canvas)",
                            borderColor: active ? "var(--mr-accent)" : "var(--mr-border-subtle)",
                            color: active ? "var(--mr-accent)" : "var(--mr-text-secondary)",
                          }}
                        >
                          {f.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Local visual studio controls synced with ChapterReaderPage */}
              <div
                className="grid gap-4 rounded-[var(--mr-radius-md)] border p-3.5 sm:grid-cols-2"
                style={{
                  backgroundColor: "var(--mr-bg-canvas)",
                  borderColor: "var(--mr-border-subtle)",
                }}
              >
                <div>
                  <label className="mb-1.5 block text-xs font-semibold">
                    Reader Canvas Backdrop
                  </label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {(
                      [
                        { value: "black", label: "AMOLED", swatch: "#000000" },
                        { value: "dark", label: "Charcoal", swatch: "#111827" },
                        { value: "gray", label: "Slate", swatch: "#334155" },
                        { value: "light", label: "Paper", swatch: "#f1f5f9" },
                      ] as const
                    ).map((bg) => (
                      <button
                        key={bg.value}
                        type="button"
                        onClick={() => setReaderBgTheme(bg.value)}
                        className="cursor-pointer rounded border px-1.5 py-1.5 text-center text-[11px]"
                        style={{
                          borderColor:
                            readerBgTheme === bg.value
                              ? "var(--mr-accent)"
                              : "var(--mr-border-subtle)",
                          backgroundColor:
                            readerBgTheme === bg.value
                              ? "var(--mr-bg-elevated)"
                              : "var(--mr-bg-surface)",
                        }}
                      >
                        <span
                          className="mx-auto mb-1 block h-4 w-4 rounded-full border"
                          style={{
                            backgroundColor: bg.swatch,
                            borderColor: "var(--mr-border-strong)",
                          }}
                        />
                        {bg.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2.5">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold">
                      Strip Panel Spacing
                    </label>
                    <div className="grid grid-cols-3 gap-1.5 text-[11px]">
                      {(
                        [
                          { value: "none", label: "Seamless (0px)" },
                          { value: "compact", label: "Compact (8px)" },
                          { value: "wide", label: "Gallery (20px)" },
                        ] as const
                      ).map((gap) => (
                        <button
                          key={gap.value}
                          type="button"
                          onClick={() => setReaderPageGap(gap.value)}
                          className="cursor-pointer rounded border px-2 py-1.5 font-medium"
                          style={{
                            backgroundColor:
                              readerPageGap === gap.value
                                ? "var(--mr-bg-elevated)"
                                : "var(--mr-bg-surface)",
                            borderColor:
                              readerPageGap === gap.value
                                ? "var(--mr-accent)"
                                : "var(--mr-border-subtle)",
                          }}
                        >
                          {gap.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={readerSoloCover}
                      onChange={(e) => setReaderSoloCover(e.target.checked)}
                    />
                    <span>Show page #1 solo cover before pairing spreads</span>
                  </label>
                </div>
              </div>

              {/* Preload Buffer */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor="reader-preload-range" className="text-xs font-semibold">
                    Preload Page Count ({readerForm.preloadPageCount})
                  </label>
                  <span
                    className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                    style={{
                      backgroundColor: "var(--mr-bg-elevated)",
                      color:
                        readerForm.preloadPageCount <= 1
                          ? "var(--mr-warning)"
                          : readerForm.preloadPageCount <= 5
                            ? "var(--mr-success)"
                            : "var(--mr-accent)",
                    }}
                  >
                    {readerForm.preloadPageCount === 0
                      ? "Strict Data Saver (On-demand)"
                      : readerForm.preloadPageCount <= 3
                        ? "Balanced Streaming"
                        : readerForm.preloadPageCount <= 6
                          ? "Fast Chapter Binge"
                          : "Instant Max Buffer"}
                  </span>
                </div>
                <input
                  id="reader-preload-range"
                  type="range"
                  min={0}
                  max={10}
                  value={readerForm.preloadPageCount}
                  onChange={(e) =>
                    setReaderForm((prev) => ({
                      ...prev,
                      preloadPageCount: Number(e.target.value),
                    }))
                  }
                  className="w-full"
                />
                <div className="flex items-center gap-1" aria-hidden="true">
                  {Array.from({ length: 11 }, (_, idx) => {
                    const active = idx === 0 || idx <= readerForm.preloadPageCount;
                    return (
                      <div
                        key={idx}
                        className="h-2 flex-1 rounded-sm transition-all"
                        style={{
                          backgroundColor:
                            idx === 0
                              ? "var(--mr-accent)"
                              : active
                                ? "var(--mr-success)"
                                : "var(--mr-bg-elevated)",
                        }}
                      />
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <button
                  type="submit"
                  className="cursor-pointer rounded-[var(--mr-radius-sm)] px-5 py-2 text-sm font-semibold text-white"
                  style={{ backgroundColor: "var(--mr-accent)" }}
                >
                  Save Preferences
                </button>
                <span className="text-xs" style={{ color: "var(--mr-text-muted)" }}>
                  Applies immediately across desktop & mobile reading sessions.
                </span>
              </div>
            </form>

            {/* Right column: Live Interactive Reader Simulator & Shortcuts */}
            <aside className="space-y-4">
              <div
                className="rounded-[var(--mr-radius-lg)] border p-4"
                style={{
                  backgroundColor: "var(--mr-bg-surface)",
                  borderColor: "var(--mr-border-subtle)",
                }}
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold">Live Reader Simulator</h3>
                    <p className="text-[11px]" style={{ color: "var(--mr-text-muted)" }}>
                      Real-time preview of your active layout, backdrop & flow
                    </p>
                  </div>
                  <span
                    className="rounded border px-2 py-0.5 font-mono text-[10px]"
                    style={{
                      borderColor: "var(--mr-border-subtle)",
                      backgroundColor: "var(--mr-bg-elevated)",
                    }}
                  >
                    {(readerForm.fitMode ?? "FIT_WIDTH").replace("_", " ")} ·{" "}
                    {readerForm.readingDirection ?? "LTR"}
                  </span>
                </div>

                {/* Simulated canvas */}
                <div
                  className="rounded-[var(--mr-radius-md)] border p-4 transition-colors"
                  style={{
                    borderColor: "var(--mr-border-strong)",
                    backgroundColor:
                      readerBgTheme === "black"
                        ? "#05070b"
                        : readerBgTheme === "dark"
                          ? "#111827"
                          : readerBgTheme === "gray"
                            ? "#334155"
                            : "#f1f5f9",
                    color: readerBgTheme === "light" ? "#0f172a" : "#e2e8f0",
                  }}
                >
                  {readerForm.displayMode === "VERTICAL_WEBTOON" ? (
                    <div
                      className="mx-auto flex max-w-[190px] flex-col"
                      style={{
                        gap:
                          readerPageGap === "none"
                            ? "0px"
                            : readerPageGap === "compact"
                              ? "8px"
                              : "18px",
                      }}
                    >
                      {[1, 2, 3].map((p) => (
                        <div
                          key={p}
                          className="flex h-16 items-center justify-between rounded-sm border px-3 text-xs font-semibold"
                          style={{
                            borderColor:
                              readerBgTheme === "light"
                                ? "rgba(15,23,42,0.2)"
                                : "rgba(255,255,255,0.16)",
                            backgroundColor:
                              readerBgTheme === "light" ? "#ffffff" : "rgba(30,41,59,0.75)",
                          }}
                        >
                          <span>Panel {p}</span>
                          <span className="font-mono text-[10px] opacity-70">↓ Scroll</span>
                        </div>
                      ))}
                    </div>
                  ) : readerForm.displayMode === "DOUBLE_PAGE" ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-center gap-2">
                        {(readerForm.readingDirection === "RTL" ? [3, 2] : [2, 3]).map((pg) => (
                          <div
                            key={pg}
                            className="flex h-36 w-24 flex-col justify-between rounded border p-2 text-xs font-semibold"
                            style={{
                              borderColor:
                                readerBgTheme === "light"
                                  ? "rgba(15,23,42,0.2)"
                                  : "rgba(255,255,255,0.18)",
                              backgroundColor:
                                readerBgTheme === "light" ? "#ffffff" : "rgba(30,41,59,0.8)",
                            }}
                          >
                            <span className="font-mono text-[10px] opacity-75">Page {pg}</span>
                            <div className="h-14 rounded bg-sky-500/20" />
                            <span className="text-[10px] opacity-70">Spread View</span>
                          </div>
                        ))}
                      </div>
                      <p className="text-center text-[11px] opacity-80">
                        {readerForm.readingDirection === "RTL"
                          ? "← Next turn moves Left (Traditional Manga Order: Page 3 | Page 2)"
                          : "Next turn moves Right (Western Order: Page 2 | Page 3) →"}
                        {readerSoloCover ? " · Solo Cover enabled" : " · Paired from Page 1"}
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-3">
                      <div
                        className={`flex flex-col justify-between rounded border p-3 text-xs font-semibold ${
                          readerForm.fitMode === "FIT_HEIGHT" ? "h-40 w-24" : "h-36 w-40"
                        }`}
                        style={{
                          borderColor:
                            readerBgTheme === "light"
                              ? "rgba(15,23,42,0.2)"
                              : "rgba(255,255,255,0.18)",
                          backgroundColor:
                            readerBgTheme === "light" ? "#ffffff" : "rgba(30,41,59,0.8)",
                        }}
                      >
                        <span className="font-mono text-[10px] opacity-75">Page 1</span>
                        <div className="h-16 rounded bg-sky-500/20" />
                        <span className="text-[10px] opacity-70">
                          {readerForm.fitMode === "ORIGINAL"
                            ? "100% Native Px"
                            : readerForm.fitMode}
                        </span>
                      </div>
                      <p className="text-[11px] opacity-80">
                        Tap edge or press{" "}
                        {readerForm.readingDirection === "RTL" ? "← Arrow" : "→ Arrow"} to advance
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div
                className="rounded-[var(--mr-radius-lg)] border p-4 text-xs"
                style={{
                  backgroundColor: "var(--mr-bg-surface)",
                  borderColor: "var(--mr-border-subtle)",
                }}
              >
                <h3 className="mb-2 text-sm font-bold">Chapter Reader Keyboard Shortcuts</h3>
                <ul className="space-y-1.5" style={{ color: "var(--mr-text-secondary)" }}>
                  <li className="flex items-center justify-between gap-2">
                    <span>Next / Previous Page</span>
                    <kbd
                      className="rounded border px-1.5 py-0.5 font-mono text-[10px]"
                      style={{ borderColor: "var(--mr-border-strong)" }}
                    >
                      ← / → · A / D
                    </kbd>
                  </li>
                  <li className="flex items-center justify-between gap-2">
                    <span>Toggle Quick Settings Drawer</span>
                    <kbd
                      className="rounded border px-1.5 py-0.5 font-mono text-[10px]"
                      style={{ borderColor: "var(--mr-border-strong)" }}
                    >
                      Reader HUD Settings
                    </kbd>
                  </li>
                  <li className="flex items-center justify-between gap-2">
                    <span>Jump to Manga Search</span>
                    <kbd
                      className="rounded border px-1.5 py-0.5 font-mono text-[10px]"
                      style={{ borderColor: "var(--mr-border-strong)" }}
                    >
                      Ctrl + K
                    </kbd>
                  </li>
                </ul>
              </div>
            </aside>
          </div>
        )
      ) : null}

      {tab === "ratings" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <input
              type="search"
              aria-label="Filter rating history by manga"
              value={ratingSearch}
              onChange={(e) => setRatingSearch(e.target.value)}
              placeholder="Filter rated manga titles..."
              className="w-56 rounded-[var(--mr-radius-sm)] border px-3 py-1.5 text-sm"
              style={{
                backgroundColor: "var(--mr-bg-surface)",
                borderColor: "var(--mr-border-strong)",
                color: "var(--mr-text-primary)",
              }}
            />
            <select
              aria-label="Filter rating action type"
              value={ratingActionFilter}
              onChange={(e) =>
                setRatingActionFilter(e.target.value as "" | "CREATE" | "UPDATE" | "REMOVE")
              }
              className="rounded-[var(--mr-radius-sm)] border px-2.5 py-1.5"
              style={{
                backgroundColor: "var(--mr-bg-surface)",
                borderColor: "var(--mr-border-strong)",
                color: "var(--mr-text-primary)",
              }}
            >
              <option value="">All Actions</option>
              <option value="CREATE">New Ratings</option>
              <option value="UPDATE">Updated Scores</option>
              <option value="REMOVE">Removed Ratings</option>
            </select>
          </div>

          {ratingsQuery.isLoading ? (
            <LoadingState variant="table" count={5} label="Loading rating history..." />
          ) : ratingsQuery.data && ratingsQuery.data.data.length === 0 ? (
            <EmptyState title="No rating history yet" />
          ) : filteredRatings.length === 0 ? (
            <EmptyState title="No rating records matched your filter" />
          ) : (
            <>
              <ul
                className="divide-y rounded-[var(--mr-radius-lg)] border"
                style={{
                  backgroundColor: "var(--mr-bg-surface)",
                  borderColor: "var(--mr-border-subtle)",
                }}
              >
                {filteredRatings.map((row) => (
                  <li
                    key={row.ratingHistoryId}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
                    style={{ borderColor: "var(--mr-border-subtle)" }}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <Link
                        to={`/manga/${row.mangaSlug}`}
                        className="aspect-[3/4] w-10 shrink-0 overflow-hidden rounded border"
                        style={{
                          backgroundColor: "var(--mr-bg-elevated)",
                          borderColor: "var(--mr-border-subtle)",
                        }}
                      >
                        {row.mangaCoverUrl ? (
                          <img
                            src={row.mangaCoverUrl}
                            alt={row.mangaTitle}
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span
                            className="flex h-full w-full items-center justify-center text-[10px] font-bold"
                            style={{ color: "var(--mr-text-muted)" }}
                          >
                            {row.mangaTitle.slice(0, 2).toUpperCase()}
                          </span>
                        )}
                      </Link>
                      <div className="min-w-0">
                        <Link
                          to={`/manga/${row.mangaSlug}`}
                          className="block truncate font-semibold hover:underline"
                          style={{ color: "var(--mr-text-primary)" }}
                        >
                          {row.mangaTitle}
                        </Link>
                        <p className="text-xs" style={{ color: "var(--mr-text-secondary)" }}>
                          {formatRatingAction(row.actionType, row.previousScore, row.newScore)}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs" style={{ color: "var(--mr-text-muted)" }}>
                      {new Date(row.recordedAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
              {ratingsQuery.data ? (
                <CatalogPagination
                  page={ratingPage}
                  total={ratingsQuery.data.meta.total}
                  pageSize={ratingsQuery.data.meta.pageSize || 20}
                  hasNext={ratingsQuery.data.meta.hasNext}
                  onPageChange={setRatingPage}
                  label="Rating history pagination"
                />
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {tab === "stats" ? (
        statsQuery.isLoading ? (
          <LoadingState
            variant="dashboard"
            label="Analyzing reading history & building visual story..."
          />
        ) : !statsQuery.data?.data.hasData ? (
          <EmptyState
            title="Not enough reading data yet"
            description="Open a few chapters, bookmark titles in your library, or rate completed manga to unlock your interactive Data Storytelling dashboard."
          />
        ) : (
          (() => {
            const st = statsQuery.data.data;
            const story = buildReaderDataStory(st, ratingsQuery.data?.data);
            const validRate =
              st.chapterOpens > 0 ? Math.round((st.validViews / st.chapterOpens) * 100) : 0;
            const chaptersPerSeries =
              st.uniqueMangasInteracted > 0
                ? (st.uniqueChaptersRead / st.uniqueMangasInteracted).toFixed(1)
                : "0";
            const breakdownEntries = Object.entries(st.readingStatusBreakdown || {});
            const totalTracked = breakdownEntries.reduce((acc, [, v]) => acc + v, 0);
            const rateCoveragePct =
              st.uniqueMangasInteracted > 0
                ? Math.round((st.ratingsCount / st.uniqueMangasInteracted) * 100)
                : 0;

            const STATUS_META: Record<string, { label: string; color: string; hint: string }> = {
              READING: {
                label: "Currently Reading",
                color: "#38bdf8",
                hint: "Active ongoing titles in rotation",
              },
              COMPLETED: {
                label: "Completed",
                color: "#34d399",
                hint: "Series finished end-to-end",
              },
              PLAN_TO_READ: {
                label: "Plan to Read",
                color: "#a78bfa",
                hint: "Saved backlog queue",
              },
              ON_HOLD: {
                label: "On Hold",
                color: "#fbbf24",
                hint: "Paused mid-series",
              },
              DROPPED: {
                label: "Dropped",
                color: "#f87171",
                hint: "Discontinued early",
              },
            };

            const donutSegments = breakdownEntries
              .filter(([, count]) => count > 0)
              .map(([key, count]) => {
                const meta = STATUS_META[key] ?? {
                  label: key.replace(/_/g, " "),
                  color: "#94a3b8",
                  hint: "Library status",
                };
                return {
                  key,
                  label: meta.label,
                  value: count,
                  color: meta.color,
                  hint: meta.hint,
                };
              });

            const maxCreatorWork = Math.max(1, ...st.topCreators.map((c) => c.workCount));

            return (
              <div className="space-y-5">
                {/* 1. Data Storytelling Persona & Actionable Insights */}
                <StorytellingNarrativeCard {...story} />

                {/* 2. Executive Metrics Strip */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  {[
                    {
                      label: "Chapter Opens",
                      val: st.chapterOpens.toLocaleString(),
                      sub: "Total sessions started",
                    },
                    {
                      label: "Valid Deep Reads",
                      val: st.validViews.toLocaleString(),
                      sub: `${validRate}% dwell completion`,
                    },
                    {
                      label: "Unique Chapters",
                      val: st.uniqueChaptersRead.toLocaleString(),
                      sub: "Distinct episodes read",
                    },
                    {
                      label: "Series Explored",
                      val: st.uniqueMangasInteracted.toLocaleString(),
                      sub: `${chaptersPerSeries} ch/title avg`,
                    },
                    {
                      label: "Ratings Submitted",
                      val: st.ratingsCount.toLocaleString(),
                      sub: `${rateCoveragePct}% of explored titles`,
                    },
                    {
                      label: "Mean Score Given",
                      val:
                        st.averageRatingGiven !== null
                          ? `${st.averageRatingGiven.toFixed(2)}/10`
                          : "—",
                      sub:
                        st.averageRatingGiven === null
                          ? "Rate a manga to calibrate"
                          : st.averageRatingGiven >= 8
                            ? "Generous curator (>8.0)"
                            : st.averageRatingGiven >= 6.5
                              ? "Balanced evaluator"
                              : "Discerning critic (<6.5)",
                    },
                  ].map((kpi) => (
                    <div
                      key={kpi.label}
                      className="rounded-[var(--mr-radius-md)] border p-3.5"
                      style={{
                        backgroundColor: "var(--mr-bg-surface)",
                        borderColor: "var(--mr-border-subtle)",
                      }}
                    >
                      <p className="text-[11px]" style={{ color: "var(--mr-text-muted)" }}>
                        {kpi.label}
                      </p>
                      <p
                        className="mt-1 text-xl font-bold"
                        style={{ color: "var(--mr-text-primary)" }}
                      >
                        {kpi.val}
                      </p>
                      <p
                        className="mt-0.5 text-[10px]"
                        style={{ color: "var(--mr-text-secondary)" }}
                      >
                        {kpi.sub}
                      </p>
                    </div>
                  ))}
                </div>

                {/* 3. Reading Retention Funnel + Library Pipeline Donut */}
                <div className="grid gap-4 lg:grid-cols-2">
                  <EngagementFunnelChart
                    title="Reading Commitment Funnel"
                    subtitle="How opening a chapter converts into deep reading, library curation, and community rating"
                    stages={[
                      {
                        key: "opens",
                        label: "Chapter Opens",
                        value: st.chapterOpens,
                        conversionLabel: "100% Entry",
                        hint: "Total chapter views triggered in the reader.",
                        color: "#38bdf8",
                      },
                      {
                        key: "valid",
                        label: "Valid Qualified Views",
                        value: st.validViews,
                        conversionLabel: `${validRate}% Deep-Read`,
                        hint:
                          validRate >= 65
                            ? "High immersion: most opened chapters keep your attention."
                            : "Many short previews — bookmark promising hits before losing track.",
                        color: "#34d399",
                      },
                      {
                        key: "tracked",
                        label: "Tracked Series in Library",
                        value: totalTracked,
                        conversionLabel: `${st.uniqueMangasInteracted} Interacted`,
                        hint: "Titles organized across Reading, Completed, and Plan-to-Read.",
                        color: "#a78bfa",
                      },
                      {
                        key: "rated",
                        label: "Rated Titles",
                        value: st.ratingsCount,
                        conversionLabel: `${rateCoveragePct}% Coverage`,
                        hint: "Scored series that sharpen Home personalized recommendations.",
                        color: "#fbbf24",
                      },
                    ]}
                  />

                  <InteractiveDonutChart
                    title="Library Lifecycle Distribution"
                    subtitle="Click any segment to inspect backlog vs. completion momentum"
                    centerLabel="Tracked Titles"
                    centerValue={totalTracked.toLocaleString()}
                    items={
                      donutSegments.length > 0
                        ? donutSegments
                        : [
                            {
                              key: "untracked",
                              label: "No Bookmarked Series Yet",
                              value: Math.max(1, st.uniqueMangasInteracted),
                              color: "#64748b",
                              hint: "Add titles to Library to organize Reading & Plan-to-Read.",
                            },
                          ]
                    }
                  />
                </div>

                {/* 4. Genre DNA Radar + Interactive Top Genres Bar/Area Chart */}
                <div className="grid gap-4 lg:grid-cols-2">
                  {st.topTags.length >= 3 ? (
                    <GenreRadarChart
                      title="Personal Genre DNA Footprint"
                      subtitle="Hover vertices to examine how concentrated or diverse your taste signature is"
                      axes={st.topTags.slice(0, 7).map((t) => ({
                        label: t.name,
                        value: t.count,
                        displayValue: `${t.count} hits`,
                      }))}
                    />
                  ) : (
                    <div
                      className="flex flex-col justify-center rounded-[var(--mr-radius-lg)] border p-5"
                      style={{
                        backgroundColor: "var(--mr-bg-surface)",
                        borderColor: "var(--mr-border-subtle)",
                      }}
                    >
                      <h3 className="text-sm font-bold">Personal Genre DNA Footprint</h3>
                      <p
                        className="mt-2 text-xs leading-relaxed"
                        style={{ color: "var(--mr-text-muted)" }}
                      >
                        Read across at least 3 distinct genres/tags to unlock the multi-axis Taste
                        Radar visualization.
                      </p>
                      <Link
                        to="/search/advanced"
                        className="mt-3 inline-block text-xs font-semibold hover:underline"
                        style={{ color: "var(--mr-accent)" }}
                      >
                        Discover new tags in Advanced Search →
                      </Link>
                    </div>
                  )}

                  <InteractiveTrendChart
                    title="Top Genres & Thematic Engagement"
                    subtitle="Switch Bar/Area views or click a genre bar to explore matching titles"
                    accentColor="#38bdf8"
                    averageLabel="Tag Avg"
                    valueFormatter={(v) => `${v} ch/interactions`}
                    data={st.topTags.map((t) => ({
                      key: t.slug,
                      label: t.name,
                      value: t.count,
                      sublabel: `#${t.slug}`,
                      href: `/search/advanced?tag=${encodeURIComponent(t.slug)}`,
                    }))}
                  />
                </div>

                {/* 5. Top Creators Affinity Panel */}
                <div
                  className="rounded-[var(--mr-radius-lg)] border p-5"
                  style={{
                    backgroundColor: "var(--mr-bg-surface)",
                    borderColor: "var(--mr-border-subtle)",
                  }}
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold">Top Creators Affinity</h3>
                      <p className="text-[11px]" style={{ color: "var(--mr-text-muted)" }}>
                        Authors & artists whose catalogs drive your highest engagement — click any
                        creator to browse their bibliography
                      </p>
                    </div>
                    <Link
                      to="/search/advanced?tab=creators"
                      className="text-xs font-semibold hover:underline"
                      style={{ color: "var(--mr-accent)" }}
                    >
                      Browse Creator Directory →
                    </Link>
                  </div>

                  {st.topCreators.length === 0 ? (
                    <p className="text-xs" style={{ color: "var(--mr-text-muted)" }}>
                      No creator attribution recorded yet in your reading history.
                    </p>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2">
                      {st.topCreators.map((c, idx) => {
                        const widthPct = Math.max(
                          10,
                          Math.round((c.workCount / maxCreatorWork) * 100),
                        );
                        return (
                          <Link
                            key={c.creatorId}
                            to={`/author/${encodeURIComponent(c.creatorId)}/${encodeURIComponent(c.creatorId)}`}
                            className="block rounded-[var(--mr-radius-md)] border p-3 transition hover:border-sky-400"
                            style={{
                              backgroundColor: "var(--mr-bg-canvas)",
                              borderColor: "var(--mr-border-subtle)",
                            }}
                          >
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <span
                                className="truncate font-semibold"
                                style={{ color: "var(--mr-text-primary)" }}
                              >
                                <span
                                  className="mr-1.5 font-mono text-[11px]"
                                  style={{ color: "var(--mr-accent)" }}
                                >
                                  #{idx + 1}
                                </span>
                                {c.name}
                              </span>
                              <span
                                className="shrink-0 font-mono text-[11px]"
                                style={{ color: "var(--mr-text-secondary)" }}
                              >
                                {c.workCount} works read
                              </span>
                            </div>
                            <div
                              className="mt-2 h-1.5 overflow-hidden rounded-full"
                              style={{ backgroundColor: "var(--mr-bg-elevated)" }}
                            >
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${widthPct}%`,
                                  backgroundColor: idx === 0 ? "#38bdf8" : "#34d399",
                                }}
                              />
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })()
        )
      ) : null}
    </div>
  );
}
