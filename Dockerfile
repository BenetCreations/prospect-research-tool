# --- build client ---
FROM node:20-bookworm-slim AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# --- server (with native module build tools for better-sqlite3) ---
FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY server/package*.json ./server/
RUN npm ci --prefix server --omit=dev

COPY server/ ./server/
COPY --from=client-build /app/client/dist ./client/dist

ENV NODE_ENV=production
ENV DB_PATH=/data/prospect.db
EXPOSE 3001

CMD ["node", "server/index.js"]
