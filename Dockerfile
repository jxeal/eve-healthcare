FROM node:20-alpine

# Prisma's query engine needs OpenSSL, which the alpine base image omits.
RUN apk add --no-cache openssl

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY prisma ./prisma
RUN npx prisma generate

COPY src ./src

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# exec makes node PID 1, so it receives SIGTERM from `docker stop` and shuts down gracefully.
CMD ["sh", "-c", "npx prisma migrate deploy && exec node src/server.js"]
