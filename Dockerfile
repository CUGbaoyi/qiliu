# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --registry=https://registry.npmjs.org
COPY src ./src
COPY server ./server
COPY public ./public
COPY index.html vite.config.mjs ./
RUN npx vite build && find dist/client/art -name '*.png' -delete
RUN npm prune --omit=dev
FROM node:22-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4173 QILIU_DEPLOYMENT=nas QILIU_DATA_DIR=/data
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist/client ./dist/client
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/package.json ./package.json
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:4173/api/auth').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","server/index.mjs"]
