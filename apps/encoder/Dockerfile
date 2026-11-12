# Video encoder: build from the repo root
#   docker build -f apps/encoder/Dockerfile -t video-encoder .
#   docker run -d --restart unless-stopped --env-file .env video-encoder

FROM node:22-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
# Every workspace's package.json, so the lockfile matches; only the encoder's code is copied.
COPY packages/db/package.json packages/db/
COPY packages/contract/package.json packages/contract/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/upload-worker/package.json apps/upload-worker/
COPY apps/encoder/package.json apps/encoder/
RUN npm ci --workspace @repo/encoder --ignore-scripts
COPY packages/db packages/db
COPY apps/encoder apps/encoder
RUN npm run build --workspace @repo/encoder \
 && npm ci --workspace @repo/encoder --omit=dev --ignore-scripts

FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/encoder/dist ./dist
ENV NODE_ENV=production ENCODER_WORK_DIR=/work
RUN mkdir /work && chown node:node /work
USER node
# SIGTERM puts unfinished videos back in the queue; give it a moment.
STOPSIGNAL SIGTERM
CMD ["node", "dist/index.js"]
