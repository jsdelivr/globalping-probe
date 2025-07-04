FROM node:22.16.0-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json tsconfig.json /app/
RUN npm ci --include=dev
COPY src /app/src
COPY config /app/config
COPY @types /app/@types
RUN npm run build

FROM node:22.16.0-bookworm-slim

ARG node_env=production
ENV NODE_ENV=$node_env

WORKDIR /app

COPY --from=builder /app/package.json /app/package-lock.json /app/

RUN apt-get update -y && apt-get install --no-install-recommends -y expect ca-certificates iputils-ping traceroute dnsutils jq tini mtr-tiny curl \
    && apt-get clean && apt-get autoremove -y \
    && cd /app && npm install --omit=dev --omit=optional \
    && rm -rf /var/lib/apt /var/lib/dpkg /var/lib/cache /var/lib/log \
    && rm -rf /usr/share/icons /var/lib/X11 /var/lib/doc \
    && rm -rf /var/cache/apt /var/cache/debconf /var/cache/fontconfig /var/cache/ldconfig \
    && rm -rf /opt /root/.npm /usr/share/man /usr/lib/arm-linux-gnueabihf/perl-base /usr/include /usr/local/include /usr/local/lib/node_modules/npm/docs \
    && rm -rf /sbin/debugfs /sbin/e2fsck /sbin/ldconfig /usr/bin/perl*

COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/config /app/config
COPY bin/entrypoint.sh /entrypoint.sh

ENTRYPOINT ["/usr/bin/tini", "--"]

CMD ["/bin/bash", "/entrypoint.sh"]
