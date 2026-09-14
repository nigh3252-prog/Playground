import {generateStagesV6,runSuite} from './benchmark-pipeline.mjs';
import {simulateHumanHistory} from './human-history.mjs';

let parent=null,job=0;
self.onmessage=async({data})=>{
  const token=++job;
  const send=message=>{if(token===job)self.postMessage({...message,requestId:data.requestId});};
  const cancelled=()=>token!==job;
  try{
    if(data.job==='suite'){
      const result=await runSuite(data,send,cancelled);send({suiteComplete:result});return;
    }
    if(data.job!=='humanHistory'){
      parent=null;
      const result=await generateStagesV6(data,send,cancelled);
      if(cancelled())return;
      parent=result?.parentDomain?result:null;
    }
    if(!parent){if(data.job==='humanHistory')throw new Error('Generate a parent world before its history.');return;}
    const humanHistory=await simulateHumanHistory(parent,data.historyOptions,
      p=>send({progress:`History · generation ${p.generation} of ${p.generations}`}),cancelled);
    if(humanHistory)send({humanHistory});
  }catch(e){send({error:e.message});}
};
