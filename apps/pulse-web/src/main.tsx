import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HttpPulseApi } from "./api/http.js";
import { App } from "./App.js";

/**
 * The entry point. Same-origin on purpose: `vite.config.ts` proxies `/api` to
 * the dev server on 8080, so the session cookie needs no CORS or SameSite
 * special-casing. Never point this at an absolute API origin.
 */
const root = document.getElementById("root");
if (!root) throw new Error("index.html is missing #root");

// `?poll=` so a run can be started anywhere in the graph without a rebuild.
// `ads-free` is where the dev server's run begins.
const pollId = new URLSearchParams(location.search).get("poll") ?? "ads-free";

createRoot(root).render(
  <StrictMode>
    <App api={new HttpPulseApi()} pollId={pollId} />
  </StrictMode>,
);
