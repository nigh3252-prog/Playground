'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const library = $('library'), player = $('player'), sheet = $('sheet');
  const canvas = $('screen'), ctx = canvas.getContext('2d', {alpha:false});
  const games = new Map(arcadeGames.map(game => [game.id,game]));
  const idleApi = {held:()=>false, hud(){}, say(){}, tone(){}, win(){}};
  const stateKey = 'playground.afterlight.v1';
  let visits = {};
  try { visits = JSON.parse(localStorage.getItem(stateKey)) || {}; } catch {}
  function mark(id,status) {
    if(visits[id] !== 'won') visits[id]=status;
    try { localStorage.setItem(stateKey,JSON.stringify(visits)); } catch {}
  }
  const heldBySource = new Map(), suppressed = new Set();
  let phase='library', active=null, session=null, kind='All', ticket=0, lastTime=0;
  let audio=null, focusReturn=null, finishText='', visibleGames=[];
  const screenshots=new Map();
  const cardById=new Map();
  const activeKeys=()=>new Set(heldBySource.values());
  function setKey(source,key) {
    if(heldBySource.has(source)) return;
    const was=activeKeys().has(key);
    heldBySource.set(source,key);
    if(phase === 'play' && !suppressed.has(source) && !was) session?.press?.(key);
    syncKeys();
  }
  function unset(source){ heldBySource.delete(source);suppressed.delete(source);syncKeys(); }
  function clearInputs(){heldBySource.clear();suppressed.clear();syncKeys();}
  function syncKeys(){
    const keys=activeKeys();
    for(const btn of document.querySelectorAll('[data-key]')) btn.classList.toggle('held',keys.has(btn.dataset.key));
  }
  function unlockSound(){
    try{
      const Audio = window.AudioContext || window.webkitAudioContext;
      if(!audio && Audio) audio=new Audio();
      if(audio?.state==='suspended') audio.resume().catch(()=>{});
    }catch{}
  }
  function tone(hz=400,seconds=.1){
    if(!audio || audio.state!=='running' || phase!=='play' || !Number.isFinite(hz))return;
    const osc=audio.createOscillator(), volume=audio.createGain(), t=audio.currentTime;
    const duration=Math.min(.8,Math.max(.025,Number(seconds)||.1));
    osc.type='sine';osc.frequency.value=Math.min(3200,Math.max(45,hz));
    volume.gain.setValueAtTime(.0001,t);volume.gain.exponentialRampToValueAtTime(.055,t+.009);
    volume.gain.exponentialRampToValueAtTime(.0001,t+duration);
    osc.connect(volume).connect(audio.destination);osc.start(t);osc.stop(t+duration+.01);
    osc.onended=()=>{osc.disconnect();volume.disconnect();};
  }
  function impact(chain){
    if(!audio||audio.state!=='running'||phase!=='play')return;
    const osc=audio.createOscillator(),gain=audio.createGain(),now=audio.currentTime;
    osc.type='triangle';
    osc.frequency.setValueAtTime(260+Math.min(chain,5)*42,now);
    osc.frequency.exponentialRampToValueAtTime(46,now+.09);
    gain.gain.setValueAtTime(.17,now);gain.gain.exponentialRampToValueAtTime(.0001,now+.12);
    osc.connect(gain).connect(audio.destination);osc.start(now);osc.stop(now+.13);
    osc.onended=()=>{osc.disconnect();gain.disconnect();};
  }
  function textNode(tag,value,cls){
    const el=document.createElement(tag);if(cls)el.className=cls;el.textContent=value;return el;
  }
  function thumbnail(game,target){
    if(!target.isConnected) return;
    if(!screenshots.has(game.id)){
      const view=document.createElement('canvas');view.width=400;view.height=263;
      const brush=view.getContext('2d');brush.scale(400/640,263/420);
      const preview=game.create(idleApi);preview.draw(brush);
      screenshots.set(game.id,view);
    }
    target.getContext('2d').drawImage(screenshots.get(game.id),0,0);
  }
  const observer='IntersectionObserver' in window ? new IntersectionObserver(entries=>{
    for(const entry of entries) if(entry.isIntersecting){
      const canvas=entry.target;
      thumbnail(games.get(canvas.dataset.thumb),canvas);observer.unobserve(canvas);
    }
  },{rootMargin:'160px'}) : null;
  // Interleave shelves so the opening view contains different games and both kinds.
  function curated(){
    const buckets=[];
    for(let i=0;i<arcadeGames.length;i+=5)buckets.push(arcadeGames.slice(i,i+5));
    const result=[];
    for(let i=0;i<5;i++)for(const [j,bucket] of buckets.entries()){
      const game=bucket[(i+(j===5?0:j))%5];if(game)result.push(game);
    }
    return result;
  }
  const ordered=curated();
  function filtered(){
    const q=$('search').value.trim().toLowerCase();
    return ordered.filter(game=>
      (kind==='All'||kind===game.kind) &&
      (!$('genre').value || $('genre').value===game.genre) &&
      (!$('input').value || game.best==='Either'||game.best===$('input').value) &&
      (!q || [game.title,game.description,...game.sources.map(s=>s[0])].join(' ').toLowerCase().includes(q)));
  }
  function drawShelf(){
    observer?.disconnect();cardById.clear();visibleGames=filtered();
    const deck=$('cards');deck.replaceChildren();
    const finished=arcadeGames.filter(g=>visits[g.id]==='won').length;
    $('totals').textContent=arcadeGames.length+' games'+(finished?' · '+finished+' finished':'');
    for(const game of visibleGames){
      const card=document.createElement('button');card.className='tile';card.dataset.status=visits[game.id]||'new';card.dataset.game=game.id;
      card.style.setProperty('--accent',game.accent);card.setAttribute('aria-label','Play '+game.title);
      const art=document.createElement('div');art.className='art';
      const snap=document.createElement('canvas');snap.width=400;snap.height=263;snap.dataset.thumb=game.id;snap.setAttribute('aria-hidden','true');art.append(snap);
      const copy=document.createElement('div');copy.className='tile-copy';
      copy.append(textNode('span',game.kind+' / '+game.genre,'tile-tag'),textNode('h3',game.title),textNode('p',game.description),textNode('span',game.best==='Either'?'Touch + Backbone':game.best+' preferred','tile-best'));
      card.append(art,copy);card.onclick=()=>go(game.id);deck.append(card);cardById.set(game.id,card);
      if(observer)observer.observe(snap);else thumbnail(game,snap);
    }
    $('empty').hidden=visibleGames.length>0;$('surprise').disabled=!visibleGames.length;
  }
  $('kind').onclick=e=>{
    const btn=e.target.closest('[data-kind]');if(!btn)return;kind=btn.dataset.kind;
    for(const child of $('kind').children)child.setAttribute('aria-pressed',String(child===btn));
    drawShelf();
  };
  $('genre').onchange=$('input').onchange=$('search').oninput=drawShelf;
  function surprise(){
    const all=filtered().filter(g=>g.id!==active?.id);
    const fresh=all.filter(g=>!visits[g.id]);
    const pool=fresh.length?fresh:(all.length?all:filtered());
    if(pool.length)go(pool[Math.floor(Math.random()*pool.length)].id);
  }
  $('surprise').onclick=surprise;
  $('play-bankshot').onclick=()=>go('bankshot');
  function go(id){
    if(!games.has(id))return;
    if(location.hash==='#'+id)route();else location.hash=id;
  }
  function home(){
    if(location.hash)location.hash='';else route();
  }
  function sources(){
    const list=$('parents');list.replaceChildren();
    for(const [name,where,mechanic] of active.sources){
      const li=document.createElement('li');const match=/PR\s*#(\d+)/i.exec(where);
      if(match){const a=textNode('a',name);a.href='https://github.com/nigh3252-prog/Playground/pull/'+match[1];a.rel='noopener';a.target='_blank';li.append(a);}
      else li.append(textNode('strong',name));
      li.append(document.createTextNode(' · '+where+' — '+mechanic));list.append(li);
    }
    $('credits').hidden=!active.sources.length;$('credits').open=false;
  }
  function displaySheet(mode){
    phase=mode;clearInputs();sheet.hidden=false;player.style.setProperty('--accent',active.accent);
    $('sheet-title').textContent=mode==='won'?'Finished · '+active.title:active.title;
    $('sheet-meta').textContent=active.kind+' / '+active.genre+' · '+(active.best==='Either'?'Touch + Backbone':active.best+' preferred');
    $('sheet-desc').textContent=mode==='won'?finishText:active.description;
    $('sheet-play').hidden=mode==='won';$('help').textContent=active.controls;
    $('primary').textContent=mode==='intro'?'Play':mode==='pause'?'Resume':'Surprise me';
    $('retry').hidden=mode==='intro';$('pause').disabled=true;
    sources();$('primary').focus({preventScroll:true});
  }
  function play(){
    phase='play';sheet.hidden=true;$('pause').disabled=false;
    for(const source of heldBySource.keys())suppressed.add(source);
    if(document.activeElement instanceof HTMLElement)document.activeElement.blur();
    lastTime=performance.now();unlockSound();
  }
  function newSession(){
    const myTicket=++ticket;
    $('hud').textContent='';$('message').textContent='';finishText='';
    session=active.create({
      held(key){return phase==='play' && [...heldBySource].some(([source,value])=>value===key&&!suppressed.has(source));},
      hud(str){if(ticket===myTicket && $('hud').textContent!==String(str))$('hud').textContent=str??'';},
      say(str){if(ticket===myTicket && $('message').textContent!==String(str))$('message').textContent=str??'';},
      tone,impact,
      win(message){
        if(ticket!==myTicket || phase!=='play')return;
        finishText=message||'Adventure complete.';mark(active.id,'won');displaySheet('won');
      }
    });paint();
  }
  function paint(){
    if(!session)return;
    const vertical=active?.id==='bankshot' && matchMedia('(orientation: portrait)').matches;
    const width=vertical?420:640,height=vertical?640:420;
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
    ctx.save();
    try{
      ctx.clearRect(0,0,width,height);
      if(vertical){ctx.translate(0,height);ctx.rotate(-Math.PI/2);}
      session.draw(ctx);
    }finally{ctx.restore();}
  }
  function route(){
    let id;try{id=decodeURIComponent(location.hash.slice(1));}catch{id='';}
    if(id==='brasswater-bellworks'){id='bankshot';history.replaceState(null,'','#bankshot');}
    const game=games.get(id);
    player.classList.toggle('bankshot',id==='bankshot');
    clearInputs();ticket++;session=null;
    if(!game){
      active=null;phase='library';player.hidden=true;sheet.hidden=true;library.hidden=false;document.title='Afterlight Arcade · Playground';drawShelf();
      if(focusReturn)cardById.get(focusReturn)?.focus({preventScroll:true});return;
    }
    focusReturn=id;active=game;phase='intro';library.hidden=true;player.hidden=false;
    document.title=game.title+' · Afterlight Arcade';$('game-title').textContent=game.title;$('portrait-help').textContent=game.controls;
    newSession();
    if(id==='bankshot'){mark(id,'seen');play();}else displaySheet('intro');
  }
  function begin(){
    if(phase==='intro')mark(active.id,'seen');
    if(phase==='won'){surprise();return;}
    play();
  }
  $('primary').onclick=begin;$('home').onclick=$('leave').onclick=home;
  $('retry').onclick=()=>{newSession();mark(active.id,'seen');play();};
  $('pause').onclick=()=>{if(phase==='play')displaySheet('pause');};
  $('shelf-full').onclick=$('full').onclick=async()=>{
    try{
      if(document.fullscreenElement)await document.exitFullscreen();
      else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();
      else $('message').textContent='Fullscreen is unavailable in this browser.';
    }catch{$('message').textContent='Fullscreen is unavailable in this window.';}
  };
  for(const b of document.querySelectorAll('[data-key]')){
    b.onpointerdown=e=>{if(phase!=='play')return;e.preventDefault();b.setPointerCapture(e.pointerId);setKey('touch'+e.pointerId,b.dataset.key);};
    b.onlostpointercapture=b.onpointercancel=b.onpointerup=e=>unset('touch'+e.pointerId);
  }
  function gamePoint(e){
    const rect=canvas.getBoundingClientRect();
    const x=(e.clientX-rect.left)*canvas.width/rect.width;
    const y=(e.clientY-rect.top)*canvas.height/rect.height;
    return canvas.width===420?[640-y,x]:[x,y];
  }
  canvas.onpointerdown=e=>{
    if(phase!=='play')return;
    e.preventDefault();unlockSound();
    if(session.drag)canvas.setPointerCapture(e.pointerId);
    session.tap?.(...gamePoint(e));
  };
  canvas.onpointermove=e=>{
    if(phase==='play'&&canvas.hasPointerCapture(e.pointerId))session.drag?.(...gamePoint(e));
  };
  canvas.onlostpointercapture=()=>session?.release?.();
  const keyMap={ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right',ArrowUp:'up',KeyW:'up',ArrowDown:'down',KeyS:'down',KeyZ:'a',Space:'a',KeyX:'b'};
  window.addEventListener('keydown',e=>{
    if(phase==='library')return;
    if(e.code==='Escape' && !e.repeat){
      e.preventDefault();
      if(phase==='play')displaySheet('pause');else if(phase==='pause')play();else home();return;
    }
    if(phase==='play' && e.code==='KeyR' && !e.repeat){e.preventDefault();$('retry').click();return;}
    if(phase==='play' && keyMap[e.code]){e.preventDefault();if(!e.repeat)setKey('kb'+e.code,keyMap[e.code]);}
  });
  window.addEventListener('keyup',e=>{if(keyMap[e.code])unset('kb'+e.code);});
  function background(){if(phase==='play')displaySheet('pause');else clearInputs();}
  document.addEventListener('visibilitychange',()=>{if(document.hidden)background();});window.addEventListener('blur',background);
  let prevPad=new Set(), lastDir='', repeatAt=0;
  function moveFocus(key){
    const root=phase==='library'?library:sheet;
    const items=[...root.querySelectorAll('button:not(:disabled),summary,select,input,a[href]')].filter(el=>el.getClientRects().length);
    if(!items.length)return;
    const origin=document.activeElement;
    if(!items.includes(origin)){(phase==='library'?$('surprise'):$('primary')).focus();return;}
    const rect=origin.getBoundingClientRect(), x=rect.x+rect.width/2,y=rect.y+rect.height/2;
    let best=null, score=Infinity;
    for(const el of items){
      if(el===origin)continue;const r=el.getBoundingClientRect();
      const dx=r.x+r.width/2-x,dy=r.y+r.height/2-y;
      const main={up:-dy,down:dy,left:-dx,right:dx}[key];
      const side=Math.abs(key==='up'||key==='down'?dx:dy);
      if(main<3)continue;
      const distance=main+side*3+side*side/main;
      if(distance<score){score=distance;best=el;}
    }
    if(best){best.focus({preventScroll:true});best.scrollIntoView({block:'nearest',inline:'nearest'});}
  }
  function pollPad(now){
    let pad;try{pad=Array.from(navigator.getGamepads?.()||[]).find(Boolean);}catch{}
    const buttons=new Set();
    if(pad){
      const down=i=>pad.buttons[i]?.pressed;
      if(down(14)||pad.axes[0]<-.48)buttons.add('left');
      if(down(15)||pad.axes[0]>.48)buttons.add('right');
      if(down(12)||pad.axes[1]<-.48)buttons.add('up');
      if(down(13)||pad.axes[1]>.48)buttons.add('down');
      if(down(0))buttons.add('a');if(down(1))buttons.add('b');if(down(9))buttons.add('menu');
    }
    for(const k of prevPad)if(!buttons.has(k))unset('pad'+k);
    const wasPlay=phase==='play';
    for(const k of buttons){
      if(prevPad.has(k))continue;
      if(wasPlay){
        if(k==='menu')displaySheet('pause');else if(phase==='play')setKey('pad'+k,k);
      }else if(k==='a'){
        const root=phase==='library'?library:sheet;const el=document.activeElement;
        if(root.contains(el) && el.tagName==='SELECT'){el.selectedIndex=(el.selectedIndex+1)%el.options.length;el.dispatchEvent(new Event('change'));}
        else if(root.contains(el)&&el.matches('button,summary,a'))el.click();
        else if(phase==='library')$('surprise').focus();else $('primary').click();
      }else if(k==='b'||k==='menu'){if(phase==='pause')play();else if(phase!=='library')home();}
    }
    if(!wasPlay && phase!=='play'){
      const dir=['up','down','left','right'].find(k=>buttons.has(k))||'';
      if(dir && (lastDir!==dir || now>=repeatAt)){moveFocus(dir);repeatAt=now+(dir===lastDir?160:380);}
      lastDir=dir;
    }else lastDir='';
    prevPad=buttons;
  }
  function frame(now){
    pollPad(now);
    if(phase==='play' && session){session.update?.(Math.min(.045,Math.max(0,(now-lastTime)/1000)));paint();}
    lastTime=now;requestAnimationFrame(frame);
  }
  window.addEventListener('hashchange',route);route();requestAnimationFrame(frame);
})();
