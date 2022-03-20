FROM node:16-bullseye-slim AS builder

WORKDIR /app

COPY src /app/src
COPY config /app/config
COPY @types /app/@types
COPY package.json package-lock.json tsconfig.json /app/

RUN npm install && npm run build

FROM node:16-bullseye-slim

ARG node_env=production
ENV NODE_ENV=$node_env

WORKDIR /build

RUN apt update && apt install -y iputils-ping traceroute \
    && apt clean && apt autoremove -y \
    && rm -rf /var/lib/{apt,dpkg,cache,log}/

COPY --from=builder /app/dist /build/dist
COPY --from=builder /app/config /build/config
COPY --from=builder /app/package.json /app/package-lock.json /build/

RUN npm install --production

CMD ["node", "./dist/index.js"]
