# Broadcast server: Node + a real ffmpeg (the audio engine).
FROM node:22-slim

# ffmpeg is the audio engine — install the full system binary.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first for better layer caching.
COPY package*.json ./
RUN npm ci

# Build the Nest app.
COPY . .
RUN npm run build

# Render provides PORT at runtime; the app reads it (defaults to 3001 locally).
ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "dist/main"]
