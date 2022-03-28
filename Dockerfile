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

RUN apt update && apt install -y iputils-ping traceroute dnsutils curl jq tini \
    && apt clean && apt autoremove -y \
    && rm -rf /var/lib/{apt,dpkg,cache,log}/

WORKDIR /app
COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/config /app/config
COPY --from=builder /app/package.json /app/package-lock.json /app/
COPY bin/entrypoint.sh /entrypoint.sh

RUN npm install --production

ENTRYPOINT ["/usr/bin/tini", "--"]

CMD ["/entrypoint.sh"]
