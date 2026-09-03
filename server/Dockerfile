# The API, packaged so it can run somewhere both people can reach.
#
# Two devices in one room have to talk to the same server, and a laptop on
# somebody's desk cannot offer that — so this exists to put it somewhere with
# a real address and a certificate.
#
# Node 22 to match the local toolchain, on slim rather than alpine: Prisma
# ships prebuilt query engines for glibc, and alpine's musl means either
# picking a different engine target or a build that fails at the first query.

FROM node:22-slim AS build

WORKDIR /app

# Dependencies first, so a source-only change does not reinstall everything.
COPY package*.json ./
RUN npm ci

# The schema before the source: `prisma generate` writes the typed client that
# the TypeScript build then compiles against.
COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build


FROM node:22-slim AS run

WORKDIR /app
ENV NODE_ENV=production

# OpenSSL is a Prisma runtime dependency and is not in the slim image.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY prisma ./prisma
RUN npx prisma generate

COPY --from=build /app/dist ./dist

# SQLite and uploaded video both live on disk. Without a volume mounted here,
# every redeploy is a factory reset — see the extension README before going
# live. Both paths are read from the environment for exactly this reason.
VOLUME ["/data"]
ENV DATABASE_URL="file:/data/dev.db"
ENV UPLOAD_DIR="/data/uploads"

EXPOSE 4000

# `db push` on boot rather than during the build: the volume does not exist at
# build time, so this is the first moment there is a database to shape.
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/server.js"]
