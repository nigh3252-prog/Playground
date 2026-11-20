import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {readFile} from 'node:fs/promises';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.MODEL_BENCH_PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../../', import.meta.url);
const port = Number(process.env.PORT || 17861);
const origin = `http://127.0.0.1:${port}`;
const bench = `${origin}/models/`;
test('native review bench switches, animates, recovers and fits phones', {timeout:150000}, async () => {
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
    const errors=[], glbs=[];
    page.on('pageerror', error=>errors.push(error.message));
    page.on('request', request=>{if (request.url().endsWith('.glb')) glbs.push(request.url().split('/').pop());});
    await page.goto(bench);
    const stage = page.locator('#stage');
    const heading = page.locator('#model-name');
    const ready = async id => {await page.waitForFunction(id=>document.getElementById('stage').dataset.model === id, id);};
    await ready('dot'); assert.equal(await heading.textContent(),'Dot');
    assert.deepEqual(glbs,['dot-v1.glb']);
    assert.equal(await page.locator('#metadata').getAttribute('open'),null);
    assert.equal(await stage.locator('canvas').count(),1);
    await delay(180);
    const framesAtRest = await page.evaluate(() => window.viewerFrameCount());
    assert(framesAtRest > 0, 'the scene drew at least once');
    await delay(180);
    assert.equal(await page.evaluate(() => window.viewerFrameCount()),framesAtRest,'paused scene does not run a render loop');
    await page.locator('#model-picker').selectOption(String(catalog.models.findIndex(m=>m.id==='white-mech')));
    await ready('white-mech'); assert.match(page.url(),/model=white-mech&v=v1$/);
    const walk = page.locator('#clip');
    await walk.selectOption({label:'Walk Preview'});
    assert.equal(await walk.locator('option').count(),4);
    const scrub = page.locator('#scrub');
    const canvas = stage.locator('canvas');
    const restPose = await canvas.screenshot();
    await scrub.evaluate(element=>{element.value=String(Number(element.max)/2);element.dispatchEvent(new Event('input',{bubbles:true}));});
    const time = await scrub.inputValue();
    await delay(250);
    assert.equal(await scrub.inputValue(),time,'scrubbing a paused clip does not resume');
    assert(Number(time)>0);
    assert.notDeepEqual(await canvas.screenshot(),restPose,'scrubbing renders a different pose');
    await page.getByRole('button',{name:'Play animation'}).click();
    await page.waitForFunction(time=>Number(document.getElementById('scrub').value)>Number(time),time);
    await page.getByRole('button',{name:'Pause animation'}).click();
    const copy = page.getByRole('button',{name:'Copy link'});
    await copy.click();
    await page.getByRole('button',{name:'Copied'}).waitFor();
    assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),page.url());
    await page.getByRole('button',{name:'Previous model'}).click();
    await ready('crocodilian');
    assert.equal(await page.locator('#animation').isVisible(),false);
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
    for (const [index, entry] of catalog.models.entries()) {
      if (index < 3) continue;
      await page.locator('#model-picker').selectOption(String(index));
      await page.waitForFunction(({id,version}) => {
        const {model,version:loadedVersion} = document.querySelector('#stage').dataset;
        return model === id && loadedVersion === version;
      }, entry);
      assert.equal(await heading.textContent(), entry.name);
      assert.equal(await stage.locator('canvas').count(), 1);
      assert.equal(await page.locator('#animation').isVisible(), entry.clips.length > 0);
      if (entry.clips.length) {
        assert.equal(await page.locator('#clip option').count(), entry.clips.length);
        await page.getByRole('button',{name:'Play animation'}).click();
        await page.waitForFunction(() => Number(document.getElementById('scrub').value) > 0);
        await page.getByRole('button',{name:'Pause animation'}).click();
      }
    }
    await page.getByRole('button',{name:'Next model'}).click();
    await ready('dot');
    assert.deepEqual(errors,[]);
    await context.close();
    const phone = await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
    await phone.goto(bench+'?model=crocodilian&v=v1');
    await phone.waitForFunction(()=>document.getElementById('stage').dataset.model==='crocodilian');
    const view = await phone.locator('#stage').boundingBox();
    assert(view.width<391 && view.height>230);
    assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth),390);
    assert.equal(await phone.locator('#model-picker option').count(),catalog.models.length);
    if (process.env.BENCH_SCREENSHOT) await phone.screenshot({path:process.env.BENCH_SCREENSHOT,fullPage:true});
  } finally {await browser?.close();server.kill();}
});
