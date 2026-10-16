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

# Run migrations, create admin (requires ADMIN_PASSWORD env), then start the server
CMD ["sh", "-c", "npx prisma migrate deploy && npm run admin:create && npm start"]
