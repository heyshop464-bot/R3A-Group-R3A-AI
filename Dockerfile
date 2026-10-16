FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# Install dependencies first (cacheable)
COPY package*.json ./
RUN npm install --omit=dev

# Copy prisma schema and generate client
COPY prisma ./prisma
COPY schema.prisma ./schema.prisma

# Copy application files
COPY . .

# Generate Prisma client
RUN npx prisma generate

EXPOSE 3000

# Run migrations (deploy). If migrate fails (no migrations yet), fall back to prisma db push.
# Then create admin (if ADMIN_PASSWORD set) and start the server.
CMD ["sh", "-c", "npx prisma migrate deploy || npx prisma db push --accept-data-loss && npm run admin:create || true && npm start"]
