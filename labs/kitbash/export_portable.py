"""Package the checked-in lab as one offline HTML file, without a build dependency.

Run from any directory:
    python labs/kitbash/export_portable.py /absolute/output/warden-kitbash-study.html

The existing vendored Three.js modules and original GLB bytes are embedded verbatim
(apart from module-specifier rewrites). No asset download is needed when opened.
"""
from pathlib import Path
import base64
import json
import re
import sys

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]


def encoded(data):
    return base64.b64encode(data).decode('ascii')


def export(destination):
    studies = json.loads((HERE / 'studies.json').read_text())
    assets = {}
    recipes = {}
    images = {}
    for study in studies['models']:
        assets[study['asset']] = encoded((HERE / study['asset']).read_bytes())
        recipes[study['recipe']] = json.loads((HERE / study['recipe']).read_text())
        images[study['poster']] = encoded((HERE / study['poster']).read_bytes())
    images[studies['lineupPoster']] = encoded((HERE / studies['lineupPoster']).read_bytes())
    assets['../../models/assets/warden-v1.glb'] = encoded((REPO / 'models/assets/warden-v1.glb').read_bytes())

    modules = {
        '@kitbash/core': 'three.core.min.js',
        'three': 'three.module.min.js',
        'three/addons/controls/OrbitControls.js': 'addons/controls/OrbitControls.js',
        'three/addons/loaders/GLTFLoader.js': 'addons/loaders/GLTFLoader.js',
        'three/addons/environments/RoomEnvironment.js': 'addons/environments/RoomEnvironment.js',
        '@kitbash/buffer-utils': 'addons/utils/BufferGeometryUtils.js',
    }
    imports = {}
    for specifier, path in modules.items():
        content = (REPO / 'armory/vendor' / path).read_text()
        content = content.replace('./three.core.min.js', '@kitbash/core')
        content = content.replace('../utils/BufferGeometryUtils.js', '@kitbash/buffer-utils')
        imports[specifier] = 'data:text/javascript;base64,' + encoded(content.encode())
    imports['meshopt'] = 'data:text/javascript;base64,' + encoded((REPO / 'models/vendor/meshoptimizer/meshopt_decoder.mjs').read_bytes())

    html = (HERE.parent / 'kitbash.html').read_text()
    html = html.replace('<link rel="stylesheet" href="./kitbash/styles.css">', '<style>\n' + (HERE / 'styles.css').read_text() + '\n</style>')
    html = re.sub(r'<script type="importmap">.*?</script>', lambda _: '<script type="importmap">' + json.dumps({'imports': imports}, separators=(',', ':')) + '</script>', html, flags=re.S)
    payload = json.dumps({'studies': studies, 'assets': assets, 'recipes': recipes, 'images': images}, separators=(',', ':')).replace('</', '<\\/')
    code = (HERE / 'viewer.mjs').read_text()
    html = html.replace('<script type="module" src="./kitbash/viewer.mjs"></script>', '<script>window.KITBASH_EMBEDDED=' + payload + ';</script>\n<script type="module">\n' + code + '\n</script>')
    html = html.replace('href="../models/"', 'href="#bellows"')
    license_text = (REPO / 'armory/vendor/THREE-LICENSE.txt').read_text()
    decoder_license = (REPO / 'models/vendor/meshoptimizer/LICENSE.md').read_text()
    html = html.replace('</body>', '<!-- Vendored renderer license:\n' + license_text + '\n\nMeshoptimizer decoder license:\n' + decoder_license + '\n--></body>')
    out = Path(destination).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html)
    print(json.dumps({'path': str(out), 'bytes': out.stat().st_size, 'models': list(assets), 'externalDependencies': 0}, indent=2))


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python export_portable.py /absolute/output/warden-kitbash-study.html')
    export(sys.argv[1])
