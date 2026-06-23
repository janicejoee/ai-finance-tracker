import React, { useState } from "react";

import Table from "../Table";
import Error from "../Error";
import { DataItem, Categories, ErrorDataItem, Data } from "../../dataUtilities";

import styles from "./index.module.css";

interface Props {
  endpoint: string;
  name?: string;
  method?: "GET" | "POST";
  categories: Array<Categories>;
  schema: string;
  description: string;
  transformData: (arg: any) => Array<DataItem>;
}

const toErrorDataItem = (
  data: Record<string, unknown>,
  status: number
): ErrorDataItem => {
  if (typeof data.error === "string") {
    return {
      error_type: "API_ERROR",
      error_code: "API_ERROR",
      error_message: data.error,
      display_message: null,
      status_code: status,
    };
  }

  const error = data.error as ErrorDataItem | undefined;
  if (error != null) {
    return {
      ...error,
      status_code: error.status_code ?? status,
    };
  }

  return {
    error_type: "API_ERROR",
    error_code: "UNKNOWN",
    error_message: `Request failed with status ${status}`,
    display_message: null,
    status_code: status,
  };
};

const Endpoint = (props: Props) => {
  const [showTable, setShowTable] = useState(false);
  const [transformedData, setTransformedData] = useState<Data>([]);
  const [error, setError] = useState<ErrorDataItem | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const method = props.method || "GET";

  const getData = async () => {
    setIsLoading(true);
    setError(null);
    setShowTable(false);

    const response = await fetch(`/api/${props.endpoint}`, { method });
    const data = await response.json();

    if (!response.ok || data.error != null) {
      setError(toErrorDataItem(data, response.status));
      setIsLoading(false);
      return;
    }

    setTransformedData(props.transformData(data));
    setShowTable(true);
    setIsLoading(false);
  };

  return (
    <>
      <div className={styles.endpointContainer}>
        <div className={styles.post}>
          <span className="inline-block self-start rounded-sm border border-[var(--color-black-300)] bg-[var(--color-black-200)] px-[0.8rem] py-[0.2rem] font-mono text-[1.4rem] font-semibold leading-normal text-[var(--color-black-1000)]">
            {method}
          </span>
        </div>
        <div className={styles.endpointContents}>
          <div className={styles.endpointHeader}>
            {props.name != null && (
              <span className={styles.endpointName}>{props.name}</span>
            )}
            <span className={styles.schema}>{props.schema}</span>
          </div>
          <div className={styles.endpointDescription}>{props.description}</div>
        </div>
        <div className={styles.buttonsContainer}>
          <button
            className={`${styles.sendRequest} inline-flex items-center justify-center rounded border border-[var(--color-black-1000)] bg-white px-[1.6rem] py-[0.8rem] text-[1.4rem] font-semibold text-[var(--color-black-1000)] hover:bg-[var(--color-black-100)]`}
            onClick={getData}
          >
            {isLoading ? "Loading..." : "Send request"}
          </button>
        </div>
      </div>
      {showTable && (
        <Table
          categories={props.categories}
          data={transformedData}
          isIdentity={false}
        />
      )}
      {error != null && <Error error={error} />}
    </>
  );
};

Endpoint.displayName = "Endpoint";

export default Endpoint;
