import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/agentos.css";

/**
 * Vault reads are local and cheap, but they are still reads: retry once, and
 * do not re-read simply because a window regained focus.
 *
 * `networkMode: "always"` matters here. The data adapter is on loopback, so
 * internet connectivity says nothing about whether it can be reached.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: "always",
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
