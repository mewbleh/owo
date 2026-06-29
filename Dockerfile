# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS dependencies

WORKDIR /app

ENV YARN_CACHE_FOLDER=/tmp/.yarn-cache

COPY package.json yarn.lock ./

RUN corepack enable && yarn install --frozen-lockfile

FROM dependencies AS build

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src

RUN yarn build

FROM node:24-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV YARN_CACHE_FOLDER=/tmp/.yarn-cache

LABEL org.opencontainers.image.title="owotify"
LABEL org.opencontainers.image.description="Spotify synced lyrics selfbot for Discord user-token automation."
LABEL org.opencontainers.image.source="https://github.com/mewbleh/owo"

RUN corepack enable \
  && groupadd --system --gid 1001 owotify \
  && useradd --system --uid 1001 --gid owotify owotify

COPY package.json yarn.lock ./

RUN yarn install --frozen-lockfile --production=true \
  && yarn cache clean \
  && rm -rf /tmp/.yarn-cache

COPY --from=build /app/dist ./dist

USER owotify

CMD ["node", "dist/index.js"]
