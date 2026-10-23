# ---- build: compile TypeScript ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- runtime: only what the running service needs ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# Migrations run on startup (tables + predefined plans)
COPY src/db/migrations ./src/db/migrations
EXPOSE 8080
USER node
CMD ["node", "dist/index.js"]