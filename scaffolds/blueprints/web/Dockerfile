#########################
# Stage 1: Dependencies #
#########################
FROM node:24.19.0-alpine AS deps
WORKDIR /app

# No git repository in the build context: skip the husky hooks
ENV HUSKY=0

# Copy package files for dependency installation
COPY package*.json ./

# Install all dependencies (including devDependencies)
RUN npm ci


####################
# Stage 2: Builder #
####################
FROM node:24.19.0-alpine AS builder
WORKDIR /app

# Copy dependencies before building
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build application
RUN npm run build


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
COPY --from=builder /app/dist .
COPY nginx.conf /etc/nginx/conf.d/default.conf

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