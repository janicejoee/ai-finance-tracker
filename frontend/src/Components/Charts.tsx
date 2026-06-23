import React from "react";
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  MonthlyCategorySpending,
  MonthlyFlow,
  chartColor,
} from "../chartData";
import { formatMoney } from "../utils";

const tooltipStyle = {
  fontSize: "1.3rem",
  borderRadius: "8px",
  border: "1px solid var(--color-black-300)",
};

function MoneyTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color?: string }[];
  label?: string;
  currency: string;
}) {
  if (!active || !payload?.length) {
    return null;
  }

  return (
    <div
      className="rounded-lg border border-[var(--color-black-300)] bg-white px-3 py-2 shadow-sm"
      style={tooltipStyle}
    >
      {label && <p className="mb-1 font-medium text-[#333]">{label}</p>}
      {payload.map((entry) => (
        <p key={entry.name} className="text-[#555]">
          <span style={{ color: entry.color }}>{entry.name}: </span>
          {formatMoney(entry.value, currency)}
        </p>
      ))}
    </div>
  );
}

export function MonthNavButton({
  direction,
  disabled,
  onClick,
}: {
  direction: "prev" | "next";
  disabled: boolean;
  onClick: () => void;
}) {
  const label = direction === "prev" ? "Older month" : "Newer month";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-black-300)] bg-white text-[1.6rem] leading-none text-slate-600 shadow-sm transition-colors hover:bg-[var(--color-black-100)] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {direction === "prev" ? "‹" : "›"}
    </button>
  );
}

export function MonthlyCashFlowChart({
  monthly,
  currency,
}: {
  monthly: MonthlyFlow[];
  currency: string;
}) {
  const hasMonthly = monthly.some((m) => m.expenses > 0 || m.income > 0);

  return (
    <div className="card p-6">
      <h3 className="mb-4 text-[1.5rem] font-semibold text-slate-800">Monthly cash flow</h3>
      {hasMonthly ? (
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <XAxis
              dataKey="label"
              tick={{ fontSize: 12 }}
              interval={0}
              angle={-20}
              textAnchor="end"
              height={50}
            />
            <YAxis
              tick={{ fontSize: 12 }}
              tickFormatter={(v) =>
                v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`
              }
            />
            <Tooltip content={<MoneyTooltip currency={currency} />} />
            <Legend wrapperStyle={{ fontSize: "1.2rem" }} />
            <Bar dataKey="expenses" name="Expenses" fill="var(--color-expense)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="income" name="Income" fill="var(--color-income)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <p className="text-[1.4rem] text-[#666]">
          No monthly data in the last 6 months yet.
        </p>
      )}
    </div>
  );
}

export function SpendingCategoryChart({
  categoryMonth,
  currency,
}: {
  categoryMonth?: MonthlyCategorySpending;
  currency: string;
}) {
  return (
    <div className="card p-6">
      <h3 className="mb-4 text-[1.5rem] font-semibold text-slate-800">Spending by category</h3>
      {categoryMonth && categoryMonth.categories.length > 0 ? (
        <ResponsiveContainer width="100%" height={280}>
          <PieChart key={categoryMonth.month}>
            <Pie
              data={categoryMonth.categories}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={95}
              paddingAngle={2}
            >
              {categoryMonth.categories.map((_, index) => (
                <Cell key={index} fill={chartColor(index)} />
              ))}
            </Pie>
            <Tooltip content={<MoneyTooltip currency={currency} />} />
            <Legend
              wrapperStyle={{ fontSize: "1.2rem" }}
              formatter={(value) =>
                value.length > 18 ? `${value.slice(0, 16)}…` : value
              }
            />
          </PieChart>
        </ResponsiveContainer>
      ) : (
        <p className="text-[1.4rem] text-[#666]">
          No categorized expenses this month. Sync transactions to categorize spending automatically.
        </p>
      )}
    </div>
  );
}
