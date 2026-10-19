# Nexus app image: the web app (built once) plus the server and its background workers.

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
RUN npm ci
COPY . .
RUN npm run build -w apps/web \
 && npx -w apps/server prisma generate \
 && npm prune --omit=dev

FROM node:24-alpine
# openssl: used by Prisma and for S/MIME signing and encryption.
RUN apk add --no-cache openssl tini
WORKDIR /app
COPY --from=build /app ./
ENV NODE_ENV=production \
    WEB_DIST=/app/apps/web/dist \
    PLUGINS_DIR=/app/plugins
WORKDIR /app/apps/server
EXPOSE 8080
USER node
ENTRYPOINT ["/sbin/tini", "--"]
# Apply any new database migrations, then start.
CMD ["sh", "-c", "npx prisma migrate deploy && node src/index.ts"]
