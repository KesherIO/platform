FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY patch-angular-build.js ./
COPY apps/api/prisma/schema.prisma ./apps/api/prisma/schema.prisma
RUN npm ci

COPY . .
RUN npx nx build api --configuration=production

FROM node:22-alpine

WORKDIR /app

COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/node_modules ./node_modules

EXPOSE 3000

CMD ["node", "dist/main.js"]
