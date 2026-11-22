"""Inspect the actual exported GLB: coordinates, source IDs, triangles and clips."""
from pathlib import Path
import json, struct, hashlib
import numpy as np

OUT=Path(__file__).resolve().parent
ROOT=OUT.parents[2]
b=(OUT/'shutter-wraith.glb').read_bytes()
n=struct.unpack_from('<I',b,12)[0];g=json.loads(b[20:20+n]);binary=b[28+n:]
types={5126:np.float32,5125:np.uint32,5123:np.uint16,5122:np.int16,5121:np.uint8,5120:np.int8}
sizes={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}
def accessor(i):
    a=g['accessors'][i];v=g['bufferViews'][a['bufferView']];dtype=np.dtype(types[a['componentType']]);count=sizes[a['type']]
    return np.ndarray((a['count'],count),dtype=dtype,buffer=binary,offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',count*dtype.itemsize),dtype.itemsize)).copy()
def matrix(node):
    if 'matrix' in node:return np.array(node['matrix']).reshape((4,4),order='F')
    x,y,z,w=node.get('rotation',[0,0,0,1]);R=np.array([[1-2*y*y-2*z*z,2*x*y-2*z*w,2*x*z+2*y*w,0],[2*x*y+2*z*w,1-2*x*x-2*z*z,2*y*z-2*x*w,0],[2*x*z-2*y*w,2*y*z+2*x*w,1-2*x*x-2*y*y,0],[0,0,0,1.]])
    R[:3,:3]*=np.array(node.get('scale',[1,1,1]));R[:3,3]=node.get('translation',[0,0,0]);return R
world={}
def visit(i,parent):
    world[i]=parent@matrix(g['nodes'][i])
    for child in g['nodes'][i].get('children',[]):visit(child,world[i])
for i in g['scenes'][g.get('scene',0)]['nodes']:visit(i,np.eye(4))
positions=[];triangles=0;mesh_nodes=0
for i,node in enumerate(g['nodes']):
    if 'mesh' not in node:continue
    mesh_nodes+=1
    for p in g['meshes'][node['mesh']]['primitives']:
        a=accessor(p['attributes']['POSITION']);positions.append((world[i]@np.column_stack([a,np.ones(len(a))]).T).T[:,:3])
        triangles+=(g['accessors'][p['indices']]['count'] if 'indices' in p else len(a))//3
positions=np.vstack(positions);lo=positions.min(axis=0);hi=positions.max(axis=0)
assert abs(hi[1]-lo[1]-12)<1e-4,(lo,hi)
assert abs(lo[1])<1e-4,lo
assert triangles<=15000,triangles
assert not g.get('skins'),'Source bone rigs should not be exported'
clips=[]
for clip in g['animations']:
    end=0;start=1e9;moving=[];loop_errors=[]
    for channel in clip['channels']:
        s=clip['samplers'][channel['sampler']];times=accessor(s['input']).ravel();vals=accessor(s['output']);end=max(end,float(times.max()));start=min(start,float(times.min()))
        if np.ptp(vals,axis=0).max()>1e-7:moving.append(g['nodes'][channel['target']['node']]['name'])
        loop_errors.append(float(np.abs(vals[0]-vals[-1]).max()))
    assert abs(start)<1e-7,(clip['name'],start)
    clips.append({'name':clip['name'],'start_seconds':start,'seconds':round(end-start,6),'channels':len(clip['channels']),'moving_nodes':sorted(set(moving)),'max_first_last_difference':max(loop_errors)})
byname={c['name']:c for c in clips}
assert set(byname)=={'idle','attack','expose'}
for name,seconds in [('idle',6),('attack',3),('expose',4)]:assert abs(byname[name]['seconds']-seconds)<.001
for name in ['Sentry_01_Bell','Sentry_02_Crescent','Sentry_03_Hood']:
    assert name in byname['idle']['moving_nodes'];assert name in byname['attack']['moving_nodes']
for side in ['L','R']:
    for row in [1,2]:assert f'Shutter_{side}_{row}' in byname['expose']['moving_nodes']
assert byname['idle']['max_first_last_difference']<1e-5
recipe=json.loads((OUT/'recipe.json').read_text());node_ids={o.get('name'):i for i,o in enumerate(g['nodes'])}
for p in recipe['pieces']:
    p['export_node_index']=node_ids[p['name']]
    src=ROOT/p['source']
    data=src.read_bytes() if src.exists() else b''.join(f.read_bytes() for f in sorted(src.parent.glob(src.name+'.part*')))
    length=struct.unpack_from('<I',data,12)[0];doc=json.loads(data[20:20+length]);node=doc['nodes'][p['source_node_index']]
    assert node['name']==p['source_node_name']
    assert node['mesh']==p['source_mesh_index']
recipe['verification']['exported_glb_height_m']=float(hi[1]-lo[1]);recipe['verification']['exported_clip_names']=list(byname)
(OUT/'recipe.json').write_text(json.dumps(recipe,indent=2))
report={'passed':True,'glb_sha256':hashlib.sha256(b).hexdigest(),'glb_bytes':len(b),'triangles':triangles,'mesh_nodes':mesh_nodes,'neutral_bounds_y_up_m':{'min':lo.tolist(),'max':hi.tolist(),'size':(hi-lo).tolist()},'native_clips':clips,'donor_nodes_verified':len(recipe['pieces']),'source_rigs_removed':not bool(g.get('skins'))}
(OUT/'verification.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
