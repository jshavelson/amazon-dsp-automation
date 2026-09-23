FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-bookworm-slim AS frontend
WORKDIR /frontend
COPY platform/frontend/package.json platform/frontend/package-lock.json ./
RUN npm ci && npm cache clean --force
COPY platform/frontend/ ./
RUN npx vite build

FROM node:24-bookworm-slim
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
  && mkdir -p /app/certs \
  && curl --fail --silent --show-error https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o /app/certs/aws-rds-global-bundle.pem \
  && apt-get purge -y curl \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*
RUN npx playwright install --with-deps chromium \
  && chown -R node:node /ms-playwright \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_EXTRA_CA_CERTS=/app/certs/aws-rds-global-bundle.pem
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY platform ./platform
COPY AGENTS.md SOUL.md IDENTITY.md ./
COPY --from=frontend /frontend/dist ./platform/frontend-dist
COPY data/dashboards/amazon-dsp-kpi-dashboard.html ./dashboard/amazon-dsp-kpi-dashboard.html
RUN chown -R node:node /app
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:8787/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "platform/src/server.mjs"]
