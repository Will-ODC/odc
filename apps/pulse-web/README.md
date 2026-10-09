# Pulse web

The Vite client serves the story and sign-in screens. In development, `pnpm
--filter @odc/pulse-web dev` proxies `/api` to the Pulse server on port 8080.
The production Docker image serves the built page through nginx on port 8080
and forwards `/api` to the `api` container, keeping page and API on one origin.

Emailed sign-in links open `/sign-in?token=…`. The page sets `no-referrer` before
loading any assets, because asset requests can otherwise send the token URL as
their `Referer` before React redeems it. Nginx omits both request query strings
and incoming `Referer` values from its access log. Keep both protections when
changing the page head or access log format.
