# Build context is the generated standalone package, never the BCR repository.
FROM oven/bun:1.3.14-debian
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libnss3 libdbus-1-3 libatk1.0-0 libgbm1 libasound2 \
    libxrandr2 libxkbcommon0 libxfixes3 libxcomposite1 libxdamage1 \
    libatk-bridge2.0-0 libpango-1.0-0 libcairo2 libcups2 fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/bcr-runner
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts
COPY dist ./dist
COPY release.json ./
COPY example ./example
RUN mkdir -p /data/state /data/config /data/cache /works && chown -R bun:bun /data /works
ENV XDG_CONFIG_HOME=/data/config XDG_DATA_HOME=/data/state XDG_CACHE_HOME=/data/cache BUN_INSTALL_CACHE_DIR=/data/cache/bun
USER bun
EXPOSE 5210 5211
ENTRYPOINT ["bun", "/opt/bcr-runner/dist/cli.js"]
CMD ["serve", "--root", "/works", "--state", "/data/state/runner", "--host", "0.0.0.0", "--port", "5210", "--preview-port", "5211", "--api-url", "http://127.0.0.1:5210", "--preview-url", "http://127.0.0.1:5211"]
