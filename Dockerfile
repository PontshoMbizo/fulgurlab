# fulgurlab: block-diagram editor + headless Scilab/Xcos simulation server, one image.
#
#   docker build -t fulgurlab .
#   docker compose up            # hardened settings live in compose.yml

# ---- build the editor
FROM node:22-bookworm-slim AS web
WORKDIR /app
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci --no-audit --no-fund
COPY shared ./shared
COPY examples ./examples
COPY web ./web
RUN cd web && npm run build

# ---- runtime: Ubuntu's Scilab (2024.0) + Node 22 (Ubuntu's own nodejs is 18, too old)
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
# scilab-cli = the launcher; scilab-full-bin = libsciscicos (Xcos simulation). Both are needed.
RUN apt-get update \
 && apt-get install -y --no-install-recommends scilab-cli scilab-full-bin ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home --uid 10001 fulgur
COPY --from=web /usr/local/bin/node /usr/local/bin/node
# Ubuntu's scilab-cli launcher needs dpkg-architecture (from dpkg-dev) to find
# its libraries; this one-file stand-in avoids installing the whole toolchain.
COPY --chmod=755 docker/dpkg-architecture /usr/local/bin/dpkg-architecture
WORKDIR /app
COPY shared ./shared
COPY examples ./examples
COPY server ./server
COPY --from=web /app/web/dist ./web/dist
USER fulgur
ENV PORT=8080 HOST=0.0.0.0 SIM_WORKDIR=/tmp NODE_ENV=production REQUIRE_SCILAB=1
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=15s CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/src/server.js"]
