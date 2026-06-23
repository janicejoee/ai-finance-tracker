import React from "react";

const Header = () => {
  return (
    <header className="mb-8 flex items-center gap-4">
      <div
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--color-black-1000)] text-[1.8rem] font-bold text-white shadow-sm"
        aria-hidden
      >
        ¤
      </div>
      <div>
        <h1 className="text-[2.4rem] font-bold tracking-tight text-[var(--color-black-1000)]">
          Personal Finance Assistant
        </h1>
        <p className="text-[1.3rem] text-slate-500">
          Track spending, categorize transactions, and understand your cash flow
        </p>
      </div>
    </header>
  );
};

export default Header;
