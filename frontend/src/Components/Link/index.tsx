import React, { useEffect, useContext } from "react";
import { usePlaidLink } from "react-plaid-link";

import Context from "../../Context";

const Link = () => {
  const { linkToken, dispatch } = useContext(Context);

  const onExit = React.useCallback(
    (error: any, metadata: any) => {
      if (error != null) {
        const linkExitError = {
          error_type: error.error_type || "",
          error_code: error.error_code || "",
          error_message: error.error_message || "",
          display_message: error.display_message || "",
          institution_name: metadata?.institution?.name || "",
        };
        dispatch({
          type: "SET_STATE",
          state: { linkExitError },
        });
        fetch("/api/link_exit_error", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(linkExitError),
        });
      }
    },
    [dispatch]
  );

  const onSuccess = React.useCallback(
    async (public_token: string) => {
      const response = await fetch("/api/set_access_token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: `public_token=${public_token}`,
      });

      if (!response.ok) {
        dispatch({
          type: "SET_STATE",
          state: {
            itemId: null,
            accessToken: null,
            isItemAccess: false,
          },
        });
        return;
      }

      const data = await response.json();
      dispatch({
        type: "SET_STATE",
        state: {
          itemId: data.item_id,
          isItemAccess: true,
          linkSuccess: true,
        },
      });
      window.history.pushState("", "", "/");
    },
    [dispatch]
  );

  let isOauth = false;
  const config: Parameters<typeof usePlaidLink>[0] = {
    token: linkToken!,
    onSuccess,
    onExit,
  };

  if (window.location.href.includes("?oauth_state_id=")) {
    // @ts-ignore
    config.receivedRedirectUri = window.location.href;
    isOauth = true;
  }

  const { open, ready } = usePlaidLink(config);

  useEffect(() => {
    if (isOauth && ready) {
      open();
    }
  }, [ready, open, isOauth]);

  return (
    <button
      type="button"
      className="btn btn-primary px-8 py-3 text-[1.5rem] font-semibold"
      onClick={() => open()}
      disabled={!ready}
    >
      Connect bank account
    </button>
  );
};

Link.displayName = "Link";

export default Link;
