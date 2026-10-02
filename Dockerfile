# JARVIS in a container.
#
#   docker compose up --build
#
# Your chats, memory and pictures live in ./data on the host (a volume), so
# rebuilding the image never touches them. API keys come from .env.local,
# never from the image: nothing secret is copied in at build time.
#
# Not for self-editing: the sandbox is a second server and a copy of the source
# inside the container, and what it applies would vanish with the container.
# Leave JARVIS_ALLOW_SELF_EDIT off here and develop outside Docker.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Scripts run so the voice models are fetched — the script never fails the
# install, so a build without network still produces a working text-only image.
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
# Never run as root: a container escape or a bug in a tool should not start there.
RUN mkdir -p /app/data /app/workspace && chown -R node:node /app/data /app/workspace /app/.next
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Bound to every interface inside the container; the compose file decides what
# the host exposes.
CMD ["npx", "next", "start", "-H", "0.0.0.0", "-p", "3000"]
