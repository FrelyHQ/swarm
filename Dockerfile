FROM oven/bun:1.1.38 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN bun run build

FROM oven/bun:1.1.38-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/dist /app/dist
EXPOSE 8787
USER bun
CMD ["bun", "dist/server.js"]
