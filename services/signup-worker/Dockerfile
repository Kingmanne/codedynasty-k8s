# Small official Node.js image (Node 22 LTS, Alpine Linux)
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# Install dependencies first, so this layer is cached when only code changes
COPY package*.json ./
# npm ci needs package-lock.json (run `npm install` once to create it)
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi \
    && npm cache clean --force

# Then copy the code
COPY src ./src

# Run as the image's built-in non-root user
USER node

EXPOSE 8080
CMD ["node", "src/index.js"]
