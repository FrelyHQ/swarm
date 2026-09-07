# syntax=docker/dockerfile:1.7

FROM oven/bun:1.4.0-alpine AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY src ./src
RUN bun run build

FROM build AS dev
ENV NODE_ENV=development
ENV SWARM_HOST=0.0.0.0
ENV PORT=4111
USER bun
EXPOSE 4111
CMD ["bun", "--watch", "src/server.ts"]

FROM oven/bun:1.4.0-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV SWARM_HOST=0.0.0.0
ENV PORT=4111

COPY --from=build /app/dist ./dist

USER bun
EXPOSE 4111
CMD ["bun", "dist/server.js"]
