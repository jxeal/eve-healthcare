FROM node:20-alpine

WORKDIR /app

# Install deps first for layer caching.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY prisma ./prisma
RUN npx prisma generate

COPY src ./src
COPY .env.example ./.env.example

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Apply pending migrations, then boot the API (no seed on boot; run manually).
CMD ["sh", "-c", "npx prisma migrate deploy && node src/server.js"]
