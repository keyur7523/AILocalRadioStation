# Continue here — session handoff

Quick catch-up for picking work back up (e.g. after moving the repo or in a new
Claude Code session). Everything below is already committed to `main`.

## ⚠️ First: move this repo out of iCloud

This project currently lives under `~/Desktop`, which macOS **syncs to iCloud**.
iCloud offloading/re-downloading the huge `node_modules` tree causes
`ETIMEDOUT` read errors that make `npm run build`, `npm test`, and running the
server **hang or fail intermittently**. It is the root cause of all the "flaky
build" pain — not the code.

**Fix (run in Terminal):**
```bash
rm -rf ~/Desktop/projects/AILocalRadioStation/backend/node_modules \
       ~/Desktop/projects/AILocalRadioStation/frontend/node_modules
mv ~/Desktop/projects/AILocalRadioStation ~/projects/
cd ~/projects/AILocalRadioStation/backend && npm install && npm run build
```
`~/projects` is not iCloud-synced (only Desktop, Documents, and iCloud Drive
are). After this, builds/tests/run work normally. GitHub is the backup, so
nothing is lost by leaving iCloud.

## Where the project is

- **Phase I ✅** — shared live MP3 stream (Nest + ffmpeg fan-out) + Next.js
  player + Render deploy + independent status page (GitHub Pages).
- **Phase II ✅ (complete)** — the DJ speaks the current time, talking **over the
  song's fading tail** with sidechain ducking (`DJ_OVERLAP=true`; set false for
  back-to-back). Done and fully verified (build + unit tests + live capture).

## Phase II.2 — what was built

Engine changed from "one ffmpeg looping a static playlist" to a **sequencer**:
- `backend/src/stream/dj/sequencer.service.ts` — one persistent encoder ffmpeg
  (raw PCM stdin → continuous MP3) + a short-lived decoder ffmpeg per item;
  plays song → DJ clip → song. The broadcaster (`broadcaster.service.ts`) is now
  just the listener fan-out + `/station` facade.
- `backend/src/stream/dj/dj.service.ts` — `nextInterstitial()`: builds the time
  phrase, calls TTS, timeout + **soft-fail** (never stalls music).
- `backend/src/stream/dj/time-announcer.ts` (+ `.spec.ts`) — pure
  `formatTimePhrase` / `minuteKey` via `Intl` (DST-aware). 5 tests, all pass.
- `backend/src/stream/tts/` — pluggable `TtsService`: `espeak-tts` (default) and
  `piper-tts`, chosen by `DJ_TTS_ENGINE` (`tts.provider.ts`). Content-addressed
  clip cache keyed by minute.
- Config: `STATION_TIMEZONE`, `DJ_ENABLED`, `DJ_EVERY_N_SONGS`, `DJ_TTS_ENGINE`,
  `DJ_VOICE_MODEL`, `DJ_CACHE_DIR` (see `backend/.env.example`, `render.yaml`).
- `backend/Dockerfile` installs `espeak-ng`.

## Locked decisions

- **Scope:** back-to-back time-check only (II.2). Ducking (II.3) is out of scope
  here but the architecture leaves room (two decoders → `amix`/sidechain → same
  encoder). See PRD §13.
- **TTS:** `espeak-ng` is the default (guaranteed to fit Render free tier);
  Piper is available via `DJ_TTS_ENGINE=piper` (needs a voice model provisioned
  in the image). One-line swap, no code change.

## How to verify locally

```bash
cd backend
npm run build          # typecheck (nest build) — passes
npm test               # unit tests — 5/5 pass
# live check:
DJ_ENABLED=true DJ_EVERY_N_SONGS=1 STATION_TIMEZONE=America/New_York npm run start:dev
curl -s --max-time 30 http://localhost:3001/stream -o /tmp/live.mp3   # play it
```
Expect logs: `▶ <song>` then `🎙 DJ: "The time is H:MM AM/PM"`, cycling.
Needs `espeak-ng` on PATH locally (`brew install espeak-ng`); it's in the Docker
image already.

## Deploy note

Backend is Docker on Render (single instance — shared playhead). Pushing to
`main` triggers a rebuild; the new image installs `espeak-ng`. Set
`STATION_TIMEZONE` on the backend service to the station's real zone.

## Next task

Phase II is done. Later phases (not yet started): song name/artist
announcements, weather/news at the top of the hour, scheduled station-ID
jingles. All slot into `DjService` as new interstitial types on the existing
sequencer — see `docs/phase-2-dj-timecheck.md` §13 "Future work".
