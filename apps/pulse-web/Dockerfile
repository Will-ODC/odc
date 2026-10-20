# The pulse client, served — and the front door. Built from the repository root:
#
#   docker build -f apps/pulse-web/Dockerfile -t pulse-web .
#
# Two images, two processes, deployed and scaled apart. But **one origin**: this
# one serves the page and forwards `/api` to the API container, so the browser
# sees a single website.
#
# That is not cosmetic. The session cookie is `SameSite=Lax`, which means the
# browser attaches it only to the site that issued it. Serve the page from
# another address and the browser treats the API as a third party, sends no
# cookie, and sign-in stops working — with the fix being to weaken the cookie to
# `SameSite=None` and rebuild by hand the cross-site protection that is being
# given up. Keeping one origin is what lets the cookie code stay as written.
#
# It is also the shape development already has: vite proxies `/api` to :8080
# for exactly this reason (`apps/pulse-web/vite.config.ts`).

FROM node:22.22-alpine AS build
WORKDIR /repo

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/pulse-web/package.json apps/pulse-web/
RUN pnpm install --frozen-lockfile --filter @odc/pulse-web...

COPY apps/pulse-web apps/pulse-web
ARG VITE_PULSE_FIRST_POLL_ID=""
ENV VITE_PULSE_FIRST_POLL_ID=$VITE_PULSE_FIRST_POLL_ID
ARG VITE_PULSE_DATA_POLL_ID=""
ARG VITE_PULSE_FUNDING_POLL_ID=""
ARG VITE_PULSE_REVOTE_POLL_ID=""
ENV VITE_PULSE_DATA_POLL_ID=$VITE_PULSE_DATA_POLL_ID \
    VITE_PULSE_FUNDING_POLL_ID=$VITE_PULSE_FUNDING_POLL_ID \
    VITE_PULSE_REVOTE_POLL_ID=$VITE_PULSE_REVOTE_POLL_ID
# Typecheck browser source only for this image. Browser tests use the full
# tsconfig in CI; client/API integration tests live in tests/pulse-integration
# and are not copied into either production image.
RUN pnpm --filter @odc/pulse-web exec tsc -p tsconfig.build.json --noEmit \
    && pnpm --filter @odc/pulse-web exec vite build

FROM nginx:1.29-alpine AS runtime

COPY --from=build /repo/apps/pulse-web/dist /usr/share/nginx/html
COPY apps/pulse-web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080
