
FROM node:22-bookworm-slim AS build

# Prisma detects the OpenSSL version with the `openssl` binary, which the slim image
# lacks; without it the client/engines can be generated for the wrong platform.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
# --ignore-scripts: the postinstall hook (prisma generate) needs prisma/schema.prisma,
# which is only copied below; the client is generated explicitly afterwards.
RUN npm ci --ignore-scripts

COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:22-bookworm-slim AS production

ENV NODE_ENV=production
WORKDIR /app

# Both workers clone repositories with git over HTTPS.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
# --ignore-scripts: postinstall (prisma generate) would run before prisma/ is copied;
# the generated client is copied from the build stage below.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma

USER node

EXPOSE 4000

CMD ["node", "dist/server.js"]
