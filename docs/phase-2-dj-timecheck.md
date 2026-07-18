# PRD — Phase II: DJ Time-Check

**Status:** Draft · **Phase:** II.2 (of the Radio Station Stream Project) ·
**Owner:** keyur7523 · **Component:** backend broadcast engine

---

## 1. Summary

Give the station an AI DJ that **speaks the current time after each song**
("The time is 3:42 PM"), blended seamlessly into the single live stream every
listener already shares. This is the first DJ capability and the foundation for
every later DJ feature (song announcements, weather, news, jingles). It requires
evolving the audio engine from a static looping playlist into a **sequencer**
that plays items one at a time and injects freshly-generated speech between them.

**In scope:** DJ speaks the time **back-to-back** (after a song fully ends).
**Out of scope (this phase):** DJ talking *over* the tail of a song (audio
ducking/mixing — Phase II.3).

---

## 2. Background & problem statement

### 2.1 What exists today (Phase I)
The backend (`backend/src/stream/broadcaster.service.ts`) runs **one** long-lived
ffmpeg process that concatenates the media folder and loops it forever:

```
ffmpeg -re -stream_loop -1 -f concat -safe 0 -i playlist.txt \
       -vn -c:a libmp3lame -b:a 128k -ar 44100 -f mp3 pipe:1
```

Its stdout is a single continuous MP3 stream. Every listener that hits
`GET /stream` is `.write()`-fanned the same bytes (`broadcast()` over a
`Set<Listener>`). Because `-re` paces the encode at real time, all listeners
hear the **same moment** — the "shared playhead" that makes it feel like radio.

### 2.2 Why the current design can't do a time-check
The playlist is **static** and looped with `-stream_loop -1`. A DJ time
announcement is **dynamic** — "3:42 PM" is only valid for 60 seconds and must be
regenerated each time it plays. You cannot bake a changing clip into a fixed,
infinitely-looping file list. The engine must therefore be able to:

1. Decide the **next item** at runtime (song, or a just-generated DJ clip).
2. Generate the DJ clip **on demand** immediately before it plays.
3. Do both **without** resetting the continuous MP3 stream, or the shared
   playhead and mid-song joining break.

---

## 3. Goals & non-goals

### Goals
- G1. After each song, the DJ speaks the current local time, then the next song
  plays. Continuously, on the shared live stream.
- G2. The spoken time is **correct for the station's configured timezone**
  (DST-aware).
- G3. No regression to Phase I: one continuous stream, shared playhead, mid-join
  works, `/station` + `/health` unchanged, frontend untouched.
- G4. The DJ is **configurable**: on/off, and cadence (after every song vs every
  N songs).
- G5. The speech engine is **pluggable** — swapping espeak-ng ↔ Piper ↔ cloud is
  a one-line change, no engine details leak into the sequencer.
- G6. **Resilient**: a failed TTS or a crashed decoder never takes the music off
  the air.

### Non-goals (this phase)
- N1. DJ talking over the song's fading tail (ducking/mixing) — Phase II.3.
- N2. Song name/artist announcements, weather, news, jingles — later phases
  (the architecture is built to accommodate them).
- N3. Any frontend/UI change (a "now playing" field may be exposed on the API but
  no UI is built; Next.js has breaking-change caveats noted in `frontend/AGENTS.md`).
- N4. Persisting the DJ clip cache across deploys.

---

## 4. Requirements

### 4.1 Functional
- FR1. On stream start, play songs from `MEDIA_DIR` in filename order, cycling.
- FR2. After each song (when `DJ_ENABLED=true` and cadence is due), synthesize
  and play a spoken current-time clip, then continue with the next song.
- FR3. The time phrase is `"The time is <h>:<mm> <AM/PM>."` formatted in
  `STATION_TIMEZONE`.
- FR4. The DJ clip is generated **at play time** (current minute), not precomputed.
- FR5. `DJ_ENABLED=false` → songs-only, identical to Phase I behavior.
- FR6. `DJ_EVERY_N_SONGS=n` → the DJ speaks once every `n` songs.
- FR7. If TTS fails or times out, skip the clip and continue music (soft-fail).

### 4.2 Non-functional
- NFR1. **Continuity:** transitions between items introduce no audible glitch and
  no MP3 stream reset (mid-join listeners keep playing).
- NFR2. **Shared playhead:** two listeners connected at the same time hear the
  same moment (±network buffer).
- NFR3. **Resource fit:** runs within Render free tier (~512MB RAM, ~0.1 shared
  CPU, single instance).
- NFR4. **Latency hiding:** TTS synthesis completes before the clip is needed
  (generated during the preceding song's ~5s of playout, or cached).
- NFR5. **Isolation:** a decoder/TTS failure is contained to that item.

---

## 5. Technical design

### 5.1 Architecture — persistent encoder + per-item decoder sequencer

Replace the single looping ffmpeg with **two roles**:

```
                    ┌───────────────────────────────────────────┐
   media/*.mp3 ─┐   │  SEQUENCER (Nest service)                 │
   DJ clip .wav ─┼──▶│  picks next item, spawns a DECODER ffmpeg │
                 │   │  per item, pipes its PCM →────────────┐   │
                 │   └───────────────────────────────────────┼───┘
                 │                                            │  raw PCM (s16le)
                 │                                            ▼  { end: false }
                 │            ┌──────────────────────────────────────┐
                 │            │  ENCODER ffmpeg (one, long-lived)     │
                 │            │  PCM stdin → continuous MP3 stdout    │
                 │            └───────────────────┬──────────────────┘
                 │                                │ MP3 chunks
                 │                                ▼
                 │            ┌──────────────────────────────────────┐
                 └───────────▶│  BroadcasterService.broadcast()       │
                              │  fan-out to every /stream listener    │  ← unchanged
                              └──────────────────────────────────────┘
```

- **Encoder (one, for process lifetime):** reads raw PCM from stdin, emits one
  continuous MP3. Because it never restarts between items, the MP3 framing never
  resets — the fan-out and shared playhead are **byte-for-byte the same design**
  as Phase I.
- **Decoder (one per item, short-lived):** decodes a song or DJ clip to raw PCM
  and pipes it into the encoder's stdin. When it finishes, the sequencer starts
  the next item's decoder.
- **Sequencer:** the brain that orders items (song → DJ → song → …) and owns
  lifecycle/error handling.

**Why this design (vs alternatives):**

| Approach | Verdict |
|---|---|
| Regenerate concat file + restart the looping ffmpeg each rotation | ❌ Restart resets the MP3 stream → every listener hiccups each cycle |
| Named-pipe/FIFO dynamic concat | ❌ Fragile, poor per-item error isolation |
| Pre-concat DJ clip onto each song file | ❌ Still can't hold a *current* time; doubles encode work |
| **Persistent encoder + per-item decoder (chosen)** | ✅ No listener-visible resets, clean injection point, per-item isolation, leaves room for II.3 ducking |

**Validated during planning:** piping one ffmpeg's decoded PCM into a second
persistent encoder ffmpeg produced a valid continuous MP3 on the target ffmpeg
(7.1). The architecture is proven at the ffmpeg level (see Appendix A).

### 5.2 The PCM contract (critical invariant)

The encoder and **every** decoder must agree on exactly one raw-audio format:

```
format = s16le    sampleRate = STREAM_SAMPLE_RATE (44100)    channels = 2
```

Every decoder must **force** `-ar <SR> -ac 2` on its *output*, so a mono TTS clip
(espeak/Piper emit ~22.05kHz mono) or an odd-rate song is normalized. Mismatch =
chipmunk/slow-motion audio. This is captured as a single shared constant
(`pcm.const.ts`) imported by encoder and decoders so they can never drift.

### 5.3 Exact ffmpeg commands

**Encoder (spawned once):**
```
ffmpeg -hide_banner -loglevel error \
  -f s16le -ar 44100 -ac 2 -i pipe:0 \
  -c:a libmp3lame -b:a 128k \
  -f mp3 pipe:1
```
- No `-re` — it drains PCM as fast as it arrives.
- `stdio: ['pipe','pipe','pipe']` (stdin is now a pipe, unlike Phase I's `ignore`).

**Decoder (spawned per item):**
```
ffmpeg -hide_banner -loglevel error \
  -re -i <itemPath> \
  -vn -f s16le -ar 44100 -ac 2 pipe:1
```
- `-re` on the **input** is the sole real-time pacer (the shared playhead).
- Output format forced to the PCM contract.

**Node wiring (the load-bearing detail):**
```ts
decoder.stdout.pipe(encoder.stdin, { end: false });
```
`{ end: false }` is mandatory — the default `{ end: true }` would close the
encoder's stdin when the first song ends and kill the entire broadcast.

### 5.4 Component / file breakdown

New folder `backend/src/stream/dj/` and `backend/src/stream/tts/`:

| File | Responsibility |
|---|---|
| `dj/sequencer.service.ts` | **New engine core.** Owns the persistent encoder, the item loop, decoder spawn/advance, error isolation, encoder restart. Most of today's process logic moves here. |
| `dj/dj.service.ts` | DJ **policy**. `nextInterstitial(): Promise<string \| null>` → returns a ready clip path or `null` (disabled/failed → skip). Calls the time-announcer + TTS. |
| `dj/time-announcer.ts` | Pure functions: `formatTimePhrase(now, tz)`, `minuteKey(now, tz)`. No I/O — unit-testable. |
| `dj/pcm.const.ts` | The shared PCM contract constant. |
| `tts/tts.interface.ts` | `TtsService { synthesize(text): Promise<string> }` + DI token `TTS_SERVICE`. |
| `tts/espeak-tts.service.ts` and/or `tts/piper-tts.service.ts` | Concrete engine(s) (see §6). |

Modified:

| File | Change |
|---|---|
| `stream.config.ts` | Add `station.timeZone` + a `dj{}` config block; reuse `bitrate`/`sampleRate`. |
| `broadcaster.service.ts` | Becomes the **fan-out + public-API facade only**. Keeps `listeners`, `addListener`, `removeListener`, `broadcast`, `getStationInfo`, lifecycle hooks (identical signatures → **zero controller changes**). `resolvePlaylist()` moves to the sequencer; `writeConcatFile()` is deleted. Delegates audio to the sequencer via an `onChunk` callback. |
| `stream.module.ts` | Register `SequencerService`, `DjService`, and `{ provide: TTS_SERVICE, useClass: <engine> }`. |
| `backend/Dockerfile` | Install the chosen TTS engine (see §6). |
| `backend/.env.example`, `render.yaml` | Document/set new env vars. |

### 5.5 Sequencer control flow

State: `encoder?`, `decoder?`, `songs[]`, `songIndex`, `songsSinceDj`,
`pendingDj`, `stopping`, `restartTimer`, `onChunk`.

**start()**
1. Guard `stopping`.
2. `songs = resolvePlaylist()` (on throw → log + `scheduleRestart()`).
3. Spawn encoder; wire `encoder.stdout.on('data', onChunk)`; on encoder `close`
   (not stopping) → kill decoder + `scheduleRestart()` (restart whole chain).
4. `void playNext()` (async; must not block `onModuleInit`).

**playNext()** — one item per call:
1. Guard `stopping` / `!encoder`.
2. Choose next item (state machine):
   ```
   if pendingDj:        pendingDj = false;              return {type:'dj'}
   path = songs[songIndex]; songIndex = (songIndex+1) % songs.length
   songsSinceDj++
   if dj.enabled && songsSinceDj >= everyN: pendingDj = true; songsSinceDj = 0
   return {type:'song', path}
   ```
3. If `dj`: `clip = await dj.nextInterstitial()`; if `null` → recurse to next song.
4. Spawn decoder for the item; `decoder.stdout.pipe(encoder.stdin, {end:false})`.
5. On decoder `close`/`error` → `advance()` (guarded to run **once** per decoder;
   `setImmediate(() => playNext())` to avoid deep recursion).

**Lifecycle & resilience**
- Decoder crash → log, advance (music continues).
- Encoder crash → kill decoder, `scheduleRestart()` after `restartDelayMs`
  (reuses the existing Phase I restart pattern; shared playhead resets, same as
  any Phase I restart).
- TTS failure → soft-fail (`null`) → skip clip.
- **Teardown** (`onModuleDestroy`): set `stopping` first, clear timer, kill
  decoder (SIGKILL), `encoder.stdin.end()` + `encoder.kill('SIGTERM')`.

### 5.6 Time formatting

```ts
export function formatTimePhrase(now: Date, timeZone: string): string {
  const t = new Intl.DateTimeFormat('en-US', {
    timeZone, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(now);                       // "3:42 PM"
  return `The time is ${t}.`;
}
```
`Intl.DateTimeFormat` with `timeZone` is built into Node 22 (full ICU) and is
DST-correct. `minuteKey` uses the same format string as the TTS cache key so a
clip is synthesized at most once per minute.

---

## 6. TTS subsystem (engine decision)

The DJ clip is text-to-speech of a short phrase. The engine sits behind
`TtsService.synthesize(text): Promise<string>` (returns a path to an audio file).
**The engine choice is a one-line DI binding** — this section documents the
options so the choice can be made (and changed) cheaply.

### 6.1 Engine comparison

| | **espeak-ng** | **Piper** (leaning) | **Cloud (ElevenLabs/Google/Azure)** |
|---|---|---|---|
| Voice quality | Robotic / retro | **Natural, neural** | Best / most "real DJ" |
| Cost | Free | Free | Per-character billing |
| Network | None (offline) | None (offline) | API call per uncached clip |
| Secrets | None | None | API key (env secret) |
| Install | `apt install espeak-ng` (~few MB) | binary/pip + voice model (~20–110MB) | SDK/`fetch` only |
| RAM (synth) | Negligible | ~100–200MB (model) | Negligible local |
| CPU (short phrase) | Instant | <1s (fast box), 1–3s on 0.1 CPU | Offloaded |
| Render free-tier fit | ✅ Guaranteed | ⚠️ Tight but feasible | ✅ (needs $ + key) |
| Best for | Guaranteed baseline / CI | **Good free voice in prod** | Premium voice |

### 6.2 Piper deep-dive (the leaning option)

**What it is:** a fast, local **neural** TTS (VITS-based) from the Rhasspy/OHF
project. CPU-only (no GPU). Outputs 16-bit mono WAV (typically 22.05kHz).

**Install (Docker `node:22-slim`, Debian):** two routes —
- **pip:** add `python3 python3-pip` to the apt line, then `pip3 install piper-tts`.
- **Prebuilt binary:** download the linux/amd64 release tarball from the Piper
  GitHub releases and put `piper` on `PATH`. Avoids a Python toolchain in the image.
> Confirm the exact package/binary name and flags against current Piper docs at
> implementation time — the project has been renamed/reorganized across versions.

**Voice models:** from the `rhasspy/piper-voices` collection on Hugging Face.
Each voice = a `.onnx` + `.onnx.json`. Quality tiers **x-low / low / medium /
high** trade size & CPU for fidelity. Good English-US DJ candidates:
`en_US-amy-medium`, `en_US-lessac-medium`, `en_US-ryan-high`, `en_US-hfc_male-medium`.
**Recommend `medium` (~60MB)** — clear voice, reasonable footprint. Bake the
chosen model into the image (`COPY backend/voices/… /app/voices/`) or download at
build; set `DJ_VOICE_MODEL=/app/voices/<voice>.onnx`.

**Invocation (per clip):**
```
echo "The time is 3:42 PM." | piper -m /app/voices/en_US-amy-medium.onnx -f <cachePath>.wav
```

**Resource strategy on free tier (~512MB):** two options —
- **Spawn-per-clip (simplest):** load model, synth, exit. Frees RAM between
  clips but spikes ~150–200MB per synth and reloads the model each time
  (adds latency). Fine when paired with minute-caching (rare synths).
- **Resident process (leaner latency):** keep one Piper process alive (model
  loaded once, ~150–200MB steady) and feed it text — via its stdin loop or the
  bundled HTTP server (`python3 -m piper.http_server -m <model>`). Avoids reload
  latency; costs steady RAM. Budget: Node (~120MB) + encoder ffmpeg (~40MB) +
  resident Piper (~180MB) ≈ **~340MB**, within 512MB but with limited headroom.

**Recommendation for Piper:** start with **spawn-per-clip + a `medium` voice +
minute-caching + generate-ahead** (synthesize the next clip during the current
song's playout). If cold-start reload latency or RAM churn becomes a problem,
switch to the resident HTTP-server mode. If free-tier RAM is ever exceeded, the
pluggable interface lets you fall back to espeak-ng with a one-line change or
bump the Render plan.

### 6.3 espeak-ng detail (the safe baseline)

`apt-get install -y --no-install-recommends espeak-ng` — a few MB, no model file,
featherweight RAM/CPU, guaranteed to fit. Robotic voice.
`EspeakTtsService.synthesize` = `espeak-ng -w <cachePath> "<text>"`. Ideal as the
**guaranteed-working default** and for local/CI where installing Piper voices is
undesirable.

### 6.4 Recommendation

Build the **pluggable interface** and ship whichever engine is bound as default.
- If the priority is **voice quality** and you accept slightly tighter free-tier
  headroom → **Piper (`medium`)**, spawn-per-clip + cache, espeak as fallback.
- If the priority is **guaranteed fit / simplicity first** → **espeak-ng**, then
  swap to Piper later (one line) once the pipeline is proven.

Either way the sequencer/DJ code is identical.

### 6.5 Clip caching (engine-agnostic)

- **Dir:** `DJ_CACHE_DIR`, default under `os.tmpdir()` (matches where Phase I
  writes its playlist; `/tmp` on Render is ephemeral and self-cleans).
- **Key:** hash of `(engine, voice, text)`. Since text derives from `minuteKey`,
  the same minute reuses one file across rotations/listeners.
- **In-flight guard:** `Map<key, Promise<string>>` so concurrent requests for the
  same clip share a single synth (no double-spawn).
- **Eviction:** none needed for v1 (time vocabulary ≤ 720 distinct strings);
  optional startup prune of files older than N hours.

---

## 7. Configuration

| Env var | Default | Purpose |
|---|---|---|
| `STATION_TIMEZONE` | `America/New_York` | IANA zone the DJ announces time in (set to the station's real zone) |
| `DJ_ENABLED` | `true` | Master on/off for DJ interstitials |
| `DJ_EVERY_N_SONGS` | `1` | Speak once every N songs |
| `DJ_TTS_ENGINE` | `piper` or `espeak` | Which engine binding (informational + future factory) |
| `DJ_VOICE_MODEL` | `/app/voices/<voice>.onnx` | Piper voice path (Piper only) |
| `DJ_CACHE_DIR` | `os.tmpdir()/radio-dj-clips` | Where synthesized clips are cached |

Reuses existing `STREAM_BITRATE`, `STREAM_SAMPLE_RATE` for the encoder/decoders.
`render.yaml` backend service adds `STATION_TIMEZONE`, `DJ_ENABLED`,
`DJ_EVERY_N_SONGS` (+ `DJ_VOICE_MODEL` if Piper; + `TTS_API_KEY` **secret** if cloud).

---

## 8. Deployment changes

- **Dockerfile:** add the TTS engine to the existing apt layer.
  - espeak-ng: `apt-get install -y --no-install-recommends ffmpeg espeak-ng`.
  - Piper: add python3/pip **or** the prebuilt binary, and provision a voice
    model (`COPY` a committed `.onnx`/`.onnx.json`, or download at build).
- **render.yaml:** new env vars (§7). Backend stays **single instance** (shared
  playhead). Free tier applies; note cold-start re-synthesizes the first clips
  (cache is ephemeral).
- No frontend deploy change.

---

## 9. Build plan / milestones

Each milestone is independently testable; the stream stays shippable after M4.

- **M1 — Config.** Extend `stream.config.ts`, `.env.example`, `render.yaml`.
- **M2 — Time logic.** `time-announcer.ts` + unit tests (pure, no ffmpeg).
- **M3 — TTS.** `tts.interface.ts` + chosen engine service + caching + in-flight guard.
- **M4 — Sequencer.** Add `sequencer.service.ts`; move ffmpeg + `resolvePlaylist`;
  refactor `broadcaster.service.ts` to delegate; register providers. **Wire
  songs-only first (DJ disabled)** to prove the encoder/decoder chain.
- **M5 — DJ.** `dj.service.ts`; enable interstitials via the state machine.
- **M6 — Dockerfile.** Install the engine (+ voice model for Piper).
- **M7 — Robustness.** Decoder-kill, encoder-kill, clean teardown; generate-ahead
  if the item-boundary gap is audible.

---

## 10. Testing & acceptance criteria

**Acceptance (definition of done):**
- AC1. A 45s stream capture contains: music → "The time is H:MM AM/PM" → music,
  repeating; the spoken minute matches wall-clock in `STATION_TIMEZONE`.
- AC2. Two simultaneous captures hear the same moment (shared playhead).
- AC3. `DJ_ENABLED=false` → songs-only, no regression.
- AC4. Killing a decoder mid-clip → stream advances, stays up.
- AC5. Killing the encoder → logs "restarting", stream resumes after delay.
- AC6. `GET /station` unchanged shape; `GET /health` still ok; frontend unaffected.
- AC7. Works the same inside the Docker image (engine present).

**Test methods** (bias to ffmpeg/CLI + short capture — local Node watch has been
flaky this project):
- ffmpeg continuity without Nest (Appendix A).
- Engine CLI synth (`espeak-ng -w …` / `echo … | piper -m … -f …`) → play WAV →
  feed through decoder→encoder to confirm in-stream playback.
- `time-announcer` unit tests incl. a winter/EST date and a non-US zone
  (`Asia/Kolkata`) to exercise `Intl`/DST.
- `curl -s http://localhost:3001/stream --max-time 45 -o live.mp3` → play.
- `docker build -f backend/Dockerfile backend` → run → repeat capture in-container.

---

## 11. Observability

Log (via Nest `Logger`): item transitions (`▶ song: <name>` / `🎙 DJ: "<phrase>"`),
TTS cache hit/miss + synth duration, soft-fail reasons, decoder/encoder exits and
restarts, listener connect/leave (already present). No metrics backend required;
the existing status page already covers up/down.

---

## 12. Risks & mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | PCM format mismatch → chipmunk/slow audio | Force `-ar SR -ac 2 -f s16le` on every decoder; one shared PCM constant (verified round-trips cleanly) |
| 2 | Missing `{ end:false }` → first song end kills the stream | Code-review checkpoint; the single most important line |
| 3 | Pacing inversion | `-re` on the **decoder** only, never the encoder |
| 4 | TTS as hard dependency stalls music | Soft-fail → `null` + synth timeout; sequencer skips |
| 5 | Double-advance (decoder emits `error`+`close`) | Guard `advance()` to run once per decoder |
| 6 | Refactor regression (controller contract) | Keep `getStationInfo/add/removeListener/broadcast` in broadcaster with identical signatures |
| 7 | Piper RAM on free tier (~512MB) | `medium` voice + spawn-per-clip + cache + generate-ahead; fallback to espeak or bigger plan |
| 8 | Item-boundary PCM gap audible | Accept (sub-100ms, between segments) for v1; add pre-spawn/overlap if needed |
| 9 | Ephemeral cache re-synth on cold start | Acceptable; don't rely on cache surviving deploys |
| 10 | ICU/timezone in slim image | Node 22 ships full ICU; add a one-line `Intl` smoke test |

---

## 13. Future work (enabled by this architecture)

- **Phase II.3 — DJ over the song tail (ducking).** Add a *second* decoder (song
  + clip) into an ffmpeg `amix` / `sidechaincompress` filtergraph whose output
  feeds the **same** persistent encoder stdin. Encoder + fan-out unchanged;
  back-to-back is the non-overlapping special case.
- **Song announcements** ("That was X by Y") — same interstitial mechanism with
  per-track metadata.
- **Weather / news / local events / jingles** — additional interstitial types
  chosen by `DjService` on a schedule (top-of-hour, etc.).
- **Now-playing API/UI** — expose an optional `nowPlaying { kind, title }` on
  `getStationInfo()` (additive, frontend keeps working), then build UI later.
- **Better voice** — swap the TTS binding to Piper `high` or a cloud voice.

---

## 14. Open questions

- Q1. Final TTS engine for launch: **Piper `medium`** (better voice, tighter RAM)
  or **espeak-ng** (guaranteed, robotic)? (Pluggable, so reversible.)
- Q2. Station timezone value (currently placeholder `America/New_York`).
- Q3. Cadence for production feel — after every song is frequent with ~5s test
  clips; likely every N songs or time-gated once real music is used.

---

## Appendix A — verified ffmpeg experiment

The decoder→encoder handoff was run on the target ffmpeg (7.1) and produced a
valid continuous MP3, confirming the architecture:

```bash
# One item through the two-stage pipeline → valid MP3
ffmpeg -i backend/media/01-starbucks-1.mp3 -f s16le -ar 44100 -ac 2 -vn pipe:1 \
 | ffmpeg -f s16le -ar 44100 -ac 2 -i pipe:0 -c:a libmp3lame -b:a 128k -f mp3 pipe:1 > /tmp/out.mp3

# Two items into ONE encoder → one seamless MP3 (simulates the sequencer)
{ ffmpeg -i backend/media/01-starbucks-1.mp3 -f s16le -ar 44100 -ac 2 -vn pipe:1; \
  ffmpeg -i backend/media/02-starbucks-2.mp3 -f s16le -ar 44100 -ac 2 -vn pipe:1; } \
 | ffmpeg -f s16le -ar 44100 -ac 2 -i pipe:0 -c:a libmp3lame -b:a 128k -f mp3 pipe:1 > /tmp/two.mp3
```

---

## Appendix B — current-state references (Phase I)

- `backend/src/stream/broadcaster.service.ts` — single looping ffmpeg
  (`-re -stream_loop -1 -f concat`), `broadcast()` fan-out, `resolvePlaylist()`,
  `writeConcatFile()`, `scheduleRestart()`, `getStationInfo()`.
- `backend/src/stream/stream.config.ts` — `ffmpegPath`, `mediaDir`, `bitrate`,
  `sampleRate`, `restartDelayMs`, `station{name,frequency,tagline,city}`; **no
  timezone** today.
- `backend/src/stream/stream.controller.ts` — `GET /stream`, `/station`, `/health`.
- `backend/Dockerfile` — `FROM node:22-slim` + `apt-get install ffmpeg`.
- Frontend polls `/station` every 8s; no now-playing/SSE.
