"""Exercise the real PR26 parent pipeline plus local exploration in Chromium.

Run from the repository root after installing playwright and its Chromium.
No fixtures or replacement modules are used. Artifacts go to review/continuity/.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import threading
import os
import shutil
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "review" / "continuity"
OUT.mkdir(parents=True, exist_ok=True)
server = ThreadingHTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{server.server_port}/regional-world.html"
results = []
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH") or shutil.which("chromium"), args=["--enable-unsafe-swiftshader", "--use-angle=swiftshader"])
        for name, width, height in [("desktop", 1440, 1000), ("portrait", 390, 844)]:
            page = browser.new_page(viewport={"width": width, "height": height}, device_scale_factor=1)
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(base + "?seed=431970387&n=129&stage=4&exag=18", wait_until="domcontentloaded")
            page.wait_for_function("document.body.dataset.ready === 'true' && __regionalWorldLab.stage === 4", timeout=180000)
            source = page.evaluate("""() => {
                const l=__regionalWorldLab,w=l.world,b=l.box;
                window.continuityBefore={world:w,generation:l.generation,height:w.height.slice(),receiver:w.receiver.slice(),area:w.area.slice()};
                let selected=null;
                for(let i=0;i<w.height.length;i++){
                    const r=w.receiver[i];
                    if(!w.river[i]||r<0||(w.lake[i]&&w.lake[r]))continue;
                    const x=(w.mesh.x[i]+w.mesh.x[r])/2,z=(w.mesh.z[i]+w.mesh.z[r])/2;
                    if(x>b.x&&x<b.x+b.size&&z>b.z&&z<b.z+b.size){selected={from:i,to:r,x,z};break;}
                }
                if(!selected)throw Error('No inherited river in the fixed regional window');
                window.continuityEdge=selected;l.view.selectedPoint={x:selected.x,z:selected.z};
                return {seed:w.config.seed,spacingKm:w.stepKm,webgl:Boolean(l.view.gl),selected};
            }""")
            assert source["webgl"], "WebGL unavailable: do not treat 2D fallback as a 3D validation"
            page.click("#localExploreToggle")
            for size in ["120", "12", "1.2", "0.41"]:
                page.select_option("#localWidth", size)
                page.click("#localFocus")
                state = page.evaluate("""() => {
                    const l=__regionalWorldLab,b=continuityBefore,e=continuityEdge;
                    return {size:l.box.size,sameWorld:l.world===b.world,sameGeneration:l.generation===b.generation,
                        sameHeight:l.world.height.every((v,i)=>v===b.height[i]),
                        sameReceiver:l.world.receiver.every((v,i)=>v===b.receiver[i]),
                        sameArea:l.world.area.every((v,i)=>v===b.area[i]),
                        riverRetained:l.localData.rivers.some(r=>r.from===e.from&&r.to===e.to),
                        sourceWeightsValid:l.localData.sourceWeights.every((s,i)=>Math.abs(s.reduce((h,[id,v])=>h+l.world.height[id]*v,0)-(l.localData.baseHeightM||l.localData.heightM)[i])<.01),
                        triangles:l.localData.mesh.triangles.length/3,
                        cameraY:l.view.target[1],minY:Math.min(...l.view.surface)/1000,maxY:Math.max(...l.view.surface)/1000,
                        exag:l.view.exag,glError:l.view.gl.getError()};
                }""")
                assert abs(state["size"]-float(size))<1e-8, state
                for key in ["sameWorld", "sameGeneration", "sameHeight", "sameReceiver", "sameArea", "riverRetained", "sourceWeightsValid"]:
                    assert state[key], (key, state)
                assert state["triangles"]>=1 and state["glError"]==0, state
                assert state["exag"]==1 and state["minY"]<=state["cameraY"]<=state["maxY"], state
                results.append({"viewport":name,"source":source,**state})
                if size in ["120", "1.2"]:
                    page.click("#localClose")
                    page.screenshot(path=str(OUT/f"{name}-{size}km.png"))
                    page.click("#localExploreToggle")
            with page.expect_download() as item:
                page.click("#localExport")
            item.value.save_as(str(OUT/f"{name}-export.json"))
            exported=json.loads((OUT/f"{name}-export.json").read_text())
            assert exported["version"] in ["watershed-inherited-window-v1","watershed-refined-window-v1"] and exported["sourceWeights"]
            local_url=page.url
            page.click("#localOverview")
            assert page.evaluate("__regionalWorldLab.localWindow===null && __regionalWorldLab.view.exag===18")
            assert "localKm" not in page.url
            page.goto(local_url,wait_until="domcontentloaded")
            page.wait_for_function("document.body.dataset.ready==='true' && __regionalWorldLab.localWindow!==null",timeout=180000)
            assert page.evaluate("__regionalWorldLab.box.size") == .41
            before=page.evaluate("__regionalWorldLab.generation")
            for stage in [1,2,3,4]:
                page.click(f'[data-stage="{stage}"]')
                assert page.evaluate("__regionalWorldLab.box.size") == .41
                assert page.evaluate("__regionalWorldLab.generation") == before
            page.click("#newWindow")
            assert page.evaluate("__regionalWorldLab.localWindow===null")
            assert page.evaluate("document.documentElement.scrollWidth<=innerWidth")
            assert not errors, errors
            page.close()
        browser.close()
finally:
    server.shutdown()
    (OUT/"browser-results.json").write_text(json.dumps({"realParentPipeline":True,"checks":results},indent=2))
print(f"Passed {len(results)} real-parent scale checks in desktop and portrait Chromium.")
