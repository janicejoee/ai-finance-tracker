import React, { useContext } from "react";

import Link from "./Link";
import Context from "../Context";

const FEATURES = [
  {
    icon: "↻",
    title: "Auto-sync",
    description: "Transactions update when you refresh",
  },
  {
    icon: "◈",
    title: "Smart categories",
    description: "AI helps organize your spending",
  },
  {
    icon: "◎",
    title: "Insights",
    description: "See trends and cash flow at a glance",
  },
];

const ConnectBank = () => {
  const { linkToken, backend, linkTokenError, linkExitError } =
    useContext(Context);

  return (
    <div className="card w-full max-w-[52rem] overflow-hidden">
      <div className="border-b border-[var(--color-black-300)] bg-gradient-to-br from-[var(--color-accent-soft)] to-white px-8 py-10">
        <p className="mb-2 text-[1.2rem] font-semibold uppercase tracking-wider text-[var(--color-accent)]">
          Get started
        </p>
        <h2 className="text-[2.6rem] font-bold tracking-tight">
          Connect your bank
        </h2>
        <p className="mt-3 max-w-[36rem] text-[1.5rem] leading-relaxed text-slate-600">
          Securely link an account through Plaid to sync transactions and start
          tracking your spending.
        </p>
      </div>

      <div className="grid gap-4 px-8 py-6 sm:grid-cols-3">
        {FEATURES.map((feature) => (
          <div
            key={feature.title}
            className="rounded-lg bg-[var(--color-black-100)] px-4 py-3"
          >
            <span className="text-[1.8rem] text-[var(--color-accent)]" aria-hidden>
              {feature.icon}
            </span>
            <p className="mt-1 text-[1.4rem] font-semibold">{feature.title}</p>
            <p className="mt-0.5 text-[1.2rem] text-slate-500">
              {feature.description}
            </p>
          </div>
        ))}
      </div>

      <div className="border-t border-[var(--color-black-300)] px-8 py-6">
        {!backend ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-[1.4rem] text-amber-900">
            <p className="font-medium">Backend not reachable</p>
            <p className="mt-1 text-amber-800">
              Start the server and check your Plaid keys in `.env`.
            </p>
          </div>
        ) : linkToken == null ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-[1.4rem] text-amber-900">
            <p className="font-medium">Could not get a link token</p>
            <p className="mt-1 text-amber-800">{linkTokenError.error_message}</p>
          </div>
        ) : linkToken === "" ? (
          <button className="btn btn-primary" disabled>
            <span className="skeleton inline-block h-4 w-4 rounded-full" />
            Loading...
          </button>
        ) : (
          <Link />
        )}

        {linkExitError != null && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-[1.4rem] text-amber-900">
            <p>{linkExitError.error_message}</p>
          </div>
        )}

        <p className="mt-5 text-center text-[1.2rem] text-slate-400">
          Secured by Plaid · Your credentials are never stored
        </p>
      </div>
    </div>
  );
};

export default ConnectBank;
