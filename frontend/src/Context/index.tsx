import { createContext, useReducer, Dispatch, ReactNode } from "react";

interface QuickstartState {
  linkSuccess: boolean;
  isItemAccess: boolean;
  linkToken: string | null;
  accessToken: string | null;
  itemId: string | null;
  backend: boolean;
  linkTokenError: {
    error_message: string;
    error_code: string;
    error_type: string;
  };
  linkExitError: {
    error_message: string;
    error_code: string;
    error_type: string;
    display_message: string;
    institution_name: string;
  } | null;
}

const initialState: QuickstartState = {
  linkSuccess: false,
  isItemAccess: true,
  linkToken: "",
  accessToken: null,
  itemId: null,
  backend: true,
  linkTokenError: {
    error_type: "",
    error_code: "",
    error_message: "",
  },
  linkExitError: null,
};

type QuickstartAction = {
  type: "SET_STATE";
  state: Partial<QuickstartState>;
};

interface QuickstartContext extends QuickstartState {
  dispatch: Dispatch<QuickstartAction>;
}

const Context = createContext<QuickstartContext>(
  initialState as QuickstartContext
);

const { Provider } = Context;
export const QuickstartProvider: React.FC<{ children: ReactNode }> = (
  props
) => {
  const reducer = (
    state: QuickstartState,
    action: QuickstartAction
  ): QuickstartState => {
    switch (action.type) {
      case "SET_STATE":
        return { ...state, ...action.state };
      default:
        return { ...state };
    }
  };
  const [state, dispatch] = useReducer(reducer, initialState);
  return <Provider value={{ ...state, dispatch }}>{props.children}</Provider>;
};

export default Context;
