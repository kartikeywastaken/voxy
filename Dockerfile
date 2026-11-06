# Voxy backend API — run the recovery/attester/orchestrator over the live testnets.
# Secrets (keys, RPC URLs) come from the host's environment, never baked into the image.
FROM node:24-bookworm-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.30.2 --activate
COPY . .
RUN pnpm install --frozen-lockfile
ENV HOST=0.0.0.0
EXPOSE 8787
CMD ["pnpm","--filter","@voxy/api","start:prod"]
