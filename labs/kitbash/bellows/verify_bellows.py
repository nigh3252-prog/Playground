"""Read back the exported GLB, independent of the Blender scene."""
import pathlib,struct,json,hashlib,numpy as np
P=pathlib.Path(__file__).resolve().parent
b=(P/'bellows.glb').read_bytes();n=struct.unpack_from('<I',b,12)[0];g=json.loads(b[20:20+n]);buf=b[28+n:]
def acc(i):
 a=g['accessors'][i];v=g['bufferViews'][a['bufferView']];k={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']];dt=np.dtype({5121:'u1',5123:'<u2',5125:'<u4',5126:'<f4'}[a['componentType']]);return np.ndarray((a['count'],k),dt,buf,offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',k*dt.itemsize),dt.itemsize))
parents={c:i for i,nd in enumerate(g['nodes']) for c in nd.get('children',[])}
def matrix(i):
 nd=g['nodes'][i]
 if 'matrix' in nd:m=np.array(nd['matrix']).reshape(4,4).T
 else:
  m=np.eye(4);m[:3,3]=nd.get('translation',[0,0,0]);x,y,z,w=nd.get('rotation',[0,0,0,1]);m[:3,:3]=np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])@np.diag(nd.get('scale',[1,1,1]))
 return matrix(parents[i])@m if i in parents else m
points=[];triangles=0;meshes=0;donor_parts=0
for i,nd in enumerate(g['nodes']):
 if 'mesh' not in nd:continue
 meshes+=1;donor_parts+='donor_file' in nd.get('extras',{})
 for p in g['meshes'][nd['mesh']]['primitives']:
  assert p.get('mode',4)==4
  a=acc(p['attributes']['POSITION']);points.append((np.column_stack([a,np.ones(len(a))])@matrix(i).T)[:,:3]);triangles+=(len(acc(p['indices'])) if 'indices' in p else len(a))//3
p=np.vstack(points);lo=p.min(0);hi=p.max(0)
clips=[]
for a in g.get('animations',[]):
 times=np.concatenate([acc(s['input']).flatten() for s in a['samplers']]);moving=[]
 for c in a['channels']:
  out=acc(a['samplers'][c['sampler']]['output'])
  if np.ptp(out,axis=0).max()>1e-6:moving.append({'node':g['nodes'][c['target']['node']].get('name'),'property':c['target']['path']})
 clips.append({'name':a['name'],'start_s':float(times.min()),'end_s':float(times.max()),'duration_s':float(times.max()-times.min()),'varying_channels':moving})
r={'file':'bellows.glb','sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b),'gltf_version':g['asset']['version'],'self_contained':all('uri' not in x for x in g.get('buffers',[])) and all('uri' not in x for x in g.get('images',[])),'bounds_gltf_m':{'min':lo.tolist(),'max':hi.tolist()},'dimensions_m':{'width':float(hi[0]-lo[0]),'height':float(hi[1]-lo[1]),'depth':float(hi[2]-lo[2])},'triangles':triangles,'mesh_nodes':meshes,'donor_attributed_mesh_nodes':donor_parts,'clips':clips}
# Evaluate each exported animation at each sampled frame, using the GLB alone.
base_nodes=g['nodes']
mesh_points={i:[acc(pr['attributes']['POSITION']) for pr in g['meshes'][nd['mesh']]['primitives']] for i,nd in enumerate(base_nodes) if 'mesh' in nd}
def interpolate(times,values,t,rotation=False):
 if t<=times[0]:return values[0].copy()
 if t>=times[-1]:return values[-1].copy()
 j=int(np.searchsorted(times,t));u=float((t-times[j-1])/(times[j]-times[j-1]));a=values[j-1].astype(float);bb=values[j].astype(float)
 if rotation:
  dot=float(np.dot(a,bb))
  if dot<0:bb=-bb;dot=-dot
  if dot>.9995:q=(1-u)*a+u*bb;return q/np.linalg.norm(q)
  theta=np.arccos(np.clip(dot,-1,1));return (np.sin((1-u)*theta)*a+np.sin(u*theta)*bb)/np.sin(theta)
 return (1-u)*a+u*bb
def pose_bounds(anim,t):
 working=[dict(nd) for nd in base_nodes]
 for ch in anim['channels']:
  sam=anim['samplers'][ch['sampler']];assert sam.get('interpolation','LINEAR')=='LINEAR'
  target=ch['target'];working[target['node']][target['path']]=interpolate(acc(sam['input']).flatten(),acc(sam['output']),t,target['path']=='rotation').tolist()
 g['nodes']=working;cache={}
 def cached(i):
  if i not in cache:cache[i]=matrix(i)
  return cache[i]
 pp=[]
 for i,aa in mesh_points.items():
  for ar in aa:pp.append((np.column_stack([ar,np.ones(len(ar))])@cached(i).T)[:,:3])
 g['nodes']=base_nodes;v=np.vstack(pp);return v.min(0),v.max(0)
for anim,record in zip(g.get('animations',[]),clips):
 amin,amax=pose_bounds(anim,0);record['neutral_start_bounds_match']=bool(np.max(np.abs(amin-lo))<1e-5 and np.max(np.abs(amax-hi))<1e-5)
 assert record['neutral_start_bounds_match'],anim['name']+' does not start at neutral'
 ground=1e9;maxheight=0
 for frame in range(round(record['duration_s']*30)+1):
  pmin,pmax=pose_bounds(anim,frame/30);ground=min(ground,float(pmin[1]));maxheight=max(maxheight,float(pmax[1]))
 record['sampled_ground_min_m']=ground;record['sampled_highest_point_m']=maxheight
 assert ground>-1e-5,(anim['name'],ground)
assert r['self_contained'];assert abs(r['dimensions_m']['height']-12)<1e-5;assert abs(lo[1])<1e-5;assert triangles==6684;assert donor_parts==meshes==93
assert {a['name'] for a in clips}=={'Idle','Charge_Jump_Demo'}
assert all(len(a['varying_channels'])>=5 for a in clips)
assert all(abs(a['start_s'])<1e-8 for a in clips)
(P/'validation.json').write_text(json.dumps(r,indent=2));print(json.dumps(r,indent=2))
