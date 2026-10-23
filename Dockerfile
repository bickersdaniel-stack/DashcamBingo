FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
# Only what the server needs; .env stays out of the image and comes in through docker-compose
COPY server server
COPY docs docs
ENV NODE_ENV=production
USER node
CMD ["node", "server/index.js"]
