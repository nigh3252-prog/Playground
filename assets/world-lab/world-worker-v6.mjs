import {generateStagesV6,runSuite} from './benchmark-pipeline.mjs';
self.onmessage=async({data})=>{try{if(data.job==='suite'){const result=await runSuite(data,message=>self.postMessage(message));self.postMessage({suiteComplete:result});}else await generateStagesV6(data,message=>self.postMessage(message));}catch(e){self.postMessage({error:e.message});}};
