# OVARA for PayPal agents: one image, one URL.
#
#   stage 1  builds the open-source OVARA gateway + proxy from a pinned commit
#   stage 2  builds the console and the API
#   stage 3  runtime: Node 22 (PayPal MCP server, API), Python 3 (setup), the ovara binary
#
# Nothing secret is baked in. PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET / META_API_KEY
# arrive as environment variables at run time and are read by OVARA only; the agent
# and the MCP server see placeholders.

ARG OVARA_REPO=https://github.com/SidianLabs/OVARA.git
ARG OVARA_COMMIT=b12111047101cebdd0bdfd22839f3f56f0d8f060

FROM golang:1.26-bookworm AS ovara
ARG OVARA_REPO
ARG OVARA_COMMIT
RUN git clone --filter=blob:none "$OVARA_REPO" /src \
 && cd /src && git checkout --quiet "$OVARA_COMMIT"
WORKDIR /src/proxy
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/ovara ./cmd/ovara

FROM node:22-bookworm-slim AS app
WORKDIR /build
COPY api/package.json api/package-lock.json* ./api/
RUN cd api && npm ci --omit=dev --ignore-scripts 2>/dev/null || (cd api && npm install --omit=dev --ignore-scripts)
COPY api ./api
RUN cd api && npm run build
COPY web ./web
RUN cd web && npm install && npm run build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates curl tini \
 && rm -rf /var/lib/apt/lists/*
# the PayPal MCP server, pinned, so the first boot does not wait on npm
RUN npm install -g @paypal/mcp@1.8.1 && npm cache clean --force
COPY --from=ovara /out/ovara /usr/local/bin/ovara
WORKDIR /opt/ovara-pay
COPY --from=app /build/api/dist ./api/dist
COPY --from=app /build/api/node_modules ./api/node_modules
COPY --from=app /build/api/package.json ./api/package.json
COPY --from=app /build/web/dist ./web/dist
COPY ovara ./ovara
COPY boot.sh ./boot.sh
RUN chmod +x boot.sh ovara/setup.sh
ENV OVARA_DIR=/srv/ovara OVARA_PAY_CONF=/opt/ovara-pay/ovara PORT=10000
EXPOSE 10000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["./boot.sh"]
