# AI Local Radio Station

A streaming server that sounds like a local music radio station — one shared live stream every listener hears at the same moment, with an AI "DJ" between songs.

> **This is a living document.** It will change as the project progresses.

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

### Phase I
Set up a streaming server that loops 3 mp3 files over and over. Distribute a link anyone can click to play the stream — all listeners hear the same stream.

### Phase II
1. Create shorter clips to speed up testing (~20 seconds total)
2. Have the DJ say the current time at the end of each song
3. Have the DJ say the current time over the tail of the song as it finishes (audio mixing, not just back-to-back playback)

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

- **Frontend:** Next.js
- **Backend:** Nest.js
- **Audio engine:** ffmpeg
- **Live metadata:** Server-Sent Events (SSE)

## Status

Early planning / architecture. No code yet.
