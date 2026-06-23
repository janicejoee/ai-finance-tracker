import React, { useState } from "react";

import { ExpenseCategory } from "../../utils";

interface CategoryManagerProps {
  categories: ExpenseCategory[];
  loading?: boolean;
  onCreate: (name: string) => Promise<void>;
  onUpdate: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function CategoryManager({
  categories,
  loading = false,
  onCreate,
  onUpdate,
  onDelete,
}: CategoryManagerProps) {
  const [newName, setNewName] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) {
      return;
    }

    setBusy("create");
    setError(null);
    try {
      await onCreate(trimmed);
      setNewName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add category");
    } finally {
      setBusy(null);
    }
  };

  const startEdit = (category: ExpenseCategory) => {
    setEditingId(category.id);
    setEditingName(category.name);
    setError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingName("");
  };

  const saveEdit = async () => {
    if (!editingId) {
      return;
    }
    const trimmed = editingName.trim();
    if (!trimmed) {
      return;
    }

    setBusy(editingId);
    setError(null);
    try {
      await onUpdate(editingId, trimmed);
      cancelEdit();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update category");
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      await onDelete(id);
      if (editingId === id) {
        cancelEdit();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete category");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        className={`flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-[var(--color-black-100)] sm:px-6 ${
          expanded ? "border-b border-[var(--color-black-300)]" : ""
        }`}
      >
        <div>
          <h3 className="text-[1.6rem] font-semibold">Categories</h3>
          <p className="mt-0.5 text-[1.2rem] text-slate-500">
            {categories.length} categor{categories.length === 1 ? "y" : "ies"}
            {!expanded && " — click to manage"}
          </p>
        </div>
        <span
          className={`shrink-0 text-[1.4rem] text-slate-400 transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
          aria-hidden
        >
          ▾
        </span>
      </button>

      {expanded && (
      <div className="px-5 py-4 sm:px-6">
        {error && (
          <p className="mb-3 text-[1.3rem] text-[var(--color-expense)]">{error}</p>
        )}

        {loading && categories.length === 0 ? (
          <p className="text-[1.4rem] text-slate-500">Loading categories...</p>
        ) : categories.length === 0 ? (
          <p className="mb-4 text-[1.4rem] text-slate-500">
            No categories yet. Add your first one below.
          </p>
        ) : (
          <ul className="mb-4 divide-y divide-[var(--color-black-300)] overflow-hidden rounded-lg border border-[var(--color-black-300)]">
            {categories.map((category) => (
              <li
                key={category.id}
                className="flex flex-wrap items-center justify-between gap-3 bg-white px-4 py-3 transition-colors hover:bg-[var(--color-black-100)]"
              >
                {editingId === category.id ? (
                  <>
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="min-w-[12rem] flex-1 rounded-lg border border-[var(--color-black-300)] px-3 py-2 text-[1.4rem] focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/20"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={saveEdit}
                        disabled={busy === category.id}
                        className="btn btn-primary px-3 py-1.5 text-[1.3rem]"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        disabled={busy === category.id}
                        className="btn btn-secondary px-3 py-1.5 text-[1.3rem]"
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="text-[1.4rem] font-medium text-slate-800">{category.name}</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(category)}
                        disabled={busy !== null}
                        className="btn btn-secondary px-3 py-1.5 text-[1.3rem]"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(category.id)}
                        disabled={busy !== null}
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-[1.3rem] font-medium text-[var(--color-expense)] transition-colors hover:bg-[var(--color-expense-soft)] disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleCreate} className="flex flex-wrap gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New category name"
            className="min-w-[16rem] flex-1 rounded-lg border border-[var(--color-black-300)] px-3 py-2 text-[1.4rem] focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/20"
          />
          <button
            type="submit"
            disabled={busy === "create" || !newName.trim()}
            className="btn btn-primary"
          >
            {busy === "create" ? "Adding..." : "Add category"}
          </button>
        </form>
      </div>
      )}
    </div>
  );
}
