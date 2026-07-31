# Unipad API — production image (monorepo)
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @unipad/api...

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate \
  && addgroup -S unipad && adduser -S unipad -G unipad
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN mkdir -p /app/apps/api/uploads && chown -R unipad:unipad /app
USER unipad
EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8787/health || exit 1
WORKDIR /app/apps/api
CMD ["pnpm", "exec", "tsx", "src/index.ts"]
