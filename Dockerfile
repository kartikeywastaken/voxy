# Reproducible static build of the Voxy frontend (apps/web) — the "Open" in CROPS.
# Pinned toolchain + committed lockfile => byte-reproducible dist, servable from any host or IPFS.
#   docker build -t voxy-web .
#   docker run -p 8080:80 voxy-web      # then open http://localhost:8080
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.30.2 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @voxy/web build

FROM nginx:1.27-alpine
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
