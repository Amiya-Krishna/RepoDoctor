FROM node:22-alpine

WORKDIR /app

# Install Git for safe repository ingestion
RUN apk add --no-cache git

# Copy package files first for Docker layer caching
COPY server/package*.json ./server/

# Prisma schema MUST exist before npm ci
COPY server/prisma ./server/prisma/

WORKDIR /app/server

RUN npm ci

WORKDIR /app

COPY server ./server

WORKDIR /app/server

EXPOSE 5000

CMD ["npm", "run", "dev"]