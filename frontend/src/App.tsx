import { useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";

type Transaction = {
  id: string;
  name: string;
  amount: number;
  date: string;
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
    };
  });
}

function formatAmount(amount: number) {
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Math.abs(amount));
  return amount > 0 ? `−${formatted}` : `+${formatted}`;
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
  const [linked, setLinked] = useState<boolean | null>(null);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  }, []);

  useEffect(() => {
    if (!linked) return;
    const controller = new AbortController();
    loadTransactions(controller.signal);
    return () => controller.abort();
  }, [linked, loadTransactions]);

  return (
    <main>
      <h1>Transactions</h1>
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
          <button
            type="button"
            onClick={() => loadTransactions()}
            disabled={loading}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
          {!loading && transactions.length === 0 && !error && (
            <p>No transactions.</p>
          )}
          <ul>
            {transactions.map((tx) => (
              <li key={tx.id || `${tx.date}-${tx.name}`}>
                <div>
                  <p className="name">{tx.name}</p>
                  <span className="date">{tx.date}</span>
                </div>
                <span className="amount">{formatAmount(tx.amount)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
