const HEAVY_MODELS = [
  {
    id: "heavy-m125x-minigun",
    name: "M125X Minigun",
    creator: "Bl4ckGh0st",
    era: "Sci-fi",
    type: "Heavy minigun",
    triangles: 18900,
    uid: "667cf95a5f924105b81db57de71a44a2",
    source: "https://sketchfab.com/3d-models/m125x-minigun-667cf95a5f924105b81db57de71a44a2",
    license: "CC BY",
    note: "Custom six-barrel heavy minigun with ammo cartridge and support hardware."
  },
  {
    id: "heavy-minigun-animated",
    name: "Minigun Animated",
    creator: "DJMaesen",
    era: "Modern",
    type: "Animated minigun",
    triangles: 19900,
    uid: "e5dbbb2d2e594ebfac33d82d65a97380",
    source: "https://sketchfab.com/3d-models/minigun-animated-e5dbbb2d2e594ebfac33d82d65a97380",
    license: "CC BY",
    note: "Animated first-person minigun with fire, reload, ready, hide and melee clips."
  },
  {
    id: "heavy-scifi-cannon",
    name: "Sci-Fi Cannon",
    creator: "unleasharun",
    era: "Sci-fi",
    type: "Heavy cannon",
    triangles: 14400,
    uid: "6be6c1702b8340ab9e4019baa8b75ef6",
    source: "https://sketchfab.com/3d-models/sci-fi-cannon-weapon-6be6c1702b8340ab9e4019baa8b75ef6",
    license: "CC BY",
    note: "Original broad industrial sci-fi cannon; especially useful as a mech-scale silhouette reference."
  },
  {
    id: "heavy-phalanx-ciws",
    name: "Phalanx CIWS / M61",
    creator: "Lemper_Studio",
    era: "Modern",
    type: "Rotary autocannon",
    triangles: 42900,
    uid: "b811949a2ba543aab5fde70ecdf0bf6d",
    source: "https://sketchfab.com/3d-models/phalanx-ciws-b811949a2ba543aab5fde70ecdf0bf6d",
    license: "CC BY",
    note: "Naval CIWS built around an M61-style rotary cannon; strong forearm, shoulder or backpack-gun reference."
  },
  {
    id: "heavy-ntw20",
    name: "Denel NTW-20",
    creator: "Amapsis",
    era: "Modern",
    type: "20 mm anti-materiel rifle",
    triangles: 34100,
    uid: "c2946bb98cca4e7988d918fb6da3b8a9",
    source: "https://sketchfab.com/3d-models/denel-ntw-20-c2946bb98cca4e7988d918fb6da3b8a9",
    license: "CC BY",
    note: "Huge game-ready 20 mm anti-materiel rifle; a natural basis for a slow Warden hand cannon."
  },
  {
    id: "heavy-m2hb",
    name: "M2HB Browning .50",
    creator: "PrasadSawant",
    era: "Modern",
    type: "Heavy machine gun",
    triangles: 8200,
    uid: "c526dc0a603c4e40a4400412e9745ad5",
    source: "https://sketchfab.com/3d-models/m2hb-browning-heavy-machine-gun-c526dc0a603c4e40a4400412e9745ad5",
    license: "CC BY",
    note: "Low-complexity .50-cal heavy machine gun; useful as a grounded mech-HMG foundation."
  },
  {
    id: "heavy-mk19",
    name: "Mk 19 Low-Poly",
    creator: "ToporEnterprise",
    era: "Modern",
    type: "40 mm grenade launcher",
    triangles: 6100,
    uid: "9965461e257f4240a86b15a784d78fb2",
    source: "https://sketchfab.com/3d-models/mk19-low-poly-9965461e257f4240a86b15a784d78fb2",
    license: "CC BY",
    note: "Short, boxy automatic grenade launcher; a useful silhouette break from rifles and rotary guns."
  },
  {
    id: "heavy-abrams-gau8",
    name: "Abrams GAU-8 Turret Package",
    creator: "Daniel Skomorovsky",
    era: "Sci-fi",
    type: "GAU-8 turret / feed system",
    triangles: 2800000,
    uid: "2f20a27b2f1e457090f3b562d1053a79",
    source: "https://sketchfab.com/3d-models/m1a2-abrams-minigun-turret-attachment-2f20a27b2f1e457090f3b562d1053a79",
    license: "CC BY · NoAI",
    noAI: true,
    note: "Fictional GAU-8 package with ammunition drums and feed hardware. Very heavy; best treated as visual reference."
  },
  {
    id: "heavy-lmg",
    name: "LMG",
    creator: "DJMaesen",
    era: "Modern",
    type: "Light machine gun",
    triangles: 12500,
    uid: "12d809cc6bda4b1191bf35c8e65c1f7e",
    source: "https://sketchfab.com/3d-models/lmg-12d809cc6bda4b1191bf35c8e65c1f7e",
    license: "CC BY",
    note: "Game-ready LMG sample; useful as the smaller end of the Warden heavy-weapon spectrum."
  }
];

const $ = id => document.getElementById(id);
const storageKey = "warden-armory:heavy-references:v1";
let active = false;
let selected = 0;
let onlyFavorites = false;
let favorites = new Set();
let frame;
let toggle;

try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
  favorites = new Set(Array.isArray(saved.favorites) ? saved.favorites.filter(id => HEAVY_MODELS.some(m => m.id === id)) : []);
} catch {}

function persist() {
  try { localStorage.setItem(storageKey, JSON.stringify({favorites:[...favorites]})); } catch {}
}
function fmt(n) { return n >= 1_000_000 ? (n/1_000_000).toFixed(1)+"M" : n >= 1000 ? (n/1000).toFixed(1)+"k" : String(n); }
function sketchfabEmbed(model) { return `https://sketchfab.com/models/${model.uid}/embed?autostart=1&ui_theme=dark&ui_infos=0&ui_stop=0`; }
function current() { return HEAVY_MODELS[selected]; }
function toast(message) {
  const el=$("toast");if(!el)return;el.textContent=message;el.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.hidden=true,3500);
}
function saveReferenceJson() {
  const picks=HEAVY_MODELS.filter(m=>favorites.has(m.id));
  if(!picks.length)return;
  const data={schema:"warden-armory-reference-selection",version:1,createdAt:new Date().toISOString(),intendedProject:"Warden Mech",note:"Source-hosted reference models. Download model files from each creator's source page and preserve attribution/license terms.",favorites:picks};
  const blob=new Blob([JSON.stringify(data,null,2)+"\n"],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download="warden-heavy-references.json";document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);toast("Heavy reference shortlist exported.");
}
function filteredModels() {
  const q=$("search").value.trim().toLowerCase(),era=$("era").value;
  return HEAVY_MODELS.filter(m=>(era==="all"||m.era===era)&&(!onlyFavorites||favorites.has(m.id))&&(!q||[m.name,m.creator,m.type,m.note,m.era].join(" ").toLowerCase().includes(q)));
}
function updateFavorites() {
  $("favorite-count").textContent=favorites.size;
  $("favorites-filter").setAttribute("aria-pressed",String(onlyFavorites));
  $("export-open").disabled=favorites.size===0;
  $("export-open").textContent="Export refs ↗";
  const model=current(),on=model&&favorites.has(model.id);
  $("model-favorite").disabled=!model;$("model-favorite").textContent=on?"★":"☆";$("model-favorite").setAttribute("aria-pressed",String(!!on));
  document.querySelectorAll(".card-star[data-heavy-id]").forEach(b=>{const on=favorites.has(b.dataset.heavyId);b.textContent=on?"★":"☆";b.setAttribute("aria-pressed",String(on));});
}
function selectModel(id) {
  const index=HEAVY_MODELS.findIndex(m=>m.id===id);if(index<0)return;selected=index;
  const model=current();
  $("model-era").textContent=model.era.toUpperCase()+" · "+model.type.toUpperCase();
  $("model-name").textContent=model.name;
  $("model-byline").textContent=model.creator+" · "+model.license;
  $("source-link").href=model.source;
  $("mesh-stats").textContent=fmt(model.triangles)+" triangles · source-hosted reference";
  $("load-status").textContent=(model.noAI?"Reference only · NoAI source term · ":"Interactive source model · ")+"download from Source to reuse with attribution.";
  $("retry-model").hidden=true;
  $("position").textContent=(index+1)+" / "+HEAVY_MODELS.length;
  $("previous").disabled=$("next").disabled=false;
  $("stage").querySelector("canvas")?.style.setProperty("visibility","hidden");
  if(!frame){frame=document.createElement("iframe");frame.className="heavy-embed";frame.title="Interactive heavy weapon reference";frame.allow="autoplay; fullscreen; xr-spatial-tracking";frame.allowFullscreen=true;$("stage").append(frame);}
  frame.src=sketchfabEmbed(model);
  document.querySelectorAll(".card").forEach(card=>card.classList.toggle("active",card.dataset.id===id));
  updateFavorites();
}
function renderCards() {
  const list=filteredModels(),cards=$("cards");cards.replaceChildren();
  for(const model of list) {
    const card=document.createElement("article");card.className="card"+(current()?.id===model.id?" active":"");card.dataset.id=model.id;
    const pick=document.createElement("button");pick.className="card-select";pick.setAttribute("aria-label","View "+model.name);
    const thumb=document.createElement("span");thumb.className="heavy-thumb";thumb.innerHTML=`<b>${model.type.includes("minigun")||model.type.includes("Rotary")?"◉◉◉":"▰"}</b><small>${fmt(model.triangles)} tris</small>`;
    const name=document.createElement("span");name.className="card-name";name.textContent=model.name;
    const era=document.createElement("span");era.className="card-era";era.textContent=model.type;
    pick.append(thumb,name,era);pick.addEventListener("click",()=>selectModel(model.id));
    const star=document.createElement("button");star.className="card-star";star.dataset.heavyId=model.id;star.addEventListener("click",event=>{event.stopPropagation();if(favorites.has(model.id))favorites.delete(model.id);else favorites.add(model.id);persist();updateFavorites();if(onlyFavorites)renderCards();});
    card.append(pick,star);cards.append(card);
  }
  $("result-count").textContent=list.length+" heavy refs";$("empty").hidden=list.length>0;
  $("pack-caption").textContent="9 free source-hosted heavy weapons · CC BY. Paid models excluded. Download originals from Source before shipping them in Warden.";
  updateFavorites();
  if(list.length&&!list.some(m=>m.id===current()?.id))selectModel(list[0].id);
}
function enterHeavy() {
  if(active)return;active=true;onlyFavorites=false;toggle.textContent="← Regular packs";toggle.setAttribute("aria-pressed","true");
  document.body.classList.add("heavy-reference-mode");
  $("view-tools").hidden=true;$("inspect-panel").hidden=true;$("inspect-open").setAttribute("aria-expanded","false");
  $("collection-count").textContent="87 BUNDLED + 9 HEAVY REFS";
  $("gesture-hint").textContent="Drag to orbit · Pinch to zoom · source-hosted";
  renderCards();selectModel(current()?.id||HEAVY_MODELS[0].id);
}
function exitHeavy(dispatch=true) {
  if(!active)return;active=false;onlyFavorites=false;toggle.textContent="Heavy refs · 9";toggle.setAttribute("aria-pressed","false");document.body.classList.remove("heavy-reference-mode");
  frame?.remove();frame=null;const canvas=$("stage").querySelector("canvas");if(canvas)canvas.style.visibility="";
  $("view-tools").hidden=false;$("gesture-hint").textContent="Drag to orbit · Pinch to zoom";$("export-open").textContent="Export favorites ↗";
  if(dispatch)$("pack").dispatchEvent(new Event("change",{bubbles:true}));
  setTimeout(()=>{const id=window.armory?.current;if(id)window.armory.select(id);},0);
}
function move(delta) { const list=filteredModels();if(!list.length)return;let i=list.findIndex(m=>m.id===current()?.id);selectModel(list[(i+delta+list.length)%list.length].id); }
function toggleCurrentFavorite() {const model=current();if(!model)return;if(favorites.has(model.id))favorites.delete(model.id);else favorites.add(model.id);persist();updateFavorites();if(onlyFavorites)renderCards();toast(favorites.has(model.id)?"Saved heavy reference":"Removed heavy reference");}

function injectStyle() {
  const style=document.createElement("style");style.textContent=`
  .heavy-embed{position:absolute;inset:0;width:100%;height:100%;border:0;background:#0d1117;z-index:2}
  .heavy-reference-mode #stage{position:relative}
  .heavy-reference-mode .stage-heading,.heavy-reference-mode .stage-footer,.heavy-reference-mode .load-status{z-index:3}
  .heavy-reference-mode .stage-heading,.heavy-reference-mode .stage-footer{pointer-events:none}
  .heavy-reference-mode .stage-heading button,.heavy-reference-mode .stage-footer button,.heavy-reference-mode .stage-footer a{pointer-events:auto}
  .heavy-thumb{height:112px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.35rem;background:linear-gradient(145deg,#1a222d,#0e131a);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#c4ee8f;border-bottom:1px solid #2a3442}
  .heavy-thumb b{font-size:2rem;letter-spacing:.15em}.heavy-thumb small{color:#8290a3;font-size:.72rem;text-transform:uppercase;letter-spacing:.08em}
  #heavy-ref-toggle[aria-pressed="true"]{border-color:#c4ee8f;color:#c4ee8f}
  `;document.head.append(style);
}

async function boot() {
  for(let i=0;i<100&&!window.armory;i++)await new Promise(r=>setTimeout(r,50));
  if(!window.armory)return;
  injectStyle();
  toggle=document.createElement("button");toggle.id="heavy-ref-toggle";toggle.className="quiet";toggle.type="button";toggle.textContent="Heavy refs · 9";toggle.setAttribute("aria-pressed","false");toggle.title="Browse free LMGs, miniguns, autocannons and other oversized weapon references";
  $("pack").closest(".packbar").insertBefore(toggle,$("catalog-toggle"));
  toggle.addEventListener("click",()=>active?exitHeavy():enterHeavy());

  document.addEventListener("change",event=>{
    if(!active)return;
    if(event.target.id==="pack"){exitHeavy(false);return;}
    if(event.target.id==="era"){event.stopImmediatePropagation();renderCards();}
  },true);
  document.addEventListener("input",event=>{if(active&&event.target.id==="search"){event.stopImmediatePropagation();renderCards();}},true);
  document.addEventListener("click",event=>{
    if(!active)return;const target=event.target.closest("button,a");if(!target)return;
    if(target.id==="model-favorite"){event.preventDefault();event.stopImmediatePropagation();toggleCurrentFavorite();}
    else if(target.id==="previous"){event.preventDefault();event.stopImmediatePropagation();move(-1);}
    else if(target.id==="next"){event.preventDefault();event.stopImmediatePropagation();move(1);}
    else if(target.id==="favorites-filter"){event.preventDefault();event.stopImmediatePropagation();onlyFavorites=!onlyFavorites;renderCards();}
    else if(target.id==="clear-filters"){event.preventDefault();event.stopImmediatePropagation();$("era").value="all";$("search").value="";onlyFavorites=false;renderCards();}
    else if(target.id==="export-open"){event.preventDefault();event.stopImmediatePropagation();saveReferenceJson();}
  },true);
  document.addEventListener("keydown",event=>{
    if(!active||event.ctrlKey||event.metaKey||event.altKey||/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)||document.querySelector("dialog[open]"))return;
    if(event.key==="ArrowLeft"){event.preventDefault();event.stopImmediatePropagation();move(-1);}
    else if(event.key==="ArrowRight"){event.preventDefault();event.stopImmediatePropagation();move(1);}
    else if(event.key.toLowerCase()==="f"){event.preventDefault();event.stopImmediatePropagation();toggleCurrentFavorite();}
  },true);
}
boot();
