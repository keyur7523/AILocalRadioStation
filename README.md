# AI Local Radio Station

A streaming server that sounds like a local music radio station — one shared live stream every listener hears at the same moment, with an AI "DJ" between songs.

> **This is a living document.** It will change as the project progresses.

📡 **[Live status page](https://keyur7523.github.io/AILocalRadioStation/)** · 🎧 **[Listen to the stream](https://ailocalradiostation-backend.onrender.com/stream)**

## Overview

Create a streaming server that loops music and feels like a real local radio station: songs back-to-back with a DJ announcing tracks, giving time checks, and reading local weather and news. Anyone with the link tunes into the **same** live stream — like turning a radio dial, you join wherever the broadcast currently is.

## Features

- DJ announces the name and artist of the song that's playing
- DJ occasionally gives a time check (says the current time)
- DJ occasionally reads a short weather forecast (current day and evening)
- DJ reads local news headlines at the top of the hour
- DJ briefly promotes local events
- Station ID jingle at the top and bottom of the hour

## Architecture

The stack is **Next.js** (frontend) + **Nest.js** (backend), with **ffmpeg** as the audio engine.

```
Content sources      songs · DJ voice clips · jingles
       |
Playlist + scheduler (Nest)   decides what plays next, and when
       |
ffmpeg audio engine           concatenates files into one real-time MP3 stream
       |
Nest broadcaster (fan-out)    one shared playhead for everyone
       |                \
  MP3 /stream            SSE /now-playing (live metadata)
       |                /
Next.js player          audio element + now-playing panel
       |
Listeners               all hear the same moment
```

**The core idea:** a single producer process (ffmpeg, paced at real time) generates one continuous audio stream. Each listener subscribes to that live feed mid-stream via `GET /stream`, so everyone stays in sync. The Next.js UI shows the current song via Server-Sent Events.

## Backend configuration

Each station is defined by:

- **Location (city)** — drives weather, news, and local events
- **Music catalog** — the songs available to play
- **Station identity** — name, persona, and jingles

## Implementation phases

### Phase I — ✅ done
Set up a streaming server that loops 3 mp3 files over and over. Distribute a link anyone can click to play the stream — all listeners hear the same stream.

Implemented: a Nest backend spawns one ffmpeg process that loops the media folder at real-time pace and fans the bytes out to every listener on `GET /stream` (one shared playhead). A Next.js player tunes into that stream. See **Running locally** below.

### Phase II — ✅ done
1. ✅ Create shorter clips to speed up testing (~20 seconds total)
2. ✅ Have the DJ say the current time at the end of each song
3. ✅ Have the DJ say the current time over the tail of the song as it finishes (audio mixing, not just back-to-back playback)

Implemented: the engine is now a **sequencer** — one persistent ffmpeg encoder
plus a short-lived decoder per item — that plays song → spoken time-check on the
shared stream. By default the DJ **talks over the song's fading tail** with
sidechain ducking (`DJ_OVERLAP=true`); set `DJ_OVERLAP=false` for back-to-back.
Speech is text-to-speech (default `espeak-ng`, swappable to Piper via
`DJ_TTS_ENGINE`); the time is spoken in `STATION_TIMEZONE`. Toggle with
`DJ_ENABLED`, cadence via `DJ_EVERY_N_SONGS`. Design details in
[docs/phase-2-dj-timecheck.md](docs/phase-2-dj-timecheck.md).

### Later phases
To be defined — weather/news/events, scheduled jingles, song requests, social posting.

## Open questions

- **What music will be played, and where will it come from?** For development: royalty-free / Creative Commons tracks or local files. Anything public-facing carries music licensing obligations.

## Possible future features

- Dedicated phone app per station (with customized branding)
- Social media integration — post the song that's playing; accept song requests (maybe a poll)
- Play music from local musicians
- Play locally produced shows

## Tech stack

- **Frontend:** Next.js (App Router, React 19)
- **Backend:** Nest.js
- **Audio engine:** ffmpeg (must be installed and on `PATH`)
- **Live metadata:** Server-Sent Events (SSE) — planned for the now-playing feed

## Project structure

```
backend/    Nest.js broadcast server (ffmpeg fan-out, /stream, /station, /health)
  media/    .mp3 rotation (short test clips for now)
frontend/   Next.js listener UI (the "On Air" player)
status/     Self-hosted status page (GitHub Actions checker + GitHub Pages)
```

## Running locally

Requires Node 20+ and `ffmpeg` on your `PATH`.

```bash
# 1. Backend (broadcast server) — http://localhost:3001
cd backend
npm install
npm run start:dev        # streams the 3 mp3s in backend/media on a loop

# 2. Frontend (player) — http://localhost:3000
cd frontend
npm install
npm run dev
```

Open http://localhost:3000 and press play. The raw shareable stream is
http://localhost:3001/stream (drop it into any audio player). Configure the
station identity and ports via `backend/.env` (see `backend/.env.example`).

To use your own music, drop `.mp3` files into `backend/media/` (they play in
filename order) and restart the backend.

## Service status

Live status page: **https://keyur7523.github.io/AILocalRadioStation/**

It's an independent status page (hosted on **GitHub Pages**, checked by **GitHub
Actions** every ~10 min) that pings the public endpoints and reports the health
of the **Live Stream**, **Broadcast API**, and **Audio Engine**. It runs on
GitHub's infrastructure — not Render — so it stays up and reports the outage
even when the backend is down. The checker writes no commits (history persists
via its own last-published data), so it never triggers a Render redeploy. See
[`status/`](status/) for details.

## Status

**Phase II complete** — the DJ speaks the current time over each song's fading
tail (sequencer engine + TTS + sidechain ducking) on the shared stream. Next up:
later phases — song announcements, weather/news, scheduled jingles.
