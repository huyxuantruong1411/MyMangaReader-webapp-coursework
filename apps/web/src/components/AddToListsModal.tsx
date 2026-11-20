import { useEffect, useState, type FormEvent } from "react";
import { ApiClientError, apiClient } from "../services/apiClient";

interface MembershipRow {
  listId: string;
  name: string;
  itemCount: number;
  selected: boolean;
}

export function AddToListsModal({
  mangaId,
  mangaTitle,
  onClose,
}: {
  mangaId: string;
  mangaTitle: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<MembershipRow[]>([]);
  const [initialSelected, setInitialSelected] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [newListName, setNewListName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    apiClient
      .getMangaListMemberships(mangaId)
      .then((res) => {
        if (!mounted) return;
        setRows(res.data.lists);
        const sel = new Set(res.data.lists.filter((x) => x.selected).map((x) => x.listId));
        setInitialSelected(new Set(sel));
        setSelectedIds(sel);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err instanceof ApiClientError ? err.message : "Unable to load reading lists.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [mangaId]);

  function toggleList(listId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(listId)) {
        next.delete(listId);
      } else {
        next.add(listId);
      }
      return next;
    });
  }

  async function handleQuickCreate(e: FormEvent) {
    e.preventDefault();
    const trimmed = newListName.trim();
    if (!trimmed) return;
    setCreating(true);
    setError(null);
    try {
      const res = await apiClient.quickCreateList({ name: trimmed });
      const created = res.data;
      setRows((prev) => [
        {
          listId: created.listId,
          name: created.name,
          itemCount: created.itemCount,
          selected: true,
        },
        ...prev,
      ]);
      setSelectedIds((prev) => new Set(prev).add(created.listId));
      setNewListName("");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not create list.");
    } finally {
      setCreating(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiClient.syncMangaListMemberships(mangaId, Array.from(selectedIds));
      setRows(res.data.lists);
      const sel = new Set(res.data.lists.filter((x) => x.selected).map((x) => x.listId));
      setInitialSelected(new Set(sel));
      setSelectedIds(sel);
      setNotice("Reading list memberships updated.");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to save list memberships.");
    } finally {
      setSaving(false);
    }
  }

  const removedCount = Array.from(initialSelected).filter((id) => !selectedIds.has(id)).length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Manage reading list memberships"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    >
      <div
        className="w-full max-w-md rounded-[var(--mr-radius-lg)] border p-5 shadow-2xl"
        style={{
          backgroundColor: "var(--mr-bg-surface)",
          borderColor: "var(--mr-border-strong)",
          color: "var(--mr-text-primary)",
        }}
      >
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-base font-semibold">Add to Reading Lists</h3>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded px-2 py-0.5 text-sm"
            style={{ color: "var(--mr-text-muted)" }}
          >
            ✕
          </button>
        </div>
        <p className="mb-4 text-xs" style={{ color: "var(--mr-text-secondary)" }}>
          Select which private lists should include <strong>{mangaTitle}</strong>.
        </p>

        {/* Inline Quick-Create (UC-8.3) */}
        <form onSubmit={handleQuickCreate} className="mb-4 flex gap-2">
          <input
            type="text"
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
            placeholder="Quick-create a new list..."
            maxLength={120}
            className="flex-1 rounded-[var(--mr-radius-sm)] border px-3 py-1.5 text-sm"
            style={{
              backgroundColor: "var(--mr-bg-elevated)",
              borderColor: "var(--mr-border-subtle)",
              color: "var(--mr-text-primary)",
            }}
          />
          <button
            type="submit"
            disabled={creating || !newListName.trim()}
            className="cursor-pointer rounded-[var(--mr-radius-sm)] border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            style={{
              borderColor: "var(--mr-accent)",
              color: "var(--mr-accent)",
            }}
          >
            {creating ? "..." : "+ Create"}
          </button>
        </form>

        {loading ? (
          <p className="py-6 text-center text-sm" style={{ color: "var(--mr-text-muted)" }}>
            Loading your lists...
          </p>
        ) : rows.length === 0 ? (
          <p className="py-4 text-center text-sm" style={{ color: "var(--mr-text-muted)" }}>
            You don&apos;t have any reading lists yet. Create one above!
          </p>
        ) : (
          <ul className="max-h-60 space-y-1.5 overflow-y-auto pr-1">
            {rows.map((row) => (
              <li key={row.listId}>
                <label
                  className="flex cursor-pointer items-center justify-between rounded-[var(--mr-radius-sm)] border px-3 py-2 text-sm"
                  style={{
                    backgroundColor: "var(--mr-bg-elevated)",
                    borderColor: selectedIds.has(row.listId)
                      ? "var(--mr-accent)"
                      : "var(--mr-border-subtle)",
                  }}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(row.listId)}
                      onChange={() => toggleList(row.listId)}
                    />
                    <span className="font-medium">{row.name}</span>
                  </span>
                  <span className="text-xs" style={{ color: "var(--mr-text-muted)" }}>
                    {row.itemCount} items
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}

        {removedCount > 0 ? (
          <p
            className="mt-3 rounded-[var(--mr-radius-sm)] border p-2 text-xs"
            style={{
              borderColor: "var(--mr-warning)",
              color: "var(--mr-warning)",
            }}
          >
            Warning: Unchecking {removedCount} list(s) will remove this manga from them when saved.
          </p>
        ) : null}

        {error ? (
          <p className="mt-3 text-xs font-medium" style={{ color: "var(--mr-danger)" }}>
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="mt-3 text-xs font-medium" style={{ color: "var(--mr-success)" }}>
            {notice}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-[var(--mr-radius-sm)] border px-3 py-1.5 text-sm"
            style={{
              borderColor: "var(--mr-border-strong)",
              color: "var(--mr-text-secondary)",
            }}
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            className="cursor-pointer rounded-[var(--mr-radius-sm)] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: "var(--mr-accent)" }}
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
