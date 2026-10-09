FROM node:20-slim

WORKDIR /app

# Install openssl needed by Prisma on Debian
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Copy dependency manifests and Prisma schema first (for optimal Docker layer caching)
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies and generate Prisma client
RUN npm install
RUN npx prisma generate

# Copy source code and build config
COPY tsconfig.json ./
COPY server.ts ./
COPY prisma.config.ts ./
COPY src ./src/

# Compile TypeScript to dist/
RUN npm run build

# Set production environment
ENV NODE_ENV=production
ENV PORT=5002

EXPOSE 5002

CMD ["node", "dist/server.js"]
