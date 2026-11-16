# Separate one-shot worker image; the public MCP API image stays minimal.
FROM node:22-bookworm-slim AS compile
WORKDIR /app/service
COPY service/package.json service/tsconfig.json ./
RUN npm install --no-audit --no-fund
COPY service/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/modal && /opt/modal/bin/pip install --no-cache-dir modal==1.4.1
ENV PATH="/opt/modal/bin:${PATH}" NODE_ENV=production MODAL_WORKER_ROOT=/app ARTIFACT_ROOT=/data/blender-workspace
WORKDIR /app
COPY --from=compile /app/service/node_modules /app/service/node_modules
COPY --from=compile /app/service/dist /app/service/dist
COPY service/migrations /app/service/migrations
COPY modal_provider /app/modal_provider
COPY blender_workspace_poc /app/blender_workspace_poc
COPY scripts /app/scripts
COPY tests /app/tests
COPY Dockerfile /app/Dockerfile
RUN mkdir -p /data/blender-workspace && chown -R node:node /data/blender-workspace
USER node
WORKDIR /app/service
ENTRYPOINT ["node","dist/jobs/cli.js"]
