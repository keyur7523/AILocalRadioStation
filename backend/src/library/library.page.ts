import { ADMIN_CSS } from '../stream/admin.styles';

/**
 * The library page, served at `/admin/library`.
 *
 * One place to manage what the station plays: search the rotation, hear how the
 * DJ pronounces a track, fix that pronunciation, reorder, rest a track or drop
 * it. Deliberately a page of its own rather than another card on the console —
 * song management is the part most likely to grow, and it already needs more
 * room than a card affords.
 *
 * Self-contained HTML with no build step, matching the rest of the admin. The
 * client script avoids template literals so it embeds cleanly in this one.
 */
export const LIBRARY_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Station Library</title>
<style>
${ADMIN_CSS}
  .wrap{max-width:1040px}
  .toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px}
  .search{flex:1;min-width:220px;position:relative}
  .search input{width:100%;padding:11px 64px 11px 13px;font-size:14px}
  .search .clear{position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--muted);cursor:pointer;font-size:12px;padding:2px 6px;line-height:1}
  .search .clear:hover{color:var(--text)}
  .count{color:var(--muted);font-size:12px;white-space:nowrap}
  .empty{color:var(--muted);font-size:13px;text-align:center;padding:28px 0}
  .filename{color:var(--muted);font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  mark{background:#4a3a1a;color:var(--amber2);border-radius:3px;padding:0 2px}
  .backlink{color:var(--amber);text-decoration:none;font-size:13px}
  .skipcell{text-align:center;width:52px}
  .skipcell input{appearance:none;-webkit-appearance:none;width:17px;height:17px;border:1px solid var(--line);border-radius:5px;background:#0e0c0a;cursor:pointer;position:relative;vertical-align:middle;padding:0}
  .skipcell input:hover{border-color:var(--amber)}
  .skipcell input:checked{background:var(--amber);border-color:var(--amber)}
  .skipcell input:checked::after{content:"";position:absolute;left:5px;top:1px;width:4px;height:9px;border:solid #1a1206;border-width:0 2px 2px 0;transform:rotate(45deg)}
  .skipcell input:focus-visible{outline:2px solid var(--amber);outline-offset:2px}
  .notice{display:flex;gap:11px;align-items:flex-start;background:#241d15;border:1px solid #4a3a22;border-radius:10px;padding:13px 15px;margin-bottom:16px;font-size:13px;line-height:1.5}
  .notice b{color:var(--amber2);font-weight:600}
  .notice .muted{display:block;margin-top:4px}
  /* The row's controls read as one group; let the table scroll rather than
     wrapping them onto a second line on a narrow screen. */
  .scroller{overflow-x:auto}
  .scroller table{min-width:840px}
  td.actions .segbar{flex-wrap:nowrap}
</style>
</head>
<body>
<div class="wrap">
  <h1>Station Library</h1>
  <p class="sub">
    Everything the station plays, in running order.
    <a class="backlink" href="/admin">Station admin</a> ·
    <a class="backlink" href="/stream">Listen</a>
  </p>

  <div class="card">
    <div class="notice" id="allSkipped" hidden>
      <span>
        <b>Every track is skipped.</b>
        <span class="muted">A station can't broadcast silence, so the rotation falls back to
        playing all of them anyway — skipping everything is the same as skipping nothing.
        Untick the tracks you do want on air.</span>
      </span>
    </div>

    <div class="notice" id="outOfSync" hidden>
      <span>
        <b>The air doesn't match this list yet.</b>
        <span class="muted" id="outOfSyncDetail"></span>
      </span>
    </div>

    <div class="toolbar">
      <label class="search">
        <input id="q" type="search" placeholder="Search title, artist, spoken spelling or filename…" autocomplete="off" />
        <button class="clear" id="clearBtn" hidden title="Clear search">Clear</button>
      </label>
      <span class="count" id="count"></span>
      <button class="mini" id="rescanBtn" title="Re-read the music source and apply it on air">Rescan</button>
    </div>

    <p class="muted" id="note">Loading&hellip;</p>
    <div class="scroller">
    <table id="table" hidden>
      <thead><tr>
        <th></th><th>Title</th><th>Artist</th>
        <th>Say title as</th><th>Say artist as</th>
        <th class="skipcell" title="Tick to keep the track but stop playing it">Skip</th><th></th>
      </tr></thead>
      <tbody id="body"></tbody>
    </table>
    </div>
    <div class="empty" id="empty" hidden></div>
  </div>
</div>
<div class="toast" id="toast"></div>
<script>
  function q(id){return document.getElementById(id)}
  function toast(msg,isErr){var t=q('toast');t.textContent=msg;t.className='toast show'+(isErr?' err':'');setTimeout(function(){t.className='toast'},2600)}
  function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e}
  function api(method,url,body){
    return fetch(url,{method:method,headers:{'Content-Type':'application/json'},
      body:body?JSON.stringify(body):undefined})
      .then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.message||'Failed');return j})});
  }

  var audio=new Audio();
  function say(text,btn){
    if(!text||!text.trim()){toast('Nothing to say',true);return}
    var label=btn.textContent;btn.disabled=true;btn.textContent='...';
    fetch('/admin/preview',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({text:text})})
      .then(function(r){if(!r.ok)return r.json().then(function(j){throw new Error(j.message||'Preview failed')});return r.blob()})
      .then(function(b){audio.src=URL.createObjectURL(b);return audio.play()})
      .catch(function(e){toast(e.message||'Preview failed',true)})
      .finally(function(){btn.disabled=false;btn.textContent=label});
  }

  var songs=[],editable=false,filter='';

  function matches(s){
    if(!filter)return true;
    var hay=[s.title,s.artist,s.phoneticTitle,s.phoneticArtist,s.file];
    for(var i=0;i<hay.length;i++){
      if(hay[i]&&String(hay[i]).toLowerCase().indexOf(filter)>-1)return true;
    }
    return false;
  }

  // Show where the match was, so a hit on a phonetic spelling or filename is
  // not a mystery when the visible title looks unrelated.
  function highlight(cell,text){
    cell.textContent='';
    if(!text){return}
    var low=String(text).toLowerCase(),at=filter?low.indexOf(filter):-1;
    if(at<0){cell.appendChild(document.createTextNode(text));return}
    cell.appendChild(document.createTextNode(text.slice(0,at)));
    cell.appendChild(el('mark',null,text.slice(at,at+filter.length)));
    cell.appendChild(document.createTextNode(text.slice(at+filter.length)));
  }

  function field(song,key,placeholder){
    var i=el('input');i.value=song[key]||'';i.placeholder=placeholder||'';
    i.onchange=function(){
      var patch={};patch[key]=i.value;
      api('PATCH','/admin/songs/'+song.id,patch)
        .then(function(u){song[key]=u[key];toast('Saved')})
        .catch(function(e){toast(e.message,true);i.value=song[key]||''});
    };
    return i;
  }

  function render(){
    var shown=songs.filter(matches);
    var skipped=songs.filter(function(s){return s.skip}).length;
    // Resting everything is a no-op the engine quietly undoes, so say so rather
    // than letting the operator believe they have taken the station off music.
    q('allSkipped').hidden=!(songs.length>0&&skipped===songs.length);
    q('count').textContent=filter
      ? shown.length+' of '+songs.length
      : songs.length+' track'+(songs.length===1?'':'s')
        +(skipped?' · '+skipped+' skipped':'');
    q('empty').hidden=shown.length>0||songs.length===0;
    if(shown.length===0&&songs.length>0){
      q('empty').textContent='No track matches "'+filter+'".';
    }
    q('table').hidden=shown.length===0;

    var b=q('body');b.textContent='';
    shown.forEach(function(song){
      var tr=el('tr');if(song.skip)tr.className='skipped';
      tr.appendChild(el('td','num',String(song.position+1)));

      var t=el('td');
      if(filter){
        var wrap=el('div');highlight(wrap,song.title);
        var fn=el('div','filename');highlight(fn,song.file);
        t.appendChild(wrap);t.appendChild(fn);
      } else {
        t.appendChild(field(song,'title'));
      }
      tr.appendChild(t);

      var a=el('td');
      if(filter){highlight(a,song.artist||'—')}
      else{a.appendChild(field(song,'artist','unknown'))}
      tr.appendChild(a);

      var pt=el('td');
      if(filter){highlight(pt,song.phoneticTitle||'')}
      else{pt.appendChild(field(song,'phoneticTitle','optional'))}
      tr.appendChild(pt);

      var pa=el('td');
      if(filter){highlight(pa,song.phoneticArtist||'')}
      else{pa.appendChild(field(song,'phoneticArtist','optional'))}
      tr.appendChild(pa);

      var skipTd=el('td','skipcell');
      var box=el('input');box.type='checkbox';box.checked=!!song.skip;
      box.title=song.skip
        ? 'Ticked: skipped. Untick to put it back in the rotation.'
        : 'Tick to keep the track but stop playing it.';
      box.onchange=function(){
        var wanted=box.checked;
        api('PATCH','/admin/songs/'+song.id,{skip:wanted}).then(function(u){
          song.skip=u.skip;render();checkOnAir();
          toast(u.skip?'Skipping '+song.title:song.title+' is back in rotation');
        }).catch(function(e){
          toast(e.message,true);box.checked=!wanted;  // put the tick back
        });
      };
      skipTd.appendChild(box);tr.appendChild(skipTd);

      var act=el('td','actions'),bar=el('div','segbar');
      var bt=el('button','mini','Hear title');
      bt.title='Hear the DJ say the title';
      bt.onclick=function(){say(song.phoneticTitle||song.title,bt)};
      var ba=el('button','mini','Hear artist');
      ba.title='Hear the DJ say the artist';
      ba.onclick=function(){
        var name=song.phoneticArtist||song.artist;
        if(!name){toast('No artist set for this track',true);return}
        say(name,ba);
      };
      bar.appendChild(bt);bar.appendChild(ba);

      // Reordering is meaningless against a filtered view — "up" would move the
      // track past rows you cannot see — so it is offered only unfiltered.
      if(!filter){
        var idx=songs.indexOf(song);
        var up=el('button','mini','Up');up.disabled=idx===0;
        up.onclick=function(){move(idx,idx-1)};
        var dn=el('button','mini','Down');dn.disabled=idx===songs.length-1;
        dn.onclick=function(){move(idx,idx+1)};
        bar.appendChild(up);bar.appendChild(dn);
      }

      var del=el('button','mini danger','delete');
      del.onclick=function(){
        if(!confirm('Remove "'+song.title+'" from the library? The file itself is left alone, so a rescan brings it back — use skip to rest it for good.'))return;
        api('DELETE','/admin/songs/'+song.id).then(function(){load();toast('Removed')})
          .catch(function(e){toast(e.message,true)});
      };
      bar.appendChild(del);
      act.appendChild(bar);tr.appendChild(act);
      b.appendChild(tr);
    });
  }

  function move(from,to){
    var copy=songs.slice(),m=copy.splice(from,1)[0];copy.splice(to,0,m);
    copy.forEach(function(s,i){s.position=i});
    songs=copy;render();
    api('POST','/admin/songs/reorder',{ids:copy.map(function(s){return s.id})})
      .then(function(list){songs=list;render();checkOnAir()})
      .catch(function(e){toast(e.message,true);load()});
  }

  // The running order is fixed when the broadcast starts, so skipping or
  // reordering changes this page at once and the air only at the next rescan.
  // Say so plainly rather than leaving it looking like the wrong song playing.
  function checkOnAir(){
    fetch('/admin/onair').then(function(r){return r.json()}).then(function(d){
      q('outOfSync').hidden=!!d.inSync;
      if(d.inSync)return;
      var playing=d.playing?'Playing '+d.playing+'. ':'';
      q('outOfSyncDetail').textContent=playing+'The station is running '
        +d.playlist.length+' track(s) chosen when it last started; this list now has '
        +d.expected.length+'. Press rescan to put your changes on air.';
    }).catch(function(){});
  }

  function load(){
    fetch('/admin/songs').then(function(r){return r.json()}).then(function(d){
      songs=d.songs||[];editable=d.editable;
      if(!editable){
        q('note').textContent='No database connected — the rotation is read-only.';
        q('table').hidden=true;return;
      }
      if(songs.length===0){
        q('note').textContent='No songs yet. Upload some and press rescan.';
        q('table').hidden=true;return;
      }
      q('note').textContent='Edits save as you leave a field.';
      render();checkOnAir();
    }).catch(function(){q('note').textContent='Could not load the library.'});
  }

  var typingTimer;
  q('q').addEventListener('input',function(e){
    var value=e.target.value;
    q('clearBtn').hidden=!value;
    clearTimeout(typingTimer);
    // A short pause keeps a long list from re-rendering on every keystroke.
    typingTimer=setTimeout(function(){filter=value.trim().toLowerCase();render()},120);
  });
  q('clearBtn').onclick=function(){
    q('q').value='';q('clearBtn').hidden=true;filter='';render();q('q').focus();
  };

  q('rescanBtn').onclick=function(){
    var btn=q('rescanBtn'),label=btn.textContent;
    btn.disabled=true;btn.textContent='scanning...';
    api('POST','/admin/songs/rescan').then(function(r){
      songs=r.songs||[];
      q('note').textContent='Edits save as you leave a field.';
      render();
      checkOnAir();
      if(r.refreshError){toast('Catalogued, but the running order needs a restart: '+r.refreshError,true)}
      else{toast(songs.length+' track(s) - now playing '+r.onAir)}
    }).catch(function(e){toast(e.message||'Rescan failed',true)})
      .finally(function(){btn.disabled=false;btn.textContent=label});
  };

  load();
</script>
</body>
</html>`;
