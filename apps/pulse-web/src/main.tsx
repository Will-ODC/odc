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

// `?poll=` so a second seeded poll can be opened without a rebuild. The dev
// server seeds `p1`.
const pollId = new URLSearchParams(location.search).get("poll") ?? "p1";

createRoot(root).render(
  <StrictMode>
    <App api={new HttpPulseApi()} pollId={pollId} />
  </StrictMode>,
);
