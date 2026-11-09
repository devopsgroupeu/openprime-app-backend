# Multi-stage Dockerfile for OpenPrime Backend
FROM node:26.13.0-alpine AS builder

# Install build dependencies
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install all dependencies (including dev dependencies for potential build steps)
RUN npm ci --include=dev

# Copy source code
COPY src/ ./src/

# Production stage
FROM node:26.13.0-alpine AS production

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN apk add --no-cache git openssh
RUN npm ci --only=production && npm cache clean --force

# Copy application files from builder stage
COPY --from=builder /app/src ./src

# Create directories with proper permissions
RUN mkdir -p logs uploads/helm \
    && chown -R node:node /app

# Run as the base image's own `node` user (uid/gid 1000), the uid the chart's
# securityContext sets; a separate uid here left /app unwritable at runtime.
USER node

# Expose port
EXPOSE 3001

# Prometheus metrics, served on their own port so they are never reachable
# through the ingress that fronts the API port (see src/utils/metrics.js)
EXPOSE 9090

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

CMD ["node", "src/server.js"]
