import asyncio
import json
import os
import pathlib
import shutil
import tempfile
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from playwright.async_api import async_playwright
ROOT = pathlib.Path(os.environ.get('AFTERLIGHT_TEST_OUTPUT', tempfile.mkdtemp()))
ROOT.mkdir(parents=True, exist_ok=True)
SITE = pathlib.Path(__file__).resolve().parents[2]
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=str(SITE)))
url = f'http://127.0.0.1:{server.server_port}/afterlight/'

async def run():
    async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path=shutil.which('google-chrome') or shutil.which('chromium'),args=['--no-sandbox','--disable-dev-shm-usage'])
        context=await browser.new_context(viewport={'width':844,'height':390},device_scale_factor=1,is_mobile=True,has_touch=True)
        page=await context.new_page()
        errors=[]; page.on('pageerror',lambda exc:errors.append(str(exc)))
        await page.goto(url)
        catalog=await page.evaluate("arcadeGames.map(({id,title,sources,kind,genre,best})=>({id,title,sources,kind,genre,best}))")
        assert len(catalog)==30 and len(set(x['id'] for x in catalog))==30,(len(catalog),errors)
        assert len([x for x in catalog if x['kind']=='Remix'])==20
        for row in catalog:
            assert len(row['sources'])==(3 if row['kind']=='Remix' else 0),row
            assert row['best'] in ('Touch','Either','Backbone'),row
        await page.set_viewport_size({'width':390,'height':844})
        await page.screenshot(path=str(ROOT/'library.png'))
        await page.locator('[data-kind=Original]').click()
        assert await page.locator('.tile').count()==10
        await page.locator('[data-kind=All]').click()
        await page.locator('#search').fill('Brasswater')
        assert await page.locator('.tile').count()==1
        await page.locator('#surprise').click()
        await page.locator('#primary').click()
        await page.screenshot(path=str(ROOT/'portrait.png'))
        await page.locator('#home').click()
        await page.locator('#search').fill('')
        await page.evaluate("localStorage.clear()")
        await page.reload()
        picked=set()
        for _ in range(5):
            await page.locator('#surprise').click()
            await page.wait_for_selector('#sheet:not([hidden])')
            picked.add(page.url.split('#')[-1]);await page.locator('#primary').click()
            await page.locator('#home').click()
        assert len(picked)==5,picked
        await page.set_viewport_size({'width':844,'height':390})
        for row in catalog:
            await page.evaluate("(id)=>location.hash=id",row['id'])
            await page.wait_for_selector('#sheet:not([hidden])')
            assert await page.locator('#sheet-title').inner_text()==row['title']
            if row['sources']:
                await page.locator('#credits summary').click()
                assert await page.locator('#parents li').count()==3
            await page.locator('#primary').click()
            await page.wait_for_selector('#sheet[hidden]',state='attached')
            geom=await page.locator('#screen').bounding_box()
            assert geom['width']>350 and geom['height']>200,(row['id'],geom)
            await page.locator('button[data-key="right"]').tap()
            await page.locator('button[data-key="a"]').tap()
            await page.keyboard.down('ArrowDown');await page.wait_for_timeout(150);await page.keyboard.up('ArrowDown')
            await page.locator('#screen').tap(position={'x':int(geom['width']*.55),'y':int(geom['height']*.6)})
            await page.keyboard.press('KeyX')
            for key in ['KeyZ','ArrowLeft','ArrowUp','KeyX']:
                await page.keyboard.press(key)
            await page.locator('#pause').click()
            assert await page.locator('#primary').inner_text()=='Resume'
            await page.locator('#primary').click()
            await page.locator('#pause').click()
            await page.locator('#retry').click()
            await page.wait_for_timeout(70)
            await page.locator('#screen').screenshot(path=str(ROOT/(row['id']+'.png')))
            if row==catalog[0]:await page.screenshot(path=str(ROOT/'landscape.png'))
            await page.locator('#home').click()
            await page.wait_for_selector('#library:not([hidden])')
        # Align all three photographic plates using the canvas, the lens button, and the shutter.
        await page.evaluate("location.hash='borrowed-moons'")
        await page.locator('#primary').click()
        board = await page.locator('#screen').bounding_box()
        for ordinal, (start_x, start_y) in enumerate([(-81,35),(104,-42),(-94,-57)]):
            target = {'x': (320 - .22 * start_x) * board['width'] / 640,
                      'y': (189 - .18 * start_y) * board['height'] / 420}
            await page.locator('#screen').tap(position=target)
            await page.locator('[data-key=b]').tap()
            await page.locator('[data-key=b]').tap()
            await page.wait_for_function("document.querySelector('#hud').textContent.includes('ready to expose')")
            await page.locator('[data-key=a]').tap()
            if ordinal < 2:
                await page.wait_for_function("!document.querySelector('#hud').textContent.includes('ready to expose')")
        await page.wait_for_selector('#sheet:not([hidden])')
        assert 'Finished' in await page.locator('#sheet-title').inner_text()
        await page.locator('#leave').click()
        await page.wait_for_selector('.tile[data-game="borrowed-moons"][data-status="won"]')
        # A virtual standard gamepad drives the launcher and player without a touchscreen.
        await page.evaluate("""()=>{window.testPad={axes:[0,0],buttons:Array.from({length:17},()=>({pressed:false}))};Object.defineProperty(navigator,'getGamepads',{value:()=>[window.testPad]});document.activeElement.blur();}""")
        async def pad(i):
            await page.evaluate('(i)=>testPad.buttons[i].pressed=true',i)
            await page.wait_for_timeout(70)
            await page.evaluate('(i)=>testPad.buttons[i].pressed=false',i)
            await page.wait_for_timeout(70)
        await pad(13)
        await pad(0)
        await page.wait_for_selector('#sheet:not([hidden])')
        await pad(0)
        await page.wait_for_selector('#sheet[hidden]',state='attached')
        await pad(15);await pad(0);await pad(9)
        assert await page.locator('#primary').inner_text()=='Resume'
        await pad(9)
        await page.wait_for_selector('#sheet[hidden]',state='attached')
        assert not errors,errors
        print(json.dumps({'games':len(catalog),'puzzles':sum(r['genre']=='Puzzle' for r in catalog),'uniqueParents':len({s[0].lower() for r in catalog for s in r['sources']}),'smoke':'30 intros/input/pause/resume/restart/exit, touch/keyboard and virtual Backbone','unexpectedErrors':errors},indent=2))
        (ROOT/'catalog.json').write_text(json.dumps(catalog,indent=2))
        await browser.close()
if __name__ == '__main__':
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        asyncio.run(run())
    finally:
        server.shutdown()

