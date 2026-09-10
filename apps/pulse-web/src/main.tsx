import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HttpPulseApi } from "./api/http.js";
import { App } from "./App.js";

/**
 * The entry point. Same-origin on purpose: `vite.config.ts` proxies `/api` to
 * the dev server on 8080, so the session cookie needs no CORS or SameSite
 * special-casing. Never point this at an absolute API origin.
 *
 * Where in the app we are is read from the URL by `App`, so the emailed
 * sign-in link — `/sign-in?token=…` — lands on something that knows what to do
 * with it. `?poll=` still starts a run anywhere in the graph.
 */
const root = document.getElementById("root");
if (!root) throw new Error("index.html is missing #root");

createRoot(root).render(
  <StrictMode>
    <App api={new HttpPulseApi()} />
  </StrictMode>,
);
