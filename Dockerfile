FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN npx prisma generate --schema=schema.prisma && mkdir -p /public && cp index.html /public/index.html
EXPOSE 3000
CMD ["sh", "-c", "npx prisma db push --schema=schema.prisma && node create-admin.js && node server.js"]
