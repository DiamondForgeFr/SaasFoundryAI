####################
# Stage 1: Builder #
####################
FROM node:24.19.0-alpine AS builder
WORKDIR /app

# No git repository in the build context: skip the husky hooks
ENV HUSKY=0

# Copy package files separately for better caching
COPY package.json ./
COPY package-lock.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Generate the Prisma client. prisma.config.ts locates the multi-file schema, and
# tsconfig.json must be in place: the client's import extensions are derived from it
RUN npx prisma generate

# Build application
RUN npm run build


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

# Copy package files separately for better caching
COPY package.json ./
COPY package-lock.json ./

# Install production dependencies; the Prisma CLI downloads its schema engine on rebuild
RUN npm ci --omit=dev --ignore-scripts && npm rebuild bcrypt --build-from-source && npm rebuild prisma @prisma/engines

# The schema, its SQL and the update script ship with the image: `npm run db:update`
COPY prisma.config.ts ./
COPY prisma ./prisma
COPY scripts ./scripts

# Copy built application
COPY --from=builder --chown=ci-deploy:users /app/dist ./dist

# Set environment variables
ENV NODE_ENV=production
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
ENV PORT=3500
ENV LOG_DIR=/app/logs

# Create necessary directories with proper permissions
RUN mkdir -p logs docs && chown -R ci-deploy:users logs docs

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
