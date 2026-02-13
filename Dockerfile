# Stage 1: Build
FROM node:20-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# Stage 2: Production
FROM node:20-slim
WORKDIR /app

# Install git and curl
RUN apt-get update && apt-get install -y git curl && rm -rf /var/lib/apt/lists/*

# Install pi agent
RUN npm install -g @mariozechner/pi-coding-agent

# Install awt
RUN curl -fsSL --retry 3 --retry-delay 5 -o /tmp/awt.tar.gz \
    https://github.com/Kernel-Labs-AI/awt/releases/download/v0.1.6/awt_0.1.6_Linux_x86_64.tar.gz \
    && tar -xzf /tmp/awt.tar.gz -C /usr/local/bin awt \
    && rm /tmp/awt.tar.gz

COPY package.json package-lock.json ./
RUN npm ci --production

COPY --from=builder /app/dist ./dist

# Create data directory for SQLite and repo
RUN mkdir -p /data

# Copy entrypoint
COPY start.sh ./
RUN chmod +x start.sh

ENV NODE_ENV=production
EXPOSE 3000

CMD ["./start.sh"]
