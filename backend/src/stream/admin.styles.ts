/**
 * Styling shared by the admin pages, so the console and the library look like
 * one product rather than two. Kept as a string because the pages are served as
 * self-contained HTML with no build step or static asset pipeline.
 */
export const ADMIN_CSS = `  :root{--bg:#100e0c;--panel:#1b1714;--line:#2c2620;--amber:#f2a93b;--amber2:#ffc061;--text:#f3ede4;--muted:#a8998a}
  *{box-sizing:border-box}
  /* An author \`display\` rule outranks the browser's built-in [hidden] rule, so
     any element given one stays on screen even when .hidden is set. Enforce it
     once here rather than remembering to at every call site. */
  [hidden]{display:none!important}
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--text)}
  .wrap{max-width:760px;margin:0 auto;padding:32px 20px 72px}
  h1{font-size:22px;letter-spacing:.02em;margin:0 0 4px}
  .sub{color:var(--muted);font-size:13px;margin:0 0 28px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px;margin-bottom:20px}
  .now{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
  .now .name{font-size:20px;font-weight:600;color:var(--amber2)}
  .now .freq{color:var(--amber);font-variant-numeric:tabular-nums}
  .now .meta{color:var(--muted);font-size:13px}
  .dot{width:8px;height:8px;border-radius:50%;background:#555;display:inline-block;margin-right:6px;vertical-align:middle}
  .dot.on{background:#43c463;box-shadow:0 0 8px #43c463}
  h2{font-size:12px;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);margin:0 0 13px}
  .pick{display:grid;gap:7px;font-size:12px;color:var(--muted)}
  select{appearance:none;-webkit-appearance:none;background:#0e0c0a;border:1px solid var(--line);color:var(--text);border-radius:8px;padding:12px 13px;font-size:15px;cursor:pointer;background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%23f2a93b' d='M6 8 0 0h12z'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 14px center}
  select:focus{outline:none;border-color:var(--amber)}
  form{display:grid;gap:12px}
  label{display:grid;gap:5px;font-size:12px;color:var(--muted)}
  input{background:#0e0c0a;border:1px solid var(--line);color:var(--text);border-radius:8px;padding:10px 12px;font-size:14px}
  input:focus{outline:none;border-color:var(--amber)}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  button.save{background:var(--amber);color:#1a1206;border:none;border-radius:9px;padding:11px 18px;font-weight:600;cursor:pointer;font-size:14px;justify-self:start}
  button.save:hover{background:var(--amber2)}
  .toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#241d15;border:1px solid var(--amber);color:var(--text);padding:11px 18px;border-radius:10px;opacity:0;transition:.25s;pointer-events:none;font-size:14px}
  .toast.show{opacity:1}
  .toast.err{border-color:#e0574f}
  a.listen{color:var(--amber);text-decoration:none}
  @media(max-width:520px){.row{grid-template-columns:1fr}}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:600;padding:0 8px 8px 0}
  td{padding:7px 8px 7px 0;border-top:1px solid var(--line);vertical-align:middle}
  td input{width:100%;padding:6px 8px;font-size:13px}
  .num{color:var(--muted);font-variant-numeric:tabular-nums;width:24px}
  .mini{background:#221d18;border:1px solid var(--line);color:var(--amber);border-radius:7px;padding:5px 9px;cursor:pointer;font-size:12px;white-space:nowrap}
  .mini:hover{border-color:var(--amber);background:#2a231c}
  .mini.danger{color:#e0574f}
  .mini[disabled]{opacity:.5;cursor:default}
  .skipped td:not(.actions):not(.skipcell){opacity:.45}
  .seg{border-top:1px solid var(--line);padding:12px 0;display:grid;gap:8px}
  .seg textarea{background:#0e0c0a;border:1px solid var(--line);color:var(--text);border-radius:8px;padding:9px 11px;font:inherit;font-size:13px;resize:vertical;min-height:52px}
  .seg textarea:focus{outline:none;border-color:var(--amber)}
  .segbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .tag{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--amber);border:1px solid var(--line);border-radius:20px;padding:3px 9px}
  .ph{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--muted)}
  .ph b{color:var(--amber2);font-weight:600}
  .spacer{flex:1}
  .muted{color:var(--muted);font-size:12px}`;
