import { FormEvent, useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";

type Transaction = {
  id: string;
  name: string;
  amount: number;
  date: string;
  approved: boolean;
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

function parseTransactions(data: unknown): Transaction[] {
  if (!Array.isArray(data)) return [];
  return data.map((tx) => {
    const row = tx as Record<string, unknown>;
    return {
      id: String(row.plaid_transaction_id ?? ""),
      name: String(row.name || row.merchant_name || "Unknown"),
      amount: Number(row.amount),
      date: String(row.date ?? "").slice(0, 10),
      approved: row.approved === true,
    };
  });
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
    if (tx.amount > 0) expenses += tx.amount;
    else if (tx.amount < 0) income += Math.abs(tx.amount);
  }
  return { expenses, income };
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
    </section>
  );
}

function UpdatesFeed({
  rows,
  savingIds,
  onToggle,
}: {
  rows: Transaction[];
  savingIds: ReadonlySet<string>;
  onToggle: (transaction: Transaction) => void;
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
              </div>
              <span className={tx.amount > 0 ? "amount out" : "amount in"}>
                {formatAmount(tx.amount)}
              </span>
              <input
                type="checkbox"
                checked={tx.approved}
                disabled={!tx.id || savingIds.has(tx.id)}
                aria-label={`Include ${tx.name}`}
                onChange={() => onToggle(tx)}
              />
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
  savingIds,
  onToggle,
}: {
  title: string;
  rows: Transaction[];
  empty: string;
  savingIds: ReadonlySet<string>;
  onToggle: (transaction: Transaction) => void;
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
                </td>
                <td className={tx.amount > 0 ? "amount out" : "amount in"}>
                  {formatAmount(tx.amount)}
                </td>
                <td className="check">
                  <input
                    type="checkbox"
                    checked={tx.approved}
                    disabled={!tx.id || savingIds.has(tx.id)}
                    aria-label={`${tx.approved ? "Remove" : "Include"} ${tx.name}`}
                    onChange={() => onToggle(tx)}
                  />
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
      const response = await fetch("/api/set_access_token", {
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
    <button type="button" onClick={() => open()} disabled={!ready}>
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
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<"home" | "updates">("home");
  const [month, setMonth] = useState(currentMonthKey);
  const waiting = transactions.filter((tx) => !tx.approved);
  const approved = transactions.filter((tx) => tx.approved && tx.date.slice(0, 7) === month);
  const income = approved.filter((tx) => tx.amount < 0);
  const expenses = approved.filter((tx) => tx.amount > 0);

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
        const response = await fetch("/api/me");
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
        const statusRes = await fetch("/api/link_status");
        const status = await statusRes.json();
        if (cancelled) return;
        if (statusRes.ok && status.linked) {
          setLinked(true);
          return;
        }

        const tokenRes = await fetch("/api/create_link_token", { method: "POST" });
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
    setSavingIds(new Set());
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

  useEffect(() => {
    if (!linked) return;
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
      {linked === false && linkToken && (
        <Connect
          token={linkToken}
          onLinked={() => setLinked(true)}
          onError={setError}
        />
      )}
      {linked && (
        <>
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
          </nav>
          <button
            type="button"
            className="secondary"
            onClick={() => loadTransactions()}
            disabled={loading}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
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
                savingIds={savingIds}
                onToggle={toggleApproved}
              />
              <TransactionTable
                title="Expenses"
                rows={expenses}
                empty="No expenses yet."
                savingIds={savingIds}
                onToggle={toggleApproved}
              />
            </>
          )}
          {page === "updates" && (
            <UpdatesFeed
              rows={waiting}
              savingIds={savingIds}
              onToggle={toggleApproved}
            />
          )}
        </>
      )}
    </main>
  );
}
