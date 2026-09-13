# The pulse API, served. Built from the repository root:
#
#   docker build -f apps/pulse/Dockerfile -t pulse-api .
#
# The context is the root and not `apps/pulse`, because this is a pnpm
# workspace: the lockfile and the workspace manifest live at the root, and an
# install that cannot see them resolves different versions than CI did.
#
# It runs `src/main.ts`, never `src/dev-server.ts` — that one refuses to start
# outside development on purpose, and this image is the reason a second entry
# point exists at all.

# Pinned to the major the repo develops against. A floating `node:22` would
# change the runtime under the image on some unrelated day.
FROM node:22.22-alpine AS build
WORKDIR /repo

# corepack ships with node and reads `packageManager` from package.json, so the
# pnpm version here is the one the lockfile was written by — not whatever is
# newest on the day the image is built.
RUN corepack enable

# Manifests before sources: the install layer is then cached against
# dependency changes rather than being redone on every edit to a source file.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/pulse/package.json apps/pulse/

# `--frozen-lockfile` is what makes this build reproducible: a lockfile that
# does not match the manifests fails here rather than silently resolving
# something CI never tested.
RUN pnpm install --frozen-lockfile --filter @odc/pulse...

COPY apps/pulse apps/pulse
RUN pnpm --filter @odc/pulse build

# A self-contained directory with production dependencies only: no devDeps, no
# workspace symlinks pointing outside it, nothing the runtime stage has to
# understand about pnpm.
RUN pnpm --filter @odc/pulse deploy --prod /out

FROM node:22.22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Never root. A process that does not need to write to its own image should not
# be able to, and `node` is an unprivileged user the base image already has.
USER node

COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/dist ./dist
COPY --from=build --chown=node:node /out/migrations ./migrations
COPY --from=build --chown=node:node /out/package.json ./package.json

# Matches `DEFAULT_PORT`. Documentation for a reader and for `docker run -P`;
# the process still binds whatever `PULSE_PORT` says.
EXPOSE 8080

# Exec form, so node is PID 1 and receives SIGTERM directly. Through a shell it
# would not, and every deploy would end in SIGKILL with requests still in
# flight — which is what `stopOnSignals` exists to handle.
CMD ["node", "dist/src/main.js"]
