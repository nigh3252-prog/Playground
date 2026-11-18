"""Exercise the public launcher and controls in phone-sized Chromium."""
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

OUTPUT = pathlib.Path(os.environ.get('AFTERLIGHT_TEST_OUTPUT', tempfile.mkdtemp()))
OUTPUT.mkdir(parents=True, exist_ok=True)
SITE = pathlib.Path(__file__).resolve().parents[2]


async def tap_world(page, x, y):
    screen = page.locator('#screen')
    box = await screen.bounding_box()
    vertical = await screen.evaluate('el => el.width === 420')
    u, v = (y / 420, (640 - x) / 640) if vertical else (x / 640, y / 420)
    await screen.tap(position={'x': box['width'] * u, 'y': box['height'] * v})


async def library(page):
    await page.locator('#home').click()
    await page.locator('#library').wait_for(state='visible')


async def bankshot_touch_ending(page):
    await page.locator('[data-game="bankshot"]').click()
    await page.locator('#screen').wait_for(state='visible')
    assert await page.locator('#sheet').is_hidden()
    box = await page.locator('#screen').bounding_box()
    assert box['height'] > box['width']
    await tap_world(page, 242, 210)
    await page.wait_for_function("document.querySelector('#hud').textContent.includes('Pack 2/4')")
    assert '3× chain' in await page.locator('#hud').inner_text()
    await tap_world(page, 174, 71)
    await page.wait_for_function("document.querySelector('#hud').textContent.includes('coil')")
    await page.screenshot(path=str(OUTPUT/'portrait.png'))
    for _ in range(100):
        if await page.locator('#sheet').is_visible():
            break
        await page.keyboard.press('KeyX')
        await page.keyboard.press('KeyZ')
        await page.wait_for_timeout(100)
    assert 'Finished' in await page.locator('#sheet-title').inner_text()
    await page.locator('#leave').click()
    await page.locator('.tile[data-game="bankshot"][data-status="won"]').wait_for()


async def check_game(page, game):
    await page.locator(f'.tile[data-game="{game["id"]}"]').click()
    await page.locator('#screen').wait_for(state='visible')
    assert await page.locator('#game-title').inner_text() == game['title']
    assert await page.locator('#sheet').is_hidden()
    await page.locator('#pause').click()
    assert await page.locator('#sheet-title').inner_text() == game['title']
    if game['sources']:
        await page.locator('#credits summary').click()
        assert await page.locator('#parents li').count() == 3
    await page.locator('#primary').click()
    box = await page.locator('#screen').bounding_box()
    assert box['width'] > 350 and box['height'] > 185, (game['id'], box)
    for action in ('right','a','b'):
        button = page.locator(f'button[data-key="{action}"]')
        if await button.is_visible():
            await button.tap()
    await page.keyboard.down('ArrowDown')
    await page.wait_for_timeout(150)
    await page.keyboard.up('ArrowDown')
    await tap_world(page,350,220)
    await page.mouse.move(box['x'] + box['width'] * .45, box['y'] + box['height'] * .5)
    await page.mouse.down()
    await page.mouse.move(box['x'] + box['width'] * .7, box['y'] + box['height'] * .65, steps=6)
    await page.mouse.up()
    for key in ('KeyZ','ArrowLeft','ArrowUp','KeyX'):
        await page.keyboard.press(key)
    if await page.locator('#sheet').is_hidden():
        await page.locator('#pause').click()
    await page.locator('#retry').click()
    await page.locator('#screen').screenshot(path=str(OUTPUT/(game['id']+'.png')))
    await library(page)


async def beachcomb(page):
    await page.locator('.tile[data-game="saltprint-atlas"]').click()
    await page.locator('#screen').wait_for(state='visible')
    for x,y in [(135,224),(343,287),(547,302),(257,135),(468,157)]:
        await tap_world(page,x,y)
    await page.wait_for_function("document.querySelector('#hud').textContent.includes('2/2 pocket finds')")
    await tap_world(page,520,388)
    await page.locator('#sheet').wait_for(state='visible')
    assert '2/2' in await page.locator('#sheet-desc').inner_text()
    await page.locator('#leave').click()
    await page.locator('.tile[data-game="saltprint-atlas"][data-status="won"]').wait_for()


async def run(url):
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=shutil.which('google-chrome') or shutil.which('chromium'),
                                          args=['--no-sandbox','--disable-dev-shm-usage'])
        context = await browser.new_context(viewport={'width':390,'height':844},device_scale_factor=1,
                                            is_mobile=True,has_touch=True)
        page = await context.new_page()
        errors = []
        page.on('pageerror',lambda exc: errors.append(str(exc)))
        await page.goto(url)
        catalog = await page.evaluate("arcadeGames.map(({id,title,sources,kind,genre,best})=>({id,title,sources,kind,genre,best}))")
        assert len(catalog) == len({row['id'] for row in catalog}) == 30
        assert sum(row['kind'] == 'Remix' for row in catalog) == 20
        for row in catalog:
            assert len(row['sources']) == (3 if row['kind']=='Remix' else 0),row
            assert row['best'] in ('Touch','Either','Backbone'),row
        await page.screenshot(path=str(OUTPUT/'library.png'))
        await page.locator('[data-kind=Original]').click()
        assert await page.locator('.tile').count() == 10
        await page.locator('[data-kind=All]').click()
        await page.locator('#search').fill('tap jab stamina')
        assert await page.locator('[data-game=bankshot]').is_visible()
        await page.locator('#search').fill('')
        await bankshot_touch_ending(page)
        await page.locator('#featured').click()
        await page.wait_for_function("document.querySelector('#game-title').textContent === 'Palm Pocket'")
        # Walk to two palms and a stone, then spend the haul on an axe.
        for x,y,expected in [(185,195,'Wood 1'),(228,175,'Wood 2'),(107,244,'Stone 2')]:
            await tap_world(page,x,y)
            await page.wait_for_function("s=>document.querySelector('#hud').textContent.includes(s)",arg=expected)
        await tap_world(page,572,24)
        await tap_world(page,250,145)
        await page.wait_for_function("document.querySelector('#message').textContent.includes('Axe made')")
        await page.screenshot(path=str(OUTPUT/'island-phone.png'))
        await library(page)
        await beachcomb(page)
        picks = set()
        for _ in range(5):
            await page.locator('#surprise').click()
            await page.locator('#screen').wait_for(state='visible')
            picks.add(page.url.split('#')[-1])
            await library(page)
        assert len(picks)==5 and 'bankshot' not in picks and 'wakepost' not in picks
        await page.set_viewport_size({'width':844,'height':390})
        for game in catalog:
            await check_game(page,game)
        await page.evaluate("""()=>{window.testPad={axes:[0,0],buttons:Array.from({length:17},()=>({pressed:false}))};
            Object.defineProperty(navigator,'getGamepads',{value:()=>[window.testPad]});document.activeElement.blur();}""")
        async def pad(i):
            await page.evaluate('(i)=>testPad.buttons[i].pressed=true',i)
            await page.wait_for_timeout(70)
            await page.evaluate('(i)=>testPad.buttons[i].pressed=false',i)
            await page.wait_for_timeout(70)
        await pad(13)
        await pad(0)
        await page.locator('#screen').wait_for(state='visible')
        for key in (15,0,9):
            await pad(key)
        assert await page.locator('#primary').inner_text() == 'Resume'
        await pad(9)
        assert await page.locator('#sheet').is_hidden()
        assert not errors,errors
        print(json.dumps({'games':len(catalog),'puzzles':sum(row['genre']=='Puzzle' for row in catalog),
                          'parents':len({s[0].casefold() for row in catalog for s in row['sources']}),'runtimeErrors':errors},indent=2))
        (OUTPUT/'catalog.json').write_text(json.dumps(catalog,indent=2))
        await browser.close()


if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=str(SITE)))
    Thread(target=server.serve_forever,daemon=True).start()
    try:
        asyncio.run(run(f'http://127.0.0.1:{server.server_port}/afterlight/'))
    finally:
        server.shutdown()
