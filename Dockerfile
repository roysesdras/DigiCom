FROM node:20-alpine

# Install build tools and SSH/rsync for remote storage integration
RUN apk add --no-cache python3 make g++ openssh-client rsync

WORKDIR /app

# Copy server package definition and install dependencies
COPY server/package.json ./server/
WORKDIR /app/server
RUN npm install --production

# Copy application sources
WORKDIR /app
COPY server ./server
COPY public ./public
COPY widget ./widget

# Persistence volume mount point for SQLite database and keys
VOLUME ["/app/server/data"]

EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production

CMD ["node", "server/server.js"]
