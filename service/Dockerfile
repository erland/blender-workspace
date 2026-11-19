FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY viewer ./viewer
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
# CPython is used only for compile(..., "exec") syntax checks, never to run user scripts.
RUN apt-get update && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 ARTIFACT_ROOT=/data/blender-workspace
WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
RUN mkdir -p /data/blender-workspace && chown node:node /data/blender-workspace
USER node
EXPOSE 3000
CMD ["node","dist/main.js"]
