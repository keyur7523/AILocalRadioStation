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
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:600;padding:0 8px 8px 0}
  td{padding:7px 8px 7px 0;border-top:1px solid var(--line);vertical-align:middle}
  td input{width:100%;padding:6px 8px;font-size:13px}
  .num{color:var(--muted);font-variant-numeric:tabular-nums;width:24px}
  .mini{background:#221d18;border:1px solid var(--line);color:var(--amber);border-radius:7px;padding:5px 9px;cursor:pointer;font-size:12px;white-space:nowrap}
  .mini:hover{border-color:var(--amber);background:#2a231c}
  .mini.danger{color:#e0574f}
  .mini[disabled]{opacity:.5;cursor:default}
  .skipped td:not(.actions){opacity:.45}
  .seg{border-top:1px solid var(--line);padding:12px 0;display:grid;gap:8px}
  .seg textarea{background:#0e0c0a;border:1px solid var(--line);color:var(--text);border-radius:8px;padding:9px 11px;font:inherit;font-size:13px;resize:vertical;min-height:52px}
  .seg textarea:focus{outline:none;border-color:var(--amber)}
  .segbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .tag{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--amber);border:1px solid var(--line);border-radius:20px;padding:3px 9px}
  .ph{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--muted)}
  .ph b{color:var(--amber2);font-weight:600}
  .spacer{flex:1}
  .muted{color:var(--muted);font-size:12px}
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
    <h2>DJ voice</h2>
    <label class="pick">Switches live — the next break uses it
      <select id="voiceSelect"></select>
    </label>
  </div>

  <div class="card">
    <h2>Set station</h2>
    <form id="customForm" autocomplete="off">
      <div class="row">
        <label>Station name<input name="name" placeholder="Radio NYC" /></label>
        <label>Frequency<input name="frequency" placeholder="98.7" /></label>
      </div>
      <div class="row">
        <label>City<input name="city" placeholder="New York" /></label>
        <label>Timezone (US) — type or pick<input name="timeZone" list="tzOptions" placeholder="America/New_York" autocomplete="off" /></label>
      </div>
      <label>Tagline<input name="tagline" placeholder="your local sound, on a loop" /></label>
      <button class="save" type="submit">Save</button>
    </form>
  </div>
  <div class="card">
    <div class="segbar">
      <div>
        <h2 style="margin:0 0 4px">Library</h2>
        <span class="muted" id="libCount">&mdash;</span>
      </div>
      <span class="spacer"></span>
      <a class="mini" href="/admin/library" style="text-decoration:none">open library &#8594;</a>
    </div>
  </div>

  <div class="card">
    <h2>Segues</h2>
    <p class="muted">What the DJ says around a song. Placeholders:
      <span class="ph"><b>[SONG NAME]</b> <b>[ARTIST NAME]</b> <b>[TIME]</b></span>
    </p>
    <div id="seguesList"></div>
    <div class="segbar" style="margin-top:14px">
      <button class="mini" data-add="before">+ line before a song</button>
      <button class="mini" data-add="after">+ line after a song</button>
    </div>
  </div>
</div>
<datalist id="tzOptions"></datalist>
<div class="toast" id="toast"></div>
<script>
  function q(id){return document.getElementById(id)}
  function toast(msg,isErr){var t=q('toast');t.textContent=msg;t.className='toast show'+(isErr?' err':'');setTimeout(function(){t.className='toast'},2600)}
  function populateTimezones(){
    // US IANA time zones (the main ones + common alternates). Free typing still
    // works for any valid zone; these are just the suggestions.
    var zones=['America/New_York','America/Chicago','America/Denver','America/Phoenix','America/Los_Angeles','America/Anchorage','Pacific/Honolulu','America/Detroit','America/Boise','America/Indiana/Indianapolis','America/Juneau','America/Adak'];
    var dl=q('tzOptions');dl.textContent='';
    for(var i=0;i<zones.length;i++){var o=document.createElement('option');o.value=zones[i];dl.appendChild(o)}
  }
  function renderCurrent(s){
    q('cName').textContent=s.name;
    q('cFreq').textContent=s.frequency?s.frequency+' FM':'';
    q('cMeta').textContent=s.city+' \\u00b7 '+s.timeZone;
    q('dot').className='dot'+(s.online?' on':'');
  }
  function fillForm(s){
    var f=q('customForm');
    var keys=['name','frequency','city','timeZone','tagline'];
    for(var i=0;i<keys.length;i++){if(f[keys[i]])f[keys[i]].value=s[keys[i]]||''}
  }
  function renderVoices(list,currentId){
    var sel=q('voiceSelect');sel.textContent='';
    if(!list||!list.length){
      var none=document.createElement('option');none.textContent='(no voices installed)';
      sel.appendChild(none);sel.disabled=true;return;
    }
    for(var i=0;i<list.length;i++){
      var o=document.createElement('option');o.value=list[i].id;o.textContent=list[i].label;sel.appendChild(o);
    }
    if(currentId)sel.value=currentId;
    sel.onchange=function(){
      apply({voiceId:sel.value},'DJ voice → '+sel.options[sel.selectedIndex].textContent);
    };
  }
  function init(){
    fetch('/admin/config').then(function(r){return r.json()}).then(function(d){
      renderCurrent(d.station);fillForm(d.station);renderVoices(d.voices,d.voiceId);
    }).catch(function(){toast('Could not load config',true)});
  }
  function refresh(){
    fetch('/admin/config').then(function(r){return r.json()}).then(function(d){
      renderCurrent(d.station);
    }).catch(function(){});
  }
  // refillForm: only after saving the station form itself. Refilling on any
  // other update (switching voice, say) would overwrite whatever the operator
  // had half-typed into those fields.
  function apply(body,okMsg,refillForm){
    fetch('/admin/config',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
      .then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})})
      .then(function(res){
        if(!res.ok){toast((res.j&&res.j.message)||'Update failed',true);return}
        renderCurrent(res.j.station);
        if(refillForm)fillForm(res.j.station);
        toast(okMsg||'Saved')
      }).catch(function(){toast('Network error',true)});
  }
  q('customForm').addEventListener('submit',function(e){
    e.preventDefault();
    var fd=new FormData(e.target),body={},keys=['name','frequency','city','timeZone','tagline'];
    for(var i=0;i<keys.length;i++){var v=(fd.get(keys[i])||'').toString().trim();if(v)body[keys[i]]=v}
    if(Object.keys(body).length===0){toast('Fill at least one field',true);return}
    apply(body,'Station saved',true);
  });

  // ---- shared -------------------------------------------------------------
  var audio=new Audio();
  function say(text,songName,artistName,btn){
    if(!text||!text.trim()){toast('Nothing to say',true);return}
    var label=btn?btn.textContent:''; if(btn){btn.disabled=true;btn.textContent='...'}
    fetch('/admin/preview',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({text:text,songName:songName,artistName:artistName})})
      .then(function(r){
        if(!r.ok)return r.json().then(function(j){throw new Error(j.message||'Preview failed')});
        return r.blob();
      })
      .then(function(b){audio.src=URL.createObjectURL(b);return audio.play()})
      .catch(function(e){toast(e.message||'Preview failed',true)})
      .finally(function(){if(btn){btn.disabled=false;btn.textContent=label}});
  }
  function api(method,url,body){
    return fetch(url,{method:method,headers:{'Content-Type':'application/json'},
      body:body?JSON.stringify(body):undefined})
      .then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.message||'Failed');return j})});
  }
  function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e}

  // The rotation is managed at /admin/library; the console just links to it.
  function loadLibraryCount(){
    fetch('/admin/songs').then(function(r){return r.json()}).then(function(d){
      var n=(d.songs||[]).length,skipped=(d.songs||[]).filter(function(s){return s.skip}).length;
      q('libCount').textContent=!d.editable
        ? 'No database connected'
        : n+' track'+(n===1?'':'s')+(skipped?' · '+skipped+' skipped':'');
    }).catch(function(){q('libCount').textContent='Could not load'});
  }

  // ---- segues -------------------------------------------------------------
  function loadSegues(){
    fetch('/admin/segues').then(function(r){return r.json()}).then(function(d){
      var list=q('seguesList');list.textContent='';
      if(!d.editable){list.appendChild(el('p','muted','No database connected — the DJ uses its built-in lines.'));return}
      if(!d.segues.length){list.appendChild(el('p','muted','No segues yet. Add one below.'));return}
      d.segues.forEach(function(seg){list.appendChild(segueRow(seg))});
    }).catch(function(){});
  }
  function segueRow(seg){
    var wrap=el('div','seg');
    var ta=el('textarea');ta.value=seg.text;
    ta.onchange=function(){
      api('PATCH','/admin/segues/'+seg.id,{text:ta.value})
        .then(function(u){seg.text=u.text;toast('Saved')})
        .catch(function(e){toast(e.message,true);ta.value=seg.text});
    };
    var bar=el('div','segbar');
    bar.appendChild(el('span','tag',seg.placement==='before'?'before song':'after song'));
    var play=el('button','mini','▶ hear it');
    play.onclick=function(){say(ta.value,null,null,play)};
    var onoff=el('button','mini',seg.enabled?'enabled':'disabled');
    onoff.onclick=function(){
      api('PATCH','/admin/segues/'+seg.id,{enabled:!seg.enabled}).then(function(u){
        seg.enabled=u.enabled;onoff.textContent=u.enabled?'enabled':'disabled';
        wrap.style.opacity=u.enabled?'1':'.5';
      }).catch(function(e){toast(e.message,true)});
    };
    var del=el('button','mini danger','delete');
    del.onclick=function(){
      if(!confirm('Delete this line?'))return;
      api('DELETE','/admin/segues/'+seg.id).then(function(){loadSegues();toast('Deleted')})
        .catch(function(e){toast(e.message,true)});
    };
    bar.appendChild(play);bar.appendChild(el('span','spacer'));bar.appendChild(onoff);bar.appendChild(del);
    wrap.appendChild(ta);wrap.appendChild(bar);
    if(!seg.enabled)wrap.style.opacity='.5';
    return wrap;
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-add]'),function(btn){
    btn.onclick=function(){
      var placement=btn.getAttribute('data-add');
      var text=placement==='before'?'Next up, [SONG NAME] by [ARTIST NAME].'
                                   :"That was [SONG NAME] by [ARTIST NAME]. It's [TIME].";
      api('POST','/admin/segues',{text:text,placement:placement})
        .then(function(){loadSegues();toast('Line added')})
        .catch(function(e){toast(e.message,true)});
    };
  });

  populateTimezones();
  init();
  loadLibraryCount();
  loadSegues();
  setInterval(refresh,8000);
</script>
</body>
</html>`;
