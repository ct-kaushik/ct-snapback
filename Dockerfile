# ---- Build stage ----
FROM node:20-bookworm-slim AS build
WORKDIR /app
# Install workspace manifests first for better layer caching.
COPY package.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm install
# Build both workspaces.
COPY . .
RUN npm run build
# Drop dev dependencies for a slimmer runtime image.
RUN npm prune --omit=dev

# ---- Runtime stage ----
FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
EXPOSE 8080
CMD ["node", "server/dist/index.js"]
