FROM node:18-alpine

# Install curl for healthcheck (Alpine doesn't have wget by default)
RUN apk add --no-cache curl

# Create app directory
WORKDIR /usr/src/app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
COPY package*.json ./

RUN npm ci --only=production && \
    npm cache clean --force

# Bundle app source
COPY . .

# Change ownership to non-root user
RUN chown -R nodejs:nodejs /usr/src/app

# Switch to non-root user
USER nodejs

# Environment configuration
# NOTE:
# - We only set generic app envs here.
# - DB connection details come from docker-compose.yml environment section
#   (server.js reads from process.env which docker-compose sets)
# - server.js also supports .env file loading, but docker-compose env vars take precedence
ENV NODE_ENV=production \
    PORT=3000

# Expose API port
EXPOSE 3000

# Healthcheck (using curl which we installed)
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start the server
CMD ["node", "server.js"]


