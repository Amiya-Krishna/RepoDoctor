FROM node:22-alpine

WORKDIR /app
RUN apk add --no-cache git

COPY server/package*.json ./server/
COPY server/prisma ./server/prisma/

WORKDIR /app/server
RUN npm install

WORKDIR /app
COPY server ./server

WORKDIR /app/server
CMD ["npm", "run", "worker"]
