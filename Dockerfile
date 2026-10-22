FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
COPY db ./db
COPY docs ./docs
COPY scripts ./scripts
COPY render.yaml ./render.yaml
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV PORT=4242
ENV SITEPIX_DATA_DIR=/app/data
EXPOSE 4242
CMD ["node", "server.js"]
