# Amazon DSP Dashboard Frontend Dockerfile
# Multi-stage build for production optimization

# Stage 1: Build the application
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Install dependencies first for better caching
COPY package.json package-lock.json* ./
RUN npm ci --frozen-lockfile

# Copy source files
COPY . .

# Build the application
RUN npm run build

# Stage 2: Production image
FROM nginx:alpine AS production

# Install certbot for SSL (if needed)
# RUN apk add --no-cache certbot certbot-nginx

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built files from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy public files
COPY public /usr/share/nginx/html/public

# Set environment variables
ENV NODE_ENV=production
ENV VITE_API_BASE_URL=/api

# Expose port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost/ || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
