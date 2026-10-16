FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev
COPY prisma ./prisma
RUN npx prisma generate
COPY src ./src
COPY public ./public
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && npm run admin:create && node src/server.js"]
