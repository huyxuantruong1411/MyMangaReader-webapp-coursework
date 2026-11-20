import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { EmptyState, ErrorState, LoadingState } from "../../components/StateViews";
import { ApiClientError, apiClient } from "../../services/apiClient";

export function ReadingListsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const [mergeOpen, setMergeOpen] = useState(false);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [mergeName, setMergeName] = useState("");
  const [mergeDesc, setMergeDesc] = useState("");
  const [needsEmptyConfirm, setNeedsEmptyConfirm] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const listsQuery = useQuery({
    queryKey: ["lists", "my", search],
    queryFn: () => apiClient.listMyLists(search.trim() || undefined),
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["lists", "my"] });
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiClient.createList({
        name: newName.trim(),
        description: newDesc.trim() || undefined,
      });
      setNewName("");
      setNewDesc("");
      setCreateOpen(false);
      refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not create reading list.");
    } finally {
      setBusy(false);
    }
  }

  async function submitMerge(confirmEmpty: boolean) {
    setBusy(true);
    setError(null);
    try {
      await apiClient.mergeCreateList({
        sourceListIds: selectedSources,
        newName: mergeName.trim(),
        description: mergeDesc.trim() || undefined,
        confirmEmpty,
      });
      setSelectedSources([]);
      setMergeName("");
      setMergeDesc("");
      setNeedsEmptyConfirm(false);
      setMergeOpen(false);
      refresh();
    } catch (err) {
      if (
        err instanceof ApiClientError &&
        err.code === "EMPTY_SOURCE_LISTS_CONFIRMATION_REQUIRED"
      ) {
        setNeedsEmptyConfirm(true);
        setError(err.message);
      } else {
        setError(err instanceof ApiClientError ? err.message : "Merge failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  function toggleSource(listId: string) {
    setSelectedSources((prev) =>
      prev.includes(listId) ? prev.filter((id) => id !== listId) : [...prev, listId],
    );
    setNeedsEmptyConfirm(false);
  }

  const lists = listsQuery.data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--mr-text-primary)" }}>
            My Reading Lists
          </h1>
          <p className="text-xs" style={{ color: "var(--mr-text-secondary)" }}>
            Private personal collections with deduplicated Clone/Merge and dynamic metadata stats.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setCreateOpen((o) => !o);
              setMergeOpen(false);
              setError(null);
            }}
            className="cursor-pointer rounded-[var(--mr-radius-sm)] px-3.5 py-1.5 text-sm font-semibold text-white"
            style={{ backgroundColor: "var(--mr-accent)" }}
          >
            + New List
          </button>
          <button
            type="button"
            disabled={lists.length === 0}
            onClick={() => {
              setMergeOpen((o) => !o);
              setCreateOpen(false);
              setNeedsEmptyConfirm(false);
              setError(null);
            }}
            className="cursor-pointer rounded-[var(--mr-radius-sm)] border px-3.5 py-1.5 text-sm font-medium disabled:opacity-50"
            style={{ borderColor: "var(--mr-border-strong)", color: "var(--mr-text-primary)" }}
          >
            Clone / Merge Lists
          </button>
        </div>
      </div>

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search your lists by name..."
        className="w-full max-w-sm rounded-[var(--mr-radius-sm)] border px-3 py-1.5 text-sm"
        style={{
          backgroundColor: "var(--mr-bg-surface)",
          borderColor: "var(--mr-border-strong)",
          color: "var(--mr-text-primary)",
        }}
      />

      {error ? (
        <p role="alert" className="text-xs font-medium" style={{ color: "var(--mr-danger)" }}>
          {error}
        </p>
      ) : null}

      {createOpen ? (
        <form
          onSubmit={handleCreate}
          className="max-w-lg space-y-3 rounded-[var(--mr-radius-lg)] border p-4"
          style={{
            backgroundColor: "var(--mr-bg-surface)",
            borderColor: "var(--mr-border-strong)",
          }}
        >
          <h2 className="text-sm font-semibold">Create New Private List</h2>
          <input
            type="text"
            required
            maxLength={120}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="List name (unique per account)"
            className="w-full rounded border px-3 py-2 text-sm"
            style={{
              backgroundColor: "var(--mr-bg-elevated)",
              borderColor: "var(--mr-border-subtle)",
              color: "var(--mr-text-primary)",
            }}
          />
          <textarea
            rows={2}
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Optional description..."
            className="w-full rounded border px-3 py-2 text-sm"
            style={{
              backgroundColor: "var(--mr-bg-elevated)",
              borderColor: "var(--mr-border-subtle)",
              color: "var(--mr-text-primary)",
            }}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="cursor-pointer rounded border px-3 py-1.5 text-xs"
              style={{ borderColor: "var(--mr-border-strong)" }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="cursor-pointer rounded px-4 py-1.5 text-xs font-semibold text-white"
              style={{ backgroundColor: "var(--mr-accent)" }}
            >
              Create List
            </button>
          </div>
        </form>
      ) : null}

      {mergeOpen ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitMerge(false);
          }}
          className="max-w-xl space-y-3 rounded-[var(--mr-radius-lg)] border p-4"
          style={{
            backgroundColor: "var(--mr-bg-surface)",
            borderColor: "var(--mr-border-strong)",
          }}
        >
          <h2 className="text-sm font-semibold">Clone or Merge Existing Lists (UC-8.2)</h2>
          <p className="text-xs" style={{ color: "var(--mr-text-secondary)" }}>
            Select one list to clone or multiple lists to merge into a new deduplicated collection.
          </p>
          <div className="flex flex-wrap gap-2">
            {lists.map((lst) => (
              <label
                key={lst.listId}
                className="flex cursor-pointer items-center gap-1.5 rounded border px-2.5 py-1 text-xs"
                style={{
                  backgroundColor: "var(--mr-bg-elevated)",
                  borderColor: selectedSources.includes(lst.listId)
                    ? "var(--mr-accent)"
                    : "var(--mr-border-subtle)",
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedSources.includes(lst.listId)}
                  onChange={() => toggleSource(lst.listId)}
                />
                <span>
                  {lst.name} ({lst.itemCount})
                </span>
              </label>
            ))}
          </div>
          <input
            type="text"
            required
            value={mergeName}
            onChange={(e) => setMergeName(e.target.value)}
            placeholder="New merged list name"
            className="w-full rounded border px-3 py-2 text-sm"
            style={{
              backgroundColor: "var(--mr-bg-elevated)",
              borderColor: "var(--mr-border-subtle)",
              color: "var(--mr-text-primary)",
            }}
          />
          <input
            type="text"
            value={mergeDesc}
            onChange={(e) => setMergeDesc(e.target.value)}
            placeholder="Optional description"
            className="w-full rounded border px-3 py-2 text-sm"
            style={{
              backgroundColor: "var(--mr-bg-elevated)",
              borderColor: "var(--mr-border-subtle)",
              color: "var(--mr-text-primary)",
            }}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setMergeOpen(false)}
              className="cursor-pointer rounded border px-3 py-1.5 text-xs"
              style={{ borderColor: "var(--mr-border-strong)" }}
            >
              Cancel
            </button>
            {needsEmptyConfirm ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void submitMerge(true)}
                className="cursor-pointer rounded px-4 py-1.5 text-xs font-semibold text-white"
                style={{ backgroundColor: "var(--mr-warning)" }}
              >
                Confirm Create Empty Merged List
              </button>
            ) : (
              <button
                type="submit"
                disabled={busy || selectedSources.length === 0 || !mergeName.trim()}
                className="cursor-pointer rounded px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: "var(--mr-accent)" }}
              >
                Clone / Merge
              </button>
            )}
          </div>
        </form>
      ) : null}

      {listsQuery.isLoading ? (
        <LoadingState label="Loading reading lists..." />
      ) : listsQuery.isError ? (
        <ErrorState onRetry={() => void listsQuery.refetch()} />
      ) : lists.length === 0 ? (
        <EmptyState
          title="No reading lists yet"
          description="Create your first private reading list to organize manga and view metadata analytics."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {lists.map((lst) => (
            <Link
              key={lst.listId}
              to={`/reading-lists/${lst.listId}`}
              className="flex flex-col justify-between rounded-[var(--mr-radius-md)] border p-4 transition-colors"
              style={{
                backgroundColor: "var(--mr-bg-surface)",
                borderColor: "var(--mr-border-subtle)",
              }}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-semibold" style={{ color: "var(--mr-text-primary)" }}>
                    {lst.name}
                  </h2>
                  <span
                    className="rounded px-2 py-0.5 font-mono text-xs"
                    style={{
                      backgroundColor: "var(--mr-bg-elevated)",
                      color: "var(--mr-accent)",
                    }}
                  >
                    {lst.itemCount} titles
                  </span>
                </div>
                {lst.description ? (
                  <p
                    className="mt-1.5 line-clamp-2 text-xs"
                    style={{ color: "var(--mr-text-secondary)" }}
                  >
                    {lst.description}
                  </p>
                ) : null}
              </div>
              <p className="mt-3 text-[11px]" style={{ color: "var(--mr-text-muted)" }}>
                Private · Updated {new Date(lst.updatedAt).toLocaleDateString()}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
