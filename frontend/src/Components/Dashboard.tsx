import React, { useCallback, useEffect, useMemo, useState } from "react";

import { fetchInsight, hasCachedInsight } from "../apiSession";
import {
  monthlyCashFlow,
  spendingByCategoryByMonth,
  spendingByMonth,
} from "../chartData";
import {
  MonthNavButton,
  MonthlyCashFlowChart,
  SpendingCategoryChart,
} from "./Charts";
import { CategoryManager } from "./Categories/CategoryManager";
import { CategorySelect } from "./Categories/CategorySelect";
import {
  Transaction,
  TransactionMonthGroup,
  ExpenseCategory,
  formatDate,
  formatMoney,
  formatMonthLabel,
  formatTransactionAmount,
  displayCategoryName,
  getCurrentMonthKey,
  getDistinctTransactionMonths,
  groupTransactionsByMonth,
  isCategorizableExpense,
} from "../utils";

const TRANSACTIONS_PAGE_SIZE = 20;

const AVATAR_COLORS = [
  "#4f46e5",
  "#059669",
  "#b45309",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
];

interface AccountBalance {
  name: string;
  current: number | null;
  iso_currency_code?: string | null;
}

function merchantInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function merchantColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function MerchantAvatar({
  name,
  logoUrl,
}: {
  name: string;
  logoUrl?: string | null;
}) {
  const [failed, setFailed] = useState(false);
  const initials = merchantInitials(name);
  const avatarBg = merchantColor(name);

  if (logoUrl && !failed) {
    return (
      <img
        src={logoUrl}
        alt=""
        className="h-10 w-10 shrink-0 rounded-full bg-white object-cover ring-1 ring-[var(--color-black-300)]"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[1.2rem] font-semibold text-white"
      style={{ backgroundColor: avatarBg }}
      aria-hidden
    >
      {initials}
    </div>
  );
}

function StatCard({
  label,
  value,
  valueClassName = "",
  hint,
}: {
  label: string;
  value: string;
  valueClassName?: string;
  hint?: string;
}) {
  return (
    <div className="card p-5">
      <p className="text-[1.2rem] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className={`mt-1 text-[2.6rem] font-bold tracking-tight ${valueClassName}`}>
        {value}
      </p>
      {hint && <p className="mt-1 text-[1.2rem] text-slate-400">{hint}</p>}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card p-5">
            <div className="skeleton h-3 w-24" />
            <div className="skeleton mt-3 h-8 w-32" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card h-72 p-6">
          <div className="skeleton h-4 w-40" />
          <div className="skeleton mt-6 h-48 w-full" />
        </div>
        <div className="card h-72 p-6">
          <div className="skeleton h-4 w-40" />
          <div className="skeleton mt-6 h-48 w-full" />
        </div>
      </div>
    </div>
  );
}

function TransactionRow({
  tx,
  categories,
  onAssignCategory,
}: {
  tx: Transaction;
  categories: ExpenseCategory[];
  onAssignCategory: (
    plaidTransactionId: string,
    args: { categoryId?: string; categoryName?: string }
  ) => Promise<void>;
}) {
  const { text, kind } = formatTransactionAmount(
    tx.amount,
    tx.iso_currency_code,
    tx.entry_type
  );
  const categoryLabel = displayCategoryName(tx);
  const categorizable = isCategorizableExpense(tx);

  return (
    <li className="group flex items-center justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-[var(--color-black-100)] sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <MerchantAvatar name={tx.name} logoUrl={tx.logo_url} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[1.5rem] font-medium text-slate-900">
            {tx.name}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[1.2rem] text-slate-500">
            <span>{formatDate(tx.date)}</span>
            {categorizable ? (
              <CategorySelect
                categories={categories}
                value={tx.category_id}
                onAssign={(args) =>
                  onAssignCategory(tx.plaid_transaction_id!, args)
                }
              />
            ) : (
              categoryLabel && (
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[1.1rem] font-medium ${
                    kind === "income"
                      ? "bg-[var(--color-income-soft)] text-[var(--color-income)]"
                      : "bg-[var(--color-black-200)] text-slate-600"
                  }`}
                >
                  {categoryLabel}
                </span>
              )
            )}
          </div>
        </div>
      </div>
      <p
        className={`shrink-0 text-[1.5rem] font-semibold tabular-nums ${
          kind === "expense"
            ? "text-[var(--color-expense)]"
            : "text-[var(--color-income)]"
        }`}
      >
        {text}
      </p>
    </li>
  );
}

function MonthTransactionGroup({
  group,
  categories,
  onAssignCategory,
}: {
  group: TransactionMonthGroup;
  categories: ExpenseCategory[];
  onAssignCategory: (
    plaidTransactionId: string,
    args: { categoryId?: string; categoryName?: string }
  ) => Promise<void>;
}) {
  return (
    <div>
      <div className="border-b border-[var(--color-black-300)] bg-[var(--color-black-100)] px-5 py-2.5 sm:px-6">
        <h4 className="text-[1.3rem] font-semibold text-slate-700">
          {group.label}{" "}
          <span className="font-normal text-slate-400">
            ({group.transactions.length})
          </span>
        </h4>
      </div>
      <ul className="divide-y divide-[var(--color-black-300)]">
        {group.transactions.map((tx) => (
          <TransactionRow
            key={tx.plaid_transaction_id || `${tx.date}-${tx.name}`}
            tx={tx}
            categories={categories}
            onAssignCategory={onAssignCategory}
          />
        ))}
      </ul>
    </div>
  );
}

function TransactionMonthNav({
  monthOptions,
  selectedMonth,
  onMonthChange,
}: {
  monthOptions: { month: string; label: string }[];
  selectedMonth: string;
  onMonthChange: (month: string) => void;
}) {
  if (monthOptions.length === 0) {
    return null;
  }

  const canGoOlder = monthOptions.some((m) => m.month < selectedMonth);
  const canGoNewer = monthOptions.some((m) => m.month > selectedMonth);

  const goOlder = () => {
    const older = monthOptions
      .filter((m) => m.month < selectedMonth)
      .sort((a, b) => b.month.localeCompare(a.month))[0];
    if (older) {
      onMonthChange(older.month);
    }
  };

  const goNewer = () => {
    const newer = monthOptions
      .filter((m) => m.month > selectedMonth)
      .sort((a, b) => a.month.localeCompare(b.month))[0];
    if (newer) {
      onMonthChange(newer.month);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <MonthNavButton
        direction="prev"
        disabled={!canGoOlder}
        onClick={goOlder}
      />
      <select
        value={selectedMonth}
        onChange={(e) => onMonthChange(e.target.value)}
        className="min-w-[14rem] rounded-lg border border-[var(--color-black-300)] bg-white px-3 py-1.5 text-[1.3rem] font-medium text-slate-700 shadow-sm transition-colors hover:bg-[var(--color-black-100)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/20"
        aria-label="Jump to month"
      >
        {monthOptions.map((m) => (
          <option key={m.month} value={m.month}>
            {m.label}
          </option>
        ))}
      </select>
      <MonthNavButton
        direction="next"
        disabled={!canGoNewer}
        onClick={goNewer}
      />
    </div>
  );
}

function TransactionPagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-black-300)] bg-[var(--color-black-100)] px-5 py-3 sm:px-6">
      <p className="text-[1.3rem] text-slate-500">
        Page {page} of {totalPages}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="btn btn-secondary px-3 py-2 text-[1.3rem]"
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="btn btn-secondary px-3 py-2 text-[1.3rem]"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function hasTransactionChanges(txData: {
  added?: unknown[];
  modified?: unknown[];
  removed?: unknown[];
  categorized?: number;
}) {
  return (
    (txData.added?.length ?? 0) > 0 ||
    (txData.modified?.length ?? 0) > 0 ||
    (txData.removed?.length ?? 0) > 0 ||
    (txData.categorized ?? 0) > 0
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

const Dashboard = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [balances, setBalances] = useState<AccountBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [insight, setInsight] = useState<string | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [spendingMonthIndex, setSpendingMonthIndex] = useState(0);
  const [selectedTransactionMonth, setSelectedTransactionMonth] = useState(
    getCurrentMonthKey
  );
  const [transactionsPage, setTransactionsPage] = useState(1);

  const loadCategories = useCallback(async (signal?: AbortSignal) => {
    setCategoriesLoading(true);
    try {
      const response = await fetch("/api/categories", { signal });
      const data = await response.json();
      if (signal?.aborted) {
        return;
      }
      if (!response.ok) {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "Failed to load categories"
        );
      }
      setCategories(data.categories || []);
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      console.error(error);
    } finally {
      if (!signal?.aborted) {
        setCategoriesLoading(false);
      }
    }
  }, []);

  const loadInsights = useCallback(async (force = false, signal?: AbortSignal) => {
    setInsightsLoading(true);
    try {
      const text = await fetchInsight(force, signal);
      if (signal?.aborted) {
        return;
      }
      setInsight(text);
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      setInsight(null);
    } finally {
      if (!signal?.aborted) {
        setInsightsLoading(false);
      }
    }
  }, []);

  const loadData = useCallback(async (forceInsights = false, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      const [txRes, balRes] = await Promise.all([
        fetch("/api/transactions", { signal }),
        fetch("/api/balance", { signal }),
      ]);
      await loadCategories(signal);

      const txData = await txRes.json();
      const balData = await balRes.json();

      if (signal?.aborted) {
        return;
      }

      if (!txRes.ok) {
        throw new Error(
          typeof txData.error === "string"
            ? txData.error
            : txData.error?.error_message || "Failed to load transactions"
        );
      }

      setTransactions(txData.transactions || []);

      if (typeof txData.categorized === "number" && txData.categorized > 0) {
        setNotice(`Auto-categorized ${txData.categorized} transaction(s).`);
      }

      if (balRes.ok && balData.accounts) {
        setBalances(
          balData.accounts.map((a: any) => ({
            name: a.name,
            current: a.balances?.current ?? a.balances?.available,
            iso_currency_code: a.balances?.iso_currency_code,
          }))
        );
      }

      if (
        forceInsights ||
        hasTransactionChanges(txData) ||
        !hasCachedInsight()
      ) {
        await loadInsights(forceInsights, signal);
      }
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      setError(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [loadInsights, loadCategories]);

  useEffect(() => {
    const controller = new AbortController();
    loadData(false, controller.signal);
    return () => controller.abort();
  }, [loadData]);

  const parseApiError = async (response: Response, fallback: string) => {
    const data = await response.json();
    throw new Error(
      typeof data.error === "string" ? data.error : fallback
    );
  };

  const createCategory = async (name: string) => {
    const response = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) {
      await parseApiError(response, "Failed to create category");
    }
    const data = await response.json();
    const created = data.category as ExpenseCategory;
    setCategories((prev) =>
      [...prev, created].sort(
        (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
      )
    );
  };

  const updateCategory = async (id: string, name: string) => {
    const response = await fetch(`/api/categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) {
      await parseApiError(response, "Failed to update category");
    }
    const data = await response.json();
    const updated = data.category as ExpenseCategory;
    setCategories((prev) =>
      prev.map((category) => (category.id === id ? updated : category))
    );
    setTransactions((prev) =>
      prev.map((tx) =>
        tx.category_id === id ? { ...tx, category_name: updated.name } : tx
      )
    );
  };

  const deleteCategory = async (id: string) => {
    const response = await fetch(`/api/categories/${id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      await parseApiError(response, "Failed to delete category");
    }
    setCategories((prev) => prev.filter((category) => category.id !== id));
  };

  const assignTransactionCategory = async (
    plaidTransactionId: string,
    args: { categoryId?: string; categoryName?: string }
  ) => {
    const response = await fetch(
      `/api/transactions/${encodeURIComponent(plaidTransactionId)}/category`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category_id: args.categoryId,
          category_name: args.categoryName,
        }),
      }
    );
    if (!response.ok) {
      await parseApiError(response, "Failed to assign category");
    }
    const data = await response.json();
    const updated = data.transaction as Transaction;

    setTransactions((prev) =>
      prev.map((tx) =>
        tx.plaid_transaction_id === plaidTransactionId
          ? {
              ...tx,
              category_id: updated.category_id,
              category_name: updated.category_name,
              entry_type: updated.entry_type ?? tx.entry_type,
            }
          : tx
      )
    );

    if (args.categoryName) {
      await loadCategories();
    }
  };

  const categorize = async () => {
    setActionLoading("categorize");
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/categorize", { method: "POST" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : data.error?.error_message || "Categorization failed"
        );
      }

      setNotice(
        data.message || `Categorized ${data.categorized} transaction(s).`
      );
      const categorizedCount =
        typeof data.categorized === "number" ? data.categorized : 0;
      await loadData(categorizedCount > 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Categorization failed");
    } finally {
      setActionLoading(null);
    }
  };

  const totalBalance = balances.reduce((sum, a) => sum + (a.current || 0), 0);
  const currency = balances[0]?.iso_currency_code || "USD";

  const spendingByMonthData = useMemo(
    () => spendingByMonth(transactions),
    [transactions]
  );
  const categoryByMonth = useMemo(
    () => spendingByCategoryByMonth(transactions),
    [transactions]
  );
  const monthlyData = useMemo(
    () => monthlyCashFlow(transactions),
    [transactions]
  );

  useEffect(() => {
    setSpendingMonthIndex(0);
  }, [spendingByMonthData]);

  const currentSpendingMonth = spendingByMonthData[spendingMonthIndex];
  const currentCategoryMonth = currentSpendingMonth
    ? categoryByMonth.find((m) => m.month === currentSpendingMonth.month)
    : undefined;
  const canGoNewerMonth = spendingMonthIndex > 0;
  const canGoOlderMonth = spendingMonthIndex < spendingByMonthData.length - 1;

  const hasCharts =
    spendingByMonthData.length > 0 ||
    monthlyData.some((m) => m.expenses > 0 || m.income > 0);

  const sortedTransactions = useMemo(
    () => [...transactions].sort((a, b) => b.date.localeCompare(a.date)),
    [transactions]
  );

  const transactionMonths = useMemo(
    () => getDistinctTransactionMonths(sortedTransactions),
    [sortedTransactions]
  );

  const transactionMonthOptions = useMemo(() => {
    if (transactionMonths.some((m) => m.month === selectedTransactionMonth)) {
      return transactionMonths;
    }
    return [
      {
        month: selectedTransactionMonth,
        label: formatMonthLabel(selectedTransactionMonth),
      },
      ...transactionMonths,
    ].sort((a, b) => b.month.localeCompare(a.month));
  }, [transactionMonths, selectedTransactionMonth]);

  const monthTransactions = useMemo(
    () =>
      sortedTransactions.filter(
        (tx) => tx.date.slice(0, 7) === selectedTransactionMonth
      ),
    [sortedTransactions, selectedTransactionMonth]
  );

  const totalTransactionPages = Math.max(
    1,
    Math.ceil(monthTransactions.length / TRANSACTIONS_PAGE_SIZE)
  );

  const paginatedMonthGroups = useMemo(() => {
    const start = (transactionsPage - 1) * TRANSACTIONS_PAGE_SIZE;
    const pageSlice = monthTransactions.slice(
      start,
      start + TRANSACTIONS_PAGE_SIZE
    );
    return groupTransactionsByMonth(pageSlice);
  }, [monthTransactions, transactionsPage]);

  const selectTransactionMonth = useCallback((month: string) => {
    setSelectedTransactionMonth(month);
    setTransactionsPage(1);
  }, []);

  useEffect(() => {
    setTransactionsPage((page) => Math.min(page, totalTransactionPages));
  }, [totalTransactionPages]);

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-[2rem] font-bold tracking-tight">Overview</h2>
          <p className="mt-0.5 text-[1.3rem] text-slate-500">
            {transactions.length} transaction{transactions.length === 1 ? "" : "s"}
            {balances.length > 0 && ` · ${balances.length} account${balances.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => loadData()}
            disabled={loading || actionLoading !== null}
            className="btn btn-secondary"
          >
            {loading ? "Syncing..." : "Refresh"}
          </button>
          <button
            type="button"
            onClick={categorize}
            disabled={loading || actionLoading !== null}
            className="btn btn-primary"
          >
            {actionLoading === "categorize" ? "Categorizing..." : "Categorize remaining"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-[var(--color-expense-soft)] px-4 py-3 text-[1.4rem] text-red-800">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-[var(--color-income-soft)] px-4 py-3 text-[1.4rem] text-emerald-800">
          {notice}
        </div>
      )}

      {(insightsLoading || insight) && (
        <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-[var(--color-accent-soft)] to-white p-5 shadow-sm">
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-0.5 text-[1.1rem] font-semibold text-[var(--color-accent)] shadow-sm">
              ✦ AI Insight
            </span>
          </div>
          {insightsLoading ? (
            <div className="space-y-2">
              <div className="skeleton h-3 w-full" />
              <div className="skeleton h-3 w-4/5" />
              <div className="skeleton h-3 w-3/5" />
            </div>
          ) : (
            <p className="text-[1.4rem] leading-relaxed text-slate-700">{insight}</p>
          )}
        </div>
      )}

      {loading && transactions.length === 0 ? (
        <DashboardSkeleton />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard
              label="Total balance"
              value={formatMoney(totalBalance, currency)}
            />
            <StatCard
              label="Spending"
              value={formatMoney(currentSpendingMonth?.total ?? 0, currency)}
              valueClassName="text-[var(--color-expense)]"
              hint={currentSpendingMonth?.label}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {hasCharts ? (
              <MonthlyCashFlowChart monthly={monthlyData} currency={currency} />
            ) : (
              <div className="card flex items-center justify-center p-8">
                <p className="text-center text-[1.4rem] text-slate-500">
                  Charts will appear once you have synced transactions.
                </p>
              </div>
            )}

            <div className="space-y-4">
              {spendingByMonthData.length > 0 && currentSpendingMonth && (
                <div className="card p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[1.2rem] font-medium uppercase tracking-wide text-slate-500">
                      Month navigator
                    </p>
                    <div className="flex items-center gap-2">
                      <MonthNavButton
                        direction="prev"
                        disabled={!canGoOlderMonth}
                        onClick={() => setSpendingMonthIndex((index) => index + 1)}
                      />
                      <p className="min-w-[10rem] text-center text-[1.3rem] font-semibold text-slate-700">
                        {currentSpendingMonth.label}
                      </p>
                      <MonthNavButton
                        direction="next"
                        disabled={!canGoNewerMonth}
                        onClick={() => setSpendingMonthIndex((index) => index - 1)}
                      />
                    </div>
                  </div>
                </div>
              )}

              {hasCharts && (
                <SpendingCategoryChart
                  categoryMonth={currentCategoryMonth}
                  currency={currency}
                />
              )}
            </div>
          </div>
        </>
      )}

      <CategoryManager
        categories={categories}
        loading={categoriesLoading}
        onCreate={createCategory}
        onUpdate={updateCategory}
        onDelete={deleteCategory}
      />

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-black-300)] px-5 py-4 sm:px-6">
          <h3 className="text-[1.6rem] font-semibold">Transactions</h3>
          {transactionMonthOptions.length > 0 && (
            <TransactionMonthNav
              monthOptions={transactionMonthOptions}
              selectedMonth={selectedTransactionMonth}
              onMonthChange={selectTransactionMonth}
            />
          )}
        </div>

        {loading && transactions.length === 0 ? null : transactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-black-200)] text-[2rem] text-slate-400">
              ∅
            </div>
            <p className="text-[1.5rem] font-medium text-slate-700">No transactions yet</p>
            <p className="mt-1 max-w-[28rem] text-[1.3rem] text-slate-500">
              Try refreshing to sync from your bank.
            </p>
          </div>
        ) : monthTransactions.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-[1.4rem] text-slate-500">
              No transactions in {formatMonthLabel(selectedTransactionMonth)}.
            </p>
          </div>
        ) : (
          <>
            <div className="divide-y divide-[var(--color-black-300)]">
              {paginatedMonthGroups.map((group) => (
                <MonthTransactionGroup
                  key={group.month}
                  group={group}
                  categories={categories}
                  onAssignCategory={assignTransactionCategory}
                />
              ))}
            </div>
            <TransactionPagination
              page={transactionsPage}
              totalPages={totalTransactionPages}
              onPageChange={setTransactionsPage}
            />
          </>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
