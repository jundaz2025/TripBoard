# Build static browser assets with Node, then serve them from a separate Nginx runtime image.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# npm ci installs the versions recorded in package-lock.json for repeatable frontend builds.
RUN npm ci
COPY . .
# Vite embeds public VITE_ settings here; changing them later requires a new build.
RUN npm run build
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
