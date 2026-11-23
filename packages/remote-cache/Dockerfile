# CREEP-safe self-hosted Nx remote cache — single-container deploy.
# Build context is this package directory *after* `bun run build`
# (dist/ must exist). No runtime dependencies beyond Node >= 22.
FROM node:22-alpine

WORKDIR /app
COPY dist ./dist
COPY package.json ./package.json

ENV NXRC_BACKEND=fs \
    NXRC_FS_DIR=/cache \
    NXRC_HOST=0.0.0.0 \
    NXRC_PORT=3000
# Docker initializes declared volumes root-owned — create /cache first and
# hand it to `node` or the first upload fails EACCES.
RUN mkdir -p /cache && chown node:node /cache
VOLUME ["/cache"]
EXPOSE 3000

USER node
ENTRYPOINT ["node", "dist/cli.mjs"]
CMD ["serve"]
