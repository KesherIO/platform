FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json patch-angular-build.js ./
COPY apps/api/package.json apps/api/package.json
COPY apps/api/prisma apps/api/prisma
COPY libs libs

RUN npm ci

COPY nx.json tsconfig.base.json ./
COPY apps/api apps/api

RUN npx nx build api --configuration=production

FROM node:22-alpine

WORKDIR /app

COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/node_modules ./node_modules

EXPOSE 3000

CMD ["node", "dist/main.js"]
