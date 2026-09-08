FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json server.mjs entrypoint.mjs static-files.mjs demo-router.mjs ./
COPY scripts/build-pages.mjs scripts/page-shell.html ./scripts/
COPY public ./public
RUN tar -xzf public/assets/mobile-v1.tar.gz -C public/assets && rm public/assets/mobile-v1.tar.gz && node scripts/build-pages.mjs
RUN mkdir -p /data && chown -R node:node /data /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
EXPOSE 3000
CMD ["node", "entrypoint.mjs"]
