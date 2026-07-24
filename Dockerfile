# Builds the frontend, then runs the backend serving it as static files.
# One image, one process, one origin — which is what lets the frontend use
# relative /api paths and derive wss:// from the page URL with no
# build-time configuration.

FROM node:22-alpine AS frontend
WORKDIR /app/frontend
# Copy manifests first so the dependency layer is only rebuilt when the
# dependencies themselves change, not on every source edit.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app/backend

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

COPY backend/ ./
COPY --from=frontend /app/frontend/dist /app/frontend/dist

# Data lives outside the image so a redeploy doesn't wipe it. Mount a
# persistent volume here — without one the container filesystem is
# ephemeral and every gym you created disappears on the next deploy.
ENV DATA_PATH=/data/data.json
RUN mkdir -p /data && chown -R node:node /data
VOLUME /data

USER node
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
