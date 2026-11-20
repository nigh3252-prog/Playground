import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {readFile} from 'node:fs/promises';
import {defaultFilters, filterModels} from '../filters.mjs';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.MODEL_BENCH_PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../../', import.meta.url);
const port = Number(process.env.PORT || 17861);
const origin = `http://127.0.0.1:${port}`;
const bench = `${origin}/models/`;
test('native review bench switches, animates, recovers and fits phones', {timeout:300000}, async () => {
  const catalog = JSON.parse(await readFile(new URL('../catalog.json', import.meta.url)));
  const server = spawn('python3',['-m','http.server',String(port),'--bind','127.0.0.1'], {cwd:root, stdio:'ignore'});
  let browser;
  try {
    for(let i=0;i<30;i++) {
      try { if ((await fetch(origin)).ok) break; } catch {}
      if (i===29) throw Error('Local test server unavailable');
      await delay(100);
    }
    browser = await chromium.launch({
      ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH}:{}),
      args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],
    });
    const context = await browser.newContext({viewport:{width:1280,height:900},permissions:['clipboard-read','clipboard-write']});
    const page = await context.newPage();
    await page.addInitScript(() => {
      let viewerFrames = 0;
      const original = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = callback => original(time => {
        if (callback.name === 'draw') viewerFrames++;
        callback(time);
      });
      window.viewerFrameCount = () => viewerFrames;
    });
    const errors=[], glbs=[], glbURLs=[];
    page.on('pageerror', error=>errors.push(error.message));
    page.on('request', request => {
      if (!request.url().endsWith('.glb')) return;
      glbs.push(request.url().split('/').pop());
      glbURLs.push(new URL(request.url()));
    });
    await page.goto(bench);
    const stage = page.locator('#stage');
    const heading = page.locator('#model-name');
    const ready = async id => {await page.waitForFunction(id=>document.getElementById('stage').dataset.model === id, id);};
    await ready('dot'); assert.equal(await heading.textContent(),'Dot');
    assert.deepEqual(glbs,['dot-v1.glb']);
    assert.equal(await page.locator('#metadata').isVisible(),false);
    assert.equal(await stage.locator('canvas').count(),1);
    await delay(180);
    const framesAtRest = await page.evaluate(() => window.viewerFrameCount());
    assert(framesAtRest > 0, 'the scene drew at least once');
    await delay(180);
    assert.equal(await page.evaluate(() => window.viewerFrameCount()),framesAtRest,'paused scene does not run a render loop');
    await page.locator('#model-picker').selectOption(String(catalog.models.findIndex(m=>m.id==='white-mech')));
    await ready('white-mech'); assert.match(page.url(),/model=white-mech&v=v1$/);
    const skeleton = page.locator('#show-skeleton');
    await skeleton.waitFor({state:'visible'});
    assert.equal(await skeleton.isChecked(),false,'rig overlay starts off');
    const walk = page.locator('#clip');
    await walk.selectOption({label:'Walk Preview'});
    assert.equal(await walk.locator('option').count(),4);
    const scrub = page.locator('#scrub');
    const canvas = stage.locator('canvas');
    const withoutSkeleton = await canvas.screenshot();
    const framesBeforeOverlay = await page.evaluate(() => window.viewerFrameCount());
    await skeleton.check();
    await page.waitForFunction(frames => Number(document.querySelector('#stage').dataset.skeleton) === 41
      && window.viewerFrameCount() > frames,framesBeforeOverlay);
    const restPose = await canvas.screenshot();
    assert.notDeepEqual(restPose,withoutSkeleton,'actual skin overlay is rendered');
    await scrub.evaluate(element=>{element.value=String(Number(element.max)/2);element.dispatchEvent(new Event('input',{bubbles:true}));});
    const time = await scrub.inputValue();
    await delay(250);
    assert.equal(await scrub.inputValue(),time,'scrubbing a paused clip does not resume');
    assert(Number(time)>0);
    assert.notDeepEqual(await canvas.screenshot(),restPose,'scrubbing renders a different pose');
    await page.getByRole('button',{name:'Play animation'}).click();
    await page.waitForFunction(time=>Number(document.getElementById('scrub').value)>Number(time),time);
    await page.getByRole('button',{name:'Pause animation'}).click();
    await skeleton.uncheck();
    await page.waitForFunction(() => !document.querySelector('#stage').dataset.skeleton);
    const copy = page.getByRole('button',{name:'Copy link'});
    await copy.click();
    await page.getByRole('button',{name:'Copied'}).waitFor();
    assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),page.url());
    await page.getByRole('button',{name:'Previous model'}).click();
    await ready('crocodilian');
    assert.equal(await page.locator('#animation').isVisible(),false);
    assert.equal(await skeleton.isVisible(),false,'non-skins do not expose a skeleton control');
    assert.equal(await page.locator('#static-label').isVisible(),true);
    await page.goBack();await ready('white-mech');
    await page.goForward();await ready('crocodilian');
    await page.getByRole('button',{name:'Previous model'}).click();
    await ready('dot');
    await page.route('**/white-mech-v1.glb',route=>route.abort());
    await page.goto(bench+'?model=white-mech&v=v1');
    await page.getByRole('button',{name:'Retry'}).waitFor({state:'visible'});
    await page.unroute('**/white-mech-v1.glb');
    await page.getByRole('button',{name:'Retry'}).click();
    await ready('white-mech');
    await page.goto(bench+'?model=white-mech&v=wrong');await ready('dot');
    assert.match(await page.locator('#lookup-note').textContent(),/not in the catalog/i);
    assert.equal(await stage.locator('canvas').count(),1);
    await page.route('**/crocodilian-v1.glb',route=>route.abort());
    await page.getByRole('button',{name:'Next model'}).click();
    await page.getByRole('button',{name:'Next model'}).click();
    await ready('white-mech');
    assert.equal(await page.locator('#retry').isVisible(),false);
    await page.unroute('**/crocodilian-v1.glb');
    const armory = catalog.models.filter(model => model.sourceCollection === 'armory');
    assert.equal(armory.length,87);
    assert.equal(new Set(armory.map(model => model.pack)).size,7);
    assert.equal(armory.filter(model => model.clips.length).length,6);
    for (const [index, entry] of catalog.models.entries()) {
      if (index < 3) continue;
      await page.locator('#model-picker').selectOption(String(index));
      await page.waitForFunction(({id,version}) => {
        const {model,version:loadedVersion} = document.querySelector('#stage').dataset;
        return model === id && loadedVersion === version;
      }, entry);
      const installedFrames = await page.evaluate(() => window.viewerFrameCount());
      await page.locator('#fit').click();
      await page.waitForFunction(frames => window.viewerFrameCount() > frames,installedFrames);
      assert.equal(await heading.textContent(), entry.name);
      assert.equal(await stage.locator('canvas').count(), 1);
      assert.equal(await page.locator('#animation').isVisible(), entry.clips.length > 0);
      assert.equal(await skeleton.isVisible(), entry.rig === 'skinned');
      if (entry.clips.length) {
        assert.deepEqual(await page.locator('#clip option').allTextContents(),entry.clips.map(clip => clip.name.replaceAll('_',' ')));
        if (entry.id === 'warden') {
          await page.locator('#clip').selectOption({label:'Walk Loop'});
          await skeleton.check();
          await page.waitForFunction(()=>document.querySelector('#stage').dataset.skeleton === '50');
          await skeleton.uncheck();
        }
        await page.getByRole('button',{name:'Play animation'}).click();
        await page.waitForFunction(() => Number(document.getElementById('scrub').value) > 0);
        await page.getByRole('button',{name:'Pause animation'}).click();
      }
    }
    await page.getByRole('button',{name:'Next model'}).click();
    await ready('dot');
    assert(glbURLs.every(url => url.origin === origin && /^\/(?:models\/assets|armory\/models)\/[a-z0-9-]+\.glb$/.test(url.pathname)));
    assert.deepEqual(new Set(armory.map(entry=>new URL(entry.asset,bench).pathname)),new Set(
      glbURLs.filter(url=>url.pathname.startsWith('/armory/')).map(url=>url.pathname)));
    glbURLs.length = 0;
    const selected = armory.find(model => model.id === 'armory-blasters-blaster-a');
    await page.goto(bench+`?model=${selected.id}&v=${selected.version}`);
    await ready(selected.id);
    await delay(180);
    const canonicalURL = new URL(selected.asset,bench);
    assert.deepEqual(glbURLs.map(url=>url.href),[canonicalURL.href],'Armory deep link does not fetch other models');
    await page.locator('#details-toggle').click();
    assert.match(await page.locator('#stats').textContent(),/Kenney/);
    assert.match(await page.locator('#stats').textContent(),/CC0-1.0/);
    assert.equal(await page.locator('#download').getAttribute('href'),canonicalURL.href);
    assert.deepEqual(errors,[]);
    await context.close();
    const phone = await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
    await phone.goto(bench+'?model=crocodilian&v=v1');
    await phone.waitForFunction(()=>document.getElementById('stage').dataset.model==='crocodilian');
    const view = await phone.locator('#stage').boundingBox();
    assert(view.width<391 && view.height>230);
    assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth),390);
    assert.equal(await phone.locator('#model-picker option').count(),catalog.models.length);
    const actions = await phone.locator('#bench-actions').boundingBox();
    const models = await phone.locator('.model-nav').boundingBox();
    assert(actions && models && actions.y < models.y && models.y + models.height > 810,
      'portrait actions sit above the bottom selection row at rest');
    assert(view.y + view.height <= actions.y + 3,'dock does not hide the viewport');
    assert(await phone.locator('.model-nav').evaluate(x => x.scrollWidth > x.clientWidth));
    await phone.locator('#filter-toggle').click();
    const filters = phone.locator('#filter-panel');
    await filters.waitFor({state:'visible'});
    const sheet = await filters.boundingBox();
    assert(sheet && sheet.y < actions.y,'filter sheet rises above actions');
    await filters.getByLabel('Type').selectOption('humanoid');
    await filters.getByLabel('Has walk clip').check();
    await filters.getByLabel('Has skin joints').check();
    await phone.waitForFunction(() => document.querySelector('#stage').dataset.model === 'white-mech');
    const walkingHumanoids = filterModels(catalog.models,{...defaultFilters,type:'humanoid',motion:['walk','skinned']});
    assert(walkingHumanoids.some(model=>model.id==='white-mech'));
    assert.equal(await phone.locator('#model-picker option').count(),walkingHumanoids.length);
    await filters.getByRole('button',{name:'Close filters'}).click();
    await phone.locator('#show-skeleton').check();
    await phone.waitForFunction(() => document.querySelector('#stage').dataset.skeleton === '41');
    await phone.locator('#animation-toggle').click();
    await phone.getByRole('button',{name:'Play animation'}).click();
    await phone.waitForFunction(() => Number(document.querySelector('#scrub').value) > 0);
    await phone.getByRole('button',{name:'Pause animation'}).click();
    await phone.locator('#filter-toggle').click();
    await filters.getByLabel('Type').selectOption('gear');
    assert.match(await filters.locator('#filter-count').textContent(),/0/);
    await filters.locator('#clear-filters').click();
    assert.equal(await phone.locator('#model-picker option').count(),catalog.models.length);
    await filters.getByLabel('Latest versions only').check();
    assert(!await phone.locator('#model-picker option').allTextContents().then(options => options.some(label => /Spirecoil Organic/.test(label))));
    await phone.keyboard.press('Escape');
    await filters.waitFor({state:'hidden'});
    await phone.goto(bench+'?model=spirecoil&v=v3');
    await phone.waitForFunction(() => document.querySelector('#stage').dataset.version === 'v3');
    assert.equal(await phone.locator('#show-skeleton').isVisible(),false);
    await phone.setViewportSize({width:844,height:390});
    assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth),844);
    assert((await phone.locator('#stage').boundingBox()).width > 350);
    await phone.setViewportSize({width:390,height:844});
    if (process.env.BENCH_SCREENSHOT) await phone.screenshot({path:process.env.BENCH_SCREENSHOT,fullPage:true});
  } finally {await browser?.close();server.kill();}
});
