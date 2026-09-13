import assert from "node:assert/strict";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {spawn} from "node:child_process";
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.ARMORY_PLAYWRIGHT_MODULE||"playwright");
const out="armory/review",generate=process.argv.includes("--thumbnails");
await mkdir(out,{recursive:true});
if(generate) await mkdir("armory/thumbs",{recursive:true});
const server=spawn("python3",["-m","http.server","8765","--bind","127.0.0.1"],{stdio:"ignore"});
const base="http://127.0.0.1:8765";
let browser;
try {
  for(let i=0;i<50;i++){try{await fetch(base);break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}
  browser=await chromium.launch({headless:true,args:["--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
  const context=await browser.newContext({viewport:{width:1440,height:950},acceptDownloads:true});
  const page=await context.newPage(),errors=[],remote=[];
  page.on("pageerror",error=>errors.push(error.message));
  page.on("request",request=>{if(!request.url().startsWith(base)&&!request.url().startsWith("data:")&&!request.url().startsWith("blob:"))remote.push(request.url());});
  await page.goto(base+"/armory/");await page.waitForFunction(()=>window.armory && document.body.dataset.ready && document.body.dataset.ready!=="error");
  const models=await page.evaluate(()=>window.armory.models),report={models:models.length,packs:new Set(models.map(m=>m.pack)).size,checks:[],rendered:[]};
  if(generate) {
    await page.setViewportSize({width:480,height:320});
    await page.addStyleTag({content:".topbar,.packbar,.catalog-panel,.stage-heading,.view-tools,.stage-footer,.load-status,.inspect-panel{display:none!important}.workspace{display:block!important;min-height:0!important;height:100vh!important}.viewer{height:100vh!important;min-height:0!important}.viewer:after{display:none!important}"});
  }
  for(const model of models) {
    await page.evaluate(id=>window.armory.select(id),model.id);
    assert.equal(await page.evaluate(()=>document.body.dataset.ready),model.id,"load "+model.id);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const stats=await page.evaluate(()=>{
      const source=document.querySelector("#stage canvas"),canvas=document.createElement("canvas");canvas.width=source.width;canvas.height=source.height;
      const c=canvas.getContext("2d");c.drawImage(source,0,0);const pixels=c.getImageData(0,0,canvas.width,canvas.height).data;
      let filled=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]>100)filled++;
      return {filled,geometry:window.armory.state.renderer.geometries,textures:window.armory.state.renderer.textures};
    });
    assert(stats.filled>100,"visible pixels "+model.id);
    report.rendered.push({id:model.id,...stats});
    if(generate) await page.locator("#stage canvas").screenshot({path:"armory/thumbs/"+model.id+".png",omitBackground:true});
    console.log("RENDER",model.id,stats.filled,"pixels",stats.geometry,"geometries");
  }
  report.checks.push("Every GLB loads and renders visible geometry; no external runtime requests");
  await page.setViewportSize({width:1440,height:950});await page.reload();
  await page.waitForFunction(()=>window.armory && document.body.dataset.ready===window.armory.models[0].id);
  assert.equal((await page.locator("#pack option").count()),report.packs+1);
  for(const pack of [...new Set(models.map(m=>m.pack))]) {
    await page.selectOption("#pack",pack);
    assert.equal(await page.locator(".card").count(),models.filter(m=>m.pack===pack).length);
  }
  await page.selectOption("#pack","all");await page.selectOption("#era","WWI");
  assert((await page.locator(".card").count())>=2);
  await page.selectOption("#era","WWII");assert((await page.locator(".card").count())>=2);
  await page.selectOption("#era","all");await page.fill("#search","a-query-with-no-match");
  assert(await page.locator("#empty").isVisible());await page.click("#clear-filters");await page.locator(".card-select").first().click();
  await page.waitForFunction(()=>document.body.dataset.ready===window.armory.models[0].id);
  report.checks.push("Pack, era, search, and empty-state filters");
  await page.click("#model-favorite");
  const first=models[0],second=models.find(m=>m.pack!==first.pack);
  await page.selectOption("#pack",second.pack);
  await page.waitForFunction(id=>document.body.dataset.ready===id,second.id);await page.click("#model-favorite");
  await page.reload();await page.waitForFunction(()=>window.armory&&document.body.dataset.ready===window.armory.models[0].id);
  assert.equal(await page.locator("#favorite-count").innerText(),"2");
  await page.selectOption("#pack",first.pack);await page.click("#export-open");
  assert.equal(await page.locator(".favorite-item").count(),2);
  await page.locator(".favorite-item textarea").first().fill("Warden left arm — test note");
  let pending=page.waitForEvent("download");await page.click("#export-json");
  let download=await pending;await download.saveAs(out+"/warden-favorites.json");
  const manifest=JSON.parse(await readFile(out+"/warden-favorites.json","utf8"));
  assert.equal(manifest.favorites.length,2);assert.equal(manifest.favorites[0].notes,"Warden left arm — test note");
  pending=page.waitForEvent("download");await page.click("#export-zip");download=await pending;await download.saveAs(out+"/warden-favorites.zip");
  const zipScript=[
    "import hashlib,json,zipfile",
    "with zipfile.ZipFile('armory/review/warden-favorites.zip') as z:",
    " assert z.testzip() is None",
    " d=json.loads(z.read('warden-favorites.json'))",
    " assert len(d['favorites'])==2",
    " assert 'CREDITS.txt' in z.namelist() and 'README.txt' in z.namelist()",
    " for m in d['favorites']:",
    "  assert hashlib.sha256(z.read(m['file'])).hexdigest()==m['sha256']",
    "print('ZIP CRC and every exported model SHA-256 verified')"
  ].join("\n");
  const unpack=spawn("python3",["-c",zipScript],{stdio:"inherit"});
  assert.equal(await new Promise(resolve=>unpack.on("exit",resolve)),0);
  await page.setInputFiles("#import-json",{name:"bad.json",mimeType:"application/json",buffer:Buffer.from('{"schema":"wrong"}')});
  await page.waitForFunction(()=>document.getElementById("export-status").textContent.includes("not a supported"));
  await page.click('[aria-label="Close export"]');
  await page.evaluate(()=>localStorage.removeItem("warden-armory:v1"));await page.reload();
  await page.waitForFunction(()=>window.armory&&document.body.dataset.ready===window.armory.models[0].id);
  await page.click("#help-open");await page.getByRole("button",{name:"Import favorites…"}).click();
  await page.setInputFiles("#import-json",out+"/warden-favorites.json");
  await page.waitForFunction(()=>document.getElementById("export-status").textContent.includes("Imported 2"));
  assert.equal(await page.locator(".favorite-item textarea").first().inputValue(),"Warden left arm — test note");
  await page.click('[aria-label="Close export"]');
  await page.click("#favorites-filter");assert.equal(await page.locator(".card").count(),2);await page.click("#favorites-filter");
  report.checks.push("Cross-pack favorites persist; notes and JSON round-trip; ZIP CRC and model hashes; invalid import rejected");
  const before=await page.evaluate(()=>window.armory.state.camera),rect=await page.locator("#stage canvas").boundingBox();
  await page.mouse.move(rect.x+rect.width*.5,rect.y+rect.height*.5);await page.mouse.down();await page.mouse.move(rect.x+rect.width*.65,rect.y+rect.height*.6,{steps:12});await page.mouse.up();
  const after=await page.evaluate(()=>window.armory.state.camera);assert.notDeepEqual(before,after);
  const zoomBefore=await page.evaluate(()=>window.armory.state.camera);
  await page.mouse.wheel(0,-300);await page.waitForTimeout(200);
  assert.notDeepEqual(await page.evaluate(()=>window.armory.state.camera),zoomBefore,"wheel zoom");
  const panBefore=await page.evaluate(()=>window.armory.state.target);
  await page.mouse.move(rect.x+rect.width*.5,rect.y+rect.height*.5);await page.mouse.down({button:"right"});await page.mouse.move(rect.x+rect.width*.57,rect.y+rect.height*.54,{steps:10});await page.mouse.up({button:"right"});
  assert.notDeepEqual(await page.evaluate(()=>window.armory.state.target),panBefore,"right drag pan");
  await page.click("#reset-view");
  await page.click("#inspect-open");await page.check("#wireframe");await page.uncheck("#wireframe");await page.click("#rotate-y");await page.click("#inspect-close");
  await page.click("#spin");assert.equal(await page.locator("#spin").getAttribute("aria-pressed"),"true");await page.click("#spin");
  await page.selectOption("#pack","historical");await page.waitForFunction(()=>document.body.dataset.ready.startsWith("historical-"));
  await page.screenshot({path:out+"/desktop.png",fullPage:true});
  report.checks.push("Orbit, pan, wheel zoom, fit, wireframe, orientation and spin controls");
  const mobile=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
  const phone=await mobile.newPage();phone.on("pageerror",error=>errors.push(error.message));
  await phone.goto(base+"/armory/");await phone.waitForFunction(()=>window.armory&&document.body.dataset.ready===window.armory.models[0].id);
  assert(await phone.locator("#pack").isVisible());assert(await phone.locator("#stage canvas").isVisible());
  assert(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),"no horizontal overflow");
  await phone.selectOption("#pack","modular");await phone.waitForFunction(()=>document.body.dataset.ready.startsWith("modular-"));
  await phone.tap("#model-favorite");assert.equal(await phone.locator("#favorite-count").innerText(),"1");
  await phone.tap("#catalog-toggle");assert.equal(await phone.locator("#catalog-toggle").getAttribute("aria-expanded"),"false");
  await phone.tap("#catalog-toggle");
  await phone.screenshot({path:out+"/mobile.png",fullPage:true});
  report.checks.push("390px portrait layout, pack switching, touch favorite, collapsible catalog, no horizontal overflow");
  assert.deepEqual(errors,[],"uncaught browser errors");assert.deepEqual(remote,[],"unexpected remote runtime requests");
  report.errors=errors;report.externalRequests=remote;await writeFile(out+"/report.json",JSON.stringify(report,null,2)+"\n");
  console.log("PASS",JSON.stringify({models:report.models,packs:report.packs,checks:report.checks}));
} finally {await browser?.close();server.kill();}
