FROM node:16-alpine AS builder

WORKDIR /app

COPY src /app/src
COPY config /app/config
COPY package.json package-lock.json tsconfig.json /app/

RUN npm install && npm run build

FROM node:16-alpine

ARG node_env=production
ENV NODE_ENV=$node_env

WORKDIR /build

RUN apk --no-cache add iputils util-linux

COPY --from=builder /app/dist /build/dist
COPY --from=builder /app/config /build/config
COPY --from=builder /app/package.json /app/package-lock.json /build/

RUN npm install --production

CMD ["node", "./dist/index.js"]
