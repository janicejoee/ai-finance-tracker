import React, { useEffect, useState } from "react";

import { ExpenseCategory } from "../../utils";

const NEW_CATEGORY_VALUE = "__new__";

interface CategorySelectProps {
  categories: ExpenseCategory[];
  value: string | null | undefined;
  disabled?: boolean;
  onAssign: (args: { categoryId?: string; categoryName?: string }) => Promise<void>;
}

export function CategorySelect({
  categories,
  value,
  disabled = false,
  onAssign,
}: CategorySelectProps) {
  const [busy, setBusy] = useState(false);
  const [showNewInput, setShowNewInput] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setShowNewInput(false);
    setNewName("");
    setError(null);
  }, [value]);

  const handleSelectChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = event.target.value;
    setError(null);

    if (selected === NEW_CATEGORY_VALUE) {
      setShowNewInput(true);
      return;
    }

    if (!selected) {
      return;
    }

    setBusy(true);
    try {
      await onAssign({ categoryId: selected });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to assign category");
    } finally {
      setBusy(false);
    }
  };

  const handleCreateAndAssign = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await onAssign({ categoryName: trimmed });
      setShowNewInput(false);
      setNewName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create category");
    } finally {
      setBusy(false);
    }
  };

  if (showNewInput) {
    return (
      <form
        onSubmit={handleCreateAndAssign}
        className="mt-1 flex flex-wrap items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New category"
          className="min-w-[10rem] rounded-lg border border-[var(--color-black-300)] px-2 py-1 text-[1.2rem] focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/20"
          autoFocus
          disabled={busy || disabled}
        />
        <button
          type="submit"
          disabled={busy || disabled || !newName.trim()}
          className="btn btn-primary px-2 py-1 text-[1.2rem]"
        >
          Add
        </button>
        <button
          type="button"
          onClick={() => {
            setShowNewInput(false);
            setNewName("");
            setError(null);
          }}
          disabled={busy || disabled}
          className="btn btn-secondary px-2 py-1 text-[1.2rem]"
        >
          Cancel
        </button>
        {error && <span className="text-[1.1rem] text-[var(--color-expense)]">{error}</span>}
      </form>
    );
  }

  return (
    <div className="inline-block" onClick={(e) => e.stopPropagation()}>
      <select
        value={value || ""}
        onChange={handleSelectChange}
        disabled={busy || disabled}
        className="max-w-full rounded-full border border-[var(--color-black-300)] bg-white px-2.5 py-0.5 text-[1.1rem] font-medium text-slate-600 shadow-sm transition-colors hover:bg-[var(--color-black-100)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/20 disabled:opacity-50"
      >
        <option value="" disabled>
          {value ? "Change category..." : "Categorize..."}
        </option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
        <option value={NEW_CATEGORY_VALUE}>+ Add new category...</option>
      </select>
      {error && <p className="mt-1 text-[1.1rem] text-[var(--color-expense)]">{error}</p>}
    </div>
  );
}
