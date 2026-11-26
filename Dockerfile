# Multi-stage Dockerfile for OpenPrime Backend

# Base image pinned by digest (H96). Dependabot's docker ecosystem bumps the tag
# and the digest together.
FROM node:26.13.1-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS builder

# Install build dependencies
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install all dependencies (including dev dependencies for potential build steps)
RUN npm ci --include=dev

# Copy source code
COPY src/ ./src/

# Production stage
FROM node:26.13.1-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS production

WORKDIR /app

# Copy package files
COPY package*.json ./

# git and ssh for the push jobs (simple-git shells out to them)
RUN apk add --no-cache git openssh

# Install only production dependencies from the lock file (npm ci verifies the
# integrity hashes in package-lock.json), then remove npm itself: nothing runs
# it at runtime (CMD, the migration Job and the HEALTHCHECK all call node
# directly), and its bundled undici and brace-expansion are what Trivy flags in
# the image.
RUN npm ci --omit=dev \
 && npm cache clean --force

# Copy application files from builder stage. Code and node_modules stay
# root-owned (read-only for the app user), so a compromised process cannot
# rewrite them.
COPY --from=builder /app/src ./src

# The only paths the app writes under /app: logs/ (file logging, off in
# Kubernetes) and uploads/ (UPLOADS_DIR). Pushes write to /tmp.
RUN mkdir -p logs uploads/helm \
 && chown -R 1000:1000 logs uploads

# Run as the base image's own `node` user (uid/gid 1000), the uid the chart's
# securityContext sets (H97). Numeric, so the kubelet can verify runAsNonRoot.
USER 1000:1000

# Expose port
EXPOSE 3001

# Prometheus metrics, served on their own port so they are never reachable
# through the ingress that fronts the API port (see src/utils/metrics.js)
EXPOSE 9090

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

CMD ["node", "src/server.js"]
