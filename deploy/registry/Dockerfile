FROM node:24.6.0-alpine3.22

ARG AIBA_VERSION=latest
RUN npm install --global "@grubbylee/aiba@${AIBA_VERSION}" \
    && npm cache clean --force \
    && addgroup -S aiba \
    && adduser -S -G aiba -h /home/aiba aiba

USER aiba
WORKDIR /home/aiba
EXPOSE 7331

ENTRYPOINT ["aiba", "registry-serve", "/registry"]
CMD ["--host", "0.0.0.0", "--port", "7331", "--registry-trust", "/config/registry-trust.json", "--publisher-trust", "/config/publisher-trust.json", "--tls-cert", "/tls/tls.crt", "--tls-key", "/tls/tls.key", "--request-limit", "600", "--json"]
