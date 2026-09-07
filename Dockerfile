FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json server.mjs entrypoint.mjs ./
COPY public ./public
RUN mkdir -p /data && chown -R node:node /data /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
EXPOSE 3000
CMD ["node", "entrypoint.mjs"]
