####################
# Stage 1: Builder #
####################
FROM node:22-alpine AS builder
WORKDIR /app

# Copy root package files for workspace resolution
COPY package.json ./
COPY package-lock.json ./

# Copy workspace package.json files
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

# Install all dependencies (workspaces)
RUN npm ci

# Copy Prisma schemas and generate client
COPY apps/api/prisma ./apps/api/prisma
RUN cd apps/api && npx prisma generate

# Copy API source code
COPY apps/api/ ./apps/api/

# Build API application
RUN npm run build -w apps/api

# Clean up Prisma after build
RUN rm -rf apps/api/prisma


###################
# Stage 2: Runner #
###################
FROM node:22-alpine AS runner
WORKDIR /app

# Add labels only in the final image
LABEL org.opencontainers.image.source="https://github.com/agachet/saasfoundry"
LABEL org.opencontainers.image.description="saasfoundry-api app"
LABEL org.opencontainers.image.licenses="MIT"

# Install necessary runtime dependencies and build tools
RUN apk add --no-cache postgresql-client dumb-init python3 make g++

# Create app user
RUN addgroup -S users || true
RUN adduser -S ci-deploy -u 1031 -G users

# Copy root package files for workspace resolution
COPY package.json ./
COPY package-lock.json ./

# Copy workspace package.json files
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

# Install production dependencies
RUN npm ci --omit=dev -w apps/api --ignore-scripts && npm rebuild bcrypt --build-from-source

# Copy built application
COPY --from=builder --chown=ci-deploy:users /app/apps/api/dist ./apps/api/dist

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3500

# Create necessary directories with proper permissions
RUN mkdir -p apps/api/logs apps/api/docs && chown -R ci-deploy:users apps/api/logs apps/api/docs

# Switch to non-root user
USER ci-deploy

# Expose port
EXPOSE $PORT

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s \
  CMD wget --quiet --tries=1 --spider http://localhost:$PORT/api/health || exit 1

# Use dumb-init as PID 1 to handle signals properly
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Start the application
CMD ["node", "apps/api/dist/main.js"]
