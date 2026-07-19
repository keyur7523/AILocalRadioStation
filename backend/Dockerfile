# Broadcast server: Node + a real ffmpeg (the audio engine).
FROM node:22-slim

# System audio + TTS tooling:
#   ffmpeg    — the broadcast audio engine (encoder + per-item decoders)
#   espeak-ng — fallback DJ voice (DJ_TTS_ENGINE=espeak); robotic, tiny
#   curl      — fetch the Piper binary + voice model at build time
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg espeak-ng curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Piper — the neural (natural-sounding) DJ voice. The standalone release is fully
# self-contained (bundles its own espeak-ng-data + onnxruntime), so no Python
# toolchain is needed. A medium en_US voice model is baked into the image.
RUN curl -fsSL https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz \
      | tar -xz -C /opt \
  && mkdir -p /app/voices \
  && curl -fsSL "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx?download=true" \
      -o /app/voices/en_US-lessac-medium.onnx \
  && curl -fsSL "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json?download=true" \
      -o /app/voices/en_US-lessac-medium.onnx.json

# Use the neural Piper voice by default; espeak-ng stays as the fallback engine.
# Baked as image ENV so it applies on deploy without needing dashboard/env changes.
ENV DJ_TTS_ENGINE=piper \
    PIPER_PATH=/opt/piper/piper \
    DJ_VOICE_MODEL=/app/voices/en_US-lessac-medium.onnx

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
