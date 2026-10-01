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

# Copy workspace package.json files, and the shared packages the web app is built from
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages ./packages

# Install all dependencies (workspaces)
RUN npm ci

# Copy web source
COPY apps/web/ ./apps/web/

# Build the web application and the shared packages it imports
RUN npx turbo run build --filter=./apps/web...


###################
# Stage 2: Runner #
###################
FROM nginx:alpine AS runner
WORKDIR /usr/share/nginx/html

# Add labels only in the final image
LABEL org.opencontainers.image.source="https://github.com/agachet/saasfoundry"
LABEL org.opencontainers.image.description="saasfoundry-web app"
LABEL org.opencontainers.image.licenses="MIT"

# Create app user for security
RUN adduser -S ci-deploy -u 1031 -G nginx

# Copy built application from builder stage
COPY --from=builder /app/apps/web/dist .
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

# Set environment variables
ENV NODE_ENV=production

# Change ownership of nginx directories
RUN chown -R ci-deploy:nginx /usr/share/nginx/html && \
    chown -R ci-deploy:nginx /var/cache/nginx && \
    chown -R ci-deploy:nginx /var/log/nginx && \
    touch /var/run/nginx.pid && \
    chown ci-deploy:nginx /var/run/nginx.pid

# Expose port (nginx listens on 8080: the server runs unprivileged)
EXPOSE 8080

# Health check (127.0.0.1: alpine resolves localhost to ::1 first)
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/ || exit 1

# Use non-root user for better security
USER ci-deploy

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]
