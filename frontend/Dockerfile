# Two stages: build the React app with Node, then serve the static files with nginx.
# Only the second stage ends up in the final image, so it contains no Node.js or source code.

# --- Stage 1: build ------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# The API lives on the same website under /api (see k8s/ingress.yaml).
# Vite bakes this into the JavaScript at build time.
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# --- Stage 2: serve ------------------------------------------------------------
# The unprivileged nginx image runs as a non-root user on port 8080
FROM nginxinc/nginx-unprivileged:stable-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080
