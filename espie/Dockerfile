# =============================================================================
# Stage 1: Build
# =============================================================================
FROM node:22-bookworm AS builder

# Build tools for native modules (better-sqlite3, @discordjs/opus)
RUN apt-get update && apt-get install -y \
  python3 make g++ \
  libopus-dev \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies (layer cache: only rebuilds when package*.json changes)
COPY package*.json ./
# ARM64 needs CFLAGS for @discordjs/opus NEON intrinsics; the flag breaks x86 builds
RUN if [ "$(uname -m)" = "aarch64" ]; then \
      export CFLAGS="-DOPUS_ARM_MAY_HAVE_NEON_INTR"; \
    fi && \
    npm install --no-optional || npm install

# Copy source and build (Pi 4 needs more memory for Nuxt build)
COPY . .
RUN NODE_OPTIONS="--max-old-space-size=2048" npm run build

# =============================================================================
# Stage 2: Runtime
# =============================================================================
FROM node:22-bookworm-slim

# Runtime dependencies only (no build tools)
RUN apt-get update && apt-get install -y --no-install-recommends \
  libopus0 \
  ffmpeg \
  curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built output and node_modules (native modules need the compiled .node files)
COPY --from=builder /app/.output .output
COPY --from=builder /app/node_modules node_modules
COPY --from=builder /app/package.json .

# Install yt-dlp (YouTube Music downloads) and uv/uvx (ha-mcp MCP server runtime)
RUN apt-get update && apt-get install -y --no-install-recommends \
  python3 python3-pip \
  && pip3 install --break-system-packages yt-dlp uv \
  && rm -rf /var/lib/apt/lists/*

# Create data directories for SQLite, firmware binaries, and YouTube Music cache
RUN mkdir -p /app/data/db /app/data/bin /app/data/ytmusic

# Memory constraint for Pi 4 (4GB shared with other services)
ENV NODE_OPTIONS="--max-old-space-size=512 --unhandled-rejections=warn"
ENV DATABASE_PATH="/app/data/db/espie.db"
ENV BIN_DIR="/app/data/bin"
ENV YTMUSIC_DIR="/app/data/ytmusic"

# Nuxt runs on port 3000 inside the container
# Docker maps host 8000 and 8003 to container 3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

CMD ["node", ".output/server/index.mjs"]
