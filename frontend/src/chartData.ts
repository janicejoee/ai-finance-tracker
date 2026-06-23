import { Transaction, resolveEntryType, displayCategoryName } from "./utils";

export interface CategorySlice {
  name: string;
  value: number;
}

export interface MonthlyFlow {
  month: string;
  label: string;
  expenses: number;
  income: number;
}

export interface MonthlyCategorySpending {
  month: string;
  label: string;
  categories: CategorySlice[];
  total: number;
}

export interface MonthlySpending {
  month: string;
  label: string;
  total: number;
}

const CHART_COLORS = [
  "#111111",
  "#ba7d17",
  "#067647",
  "#b42318",
  "#5b6ee1",
  "#9b59b6",
  "#e67e22",
  "#16a085",
  "#c0392b",
  "#34495e",
];

export function chartColor(index: number) {
  return CHART_COLORS[index % CHART_COLORS.length];
}

function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function spendingByMonth(transactions: Transaction[]): MonthlySpending[] {
  const monthMap = new Map<string, number>();

  for (const tx of transactions) {
    if (resolveEntryType(tx.amount, tx.entry_type) !== "expense") {
      continue;
    }

    const month = tx.date.slice(0, 7);
    monthMap.set(month, (monthMap.get(month) || 0) + Math.abs(tx.amount));
  }

  return [...monthMap.keys()]
    .sort((a, b) => b.localeCompare(a))
    .map((month) => ({
      month,
      label: monthLabel(month),
      total: monthMap.get(month)!,
    }));
}

export function spendingByCategoryByMonth(
  transactions: Transaction[]
): MonthlyCategorySpending[] {
  const monthMap = new Map<string, Map<string, number>>();

  for (const tx of transactions) {
    if (resolveEntryType(tx.amount, tx.entry_type) !== "expense") {
      continue;
    }

    const month = tx.date.slice(0, 7);
    const category = displayCategoryName(tx) || "Uncategorized";
    const categories = monthMap.get(month) ?? new Map<string, number>();
    categories.set(category, (categories.get(category) || 0) + Math.abs(tx.amount));
    monthMap.set(month, categories);
  }

  return [...monthMap.keys()]
    .sort((a, b) => b.localeCompare(a))
    .map((month) => {
      const categoryTotals = monthMap.get(month)!;
      const categories = [...categoryTotals.entries()]
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value);
      const total = categories.reduce((sum, category) => sum + category.value, 0);

      return {
        month,
        label: monthLabel(month),
        categories,
        total,
      };
    });
}

export function monthlyCashFlow(
  transactions: Transaction[],
  months = 6
): MonthlyFlow[] {
  const now = new Date();
  const buckets: MonthlyFlow[] = [];

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    });
    buckets.push({ month: key, label, expenses: 0, income: 0 });
  }

  const bucketMap = new Map(buckets.map((b) => [b.month, b]));

  for (const tx of transactions) {
    const month = tx.date.slice(0, 7);
    const bucket = bucketMap.get(month);
    if (!bucket) {
      continue;
    }

    const kind = resolveEntryType(tx.amount, tx.entry_type);
    const amount = Math.abs(tx.amount);
    if (kind === "transfer") {
      continue;
    }
    if (kind === "expense") {
      bucket.expenses += amount;
    } else {
      bucket.income += amount;
    }
  }

  return buckets;
}
