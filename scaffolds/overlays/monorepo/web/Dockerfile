#########################
# Stage 1: Dependencies #
#########################
FROM node:22-alpine AS deps
WORKDIR /app

# Copy root package files for workspace resolution
COPY package.json ./
COPY package-lock.json ./

# Copy workspace package.json files
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

# Install all dependencies (workspaces)
RUN npm ci


####################
# Stage 2: Builder #
####################
FROM node:22-alpine AS builder
WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules

# Copy root package files
COPY package.json ./
COPY package-lock.json ./

# Copy web source
COPY apps/web/ ./apps/web/

# Build web application
RUN npm run build -w apps/web


###################
# Stage 3: Runner #
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

# Expose port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s \
  CMD wget --quiet --tries=1 --spider http://localhost:80/ || exit 1

# Use non-root user for better security
USER ci-deploy

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]
