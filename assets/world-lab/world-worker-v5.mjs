import {generateStages} from './world-pipeline.mjs';
self.onmessage=async({data})=>{try{await generateStages(data,message=>self.postMessage(message));}catch(e){self.postMessage({error:e.message});}};
