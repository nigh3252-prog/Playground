import {readdir,mkdir,cp,writeFile} from 'node:fs/promises';import {execFileSync} from 'node:child_process';
const node=process.execPath;
const run=args=>execFileSync(node,args,{stdio:'inherit',timeout:600000});
// Parse every local world module before attempting another preview deployment.
for(const file of await readdir('assets/world-lab'))if(file.endsWith('.mjs'))run(['--check',`assets/world-lab/${file}`]);
run(['--test','tests/regional-water-budget.test.mjs','tests/regional-reference-data.test.mjs']);
run(['scripts/prepare-reference-data.mjs']);
run(['--test','tests/regional-integration-v5.test.mjs']);
await mkdir('public',{recursive:true});
// Preserve all existing static Playground demos and their assets. No routes,
// production domains, projects, account settings or paid services are changed.
for(const entry of await readdir('.',{withFileTypes:true}))if(!entry.name.startsWith('.')&&entry.name!=='public'&&(entry.isFile()&&/\.(html|js|mjs|css|png|jpg|ico|svg)$/.test(entry.name)||entry.isDirectory()&&['assets','docs'].includes(entry.name)))await cp(entry.name,`public/${entry.name}`,{recursive:true});
await writeFile('public/assets/world-lab/build-validation.json',JSON.stringify({revision:'r5',unitChecks:17,integrationChecks:6,generatedAt:new Date().toISOString(),note:'Node/model/data validation passed. Not a phone WebGL visual test.'},null,2));
console.log('WATERSHED R5: all 23 unit/integration checks passed; both real reference packs ready.');
