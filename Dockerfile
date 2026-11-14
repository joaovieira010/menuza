FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 UPLOAD_DIR=/var/lib/menuza/uploads
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY backend/src ./backend/src
COPY frontend ./frontend
COPY scripts ./scripts
RUN mkdir -p /var/lib/menuza/uploads && chown -R node:node /var/lib/menuza
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","backend/src/server.js"]
