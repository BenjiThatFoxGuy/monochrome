# Node Alpine -- multi-arch (amd64 + arm64)
FROM oven/bun:1.3.10-alpine AS builder

WORKDIR /app

# Install system dependencies required for Bun and Neutralino
RUN apk add --no-cache wget curl bash
RUN apk add --no-cache python3 make g++ && ln -sf python3 /usr/bin/python

# Accept build arguments for environment variables
ARG AUTH_ENABLED
ARG AUTH_SECRET
ARG POCKETBASE_URL
ARG SESSION_MAX_AGE

# Copy package files first for caching
COPY package.json package-lock.json ./

# Install dependencies (Node)
RUN bun install

# Copy the rest of the project
COPY . .

# Build the project (Bun is now available for "bun x neu build")
RUN bun run build

# Serve with nginx + bundled Subsonic API (Bun)
FROM nginx:1.28.2-alpine

# Copy the built frontend
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Bundle the Subsonic API server files
COPY --from=builder /app/server /app/server

# Copy the Bun binary from the builder so the Subsonic server can run
COPY --from=builder /usr/local/bin/bun /usr/local/bin/bun

# Entrypoint that starts both the Subsonic server and nginx
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Web UI port
EXPOSE 4173
# Subsonic API port
EXPOSE 4533

ENTRYPOINT ["/docker-entrypoint.sh"]
