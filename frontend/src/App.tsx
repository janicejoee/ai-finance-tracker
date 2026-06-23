import React, { useEffect, useContext, useCallback } from "react";

import Header from "./Components/Headers";
import ConnectBank from "./Components/ConnectBank";
import Dashboard from "./Components/Dashboard";
import Context from "./Context";

import styles from "./App.module.css";

const App = () => {
  const { linkSuccess, dispatch } = useContext(Context);

  const generateToken = useCallback(async () => {
    const response = await fetch("/api/create_link_token", { method: "POST" });
    if (!response.ok) {
      dispatch({ type: "SET_STATE", state: { backend: false } });
      let errorDetail;
      try {
        const data = await response.json();
        errorDetail = data.error || {
          error_code: data.error_code || "UNKNOWN",
          error_type: data.error_type || "API_ERROR",
          error_message:
            data.error_message ||
            `Request failed with status ${response.status}`,
        };
      } catch {
        errorDetail = {
          error_code: "UNKNOWN",
          error_type: "API_ERROR",
          error_message: `Request failed with status ${response.status}`,
        };
      }
      dispatch({
        type: "SET_STATE",
        state: { linkToken: null, linkTokenError: errorDetail },
      });
      return;
    }

    const data = await response.json();
    if (data.error != null) {
      dispatch({
        type: "SET_STATE",
        state: {
          linkToken: null,
          linkTokenError: data.error,
        },
      });
      return;
    }

    dispatch({
      type: "SET_STATE",
      state: { linkToken: data.link_token, backend: true },
    });
    localStorage.setItem("link_token", data.link_token);
  }, [dispatch]);

  useEffect(() => {
    const init = async () => {
      if (window.location.href.includes("?oauth_state_id=")) {
        dispatch({
          type: "SET_STATE",
          state: {
            linkToken: localStorage.getItem("link_token"),
          },
        });
        return;
      }

      try {
        const res = await fetch("/api/link_status");
        const data = await res.json();
        if (res.ok && data.linked === true) {
          dispatch({ type: "SET_STATE", state: { linkSuccess: true } });
        }
      } catch {
        // no linked account yet
      }

      generateToken();
    };
    init();
  }, [dispatch, generateToken]);

  return (
    <div className={`${styles.App} min-h-screen py-8 px-4 sm:px-6 lg:px-8`}>
      <div className={`${styles.container} w-full`}>
        <Header />
        {linkSuccess ? (
          <Dashboard />
        ) : (
          <div className="flex justify-center pt-4">
            <ConnectBank />
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
