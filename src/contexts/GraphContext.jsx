// GraphContext is stubbed — Microsoft Graph integration pending CSPC IT setup.
import { createContext, useContext } from "react";

const GraphContext = createContext(null);

export function GraphProvider({ children }) {
  return <GraphContext.Provider value={{ getToken: null, sendEmail: null }}>{children}</GraphContext.Provider>;
}

export const useGraph = () => useContext(GraphContext);
