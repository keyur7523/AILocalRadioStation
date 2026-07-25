# AI Local Radio Station

A streaming server that sounds like a local music radio station — one shared live stream every listener hears at the same moment, with an AI "DJ" between songs.

> **This is a living document.** It will change as the project progresses.

📡 **[Live status page](https://keyur7523.github.io/AILocalRadioStation/)** · 🎧 **[Listen to the stream](https://ailocalradiostation-backend.onrender.com/stream)** · 🎛️ **[Station admin](https://ailocalradiostation-backend.onrender.com/admin)**

## Overview

Create a streaming server that loops music and feels like a real local radio station: songs with a DJ announcing the time between them (weather, news, and events to come). Anyone with the link tunes into the **same** live stream — like turning a radio dial, you join wherever the broadcast currently is.

## Features

**Shipped**

- 🔴 **One shared live stream** — every listener hears the same moment (a single real-time-paced producer, fanned out to all `/stream` connections).
- 🎙️ **AI DJ time-check after every song** — speaks the current local time, cleanly between songs (0.5s gap on each side, no talking over the music).
- 🧠 **Natural neural voice** — [Piper](https://github.com/OHF-Voice/piper1-gpl) by default in production (espeak-ng as a fallback).
- ⏱️ **Accurate time** — timezone-aware (DST correct) and **latency-compensated** so the spoken time matches your clock when you actually hear it.
- 🎛️ **Live admin panel** (`/admin`) — switch the station name / city / frequency / tagline and the DJ's timezone on the fly, no restart. Presets for the US time zones.
- 📊 **Comprehensive logging** — the full runtime (songs, DJ, cache, transitions, errors) is visible in the host logs; tune verbosity with `LOG_LEVELS`.
- 🟢 **Independent status page** — up/down monitoring hosted off-Render (GitHub Pages + Actions).

**Planned** — song name/artist announcements, weather & news at the top of the hour, local events, scheduled station-ID jingles, a now-playing feed, song requests.

## Architecture

The stack is **Next.js** (frontend) + **Nest.js** (backend), with **ffmpeg** as the audio engine.

```
media/*.mp3  +  DJ time-check clips (Piper / espeak TTS, cached)
      │
Sequencer (Nest)         picks the next item and paces the show:
      │                    song → gap → time-check → gap → song → …
      │  spawns a short-lived DECODER ffmpeg per item
      ▼  raw PCM piped in with { end: false }
Persistent ENCODER ffmpeg   -re paced (the single real-time pacer) →
      │                      one continuous MP3, framing never resets
      ▼
Broadcaster fan-out       one shared playhead → every /stream listener
      │
      ├── GET /stream    the live MP3 feed
      ├── GET /station   station identity + listener count (player polls this)
      └── GET /admin     admin panel  ·  GET/PUT /admin/config
      │
Next.js player + /admin   the "On Air" player and the station controls
      │
Listeners                 all hear the same moment
```

**The core idea:** one long-lived **encoder** ffmpeg reads raw PCM and emits a single continuous MP3; a **sequencer** feeds it one item at a time from short-lived per-item **decoder** ffmpegs. `-re` on the encoder makes it the sole real-time pacer, and pipe backpressure throttles the decoders — so there's no drift and swapping the PCM source (song ↔ time-check ↔ silence) is invisible to listeners. The DJ clip for each boundary is **synthesized ahead of time and cache-warmed per minute**, so the time-check plays after every song without a pause.

## Configuration

Station identity and DJ behavior are set via env (see [`backend/.env.example`](backend/.env.example)) and, for identity, can be changed **live** via the admin panel. The most useful knobs:

| Env var | Default | What it does |
|---|---|---|
| `STATION_NAME` / `STATION_CITY` / `STATION_FREQUENCY` | `KIND FM` / `Anytown` / `98.7` | On-air identity (also editable at `/admin`) |
| `STATION_TIMEZONE` | `America/New_York` | IANA zone the DJ announces the time in (also editable at `/admin`) |
| `DJ_ENABLED` | `true` | Master on/off for the DJ |
| `DJ_EVERY_N_SONGS` | `1` | Time-check after every N songs |
| `DJ_OVERLAP` | `false` | `false` = DJ speaks in the gap (tail stays clear); `true` = talk over the fading tail (ducked) |
| `DJ_GAP` | `0.5` | Seconds of silence between every item |
| `DJ_TIME_OFFSET_SEC` | `10` | Shift the announced time forward to cancel pipeline + player latency |
| `DJ_TTS_ENGINE` | `piper` (image) / `espeak` (local) | Voice engine |
| `LOG_LEVELS` | all | `error,warn,log,debug,verbose`; drop levels to quiet the logs |

### Admin panel

`GET /admin` serves a small web UI to set the station name/city/frequency/tagline and the DJ's timezone (with a US-timezone typeahead). It drives a JSON API you can also call directly:

```bash
# current identity
curl -s https://ailocalradiostation-backend.onrender.com/admin/config

# switch the timezone / name live
curl -X PUT https://ailocalradiostation-backend.onrender.com/admin/config \
  -H 'Content-Type: application/json' \
  -d '{"name":"Radio Chicago","city":"Chicago","timeZone":"America/Chicago"}'
```

Changes apply live: the player updates on its next poll (~8s) and the DJ's spoken time switches on the next time-check. The choice is persisted to a file (`STATION_STATE_FILE`) so it survives restarts.

> ⚠️ The admin endpoints are currently **unauthenticated**. Put them behind an auth guard before exposing the backend publicly.

## Tech stack

- **Frontend:** Next.js (App Router, React 19)
- **Backend:** Nest.js
- **Audio engine:** ffmpeg + ffprobe (must be installed and on `PATH`)
- **DJ voice:** Piper (neural, self-contained binary) — espeak-ng fallback

## Project structure

```
backend/    Nest.js broadcast server (sequencer/encoder engine, DJ + TTS,
  media/    fan-out, /stream · /station · /health · /admin)
  src/stream/  sequencer, broadcaster, dj/, tts/, station config + admin
frontend/   Next.js listener UI (the "On Air" player)
status/     Self-hosted status page (GitHub Actions checker + GitHub Pages)
```

## Running locally

Requires Node 20+ and `ffmpeg` (with `ffprobe`) on your `PATH`. For the DJ voice
locally, install `espeak-ng` (`brew install espeak-ng`) — Piper ships in the
Docker image but isn't required for local dev.

```bash
# 1. Backend (broadcast server) — http://localhost:3001
cd backend
npm install
npm run start:dev

# 2. Frontend (player) — http://localhost:3000
cd frontend
npm install
npm run dev
```

Open http://localhost:3000 and press play. The raw shareable stream is
http://localhost:3001/stream (drop it into any audio player); the admin panel is
http://localhost:3001/admin. Configure the station via `backend/.env` (see
`backend/.env.example`).

To use your own music, drop `.mp3` files into `backend/media/` (they play in
filename order) and restart the backend.

## Service status

Live status page: **https://keyur7523.github.io/AILocalRadioStation/**

An independent status page (hosted on **GitHub Pages**, checked by **GitHub
Actions** every ~10 min) that pings the public endpoints and reports the health
of the **Live Stream**, **Broadcast API**, and **Audio Engine**. It runs on
GitHub's infrastructure — not Render — so it stays up and reports the outage
even when the backend is down. The checker writes no commits (history persists
via its own last-published data), so it never triggers a Render redeploy. See
[`status/`](status/) for details.

## Status

**Live.** Shared MP3 stream + AI DJ time-check after every song (natural Piper
voice, back-to-back with clean gaps, timezone-aware and latency-compensated),
plus a live admin panel to switch station identity/timezone. Design notes for
the DJ engine are in [docs/phase-2-dj-timecheck.md](docs/phase-2-dj-timecheck.md).
Next up: song announcements, weather/news, scheduled jingles.
