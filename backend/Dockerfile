# Broadcast server: Node + a real ffmpeg (the audio engine).
FROM node:22-slim

# System audio tools:
#   ffmpeg    — the broadcast audio engine (encoder + per-item decoders)
#   espeak-ng — the default DJ text-to-speech voice (Phase II)
# To use Piper instead (DJ_TTS_ENGINE=piper), also install the piper binary and
# COPY a voice model into /app/voices, then set DJ_VOICE_MODEL.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg espeak-ng \
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
