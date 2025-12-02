FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
  && npm cache clean --force \
  && chown -R node:node /app

COPY --chown=node:node GitWakaBot.js ./

USER node

CMD ["node", "GitWakaBot.js"]
