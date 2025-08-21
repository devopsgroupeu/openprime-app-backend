# Multi-stage Dockerfile for OpenPrime Backend
FROM node:24.5.0-alpine AS builder

# Install build dependencies
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install all dependencies (including dev dependencies for potential build steps)
RUN npm ci --include=dev

# Copy source code
COPY src/ ./src/

# Production stage
FROM node:24.5.0-alpine AS production

# Create user and group
RUN addgroup -g 1001 -S nodejs \
    && adduser -S nodejs -u 1001

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy application files from builder stage
COPY --from=builder /app/src ./src

# Create directories with proper permissions
RUN mkdir -p logs uploads/helm \
    && chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

CMD ["node", "src/server.js"]