FROM node:22-alpine

WORKDIR /app

# Dependencies are installed from the lockfile so every build resolves the same versions.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

USER node

CMD ["node", "src/index.js"]
