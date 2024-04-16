FROM node:18.19.1-bullseye-slim AS builder

WORKDIR /app

RUN npm install npm@10.5.2 -g
COPY package.json package-lock.json tsconfig.json /app/
RUN npm ci --include=dev
COPY src /app/src
COPY config /app/config
COPY @types /app/@types
RUN npm run build

FROM node:18.19.1-bullseye-slim

ARG node_env=production
ENV NODE_ENV=$node_env

WORKDIR /app

COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/config /app/config
COPY --from=builder /app/package.json /app/package-lock.json /app/
COPY bin/entrypoint.sh /entrypoint.sh

RUN apt-get update -y && apt-get install --no-install-recommends -y expect ca-certificates iputils-ping traceroute dnsutils jq tini mtr curl \
    && apt-get clean && apt-get autoremove -y \
    && rm -rf /var/lib/{apt,dpkg,cache,log}/* \
    && rm -rf /usr/share/{icons,X11,doc}/* \
    && rm -rf /var/cache/{apt,debconf,fontconfig,ldconfig}/* \
    && rm -rf /opt /root/.npm /usr/share/man /usr/lib/arm-linux-gnueabihf/perl-base /usr/include /usr/local/include /usr/local/lib/node_modules/npm/docs \
    && rm -rf /tmp/v8-compile-cache-0 /sbin/debugfs /sbin/e2fsck /sbin/ldconfig /usr/bin/perl* \
    && cd /app && npm install npm@10.5.2 -g && npm install --omit=dev --omit=optional

ENTRYPOINT ["/usr/bin/tini", "--"]

CMD ["/bin/bash", "/entrypoint.sh"]
