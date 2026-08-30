# Proof-of-Ink backend.
#
# Long-lived service: holds two websocket connections and an in-process keeper that
# refreshes the ops authorization before it expires. Built to restart cleanly, since
# `--dev` chains and RPC endpoints both drop connections in normal operation.

FROM node:22-alpine

# tini: init process so SIGTERM reaches Node directly and shutdown drains connections
# instead of being killed at the 10s timeout.
# ffmpeg: compresses each verification video down to Bulletin's per-transaction limit
# before it is stored (src/media.mjs); the service cannot accept uploads without it.
RUN apk add --no-cache tini ffmpeg

WORKDIR /app

# The PAPI descriptors, consumed through a `portal:` dependency, are generated at the
# repo root — so the build context is the repo root rather than this directory (see
# docker-compose.yml), and they must be present before `yarn install` resolves the
# portal against them.
#
# They are generated on the host rather than in the image. Codegen pulls in the
# frontend's build toolchain (esbuild, rollup), and installing all of that just to
# produce a directory the host already has would trade a large image and a slow build
# for nothing. `yarn papi generate` at the repo root is what produces it; the guard
# below fails the build loudly if that step was skipped, rather than shipping an image
# that dies on its first storage query.
COPY .papi/descriptors ./.papi/descriptors
RUN test -f ./.papi/descriptors/dist/index.js || \
  (echo 'ERROR: .papi/descriptors/dist is missing. Run `yarn papi generate` at the repo root first.' && exit 1)

# Dependencies next: this layer is cached unless the manifests actually change.
#
# Yarn 4 via corepack, pinned by `packageManager` in package.json. An `|| npm install`
# fallback was tried and removed: it hid a failing yarn install behind a silently
# different resolution, which is exactly the kind of drift a lockfile exists to stop.
COPY services/poi-backend/package.json services/poi-backend/yarn.lock services/poi-backend/.yarnrc.yml ./services/poi-backend/
WORKDIR /app/services/poi-backend
RUN corepack enable && yarn workspaces focus --production --all

COPY services/poi-backend/src ./src
COPY services/poi-backend/scripts ./scripts

# The registry JSON and the wallpaper cache are written under ./data at runtime (mount a
# persistent volume here). Create it owned by `node` so the dropped-privilege process can
# write even before a volume is attached.
RUN mkdir -p ./data/images && chown -R node:node ./data

# Drop privileges. Apart from ./data the image needs no write access to anything it ships.
USER node

ENV NODE_ENV=production
EXPOSE 8787

# Reports degraded when the chain connections are down, so an unhealthy container is
# visible rather than silently accepting requests it cannot serve.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
# `--preserve-symlinks` is required by the `portal:` descriptors dependency: without it
# Node resolves through the symlink and loads a second, unrelated copy of the PAPI
# runtime, which fails at the first storage query.
CMD ["node", "--preserve-symlinks", "src/index.mjs"]
