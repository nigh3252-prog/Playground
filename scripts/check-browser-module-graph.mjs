// Resolve browser entry-point imports/exports without pretending that a Node
// DOM stub is a real WebGL browser test. Requires --experimental-vm-modules.
import {SourceTextModule,createContext} from 'node:vm';
import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
const context=createContext({}),modules=new Map();
async function get(file){const id=resolve(file);if(!modules.has(id))modules.set(id,readFile(id,'utf8').then(source=>new SourceTextModule(source,{context,identifier:id})));return modules.get(id);}
async function linker(specifier,parent){if(!specifier.startsWith('.'))throw new Error('Unexpected external browser import: '+specifier);return get(resolve(dirname(parent.identifier),specifier));}
for(const file of ['assets/world-lab/world-app-v6.mjs','assets/world-lab/world-worker-v6.mjs']){const module=await get(file);if(module.status==='unlinked')await module.link(linker);console.log('Linked browser module graph:',file);}
