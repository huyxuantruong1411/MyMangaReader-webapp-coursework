import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ReportModal } from "../../components/ReportModal";
import { ErrorState, LoadingState, NotFoundState } from "../../components/StateViews";
import { useAuth } from "../../hooks/useAuth";
import { ApiClientError, apiClient } from "../../services/apiClient";

export function ProfilePage() {
  const { username = "" } = useParams();
  const { isAuthenticated, user } = useAuth();
  const [reportOpen, setReportOpen] = useState(false);

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

  return (
    <section
      className="mx-auto max-w-2xl space-y-5 rounded-[var(--mr-radius-lg)] border p-6"
      style={{
        backgroundColor: "var(--mr-bg-surface)",
        borderColor: "var(--mr-border-subtle)",
      }}
    >
      <div className="flex flex-wrap items-center gap-4">
        <div
          className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border text-xl font-bold"
          style={{
            backgroundColor: "var(--mr-bg-elevated)",
            borderColor: "var(--mr-border-strong)",
            color: "var(--mr-accent)",
          }}
        >
          {profile.avatarUrl ? (
            <img
              src={profile.avatarUrl}
              alt={profile.displayName}
              className="h-full w-full object-cover"
            />
          ) : (
            profile.displayName.slice(0, 2).toUpperCase()
          )}
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

        <div className="flex gap-2">
          {isOwnProfile ? (
            <Link
              to="/settings"
              className="rounded-[var(--mr-radius-sm)] border px-3 py-1.5 text-xs font-semibold"
              style={{ borderColor: "var(--mr-border-strong)", color: "var(--mr-text-primary)" }}
            >
              Edit Profile
            </Link>
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
