"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { STATION_URL, STREAM_URL } from "../config";
import styles from "./RadioPlayer.module.css";

interface StationInfo {
  name: string;
  frequency: string;
  tagline: string;
  city: string;
  listeners: number;
  online: boolean;
}

const DEFAULT_STATION: StationInfo = {
  name: "KIND FM",
  frequency: "98.7",
  tagline: "your local sound, on a loop",
  city: "Anytown",
  listeners: 0,
  online: false,
};

export default function RadioPlayer() {
  const [station, setStation] = useState<StationInfo>(DEFAULT_STATION);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [clock, setClock] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const rafRef = useRef<number>(0);
  const playingRef = useRef(false);

  // Live clock — a nod to the DJ "time check" feature coming later. Rendered
  // only after mount to avoid a server/client hydration mismatch.
  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Poll station identity + live listener count.
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await fetch(STATION_URL, { cache: "no-store" });
        if (!res.ok) throw new Error();
        const data = (await res.json()) as StationInfo;
        if (active) setStation(data);
      } catch {
        /* backend may be waking up; keep last known values */
      }
    };
    load();
    const id = setInterval(load, 8000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  // The visualizer runs continuously: real frequency data while on air, a slow
  // idle shimmer while off air, so the console always feels alive.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const BARS = 56;
    const freq = new Uint8Array(
      analyserRef.current?.frequencyBinCount ?? 128,
    );
    const start = performance.now();

    const render = (now: number) => {
      rafRef.current = requestAnimationFrame(render);
      const { width: w, height: h } = canvas.getBoundingClientRect();
      const mid = h / 2;
      ctx2d.clearRect(0, 0, w, h);

      const analyser = analyserRef.current;
      const live = playingRef.current && !!analyser;
      if (live) analyser!.getByteFrequencyData(freq);

      const gap = 3;
      const barW = (w - gap * (BARS - 1)) / BARS;
      const t = (now - start) / 1000;

      for (let i = 0; i < BARS; i++) {
        let level: number;
        if (live) {
          // Use the lower ~75% of the spectrum where the energy lives.
          const idx = Math.floor((i / BARS) * (freq.length * 0.75));
          level = freq[idx] / 255;
        } else {
          // Gentle breathing wave when off air.
          level =
            0.06 +
            0.05 * (Math.sin(t * 1.4 + i * 0.5) * 0.5 + 0.5) +
            0.03 * (Math.sin(t * 0.6 + i * 0.18) * 0.5 + 0.5);
        }

        const barH = Math.max(2, level * (mid - 4));
        const x = i * (barW + gap);

        const grad = ctx2d.createLinearGradient(0, mid - barH, 0, mid + barH);
        if (live) {
          grad.addColorStop(0, "#ffc061");
          grad.addColorStop(0.5, "#f2a93b");
          grad.addColorStop(1, "#c9781f");
        } else {
          grad.addColorStop(0, "rgba(242,169,59,0.35)");
          grad.addColorStop(1, "rgba(201,120,31,0.2)");
        }
        ctx2d.fillStyle = grad;

        const r = Math.min(barW / 2, 2);
        roundedRect(ctx2d, x, mid - barH, barW, barH * 2, r);
        ctx2d.fill();
      }
    };

    rafRef.current = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, []);

  // Create the AudioContext + analyser once. We deliberately do NOT attach the
  // media element yet: a suspended context can stall an element that's wired
  // into it, so we tap the element only after playback is actually flowing.
  const ensureContext = useCallback(() => {
    if (!ctxRef.current) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new AudioCtx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.82;
      analyser.connect(ctx.destination);
      ctxRef.current = ctx;
      analyserRef.current = analyser;
    }
    return ctxRef.current;
  }, []);

  // Route the element through the analyser for the visualizer. A given element
  // can only be sourced once, so guard with sourceRef.
  const connectTap = useCallback(() => {
    const el = audioRef.current;
    const ctx = ctxRef.current;
    const analyser = analyserRef.current;
    if (!el || !ctx || !analyser || sourceRef.current) return;
    sourceRef.current = ctx.createMediaElementSource(el);
    sourceRef.current.connect(analyser);
  }, []);

  const stop = useCallback(() => {
    const el = audioRef.current;
    if (el) {
      el.pause();
      // Drop the connection entirely — you rejoin *live*, like real radio.
      el.removeAttribute("src");
      el.load();
    }
    playingRef.current = false;
    setIsPlaying(false);
    setIsConnecting(false);
  }, []);

  const play = useCallback(async () => {
    const el = audioRef.current;
    if (!el) return;
    setError(null);
    setIsConnecting(true);
    try {
      const ctx = ensureContext();
      await ctx.resume();
      el.src = STREAM_URL;
      el.volume = volume;
      await el.play();
      // On-air state is flipped by the 'playing' media event below.
    } catch {
      setError("Couldn’t reach the stream. Is the backend running?");
      stop();
    }
  }, [ensureContext, stop, volume]);

  // Drive on-air state from real media events, and attach the visualizer tap
  // the moment audio actually starts flowing.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onPlaying = () => {
      connectTap();
      playingRef.current = true;
      setIsPlaying(true);
      setIsConnecting(false);
    };
    const onWaiting = () => setIsConnecting(true);
    const onPause = () => {
      playingRef.current = false;
      setIsPlaying(false);
    };
    const onError = () => {
      if (!el.getAttribute("src")) return; // ignore the empty-src teardown
      setError("Lost the stream. Is the backend running?");
      stop();
    };
    el.addEventListener("playing", onPlaying);
    el.addEventListener("waiting", onWaiting);
    el.addEventListener("pause", onPause);
    el.addEventListener("error", onError);
    return () => {
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("waiting", onWaiting);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("error", onError);
    };
  }, [connectTap, stop]);

  const toggle = useCallback(() => {
    if (isPlaying) stop();
    else void play();
  }, [isPlaying, play, stop]);

  const onVolume = (value: number) => {
    setVolume(value);
    if (audioRef.current) audioRef.current.volume = value;
  };

  const share = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — ignore */
    }
  }, []);

  const onAir = isPlaying && !isConnecting;

  return (
    <section className={styles.console} aria-label={`${station.name} radio`}>
      <audio ref={audioRef} crossOrigin="anonymous" preload="none" hidden />

      <header className={styles.bezel}>
        <div className={styles.brand}>
          <span className={styles.fmTag}>FM</span>
          <h1 className={styles.wordmark}>{station.name}</h1>
          <span className={styles.freq}>{station.frequency}</span>
        </div>
        <div
          className={`${styles.onair} ${onAir ? styles.onairLive : ""}`}
          aria-live="polite"
        >
          <span className={styles.onairDot} aria-hidden />
          {isConnecting ? "tuning…" : onAir ? "on air" : "off air"}
        </div>
      </header>

      <p className={styles.tagline}>
        {station.tagline} · {station.city}
      </p>

      <div className={styles.scope}>
        <canvas ref={canvasRef} className={styles.canvas} aria-hidden />
        {!isPlaying && (
          <span className={styles.scopeHint}>press play to tune in</span>
        )}
      </div>

      <div className={styles.controls}>
        <button
          type="button"
          className={`${styles.knob} ${isPlaying ? styles.knobOn : ""}`}
          onClick={toggle}
          aria-label={isPlaying ? "Stop the stream" : "Play the stream"}
        >
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>

        <div className={styles.fader}>
          <span className={styles.faderLabel}>vol</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => onVolume(Number(e.target.value))}
            aria-label="Volume"
            style={{ ["--fill" as string]: `${volume * 100}%` }}
          />
        </div>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <footer className={styles.readout}>
        <span className={styles.clock}>{clock ?? "--:--:--"}</span>
        <span className={styles.dotSep} aria-hidden />
        <span className={styles.listeners}>
          {station.listeners} {station.listeners === 1 ? "ear" : "ears"} tuned in
        </span>
        <button type="button" className={styles.share} onClick={share}>
          {copied ? "copied!" : "copy link"}
        </button>
      </footer>
    </section>
  );
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden>
      <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden>
      <rect x="6.5" y="5.5" width="4" height="13" rx="1" fill="currentColor" />
      <rect x="13.5" y="5.5" width="4" height="13" rx="1" fill="currentColor" />
    </svg>
  );
}
