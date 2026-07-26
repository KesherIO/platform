FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY patch-angular-build.js ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/api/prisma/schema.prisma ./apps/api/prisma/schema.prisma
COPY libs/shared-types/package.json ./libs/shared-types/package.json

# Stub package.json for dockerignored workspaces so npm workspaces resolves
RUN mkdir -p apps/api-e2e apps/lab apps/lab-e2e \
 && echo '{"name":"@org/api-e2e","private":true}' > apps/api-e2e/package.json \
 && echo '{"name":"@vet-ai/lab","private":true}' > apps/lab/package.json \
 && echo '{"name":"@vet-ai/lab-e2e","private":true}' > apps/lab-e2e/package.json

RUN npm ci

COPY . .
RUN npx nx sync
RUN npx nx build api --configuration=production

FROM node:22-alpine

WORKDIR /app

COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/libs/shared-types/dist ./node_modules/@vet-ai/shared-types/dist
COPY --from=build /app/libs/shared-types/package.json ./node_modules/@vet-ai/shared-types/package.json

EXPOSE 3000

CMD ["node", "dist/main.js"]
