/**
 * Styling shared by the admin pages, so the console and the library look like
 * one product rather than two. Kept as a string because the pages are served as
 * self-contained HTML with no build step or static asset pipeline.
 *
 * Same themes as the listener page — Daylight in light mode, Evening in dark —
 * with the same token names where they overlap (see docs/themes.md). The
 * tokens are repeated here because the two apps share no build.
 */
export const ADMIN_CSS = `  :root{color-scheme:light;
    --bg:#f4f1ec;--glow-1:#ffc9a8;--glow-2:#c9b8ff;--glow-3:#a8d8ff;--glow-opacity:.9;
    --glass:rgba(255,255,255,.6);--glass-solid:#fbfaf8;--edge:rgba(255,255,255,.85);--shadow:rgba(70,45,30,.12);
    --line:rgba(20,22,28,.09);--line-strong:rgba(20,22,28,.18);
    --text:#14161c;--muted:#565d6c;--field:#ffffff;--chip:rgba(20,22,28,.04);--chip-hover:rgba(20,22,28,.08);
    --accent:#e2553a;--accent-bright:#ec6b50;--accent-text:#b8432b;--on-accent:#ffffff;
    --danger:#c62f2f;--ok:#1f8a4c;--warn:#a65d00}
  @media (prefers-color-scheme:dark){:root{color-scheme:dark;
    --bg:#1c1a22;--glow-1:#c98a6b;--glow-2:#8c7cc9;--glow-3:#6e9cc4;--glow-opacity:.4;
    --glass:rgba(255,255,255,.06);--glass-solid:#26232d;--edge:rgba(255,240,230,.14);--shadow:rgba(0,0,0,.35);
    --line:rgba(244,239,234,.09);--line-strong:rgba(244,239,234,.18);
    --text:#f4efea;--muted:#b3aaa2;--field:rgba(0,0,0,.22);--chip:rgba(255,255,255,.05);--chip-hover:rgba(255,255,255,.09);
    --accent:#f08a6e;--accent-bright:#f6a188;--accent-text:#f6a188;--on-accent:#2a120b;
    --danger:#ff7b72;--ok:#5fd38a;--warn:#f0b45a}}
  @media (prefers-contrast:more){:root{--glass:var(--glass-solid);--edge:var(--line-strong);--muted:var(--text)}}
  *{box-sizing:border-box}
  /* An author \`display\` rule outranks the browser's built-in [hidden] rule, so
     any element given one stays on screen even when .hidden is set. Enforce it
     once here rather than remembering to at every call site. */
  [hidden]{display:none!important}
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.45;background:var(--bg);color:var(--text);-webkit-font-smoothing:antialiased;transition:background-color .4s ease,color .4s ease}
  /* Soft, still pools of colour behind the glass, fixed while the page scrolls. */
  body::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;opacity:var(--glow-opacity);
    background:radial-gradient(38% 45% at 12% 8%,var(--glow-1),transparent 70%),radial-gradient(40% 48% at 92% 90%,var(--glow-2),transparent 70%),radial-gradient(30% 36% at 70% 30%,var(--glow-3),transparent 70%)}
  ::selection{background:var(--accent);color:var(--on-accent)}
  :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .wrap{max-width:760px;margin:0 auto;padding:32px 20px 72px}
  h1{font-size:26px;font-weight:700;letter-spacing:-.02em;line-height:1.1;margin:0 0 6px}
  .sub{color:var(--muted);font-size:13px;margin:0 0 28px}
  /* Each card is a pane of frosted glass. */
  .card{background:var(--glass);-webkit-backdrop-filter:blur(24px) saturate(180%);backdrop-filter:blur(24px) saturate(180%);border:1px solid var(--edge);border-radius:18px;padding:20px;margin-bottom:20px;box-shadow:0 1px 0 var(--edge) inset,0 24px 60px -34px var(--shadow)}
  .now{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
  .now .name{font-size:22px;font-weight:700;letter-spacing:-.015em;color:var(--text)}
  .now .freq{color:var(--accent-text);font-weight:500;font-variant-numeric:tabular-nums}
  .now .meta{color:var(--muted);font-size:13px}
  .dot{width:8px;height:8px;border-radius:50%;background:var(--muted);display:inline-block;margin-right:6px;vertical-align:middle}
  .dot.on{background:var(--ok);box-shadow:0 0 0 3px color-mix(in srgb,var(--ok) 22%,transparent)}
  h2{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);margin:0 0 13px}
  .pick{display:grid;gap:7px;font-size:12px;color:var(--muted)}
  select{appearance:none;-webkit-appearance:none;background:var(--field);border:1px solid var(--line-strong);color:var(--text);border-radius:10px;padding:12px 13px;font-size:15px;cursor:pointer;background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%23e2553a' d='M6 8 0 0h12z'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 14px center}
  select:focus{outline:none;border-color:var(--accent)}
  form{display:grid;gap:12px}
  label{display:grid;gap:5px;font-size:12px;color:var(--muted)}
  input,textarea{background:var(--field);border:1px solid var(--line-strong);color:var(--text);border-radius:10px;padding:10px 12px;font-size:14px}
  input:focus,textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 18%,transparent)}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  button,.mini{touch-action:manipulation}
  button.save{background:var(--accent);color:var(--on-accent);border:none;border-radius:11px;padding:11px 18px;font-weight:600;cursor:pointer;font-size:14px;justify-self:start;box-shadow:0 8px 20px -10px var(--accent);transition:transform .1s ease,background .2s ease}
  @media (hover:hover){button.save:hover{background:var(--accent-bright)}}
  /* Feedback on the press itself, not on release. */
  button.save:active,.mini:active{transform:scale(.96)}
  .toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--glass-solid);border:1px solid var(--accent);color:var(--text);padding:11px 18px;border-radius:12px;opacity:0;transition:.25s;pointer-events:none;font-size:14px;box-shadow:0 12px 30px -12px var(--shadow)}
  .toast.show{opacity:1}
  .toast.err{border-color:var(--danger)}
  a.listen{color:var(--accent-text);text-decoration:none;font-weight:500}
  @media(max-width:520px){.row{grid-template-columns:1fr}}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:600;padding:0 8px 8px 0}
  td{padding:7px 8px 7px 0;border-top:1px solid var(--line);vertical-align:middle}
  td input{width:100%;padding:6px 8px;font-size:13px}
  .num{color:var(--muted);font-variant-numeric:tabular-nums;width:24px}
  .mini{background:var(--chip);border:1px solid var(--line-strong);color:var(--accent-text);border-radius:8px;padding:5px 10px;cursor:pointer;font-size:12px;font-weight:500;white-space:nowrap;transition:transform .1s ease,background .2s ease,border-color .2s ease}
  @media (hover:hover){.mini:hover{border-color:var(--accent);background:var(--chip-hover)}}
  .mini.danger{color:var(--danger)}
  .mini[disabled]{opacity:.5;cursor:default}
  .skipped td:not(.actions):not(.skipcell){opacity:.45}
  .seg{border-top:1px solid var(--line);padding:12px 0;display:grid;gap:8px}
  .seg textarea{padding:9px 11px;font:inherit;font-size:13px;resize:vertical;min-height:52px}
  .segbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .tag{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--accent-text);border:1px solid var(--line-strong);border-radius:20px;padding:3px 9px}
  .ph{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--muted)}
  .ph b{color:var(--accent-text);font-weight:600}
  .spacer{flex:1}
  .muted{color:var(--muted);font-size:12px}
  /* Transparency turned down: solid cards instead of frosted glass. */
  @media (prefers-reduced-transparency:reduce){.card{background:var(--glass-solid);-webkit-backdrop-filter:none;backdrop-filter:none}}
  @media (prefers-reduced-motion:reduce){*{transition:none!important}button.save:active,.mini:active{transform:none}}`;
