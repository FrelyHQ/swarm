# syntax=docker/dockerfile:1.7

FROM oven/bun:1.4.0-alpine AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY src ./src
RUN bun run build

FROM oven/bun:1.4.0-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV SNAP_HOST=0.0.0.0
ENV PORT=8080

COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/bun.lock ./bun.lock

USER bun
EXPOSE 8080
CMD ["bun", "dist/server.js"]
