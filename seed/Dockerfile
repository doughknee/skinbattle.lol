# One-shot importer: seeds champions/skins from Riot Data Dragon, then exits.
FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

CMD ["node", "import.js"]
