import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { EmptyState, LoadingState } from "../../components/StateViews";
import { useAuth } from "../../hooks/useAuth";
import { ApiClientError, apiClient, type ReaderSettingsData } from "../../services/apiClient";

type SettingsTab = "profile" | "security" | "reader" | "ratings" | "stats";

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
  const [avatarFile, setAvatarFile] = useState<File | null>(null);

  // Password form
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

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

  useEffect(() => {
    if (readerSettingsQuery.data?.data) {
      setReaderForm(readerSettingsQuery.data.data);
    }
  }, [readerSettingsQuery.data]);

  const ratingsQuery = useQuery({
    queryKey: ["account", "rating-history"],
    queryFn: () => apiClient.getMyRatingHistory(1),
    enabled: tab === "ratings",
  });

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

  async function handleUploadAvatar(e: FormEvent) {
    e.preventDefault();
    if (!avatarFile) return;
    setMessage(null);
    try {
      await apiClient.uploadAvatar(avatarFile);
      await refreshProfile();
      setAvatarFile(null);
      setMessage({ tone: "ok", text: "Avatar uploaded and verified." });
    } catch (err) {
      setMessage({
        tone: "err",
        text: err instanceof ApiClientError ? err.message : "Avatar upload failed.",
      });
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
      await apiClient.updateReaderSettings(readerForm);
      void queryClient.invalidateQueries({ queryKey: ["reader", "settings"] });
      setMessage({ tone: "ok", text: "Reader preferences saved." });
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

          <form
            onSubmit={handleUploadAvatar}
            className="space-y-4 rounded-[var(--mr-radius-lg)] border p-5"
            style={{
              backgroundColor: "var(--mr-bg-surface)",
              borderColor: "var(--mr-border-subtle)",
            }}
          >
            <h2 className="text-base font-semibold">Avatar Image</h2>
            <p className="text-xs" style={{ color: "var(--mr-text-secondary)" }}>
              Supports PNG, JPEG, and WebP up to 5 MB (MIME-verified server-side).
            </p>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setAvatarFile(e.target.files?.[0] ?? null)}
              className="block w-full text-xs"
            />
            <button
              type="submit"
              disabled={!avatarFile}
              className="cursor-pointer rounded-[var(--mr-radius-sm)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: "var(--mr-accent)" }}
            >
              Upload Avatar
            </button>
          </form>
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
          <LoadingState label="Loading reader settings..." />
        ) : (
          <form
            onSubmit={handleSaveReaderSettings}
            className="max-w-md space-y-4 rounded-[var(--mr-radius-lg)] border p-5"
            style={{
              backgroundColor: "var(--mr-bg-surface)",
              borderColor: "var(--mr-border-subtle)",
            }}
          >
            <h2 className="text-base font-semibold">Default Reader Settings</h2>
            <div>
              <label className="mb-1 block text-xs font-medium">Display Mode</label>
              <select
                value={readerForm.displayMode}
                onChange={(e) =>
                  setReaderForm((prev) => ({
                    ...prev,
                    displayMode: e.target.value as ReaderSettingsData["displayMode"],
                  }))
                }
                className="w-full rounded border px-3 py-2 text-sm"
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
            <div>
              <label className="mb-1 block text-xs font-medium">Reading Direction</label>
              <select
                value={readerForm.readingDirection}
                onChange={(e) =>
                  setReaderForm((prev) => ({
                    ...prev,
                    readingDirection: e.target.value as ReaderSettingsData["readingDirection"],
                  }))
                }
                className="w-full rounded border px-3 py-2 text-sm"
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
            <div>
              <label className="mb-1 block text-xs font-medium">Fit Mode</label>
              <select
                value={readerForm.fitMode}
                onChange={(e) =>
                  setReaderForm((prev) => ({
                    ...prev,
                    fitMode: e.target.value as ReaderSettingsData["fitMode"],
                  }))
                }
                className="w-full rounded border px-3 py-2 text-sm"
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
            <div>
              <label className="mb-1 block text-xs font-medium">
                Preload Page Count ({readerForm.preloadPageCount})
              </label>
              <input
                type="range"
                min={0}
                max={10}
                value={readerForm.preloadPageCount}
                onChange={(e) =>
                  setReaderForm((prev) => ({ ...prev, preloadPageCount: Number(e.target.value) }))
                }
                className="w-full"
              />
            </div>
            <button
              type="submit"
              className="cursor-pointer rounded-[var(--mr-radius-sm)] px-4 py-2 text-sm font-semibold text-white"
              style={{ backgroundColor: "var(--mr-accent)" }}
            >
              Save Preferences
            </button>
          </form>
        )
      ) : null}

      {tab === "ratings" ? (
        ratingsQuery.isLoading ? (
          <LoadingState label="Loading rating history..." />
        ) : ratingsQuery.data && ratingsQuery.data.data.length === 0 ? (
          <EmptyState title="No rating history yet" />
        ) : (
          <ul
            className="divide-y rounded-[var(--mr-radius-lg)] border"
            style={{
              backgroundColor: "var(--mr-bg-surface)",
              borderColor: "var(--mr-border-subtle)",
            }}
          >
            {ratingsQuery.data?.data.map((row) => (
              <li
                key={row.ratingHistoryId}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                style={{ borderColor: "var(--mr-border-subtle)" }}
              >
                <div>
                  <Link
                    to={`/manga/${row.mangaSlug}`}
                    className="font-semibold hover:underline"
                    style={{ color: "var(--mr-text-primary)" }}
                  >
                    {row.mangaTitle}
                  </Link>
                  <p className="text-xs" style={{ color: "var(--mr-text-muted)" }}>
                    {row.actionType}: {row.previousScore ?? "—"} → {row.newScore ?? "Removed"}
                  </p>
                </div>
                <span className="text-xs" style={{ color: "var(--mr-text-muted)" }}>
                  {new Date(row.recordedAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {tab === "stats" ? (
        statsQuery.isLoading ? (
          <LoadingState label="Computing personal reading statistics..." />
        ) : !statsQuery.data?.data.hasData ? (
          <EmptyState
            title="Not enough reading data yet"
            description="Start reading and rating manga to unlock your personal reading insights."
          />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Chapter Opens", val: statsQuery.data.data.chapterOpens },
                { label: "Valid Views", val: statsQuery.data.data.validViews },
                { label: "Unique Chapters", val: statsQuery.data.data.uniqueChaptersRead },
                {
                  label: "Avg Rating Given",
                  val:
                    statsQuery.data.data.averageRatingGiven !== null
                      ? `${statsQuery.data.data.averageRatingGiven.toFixed(2)}/10`
                      : "—",
                },
              ].map((kpi) => (
                <div
                  key={kpi.label}
                  className="rounded-[var(--mr-radius-md)] border p-4"
                  style={{
                    backgroundColor: "var(--mr-bg-surface)",
                    borderColor: "var(--mr-border-subtle)",
                  }}
                >
                  <p className="text-xs" style={{ color: "var(--mr-text-muted)" }}>
                    {kpi.label}
                  </p>
                  <p className="mt-1 text-xl font-bold" style={{ color: "var(--mr-text-primary)" }}>
                    {kpi.val}
                  </p>
                </div>
              ))}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div
                className="rounded-[var(--mr-radius-md)] border p-4"
                style={{
                  backgroundColor: "var(--mr-bg-surface)",
                  borderColor: "var(--mr-border-subtle)",
                }}
              >
                <h3 className="mb-2 text-sm font-semibold">Top Tags</h3>
                <ul className="space-y-1 text-xs">
                  {statsQuery.data.data.topTags.map((t) => (
                    <li key={t.slug} className="flex justify-between">
                      <span>{t.name}</span>
                      <span className="font-mono">{t.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div
                className="rounded-[var(--mr-radius-md)] border p-4"
                style={{
                  backgroundColor: "var(--mr-bg-surface)",
                  borderColor: "var(--mr-border-subtle)",
                }}
              >
                <h3 className="mb-2 text-sm font-semibold">Top Creators</h3>
                <ul className="space-y-1 text-xs">
                  {statsQuery.data.data.topCreators.map((c) => (
                    <li key={c.creatorId} className="flex justify-between">
                      <span>{c.name}</span>
                      <span className="font-mono">{c.workCount} works</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}
