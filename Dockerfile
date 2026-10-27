# --- Build Stage ---
FROM node:18-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install all dependencies (including devDependencies needed for build)
RUN npm ci

# Copy the rest of the application files
COPY . .

# Build the production assets
RUN npm run build

# --- Production Stage ---
FROM node:18-alpine

WORKDIR /app

ENV NODE_ENV=production

# Copy built assets and necessary runtime files from builder stage
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/src ./src

# Install only production dependencies to keep the image lightweight
RUN npm ci --only=production

# Rammerhead typically listens on port 8080 by default
EXPOSE 8080

CMD ["node", "src/server.js"]




