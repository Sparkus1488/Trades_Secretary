FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY package.json server.js ./
COPY index.html ./public/index.html
COPY schema.sql ./schema.sql

RUN mkdir -p /app/data /app/public && chown -R node:node /app
USER node

ENV PORT=4242
ENV SITEPIX_DATA_DIR=/var/data
EXPOSE 4242
CMD ["node", "server.js"]
