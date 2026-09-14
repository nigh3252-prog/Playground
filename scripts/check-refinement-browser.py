"""Check actual generated terrain and before/after views, not a mock renderer."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import os
import shutil
import threading
import time
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'review' / 'refinement'
OUT.mkdir(parents=True, exist_ok=True)
class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{server.server_port}/regional-world.html'
results = []
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH') or shutil.which('chromium'), args=['--enable-unsafe-swiftshader', '--use-angle=swiftshader'])
        for name, width, height in [('desktop', 1440, 1000), ('portrait', 390, 844)]:
            page = browser.new_page(viewport={'width': width, 'height': height}, device_scale_factor=1)
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            try:
                page.goto(base + '?seed=431970387&n=129&stage=4&exag=1', wait_until='domcontentloaded')
                page.wait_for_function("document.body.dataset.ready==='true' && __regionalWorldLab.snapshots[4]", timeout=180000)
                assert page.evaluate('Boolean(__regionalWorldLab.view.gl)'), 'A 2D fallback is not a WebGL check'
                page.click('#localExploreToggle')
                page.click('#localRiverSpot')
                page.evaluate("window.refineBefore={world:__regionalWorldLab.world,generation:__regionalWorldLab.generation,height:__regionalWorldLab.world.height.slice(),receiver:__regionalWorldLab.world.receiver.slice(),area:__regionalWorldLab.world.area.slice()}")
                site = page.evaluate('({...__regionalWorldLab.box})')
                for size in ['12', '1.2', '0.41']:
                    start = time.monotonic()
                    page.select_option('#localWidth', size)
                    page.click('#localFocus')
                    elapsed = (time.monotonic() - start) * 1000
                    state = page.evaluate("""() => {
                        const l=__regionalWorldLab,d=l.localData,b=refineBefore;
                        return {window:{...l.box},refinement:d.refinement,metrics:d.metrics,
                            sameWorld:l.world===b.world,sameGeneration:l.generation===b.generation,
                            sameHeight:l.world.height.every((v,i)=>v===b.height[i]),sameReceiver:l.world.receiver.every((v,i)=>v===b.receiver[i]),sameArea:l.world.area.every((v,i)=>v===b.area[i]),
                            baseWeights:d.sourceWeights.every((s,i)=>Math.abs(s.reduce((v,[id,t])=>v+l.world.height[id]*t,0)-d.baseHeightM[i])<.002),
                            changed:d.detailM.some(x=>Math.abs(x)>1),wet:d.waterDepthM.some(x=>x>.2),
                            riverIdentity:d.rivers.every(r=>l.world.receiver[r.from]===r.to&&l.world.area[r.from]===r.upstreamAreaKm2),
                            downhill:d.channels.every(r=>r.levelsM[0]>=r.levelsM[1]),glError:l.view.gl.getError(),
                            cameraY:l.view.target[1],minY:Math.min(...l.view.surface)/1000,maxY:Math.max(...l.view.surface)/1000,
                            finite:d.heightM.every(Number.isFinite),triangles:d.mesh.triangles.length/3};
                    }""")
                    for key in ['sameWorld','sameGeneration','sameHeight','sameReceiver','sameArea','baseWeights','changed','wet','riverIdentity','downhill','finite']:
                        assert state[key], (key, state)
                    assert state['triangles']>20000 and state['glError']==0, state
                    assert state['minY']<=state['cameraY']<=state['maxY'], state
                    results.append({'viewport':name,'focusMs':elapsed,**state})
                    page.click('#localClose')
                    page.wait_for_timeout(150)
                    page.screenshot(path=str(OUT/f'{name}-{size}km-after.png'))
                    page.click('#localExploreToggle')
                    if size=='1.2':
                        saved_rivers=page.evaluate('JSON.stringify(__regionalWorldLab.localData.rivers)')
                        page.uncheck('#localDetail')
                        assert page.evaluate("!__regionalWorldLab.localData.refinement && document.body.dataset.refined==='false'")
                        assert saved_rivers==page.evaluate('JSON.stringify(__regionalWorldLab.localData.rivers)')
                        page.click('#localClose');page.wait_for_timeout(150)
                        page.screenshot(path=str(OUT/f'{name}-1.2km-before.png'))
                        page.click('#localExploreToggle');page.check('#localDetail')
                with page.expect_download() as item:
                    page.click('#localExport')
                item.value.save_as(str(OUT/f'{name}-export.json'))
                exported=json.loads((OUT/f'{name}-export.json').read_text())
                assert exported['version']=='watershed-refined-window-v1'
                assert exported['baseHeightM'] and exported['detailM'] and exported['sourceWeights']
                local_url=page.url
                page.click('#localOverview')
                assert page.evaluate('__regionalWorldLab.localWindow===null')
                page.goto(local_url,wait_until='domcontentloaded')
                page.wait_for_function("document.body.dataset.ready==='true' && document.body.dataset.refined==='true'",timeout=180000)
                assert page.evaluate('__regionalWorldLab.box.size')==.41
                generation=page.evaluate('__regionalWorldLab.generation')
                for stage in [1,2,3,4]:
                    page.click(f'[data-stage="{stage}"]')
                    assert page.evaluate('__regionalWorldLab.generation')==generation
                    assert page.evaluate('__regionalWorldLab.localData.baseHeightM.every(Number.isFinite)')
                page.click('#localExploreToggle')
                page.uncheck('#localDetail')
                off_url=page.url
                page.goto(off_url,wait_until='domcontentloaded')
                page.wait_for_function("document.body.dataset.ready==='true' && __regionalWorldLab.localWindow",timeout=180000)
                assert page.evaluate('!__regionalWorldLab.detailEnabled && !__regionalWorldLab.localData.refinement')
                page.click('#localExploreToggle');page.check('#localDetail')
                page.click('#localRiverSpot');page.click('#localRiverSpot')
                assert abs(page.evaluate('__regionalWorldLab.box.x')-site['x'])>.01, 'The second valley must be a different location'
                page.click('#localClose');page.wait_for_timeout(150)
                page.screenshot(path=str(OUT/f'{name}-second-valley.png'))
                page.click('#mapView');page.wait_for_timeout(150)
                page.screenshot(path=str(OUT/f'{name}-map.png'))
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                assert not errors, errors
            except Exception:
                page.screenshot(path=str(OUT/f'{name}-failure.png'))
                (OUT/f'{name}-failure.html').write_text(page.content())
                (OUT/f'{name}-errors.json').write_text(json.dumps(errors))
                raise
            finally:
                page.close()
        browser.close()
finally:
    server.shutdown()
    (OUT/'browser-results.json').write_text(json.dumps({'realParentPipeline':True,'checks':results},indent=2))
print(f'Passed {len(results)} refined scale checks plus comparison, export, reload, stage, navigation and portrait checks.')
