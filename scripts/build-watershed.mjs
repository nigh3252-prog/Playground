import {readdir,mkdir,cp,writeFile} from 'node:fs/promises';import {execFileSync} from 'node:child_process';
const node=process.execPath,completed=[];
const run=args=>execFileSync(node,args,{stdio:'inherit',timeout:1800000});
for(const file of await readdir('assets/world-lab'))if(file.endsWith('.mjs'))run(['--check',`assets/world-lab/${file}`]);
for(const file of await readdir('scripts'))if(file.endsWith('.mjs'))run(['--check',`scripts/${file}`]);
run(['--experimental-vm-modules','scripts/check-browser-module-graph.mjs']);completed.push('Browser app and worker module graphs linked without evaluating a fake DOM');
run(['--test','tests/regional-water-budget.test.mjs','tests/regional-reference-data.test.mjs','tests/regional-benchmark-math.test.mjs']);completed.push('38 water/data/benchmark math and UI-contract tests');
// r6 supersedes the old constrained r5 reference-pack build. The active real-
// world path uses raw DEM + observed climate as inputs, then downloads held-out
// NHD/Census observations into separate benchmark packs. Do not make deploys
// depend on the retired 3DHP display-pack query.
run(['--test','--test-name-pattern=parent |geography is|true visual','tests/regional-benchmark-integration.test.mjs']);completed.push('Parent-world/crop invariants passed before external benchmark downloads');
run(['scripts/prepare-benchmarks.mjs']);completed.push('Four raw-input + held-out observation packs downloaded with source provenance');
run(['--test','tests/regional-benchmark-integration.test.mjs']);completed.push('13 parent/blind-prediction/source/benchmark integration tests');
run(['scripts/run-benchmark-baselines.mjs']);completed.push('4 actual reference baseline reports, same frozen parameters');
await mkdir('public',{recursive:true});
for(const entry of await readdir('.',{withFileTypes:true}))if(!entry.name.startsWith('.')&&entry.name!=='public'&&(entry.isFile()&&/\.(html|js|mjs|css|png|jpg|ico|svg)$/.test(entry.name)||entry.isDirectory()&&['assets','docs'].includes(entry.name)))await cp(entry.name,`public/${entry.name}`,{recursive:true});
await writeFile('public/assets/world-lab/build-validation.json',JSON.stringify({revision:'r6',completed,generatedAt:new Date().toISOString(),note:'All listed Node/model/data checks completed before this file was written. The retired r5 constrained-reference pack builder is not part of this deployment gate. Not a phone WebGL visual test.'},null,2));
console.log('WATERSHED R6: parent-world and blind benchmark checks passed; four independent real-data baseline reports ready.');
