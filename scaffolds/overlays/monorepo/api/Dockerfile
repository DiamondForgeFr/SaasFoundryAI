####################
# Stage 1: Builder #
####################
FROM node:24.19.0-alpine AS builder
WORKDIR /app

# No git repository in the build context: skip the husky hooks and turbo telemetry
ENV HUSKY=0
ENV TURBO_TELEMETRY_DISABLED=1

# Copy root package files for workspace resolution, and the turbo pipeline
COPY package.json ./
COPY package-lock.json ./
COPY turbo.json ./

# Copy workspace package.json files, and the shared packages the API is built from
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages ./packages

# Install all dependencies (workspaces)
RUN npm ci

# Copy API source code
COPY apps/api/ ./apps/api/

# Generate the Prisma client. prisma.config.ts locates the multi-file schema, and
# tsconfig.json must be in place: the client's import extensions are derived from it
RUN cd apps/api && npx prisma generate

# Build the API and the shared packages it imports at runtime
RUN npx turbo run build --filter=./apps/api...


###################
# Stage 2: Runner #
###################
FROM node:24.19.0-alpine AS runner
WORKDIR /app

# Add labels only in the final image (CI adds org.opencontainers.image.source from the repository)
LABEL org.opencontainers.image.description="saasfoundry-api app"
LABEL org.opencontainers.image.licenses="MIT"

# Install necessary runtime dependencies and build tools
# (postgresql-client applies prisma/sql during `npm run db:update`)
RUN apk add --no-cache postgresql-client dumb-init python3 make g++

# Create app user
RUN addgroup -S users || true
RUN adduser -S ci-deploy -u 1031 -G users

# Copy root package files for workspace resolution
COPY package.json ./
COPY package-lock.json ./

# Copy workspace package.json files, and the built shared packages the API imports
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY --from=builder /app/packages ./packages

# Install production dependencies; the Prisma CLI downloads its schema engine on rebuild
RUN npm ci --omit=dev -w apps/api --ignore-scripts && npm rebuild bcrypt --build-from-source && npm rebuild prisma @prisma/engines

# The schema, its SQL and the update script ship with the image: `npm run db:update`
COPY apps/api/prisma.config.ts ./apps/api/
COPY apps/api/prisma ./apps/api/prisma
COPY apps/api/scripts ./apps/api/scripts

# Copy built application
COPY --from=builder --chown=ci-deploy:users /app/apps/api/dist ./apps/api/dist

# Set environment variables
ENV NODE_ENV=production
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
ENV PORT=3500
ENV LOG_DIR=/app/logs

# Create necessary directories with proper permissions. apps/api/logs links to /app/logs,
# so a relative LOG_DIR=logs (the generated .env) writes where the volume is mounted
RUN mkdir -p logs apps/api/docs && ln -s /app/logs apps/api/logs && chown -R ci-deploy:users logs apps/api/docs

# Run from the API's own directory: its relative paths (docs/, prisma/, scripts/) resolve there
WORKDIR /app/apps/api

# Switch to non-root user
USER ci-deploy

# Expose port
EXPOSE $PORT

# Health check (127.0.0.1: alpine resolves localhost to ::1 first)
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:$PORT/api/health || exit 1

# Use dumb-init as PID 1 to handle signals properly
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Start the application (Nest emits dist/src/main.js, as the prod script runs it)
CMD ["node", "dist/src/main.js"]
