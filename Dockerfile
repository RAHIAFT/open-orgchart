# syntax=docker/dockerfile:1
# SPDX-License-Identifier: Apache-2.0
#
# open-orgchart: one process, one SQLite file in /data, no runtime dependencies.
#   docker build -t open-orgchart .
#   docker run -p 8080:8080 -v orgchart-data:/data open-orgchart

FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/chart/package.json packages/chart/
COPY packages/server/package.json packages/server/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm test --workspace @open-orgchart/server

FROM node:22-alpine
ENV NODE_ENV=production ORG_DATA=/data ORG_PORT=8080
WORKDIR /app
COPY --from=build /src/packages/server/package.json ./package.json
COPY --from=build /src/packages/server/src ./src
COPY --from=build /src/packages/server/public ./public
COPY LICENSE NOTICE ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${ORG_PORT}/healthz" >/dev/null || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "src/cli.js", "serve"]
