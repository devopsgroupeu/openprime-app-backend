# Dockerfile
FROM node:18-alpine

# Install Python for processing service
RUN apk add --no-cache python3 py3-pip

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY . .

# Create directories
RUN mkdir -p logs uploads/helm

EXPOSE 3001

CMD ["node", "src/server.js"]