FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .
VOLUME ["/app/state"]
ENTRYPOINT ["node", "detector/index.mjs", "--state", "/app/state/detector.json"]
CMD ["--help"]
