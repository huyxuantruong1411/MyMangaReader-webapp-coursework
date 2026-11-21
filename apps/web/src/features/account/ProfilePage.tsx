import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type ChangeEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { ReportModal } from "../../components/ReportModal";
import { ErrorState, LoadingState, NotFoundState } from "../../components/StateViews";
import { UserAvatar } from "../../components/UserAvatar";
import { useAuth } from "../../hooks/useAuth";
import { ApiClientError, apiClient } from "../../services/apiClient";

export function ProfilePage() {
  const { username = "" } = useParams();
  const { isAuthenticated, user, refreshProfile } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarNotice, setAvatarNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(
    null,
  );

  const profileQuery = useQuery({
    queryKey: ["profile", username],
    queryFn: () => apiClient.getProfileByUsername(username),
    enabled: Boolean(username),
  });

  if (profileQuery.isLoading) return <LoadingState label="Loading profile..." />;
  if (profileQuery.isError) {
    if (profileQuery.error instanceof ApiClientError && profileQuery.error.status === 404) {
      return (
        <NotFoundState
          title="Profile unavailable"
          description="This reader profile does not exist or is currently unavailable."
        />
      );
    }
    return <ErrorState onRetry={() => void profileQuery.refetch()} />;
  }

  const profile = profileQuery.data?.data;
  if (!profile) return <NotFoundState title="Profile not found" />;

  const isOwnProfile = user?.accountId === profile.accountId;

  async function handleAvatarFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setAvatarNotice({ tone: "err", text: "Image file must be 5 MB or smaller." });
      return;
    }
    setAvatarBusy(true);
    setAvatarNotice(null);
    try {
      await apiClient.uploadAvatar(file);
      await refreshProfile();
      await queryClient.invalidateQueries({ queryKey: ["profile", username] });
      setAvatarNotice({ tone: "ok", text: "Avatar image updated successfully." });
    } catch (err) {
      setAvatarNotice({
        tone: "err",
        text: err instanceof ApiClientError ? err.message : "Failed to upload avatar image.",
      });
    } finally {
      setAvatarBusy(false);
    }
  }

  return (
    <section
      className="mx-auto max-w-2xl space-y-5 rounded-[var(--mr-radius-lg)] border p-6"
      style={{
        backgroundColor: "var(--mr-bg-surface)",
        borderColor: "var(--mr-border-subtle)",
      }}
    >
      {avatarNotice ? (
        <div
          role="status"
          className="rounded-[var(--mr-radius-sm)] border px-3 py-2 text-xs font-medium"
          style={{
            borderColor: avatarNotice.tone === "ok" ? "var(--mr-success)" : "var(--mr-danger)",
            color: avatarNotice.tone === "ok" ? "var(--mr-success)" : "var(--mr-danger)",
            backgroundColor: "var(--mr-bg-elevated)",
          }}
        >
          {avatarNotice.text}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-4">
        <div className="relative shrink-0">
          <UserAvatar src={profile.avatarUrl} name={profile.displayName} size="lg" />
          {isOwnProfile ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                aria-label="Upload new avatar image"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={(e) => void handleAvatarFileChange(e)}
              />
              <button
                type="button"
                disabled={avatarBusy}
                onClick={() => fileInputRef.current?.click()}
                title="Upload new avatar image"
                aria-label="Change avatar image"
                className="absolute -right-1 -bottom-1 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border text-xs shadow disabled:opacity-50"
                style={{
                  backgroundColor: "var(--mr-accent)",
                  borderColor: "var(--mr-bg-surface)",
                  color: "#ffffff",
                }}
              >
                {avatarBusy ? "…" : "📷"}
              </button>
            </>
          ) : null}
        </div>

        <div className="flex-1">
          <h1 className="text-xl font-bold" style={{ color: "var(--mr-text-primary)" }}>
            {profile.displayName}
          </h1>
          <p className="text-xs font-mono" style={{ color: "var(--mr-text-muted)" }}>
            @{profile.username} · {profile.role}
          </p>
          {profile.createdAt ? (
            <p className="mt-1 text-xs" style={{ color: "var(--mr-text-muted)" }}>
              Joined {new Date(profile.createdAt).toLocaleDateString()}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {isOwnProfile ? (
            <>
              <button
                type="button"
                disabled={avatarBusy}
                onClick={() => fileInputRef.current?.click()}
                className="cursor-pointer rounded-[var(--mr-radius-sm)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: "var(--mr-accent)" }}
              >
                {avatarBusy ? "Uploading Avatar..." : "Upload Avatar Image"}
              </button>
              <Link
                to="/settings"
                className="rounded-[var(--mr-radius-sm)] border px-3 py-1.5 text-xs font-semibold"
                style={{ borderColor: "var(--mr-border-strong)", color: "var(--mr-text-primary)" }}
              >
                Edit Profile &amp; Settings
              </Link>
            </>
          ) : isAuthenticated && profile.role === "READER" ? (
            <button
              type="button"
              onClick={() => setReportOpen(true)}
              className="cursor-pointer rounded-[var(--mr-radius-sm)] border px-3 py-1.5 text-xs font-medium"
              style={{ borderColor: "var(--mr-danger)", color: "var(--mr-danger)" }}
            >
              Report Account
            </button>
          ) : null}
        </div>
      </div>

      <div
        className="space-y-2 border-t pt-4 text-sm"
        style={{ borderColor: "var(--mr-border-subtle)" }}
      >
        <p className="whitespace-pre-wrap" style={{ color: "var(--mr-text-secondary)" }}>
          {profile.bio || "No bio set yet."}
        </p>
        {profile.birthDate ? (
          <p className="text-xs" style={{ color: "var(--mr-text-muted)" }}>
            Birth date: {profile.birthDate}
          </p>
        ) : null}
      </div>

      {reportOpen ? (
        <ReportModal
          target={{
            kind: "ACCOUNT",
            accountId: profile.accountId,
            label: `${profile.displayName} (@${profile.username})`,
          }}
          onClose={() => setReportOpen(false)}
        />
      ) : null}
    </section>
  );
}
