/**
 * The admin UI: a self-contained HTML page served by the backend at `/admin`.
 * It calls the same-origin `/admin/config` API. Kept dependency-free (inline
 * CSS/JS, no template literals in the client script so it embeds cleanly here).
 */
export const ADMIN_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Station Admin</title>
<style>
  :root{--bg:#100e0c;--panel:#1b1714;--line:#2c2620;--amber:#f2a93b;--amber2:#ffc061;--text:#f3ede4;--muted:#a8998a}
  *{box-sizing:border-box}
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
</style>
</head>
<body>
<div class="wrap">
  <h1>📻 Station Admin</h1>
  <p class="sub">Switch the on-air identity &amp; the timezone the DJ announces — live, no restart. <a class="listen" href="/stream">listen &#8599;</a></p>

  <div class="card">
    <h2>On air now</h2>
    <div class="now">
      <span class="name"><span id="dot" class="dot"></span><span id="cName">&mdash;</span></span>
      <span class="freq" id="cFreq"></span>
      <span class="meta" id="cMeta"></span>
    </div>
  </div>

  <div class="card">
    <h2>Station (US time zones)</h2>
    <label class="pick">Pick a station — sets the name &amp; the timezone the DJ announces
      <select id="presetSelect"></select>
    </label>
  </div>

  <div class="card">
    <h2>Custom</h2>
    <form id="customForm" autocomplete="off">
      <div class="row">
        <label>Station name<input name="name" placeholder="Radio NYC" /></label>
        <label>Frequency<input name="frequency" placeholder="98.7" /></label>
      </div>
      <div class="row">
        <label>City<input name="city" placeholder="New York" /></label>
        <label>Timezone (IANA)<input name="timeZone" placeholder="America/New_York" /></label>
      </div>
      <label>Tagline<input name="tagline" placeholder="your local sound, on a loop" /></label>
      <button class="save" type="submit">Save custom</button>
    </form>
  </div>
</div>
<div class="toast" id="toast"></div>
<script>
  function q(id){return document.getElementById(id)}
  function toast(msg,isErr){var t=q('toast');t.textContent=msg;t.className='toast show'+(isErr?' err':'');setTimeout(function(){t.className='toast'},2600)}
  var presets=[];
  function renderCurrent(s){
    q('cName').textContent=s.name;
    q('cFreq').textContent=s.frequency?s.frequency+' FM':'';
    q('cMeta').textContent=s.city+' \\u00b7 '+s.timeZone;
    q('dot').className='dot'+(s.online?' on':'');
    var match='';
    for(var i=0;i<presets.length;i++){
      if(presets[i].name===s.name&&presets[i].timeZone===s.timeZone){match=presets[i].id;break}
    }
    q('presetSelect').value=match;
  }
  function renderPresets(list){
    presets=list;
    var sel=q('presetSelect');sel.textContent='';
    var custom=document.createElement('option');custom.value='';custom.textContent='\\u2014 custom \\u2014';sel.appendChild(custom);
    for(var i=0;i<list.length;i++){
      var o=document.createElement('option');o.value=list[i].id;o.textContent=list[i].name+' \\u00b7 '+list[i].timeZone;sel.appendChild(o);
    }
    sel.onchange=function(){
      if(!sel.value)return;
      var p=null;for(var j=0;j<presets.length;j++){if(presets[j].id===sel.value){p=presets[j];break}}
      apply({presetId:sel.value},'Switched to '+(p?p.name:sel.value));
    };
  }
  function init(){
    fetch('/admin/config').then(function(r){return r.json()}).then(function(d){
      renderPresets(d.presets);renderCurrent(d.station);
    }).catch(function(){toast('Could not load config',true)});
  }
  function refresh(){
    fetch('/admin/config').then(function(r){return r.json()}).then(function(d){
      renderCurrent(d.station);
    }).catch(function(){});
  }
  function apply(body,okMsg){
    fetch('/admin/config',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
      .then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})})
      .then(function(res){
        if(!res.ok){toast((res.j&&res.j.message)||'Update failed',true);return}
        renderCurrent(res.j.station);toast(okMsg||'Saved')
      }).catch(function(){toast('Network error',true)});
  }
  q('customForm').addEventListener('submit',function(e){
    e.preventDefault();
    var fd=new FormData(e.target),body={},keys=['name','frequency','city','timeZone','tagline'];
    for(var i=0;i<keys.length;i++){var v=(fd.get(keys[i])||'').toString().trim();if(v)body[keys[i]]=v}
    if(Object.keys(body).length===0){toast('Fill at least one field',true);return}
    apply(body,'Saved custom station');e.target.reset();
  });
  init();
  setInterval(refresh,8000);
</script>
</body>
</html>`;
