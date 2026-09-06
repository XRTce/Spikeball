# syntax=docker/dockerfile:1

# ---- Build ----------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Install dependencies first so the layer is cached until the lockfile changes.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig*.json vite.config.ts vitest.config.ts index.html ./
COPY public ./public
COPY src ./src
COPY tests ./tests
COPY scripts ./scripts

# Type errors and failing tests must not reach an image.
RUN npm run test
RUN npm run build

# ---- Runtime --------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

# Drop the stock site so only Rally's config is loaded. The image listens on
# 8080 rather than 80, so no privileged port bind is needed.
RUN rm -rf /usr/share/nginx/html/* /etc/nginx/conf.d/default.conf

COPY docker/nginx.conf /etc/nginx/conf.d/rally.conf
COPY docker/security-headers.conf /etc/nginx/rally-security.conf
COPY --from=build /app/dist /usr/share/nginx/html

# Rally is a static bundle with no server-side state; everything the app stores
# lives in the visitor's own browser.
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/ || exit 1

STOPSIGNAL SIGQUIT
CMD ["nginx", "-g", "daemon off;"]
