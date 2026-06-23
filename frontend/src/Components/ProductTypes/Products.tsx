import React, { useState } from "react";

import Endpoint from "../Endpoint";
import ProductTypesContainer from "./ProductTypesContainer";
import {
  transactionsCategories,
  balanceCategories,
  accountsCategories,
  transformTransactionsData,
  transformBalanceData,
  transformAccountsData,
} from "../../dataUtilities";

import styles from "../Endpoint/index.module.css";

const Products = () => {
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);

  const categorize = async () => {
    setIsSummarizing(true);
    setSummaryError(null);
    setSummary(null);

    const response = await fetch("/api/categorize", { method: "POST" });
    const data = await response.json();

    if (!response.ok) {
      setSummaryError(
        typeof data.error === "string"
          ? data.error
          : data.error?.error_message || "Failed to categorize transactions."
      );
      setIsSummarizing(false);
      return;
    }

    setSummary(
      data.message ||
        `Categorized ${data.categorized} transaction(s).`
    );
    setIsSummarizing(false);
  };

  return (
    <ProductTypesContainer productType="Expenses">
      <Endpoint
        endpoint="transactions"
        name="Transactions"
        method="GET"
        categories={transactionsCategories}
        schema="/transactions/sync/"
        description="Sync and retrieve transactions from your linked accounts."
        transformData={transformTransactionsData}
      />
      <Endpoint
        endpoint="balance"
        name="Balance"
        method="GET"
        categories={balanceCategories}
        schema="/accounts/balance/get"
        description="Check real-time balances for your linked accounts."
        transformData={transformBalanceData}
      />
      <div className={styles.endpointContainer}>
        <div className={styles.post}>
          <span className="inline-block self-start rounded-sm border border-[var(--color-black-300)] bg-[var(--color-black-200)] px-[0.8rem] py-[0.2rem] font-mono text-[1.4rem] font-semibold leading-normal text-[var(--color-black-1000)]">
            POST
          </span>
        </div>
        <div className={styles.endpointContents}>
          <div className={styles.endpointHeader}>
            <span className={styles.endpointName}>Categorize</span>
            <span className={styles.schema}>/categorize</span>
          </div>
          <div className={styles.endpointDescription}>
            Sync and categorize uncategorized transactions with AI.
          </div>
        </div>
        <div className={styles.buttonsContainer}>
          <button
            className={`${styles.sendRequest} inline-flex items-center justify-center rounded border border-[var(--color-black-1000)] bg-white px-[1.6rem] py-[0.8rem] text-[1.4rem] font-semibold text-[var(--color-black-1000)] hover:bg-[var(--color-black-100)]`}
            onClick={categorize}
          >
            {isSummarizing ? "Loading..." : "Send request"}
          </button>
        </div>
      </div>
      {summary != null && (
        <div className="rounded border border-[var(--color-black-300)] bg-[var(--color-black-100)] p-[1.6rem]">
          {summary}
        </div>
      )}
      {summaryError != null && (
        <div className="rounded border border-[var(--color-gold)] bg-[var(--color-yellow-200)] p-[1.6rem]">
          {summaryError}
        </div>
      )}
    </ProductTypesContainer>
  );
};

Products.displayName = "Products";

export default Products;
