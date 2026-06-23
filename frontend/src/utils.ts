export type EntryType = "income" | "expense" | "transfer";

export interface ExpenseCategory {
  id: string;
  name: string;
  sort_order?: number;
}

export interface Transaction {
  plaid_transaction_id?: string;
  name: string;
  amount: number;
  date: string;
  iso_currency_code?: string | null;
  category_id?: string | null;
  /** Joined from expense_categories — not stored on transactions */
  category_name?: string | null;
  entry_type?: EntryType | null;
  /** Plaid merchant logo or personal_finance_category_icon_url */
  logo_url?: string | null;
}

export function resolveEntryType(
  amount: number,
  entryType?: EntryType | null
): EntryType {
  if (entryType === "income" || entryType === "expense" || entryType === "transfer") {
    return entryType;
  }
  return amount > 0 ? "expense" : "income";
}

export function displayCategoryName(
  tx: Pick<Transaction, "amount" | "entry_type" | "category_name">
): string | null {
  if (resolveEntryType(tx.amount, tx.entry_type) === "income") {
    return "Income";
  }
  if (tx.entry_type === "transfer") {
    return "Transfer";
  }
  return tx.category_name?.trim() || null;
}

export function isCategorizableExpense(
  tx: Pick<Transaction, "amount" | "entry_type">
): boolean {
  if (tx.entry_type === "transfer") {
    return false;
  }
  return resolveEntryType(tx.amount, tx.entry_type) === "expense";
}

export function formatMoney(
  amount: number,
  currency: string | null | undefined = "USD"
) {
  const code = currency || "USD";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: code,
  }).format(Math.abs(amount));
}

export function formatTransactionAmount(
  amount: number,
  currency?: string | null,
  entryType?: EntryType | null
) {
  const kind = resolveEntryType(amount, entryType);
  const formatted = formatMoney(amount, currency);
  if (kind === "expense") {
    return { text: `-${formatted}`, kind };
  }
  return { text: `+${formatted}`, kind };
}

export function formatDate(date: string) {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export interface TransactionMonthGroup {
  month: string;
  label: string;
  transactions: Transaction[];
}

export function getCurrentMonthKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function getDistinctTransactionMonths(
  transactions: Transaction[]
): { month: string; label: string }[] {
  const months: { month: string; label: string }[] = [];
  let lastMonth = "";

  for (const tx of transactions) {
    const month = tx.date.slice(0, 7);
    if (month !== lastMonth) {
      months.push({ month, label: formatMonthLabel(month) });
      lastMonth = month;
    }
  }

  return months;
}

export function groupTransactionsByMonth(
  transactions: Transaction[]
): TransactionMonthGroup[] {
  const groups: TransactionMonthGroup[] = [];

  for (const tx of transactions) {
    const month = tx.date.slice(0, 7);
    const last = groups[groups.length - 1];

    if (last?.month === month) {
      last.transactions.push(tx);
    } else {
      groups.push({
        month,
        label: formatMonthLabel(month),
        transactions: [tx],
      });
    }
  }

  return groups;
}
