import { FormEvent, useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";

type Kind = "expense" | "income" | "transfer";

type Category = {
  id: string;
  name: string;
};

type Transaction = {
  id: string;
  name: string;
  amount: number;
  date: string;
  approved: boolean;
  entryType: Kind;
  categoryId: string | null;
  categoryName: string | null;
};

function errorText(data: unknown, fallback: string) {
  if (!data || typeof data !== "object") return fallback;
  const body = data as { error?: unknown; error_message?: string };
  if (typeof body.error === "string") return body.error;
  if (body.error && typeof body.error === "object" && "error_message" in body.error) {
    const message = (body.error as { error_message?: string }).error_message;
    if (message) return message;
  }
  return body.error_message || fallback;
}

function parseKind(value: unknown): Kind {
  if (value === "income" || value === "transfer") return value;
  return "expense";
}

function parseCategories(data: unknown): Category[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((item) => {
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.name !== "string") return [];
    return [{ id: row.id, name: row.name }];
  });
}

function parseTransaction(data: unknown): Transaction | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  const id = String(row.plaid_transaction_id ?? "");
  if (!id) return null;
  return {
    id,
    name: String(row.name || row.merchant_name || "Unknown"),
    amount: Number(row.amount),
    date: String(row.date ?? "").slice(0, 10),
    approved: row.approved === true,
    entryType: parseKind(row.entry_type),
    categoryId: typeof row.category_id === "string" ? row.category_id : null,
    categoryName: typeof row.category_name === "string" ? row.category_name : null,
  };
}

function parseTransactions(data: unknown): Transaction[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((item) => {
    const tx = parseTransaction(item);
    return tx ? [tx] : [];
  });
}

function todayKey() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function formatMoney(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatAmount(amount: number) {
  const formatted = formatMoney(Math.abs(amount));
  return amount > 0 ? `−${formatted}` : `+${formatted}`;
}

type CategoryGroup = {
  category: string;
  count: number;
  total: number;
};

function kindOf(tx: Transaction): Kind {
  return tx.entryType;
}

function categoryLabel(tx: Transaction) {
  return tx.categoryName || "Uncategorized";
}

function formatCategory(category: string) {
  return category
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function currentMonthKey() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${month}`;
}

function shiftMonth(month: string, delta: number) {
  const [year, monthIndex] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthIndex - 1 + delta, 1));
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${date.getUTCFullYear()}-${nextMonth}`;
}

function monthBounds(rows: Transaction[]) {
  const current = currentMonthKey();
  let earliest = current;
  let latest = current;
  for (const tx of rows) {
    const month = tx.date.slice(0, 7);
    if (month.length < 7) continue;
    if (month < earliest) earliest = month;
    if (month > latest) latest = month;
  }
  return { earliest, latest };
}

function summarizeMonth(rows: Transaction[], month: string) {
  let expenses = 0;
  let income = 0;
  for (const tx of rows) {
    if (!tx.approved || tx.date.slice(0, 7) !== month) continue;
    const kind = kindOf(tx);
    if (kind === "expense") expenses += tx.amount;
    else if (kind === "income") income += Math.abs(tx.amount);
  }
  return { expenses, income };
}

function expenseGroups(rows: Transaction[]): CategoryGroup[] {
  const byCategory = new Map<string, CategoryGroup>();
  for (const tx of rows) {
    if (kindOf(tx) !== "expense") continue;
    const category = categoryLabel(tx);
    const group = byCategory.get(category);
    if (group) {
      group.count += 1;
      group.total += tx.amount;
    } else {
      byCategory.set(category, { category, count: 1, total: tx.amount });
    }
  }
  return [...byCategory.values()].sort((a, b) => b.total - a.total);
}

function formatMonth(month: string) {
  const [year, monthIndex] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthIndex - 1, 1)));
}

function MonthlySummary({
  rows,
  month,
  onMonthChange,
}: {
  rows: Transaction[];
  month: string;
  onMonthChange: (month: string) => void;
}) {
  const bounds = monthBounds(rows);
  const totals = summarizeMonth(rows, month);
  const groups = expenseGroups(
    rows.filter((tx) => tx.approved && tx.date.slice(0, 7) === month),
  );

  return (
    <section>
      <div className="month-nav">
        <button
          type="button"
          className="secondary"
          aria-label="Previous month"
          disabled={month <= bounds.earliest}
          onClick={() => onMonthChange(shiftMonth(month, -1))}
        >
          Prev
        </button>
        <h2>{formatMonth(month)}</h2>
        <button
          type="button"
          className="secondary"
          aria-label="Next month"
          disabled={month >= bounds.latest}
          onClick={() => onMonthChange(shiftMonth(month, 1))}
        >
          Next
        </button>
      </div>
      <div className="pair">
        <p>
          <span className="label">Expenses</span>
          <span className="amount out">{formatMoney(totals.expenses)}</span>
        </p>
        <p>
          <span className="label">Income</span>
          <span className="amount in">{formatMoney(totals.income)}</span>
        </p>
      </div>
      {groups.length > 0 && (
        <ul className="category-groups">
          {groups.map((group) => (
            <li key={group.category}>
              <span className="name">{formatCategory(group.category)}</span>
              <span className="count">{group.count}</span>
              <span className="amount out">{formatMoney(group.total)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CategoryEditor({
  transaction,
  disabled,
  categories,
  onSave,
}: {
  transaction: Transaction;
  disabled: boolean;
  categories: Category[];
  onSave: (transaction: Transaction, categoryId: string | null) => void;
}) {
  const known = categories.some((category) => category.id === transaction.categoryId);
  const value = transaction.categoryId && known ? transaction.categoryId : "";

  return (
    <div className="category-editor">
      <select
        className="category-input"
        disabled={disabled || !transaction.id}
        aria-label={`Category for ${transaction.name}`}
        value={value}
        onChange={(event) => {
          const next = event.target.value || null;
          if (next === (transaction.categoryId ?? null)) return;
          onSave(transaction, next);
        }}
      >
        <option value="">Uncategorized</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function ManualEntryForm({
  categories,
  onCreated,
  onError,
}: {
  categories: Category[];
  onCreated: (transaction: Transaction) => void;
  onError: (message: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayKey);
  const [entryType, setEntryType] = useState<Kind>("expense");
  const [categoryId, setCategoryId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function resetForm() {
    setName("");
    setAmount("");
    setDate(todayKey());
    setEntryType("expense");
    setCategoryId("");
  }

  function close() {
    if (submitting) return;
    setOpen(false);
    resetForm();
  }

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || submitting) return;
      setOpen(false);
      setName("");
      setAmount("");
      setDate(todayKey());
      setEntryType("expense");
      setCategoryId("");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, submitting]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    const value = Number(amount);
    if (!trimmed || !Number.isFinite(value) || value <= 0) {
      onError("Enter a name and a positive amount");
      return;
    }
    setSubmitting(true);
    onError(null);
    try {
      const body: Record<string, unknown> = {
        name: trimmed,
        amount: value,
        date,
        entry_type: entryType,
      };
      if (categoryId) body.category_id = categoryId;
      const response = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        onError(errorText(data, "Could not add transaction"));
        return;
      }
      const created = parseTransaction(data);
      if (!created) {
        onError("Could not add transaction");
        return;
      }
      onCreated(created);
      resetForm();
      setOpen(false);
    } catch {
      onError("Backend not reachable");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Add transaction
      </button>
      {open && (
        <div
          className="modal-backdrop"
          onClick={close}
          role="presentation"
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manual-entry-title"
            onClick={(event) => event.stopPropagation()}
          >
            <form className="manual-entry" onSubmit={submit}>
              <div className="modal-header">
                <h2 id="manual-entry-title">Add transaction</h2>
                <button
                  type="button"
                  className="secondary"
                  aria-label="Close"
                  onClick={close}
                  disabled={submitting}
                >
                  Close
                </button>
              </div>
              <div className="manual-entry-fields">
                <label>
                  Name
                  <input
                    type="text"
                    name="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                    autoFocus
                  />
                </label>
                <label>
                  Amount
                  <input
                    type="number"
                    name="amount"
                    min="0.01"
                    step="0.01"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    required
                  />
                </label>
                <label>
                  Date
                  <input
                    type="date"
                    name="date"
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                    required
                  />
                </label>
                <label>
                  Type
                  <select
                    name="entry_type"
                    value={entryType}
                    onChange={(event) => setEntryType(parseKind(event.target.value))}
                  >
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                    <option value="transfer">Transfer</option>
                  </select>
                </label>
                <label>
                  Category
                  <select
                    name="category_id"
                    value={categoryId}
                    onChange={(event) => setCategoryId(event.target.value)}
                  >
                    <option value="">Uncategorized</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="actions">
                <button type="submit" disabled={submitting}>
                  {submitting ? "Adding…" : "Add"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={close}
                  disabled={submitting}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function EditTransactionForm({
  transaction,
  onSaved,
  onClose,
  onError,
}: {
  transaction: Transaction;
  onSaved: (transaction: Transaction) => void;
  onClose: () => void;
  onError: (message: string | null) => void;
}) {
  const [name, setName] = useState(transaction.name);
  const [amount, setAmount] = useState(String(Math.abs(transaction.amount)));
  const [date, setDate] = useState(transaction.date);
  const [entryType, setEntryType] = useState<Kind>(transaction.entryType);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || submitting) return;
      onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, submitting]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    const value = Number(amount);
    if (!trimmed || !Number.isFinite(value) || value <= 0) {
      onError("Enter a name and a positive amount");
      return;
    }
    setSubmitting(true);
    onError(null);
    try {
      const response = await fetch(
        `/api/transactions/${encodeURIComponent(transaction.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: trimmed,
            amount: value,
            date,
            entry_type: entryType,
          }),
        },
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        onError(errorText(data, "Could not update transaction"));
        return;
      }
      const updated = parseTransaction(data);
      if (!updated) {
        onError("Could not update transaction");
        return;
      }
      onSaved(updated);
      onClose();
    } catch {
      onError("Backend not reachable");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!submitting) onClose();
      }}
      role="presentation"
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-entry-title"
        onClick={(event) => event.stopPropagation()}
      >
        <form className="manual-entry" onSubmit={submit}>
          <div className="modal-header">
            <h2 id="edit-entry-title">Edit transaction</h2>
            <button
              type="button"
              className="secondary"
              aria-label="Close"
              onClick={onClose}
              disabled={submitting}
            >
              Close
            </button>
          </div>
          <div className="manual-entry-fields">
            <label>
              Name
              <input
                type="text"
                name="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                autoFocus
              />
            </label>
            <label>
              Amount
              <input
                type="number"
                name="amount"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                required
              />
            </label>
            <label>
              Date
              <input
                type="date"
                name="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                required
              />
            </label>
            <label>
              Type
              <select
                name="entry_type"
                value={entryType}
                onChange={(event) => setEntryType(parseKind(event.target.value))}
              >
                <option value="expense">Expense</option>
                <option value="income">Income</option>
                <option value="transfer">Transfer</option>
              </select>
            </label>
          </div>
          <div className="actions">
            <button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function UpdatesFeed({
  rows,
  categories,
  savingIds,
  onToggle,
  onCategory,
  onEdit,
  onDelete,
}: {
  rows: Transaction[];
  categories: Category[];
  savingIds: ReadonlySet<string>;
  onToggle: (transaction: Transaction) => void;
  onCategory: (transaction: Transaction, categoryId: string | null) => void;
  onEdit: (transaction: Transaction) => void;
  onDelete: (transaction: Transaction) => void;
}) {
  return (
    <section>
      <h2>New Transactions</h2>
      {rows.length === 0 ? (
        <p className="empty">You're all caught up.</p>
      ) : (
        <ul className="feed">
          {rows.map((tx) => (
            <li key={tx.id || `${tx.date}-${tx.name}`}>
              <div>
                <p className="name">{tx.name}</p>
                <span className="date">{tx.date}</span>
                <CategoryEditor
                  transaction={tx}
                  disabled={savingIds.has(tx.id)}
                  categories={categories}
                  onSave={onCategory}
                />
                <div className="row-actions">
                  <button
                    type="button"
                    className="text"
                    disabled={!tx.id || savingIds.has(tx.id)}
                    onClick={() => onEdit(tx)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="text"
                    disabled={!tx.id || savingIds.has(tx.id)}
                    onClick={() => onDelete(tx)}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <span className={tx.amount > 0 ? "amount out" : "amount in"}>
                {formatAmount(tx.amount)}
              </span>
              <label className="include">
                <input
                  type="checkbox"
                  checked={tx.approved}
                  disabled={!tx.id || savingIds.has(tx.id)}
                  aria-label={`Include ${tx.name}`}
                  onChange={() => onToggle(tx)}
                />
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TransactionTable({
  title,
  rows,
  empty,
  categories,
  savingIds,
  onToggle,
  onCategory,
  onEdit,
  onDelete,
}: {
  title: string;
  rows: Transaction[];
  empty: string;
  categories: Category[];
  savingIds: ReadonlySet<string>;
  onToggle: (transaction: Transaction) => void;
  onCategory: (transaction: Transaction, categoryId: string | null) => void;
  onEdit: (transaction: Transaction) => void;
  onDelete: (transaction: Transaction) => void;
}) {
  return (
    <section>
      <div className="section-title">
        <h2>{title}</h2>
        <span className="count">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="empty">{empty}</p>
      ) : (
        <table>
          <tbody>
            {rows.map((tx) => (
              <tr key={tx.id || `${tx.date}-${tx.name}`}>
                <td>
                  <p className="name">{tx.name}</p>
                  <span className="date">{tx.date}</span>
                  <CategoryEditor
                    transaction={tx}
                    disabled={savingIds.has(tx.id)}
                    categories={categories}
                    onSave={onCategory}
                  />
                  <div className="row-actions">
                    <button
                      type="button"
                      className="text"
                      disabled={!tx.id || savingIds.has(tx.id)}
                      onClick={() => onEdit(tx)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="text"
                      disabled={!tx.id || savingIds.has(tx.id)}
                      onClick={() => onDelete(tx)}
                    >
                      Delete
                    </button>
                  </div>
                </td>
                <td className={tx.amount > 0 ? "amount out" : "amount in"}>
                  {formatAmount(tx.amount)}
                </td>
                <td className="check">
                  <label className="include">
                    <input
                      type="checkbox"
                      checked={tx.approved}
                      disabled={!tx.id || savingIds.has(tx.id)}
                      aria-label={`${tx.approved ? "Remove" : "Include"} ${tx.name}`}
                      onChange={() => onToggle(tx)}
                    />
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Login({ onLoggedIn }: { onLoggedIn: (email: string) => void }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const creating =
      submitter instanceof HTMLButtonElement && submitter.value === "signup";
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(creating ? "/api/signup" : "/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.email) {
        setError(errorText(data, creating ? "Could not create account" : "Could not sign in"));
        return;
      }
      onLoggedIn(String(data.email));
    } catch {
      setError("Backend not reachable");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h1>Sign in</h1>
      <label>
        Email
        <input
          type="email"
          name="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="submit" value="login" disabled={submitting}>
          {submitting ? "Please wait…" : "Sign in"}
        </button>
        <button
          type="submit"
          value="signup"
          className="secondary"
          disabled={submitting}
        >
          Create account
        </button>
      </div>
    </form>
  );
}

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

function AskChat({
  onUnauthorized,
}: {
  onUnauthorized: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [retryQuestion, setRetryQuestion] = useState<string | null>(null);

  async function sendQuestion(question: string) {
    const trimmed = question.trim();
    if (!trimmed || sending) return;

    const history = messages.slice(-10);
    setSending(true);
    setChatError(null);
    setRetryQuestion(null);
    setDraft("");
    setMessages((current) => [...current, { role: "user", content: trimmed }]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed, history }),
      });
      const data = await response.json().catch(() => null);
      if (response.status === 401) {
        onUnauthorized();
        return;
      }
      if (!response.ok) {
        setMessages((current) => current.slice(0, -1));
        setDraft(trimmed);
        setRetryQuestion(trimmed);
        setChatError(errorText(data, "Could not get an answer"));
        return;
      }
      const answer =
        data && typeof data === "object" && typeof (data as { answer?: unknown }).answer === "string"
          ? (data as { answer: string }).answer
          : "";
      setMessages((current) => [
        ...current,
        { role: "assistant", content: answer || "No answer returned." },
      ]);
    } catch {
      setMessages((current) => current.slice(0, -1));
      setDraft(trimmed);
      setRetryQuestion(trimmed);
      setChatError("Backend not reachable");
    } finally {
      setSending(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void sendQuestion(draft);
  }

  return (
    <section className="ask">
      <p className="ask-intro">
        Ask about your approved expenses—totals, categories, merchants, or comparisons.
      </p>
      <div className="ask-thread" aria-live="polite">
        {messages.length === 0 && !sending && (
          <p className="ask-empty">Try “How much did I spend this month?”</p>
        )}
        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={`ask-bubble ${message.role}`}
          >
            <span className="ask-role">
              {message.role === "user" ? "You" : "Assistant"}
            </span>
            <p>{message.content}</p>
          </div>
        ))}
        {sending && <p className="ask-loading">Thinking…</p>}
      </div>
      {chatError && (
        <div className="ask-error">
          <p className="error">{chatError}</p>
          {retryQuestion && (
            <button
              type="button"
              className="secondary"
              onClick={() => void sendQuestion(retryQuestion)}
              disabled={sending}
            >
              Retry
            </button>
          )}
        </div>
      )}
      <form className="ask-form" onSubmit={onSubmit}>
        <label>
          Question
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="How much did I spend on dining last month?"
            disabled={sending}
          />
        </label>
        <button type="submit" disabled={sending || !draft.trim()}>
          {sending ? "Asking…" : "Ask"}
        </button>
      </form>
    </section>
  );
}

function Connect({
  token,
  onLinked,
  onError,
}: {
  token: string;
  onLinked: () => void;
  onError: (message: string) => void;
}) {
  const oauth = window.location.href.includes("?oauth_state_id=");

  const { open, ready } = usePlaidLink({
    token,
    receivedRedirectUri: oauth ? window.location.href : undefined,
    onSuccess: async (publicToken) => {
      const response = await fetch("/api/bank/connect", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ public_token: publicToken }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        onError(errorText(data, "Could not save the bank link"));
        return;
      }
      window.history.replaceState("", "", "/");
      onLinked();
    },
    onExit: (error) => {
      if (error?.error_message) onError(error.error_message);
    },
  });

  useEffect(() => {
    if (oauth && ready) open();
  }, [oauth, ready, open]);

  return (
    <button type="button" className="connect" onClick={() => open()} disabled={!ready}>
      {ready ? "Connect bank" : "Loading…"}
    </button>
  );
}

export default function App() {
  const [email, setEmail] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [linked, setLinked] = useState<boolean | null>(null);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<"home" | "updates" | "ask">("home");
  const [month, setMonth] = useState(currentMonthKey);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const waiting = transactions.filter((tx) => !tx.approved);
  const approved = transactions.filter((tx) => tx.approved && tx.date.slice(0, 7) === month);
  const income = approved.filter((tx) => kindOf(tx) === "income");
  const expenses = approved.filter((tx) => kindOf(tx) === "expense");
  const transfers = approved.filter((tx) => kindOf(tx) === "transfer");
  const loadTransactions = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/transactions", { signal });
      const data = await response.json();
      if (signal?.aborted) return;
      if (!response.ok) {
        throw new Error(errorText(data, "Failed to load transactions"));
      }
      setTransactions(parseTransactions(data));
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/session");
        const data = await response.json().catch(() => null);
        if (cancelled || !response.ok || !data?.email) return;
        setEmail(String(data.email));
      } catch {
        // Stay on the sign-in form when the backend is down.
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!email) return;

    const oauth = window.location.href.includes("?oauth_state_id=");
    if (oauth) {
      setLinkToken(localStorage.getItem("link_token"));
      setLinked(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const statusRes = await fetch("/api/bank");
        const status = await statusRes.json();
        if (cancelled) return;
        if (statusRes.ok && status.linked) {
          setLinked(true);
          return;
        }

        const tokenRes = await fetch("/api/bank/link-token", { method: "POST" });
        const tokenData = await tokenRes.json();
        if (cancelled) return;
        if (!tokenRes.ok || !tokenData.link_token) {
          setError(errorText(tokenData, "Could not start bank link"));
          setLinked(false);
          return;
        }
        localStorage.setItem("link_token", tokenData.link_token);
        setLinkToken(tokenData.link_token);
        setLinked(false);
      } catch {
        if (!cancelled) {
          setError("Backend not reachable");
          setLinked(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [email]);

  async function signOut() {
    await fetch("/api/logout", { method: "POST" });
    setEmail(null);
    setLinked(null);
    setLinkToken(null);
    setTransactions([]);
    setCategories([]);
    setSavingIds(new Set());
    setEditing(null);
    setPage("home");
    setMonth(currentMonthKey());
    setError(null);
  }

  async function toggleApproved(transaction: Transaction) {
    if (!transaction.id || savingIds.has(transaction.id)) return;
    const nextApproved = !transaction.approved;
    setSavingIds((current) => new Set(current).add(transaction.id));
    setTransactions((current) =>
      current.map((row) =>
        row.id === transaction.id ? { ...row, approved: nextApproved } : row,
      ),
    );
    setError(null);
    try {
      const response = await fetch(
        `/api/transactions/${encodeURIComponent(transaction.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approved: nextApproved }),
        },
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setTransactions((current) =>
          current.map((row) =>
            row.id === transaction.id
              ? { ...row, approved: transaction.approved }
              : row,
          ),
        );
        setError(errorText(data, "Could not update transaction"));
      }
    } catch {
      setTransactions((current) =>
        current.map((row) =>
          row.id === transaction.id
            ? { ...row, approved: transaction.approved }
            : row,
        ),
      );
      setError("Backend not reachable");
    } finally {
      setSavingIds((current) => {
        const next = new Set(current);
        next.delete(transaction.id);
        return next;
      });
    }
  }

  async function deleteTransaction(transaction: Transaction) {
    if (!transaction.id || savingIds.has(transaction.id)) return;
    if (!window.confirm(`Delete “${transaction.name}”?`)) return;
    setSavingIds((current) => new Set(current).add(transaction.id));
    setError(null);
    try {
      const response = await fetch(
        `/api/transactions/${encodeURIComponent(transaction.id)}`,
        { method: "DELETE" },
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(errorText(data, "Could not delete transaction"));
        return;
      }
      setTransactions((current) =>
        current.filter((row) => row.id !== transaction.id),
      );
      setEditing((current) =>
        current?.id === transaction.id ? null : current,
      );
    } catch {
      setError("Backend not reachable");
    } finally {
      setSavingIds((current) => {
        const next = new Set(current);
        next.delete(transaction.id);
        return next;
      });
    }
  }

  async function saveCategory(transaction: Transaction, categoryId: string | null) {
    if (!transaction.id || savingIds.has(transaction.id)) return;
    const previous = {
      categoryId: transaction.categoryId,
      categoryName: transaction.categoryName,
    };
    const categoryName =
      categories.find((category) => category.id === categoryId)?.name ?? null;
    setSavingIds((current) => new Set(current).add(transaction.id));
    setTransactions((current) =>
      current.map((row) =>
        row.id === transaction.id ? { ...row, categoryId, categoryName } : row,
      ),
    );
    setError(null);
    try {
      const response = await fetch(
        `/api/transactions/${encodeURIComponent(transaction.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category_id: categoryId }),
        },
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setTransactions((current) =>
          current.map((row) =>
            row.id === transaction.id ? { ...row, ...previous } : row,
          ),
        );
        setError(errorText(data, "Could not update category"));
      }
    } catch {
      setTransactions((current) =>
        current.map((row) =>
          row.id === transaction.id ? { ...row, ...previous } : row,
        ),
      );
      setError("Backend not reachable");
    } finally {
      setSavingIds((current) => {
        const next = new Set(current);
        next.delete(transaction.id);
        return next;
      });
    }
  }

  useEffect(() => {
    if (!email) return;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch("/api/categories", { signal: controller.signal });
        const data = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) {
          setError(errorText(data, "Could not load categories"));
          return;
        }
        setCategories(parseCategories(data));
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError("Backend not reachable");
      }
    })();
    return () => controller.abort();
  }, [email]);

  useEffect(() => {
    if (linked === null) return;
    const controller = new AbortController();
    loadTransactions(controller.signal);
    return () => controller.abort();
  }, [linked, loadTransactions]);

  if (!authChecked) {
    return (
      <main>
        <p>Loading…</p>
      </main>
    );
  }

  if (!email) {
    return (
      <main>
        <Login onLoggedIn={setEmail} />
      </main>
    );
  }

  return (
    <main>
      <header className="top">
        <h1>Personal Copilot Finance Tracker</h1>
        <div className="account">
          <span>{email}</span>
          <button type="button" className="secondary" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>
      {error && <p className="error">{error}</p>}
      {linked === null && <p>Loading…</p>}
      {linked !== null && (
        <>
          {linked === false && linkToken && (
            <Connect
              token={linkToken}
              onLinked={() => setLinked(true)}
              onError={setError}
            />
          )}
          <nav className="pages" aria-label="Sections">
            <button
              type="button"
              className={page === "home" ? "active" : undefined}
              aria-current={page === "home" ? "page" : undefined}
              onClick={() => setPage("home")}
            >
              Home
            </button>
            <button
              type="button"
              className={page === "updates" ? "active" : undefined}
              aria-current={page === "updates" ? "page" : undefined}
              onClick={() => setPage("updates")}
            >
              New Transactions
              {waiting.length > 0 && <span className="badge">{waiting.length}</span>}
            </button>
            <button
              type="button"
              className={page === "ask" ? "active" : undefined}
              aria-current={page === "ask" ? "page" : undefined}
              onClick={() => setPage("ask")}
            >
              <svg
                className="ask-nav-icon"
                width="14"
                height="14"
                viewBox="0 0 16 16"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  fill="currentColor"
                  d="M8 1.2l.9 2.7c.2.5.6.9 1.1 1.1L12.8 6l-2.8.9c-.5.2-.9.6-1.1 1.1L8 10.8l-.9-2.8c-.2-.5-.6-.9-1.1-1.1L3.2 6l2.8-.9c.5-.2.9-.6 1.1-1.1L8 1.2zm5.2 7.1l.5 1.5c.1.3.3.5.6.6l1.5.5-1.5.5c-.3.1-.5.3-.6.6l-.5 1.5-.5-1.5c-.1-.3-.3-.5-.6-.6L10.6 11l1.5-.5c.3-.1.5-.3.6-.6l.5-1.5z"
                />
              </svg>
              Ask
            </button>
          </nav>
          {page !== "ask" && (
            <div className="toolbar">
              <ManualEntryForm
                categories={categories}
                onCreated={(transaction) =>
                  setTransactions((current) => [transaction, ...current])
                }
                onError={setError}
              />
              <button
                type="button"
                className="secondary"
                onClick={() => loadTransactions()}
                disabled={loading}
              >
                {loading ? "Loading…" : "Refresh"}
              </button>
            </div>
          )}
          {editing && (
            <EditTransactionForm
              key={editing.id}
              transaction={editing}
              onSaved={(updated) =>
                setTransactions((current) =>
                  current.map((row) =>
                    row.id === updated.id ? updated : row,
                  ),
                )
              }
              onClose={() => setEditing(null)}
              onError={setError}
            />
          )}
          {page === "home" && !loading && transactions.length === 0 && !error && (
            <p>No transactions.</p>
          )}
          {page === "home" && transactions.length > 0 && (
            <>
              <MonthlySummary
                rows={transactions}
                month={month}
                onMonthChange={setMonth}
              />
              <TransactionTable
                title="Income"
                rows={income}
                empty="No income yet."
                categories={categories}
                savingIds={savingIds}
                onToggle={toggleApproved}
                onCategory={saveCategory}
                onEdit={setEditing}
                onDelete={deleteTransaction}
              />
              <TransactionTable
                title="Expenses"
                rows={expenses}
                empty="No expenses yet."
                categories={categories}
                savingIds={savingIds}
                onToggle={toggleApproved}
                onCategory={saveCategory}
                onEdit={setEditing}
                onDelete={deleteTransaction}
              />
              <TransactionTable
                title="Transfers"
                rows={transfers}
                empty="No transfers yet."
                categories={categories}
                savingIds={savingIds}
                onToggle={toggleApproved}
                onCategory={saveCategory}
                onEdit={setEditing}
                onDelete={deleteTransaction}
              />
            </>
          )}
          {page === "updates" && (
            <UpdatesFeed
              rows={waiting}
              categories={categories}
              savingIds={savingIds}
              onToggle={toggleApproved}
              onCategory={saveCategory}
              onEdit={setEditing}
              onDelete={deleteTransaction}
            />
          )}
          {page === "ask" && <AskChat onUnauthorized={signOut} />}
        </>
      )}
    </main>
  );
}
