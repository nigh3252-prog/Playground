import {generateTerrain,generateHydrology,generateEcology} from './world-core.mjs';
self.onmessage=({data})=>{
  try{
    const start=performance.now();let world=generateTerrain(data);
    self.postMessage({stage:1,world,elapsed:performance.now()-start});
    world=generateHydrology(world);self.postMessage({stage:2,world,elapsed:performance.now()-start});
    world=generateEcology(world);self.postMessage({stage:3,world,elapsed:performance.now()-start});
  }catch(e){self.postMessage({error:e.message});}
};
