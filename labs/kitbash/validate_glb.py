"""Inspect exported GLB bytes, including default node transforms and actual vertices.

This catches a real Blender NLA export failure where geometry/animations are valid
but neutral root transforms are lost. Run after any rebuild, before packaging.
"""
from pathlib import Path
import hashlib
import json
import math
import struct

HERE = Path(__file__).resolve().parent
IDENTITY = [[float(i == j) for j in range(4)] for i in range(4)]


def multiply(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def node_matrix(node):
    if 'matrix' in node:
        a = node['matrix']
        return [[a[j * 4 + i] for j in range(4)] for i in range(4)]
    x, y, z, w = node.get('rotation', [0, 0, 0, 1])
    r = [[1-2*y*y-2*z*z, 2*x*y-2*z*w, 2*x*z+2*y*w],
         [2*x*y+2*z*w, 1-2*x*x-2*z*z, 2*y*z-2*x*w],
         [2*x*z-2*y*w, 2*y*z+2*x*w, 1-2*x*x-2*y*y]]
    scale = node.get('scale', [1, 1, 1])
    translation = node.get('translation', [0, 0, 0])
    return [[r[i][j] * scale[j] for j in range(3)] + [translation[i]] for i in range(3)] + [[0, 0, 0, 1]]


def inspect(study_id):
    path = HERE / study_id / (study_id + '.glb')
    data = path.read_bytes()
    assert struct.unpack_from('<4sII', data) == (b'glTF', 2, len(data)), 'Invalid GLB header'
    size = struct.unpack_from('<I', data, 12)[0]
    gltf = json.loads(data[20:20+size])
    binary = data[28+size:]
    assert all('uri' not in b for b in gltf['buffers']), 'External buffer dependency'
    assert all('uri' not in image for image in gltf.get('images', [])), 'External image dependency'
    assert not gltf.get('skins'), 'These exports use rigid named pivots'

    def accessor(index):
        a = gltf['accessors'][index]
        v = gltf['bufferViews'][a['bufferView']]
        code = {5126: 'f', 5125: 'I', 5123: 'H', 5121: 'B'}[a['componentType']]
        count = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
        fmt = '<' + code * count
        stride = v.get('byteStride', struct.calcsize(fmt))
        start = v.get('byteOffset', 0) + a.get('byteOffset', 0)
        return [struct.unpack_from(fmt, binary, start+i*stride) for i in range(a['count'])]

    low = [math.inf] * 3
    high = [-math.inf] * 3
    triangles = mesh_count = 0

    def walk(index, parent):
        nonlocal triangles, mesh_count
        node = gltf['nodes'][index]
        m = multiply(parent, node_matrix(node))
        if 'mesh' in node:
            mesh_count += 1
            for primitive in gltf['meshes'][node['mesh']]['primitives']:
                assert primitive.get('mode', 4) == 4, 'Expected triangles'
                position = primitive['attributes']['POSITION']
                triangles += gltf['accessors'][primitive.get('indices', position)]['count'] // 3
                for v in accessor(position):
                    for i in range(3):
                        value = sum(m[i][k] * v[k] for k in range(3)) + m[i][3]
                        assert math.isfinite(value), 'Nonfinite geometry'
                        low[i] = min(low[i], value)
                        high[i] = max(high[i], value)
        for child in node.get('children', []):
            walk(child, m)

    for index in gltf['scenes'][gltf.get('scene', 0)]['nodes']:
        walk(index, IDENTITY)
    dimensions = [high[i] - low[i] for i in range(3)]
    assert abs(dimensions[1] - 12) < .002, (study_id, 'Neutral height is not 12m', dimensions)
    assert abs(low[1]) < .002, (study_id, 'Neutral baseline is not zero', low)
    clips = []
    for animation in gltf.get('animations', []):
        starts, ends, varying = [], [], 0
        for sampler in animation['samplers']:
            times = accessor(sampler['input'])
            output = accessor(sampler['output'])
            starts.append(min(t[0] for t in times))
            ends.append(max(t[0] for t in times))
            varying += any(max(v[c] for v in output) - min(v[c] for v in output) > 1e-5 for c in range(len(output[0])))
        assert varying, (study_id, animation['name'], 'No animated channel')
        assert min(starts) == 0, (study_id, animation['name'], 'Leading clip gap')
        clips.append({'name': animation['name'], 'durationSeconds': max(ends), 'varyingChannels': varying})
    assert len(clips) >= 2, 'Expected idle and action demonstrations'
    return {'id': study_id, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
            'triangles': triangles, 'meshNodes': mesh_count, 'textures': len(gltf.get('textures', [])),
            'boundsMin': low, 'boundsMax': high, 'dimensionsMeters': dimensions, 'clips': clips}


if __name__ == '__main__':
    records = [inspect(name) for name in ['bellows', 'brood-loom', 'shutter-wraith']]
    report = {'checks': ['GLB header', 'embedded buffers and textures', 'finite vertex coordinates',
                         'actual scene-transformed 12m neutral bounds', 'ground baseline',
                         'native zero-start nonconstant animation clips'], 'models': records}
    (HERE / 'validation.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))
