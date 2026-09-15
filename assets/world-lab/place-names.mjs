/** Plain place names refer only to present geography or to the generated
 * founding community. Naming is independent of the demographic random stream.
 * Both exported helpers are pure; callers reserve returned names themselves.
 */
const HOUSEHOLDS=['Bell','Ward','Ellis','Shaw','Grant','Reed','Cole','Mason','Hayes','Lane','Brooks','Stone','Wells','Price','Webb','Hart','Gray','Ross','Blake','Dean','Mills','Hale','Moore','Ford','West','Page','Clarke','Green','Wood','Finch','Palmer','Watts','Sutton','Field','Bennett','Carter','Dale','Fletcher','Hughes','Kent','Lawson','Marsh','Nash','Owen','Parker','Quinn','Rowe','Scott','Turner','Vaughan','Walsh','Young','Abbott','Bailey','Collins','Dawson','Evans','Foster','Gibbs','Harris','Irwin','James','Kerr','Lewis'];
const GIVEN=['Ada','Alma','Anita','Arun','Bela','Cora','Dara','Eden','Elias','Emil','Esme','Eva','Farah','Flora','Hana','Hugo','Ida','Ilan','Iona','Iris','Jaya','Jonah','Jules','Kiran','Lena','Leon','Lila','Lina','Luca','Mara','Maya','Milan','Mira','Nadia','Nala','Nina','Noah','Nora','Omar','Orin','Otto','Priya','Rafi','Raya','Remy','Rosa','Ruth','Sami','Sana','Sara','Seth','Sofia','Tala','Tara','Theo','Tomas','Uma','Vera','Willa','Yara','Yuri','Zara','Zoya','Asha'];
const CIVIC_FORMS=['assembly','commons','council','fellowship','cooperative','union'];
const TITLE=s=>s[0].toUpperCase()+s.slice(1);
function hash(n,seed){let t=(n^seed)>>>0;t=Math.imul(t^t>>>16,0x45d9f3b);t=Math.imul(t^t>>>16,0x45d9f3b);return(t^t>>>16)>>>0;}
function featuresAt(world,nodeId){
 const nearby=[nodeId],mesh=world.mesh;
 for(let k=mesh.offsets[nodeId];k<mesh.offsets[nodeId+1];k++)nearby.push(mesh.neighbors[k]);
 const out=[],add=(name,origin)=>out.push({name,nameOrigin:origin});
 if(nearby.some(i=>world.ocean[i]))add('Coast View','Named for the nearby ocean coast.');
 if(nearby.some(i=>world.lake[i]))add('Lake Shore','Named for the neighboring lake shore.');
 if(nearby.some(i=>world.river?.[i]||world.navigableRiver[i])){
  add('Riverbank','Named for the nearby river reach.');
  add('River Reach','Named for the nearby river channel.');
 }
 if(world.strategicKind?.[nodeId]==='confluence'||world.confluences?.includes(nodeId))add('The Meeting','Named for the tributaries that meet at this river confluence.');
 if(world.strategicKind?.[nodeId]==='pass')add('The Pass','Named for the local saddle through the surrounding high ground.');
 if(world.strategicKind?.[nodeId]==='mouth')add('River Mouth','Named for the river entering open water here.');
 const biome=world.biome[nodeId];
 if([3,4,5,9].includes(biome)){
  add('Woodland End','Named for the woodland around the founding households.');
  add('Forest Green','Named for the surrounding wooded landscape.');
 }else if(biome===6){
  add('Open Meadow','Named for the open grassland at the founding site.');
  add('Grass Fields','Named for the surrounding grassland.');
 }else if(biome===7)add('Dry Plain','Named for the dry steppe around the founding site.');
 else if(biome===8)add('Scrub Plain','Named for the surrounding arid scrubland.');
 else if(biome===2)add('Marsh Edge','Named for the wetland landscape at the founding site.');
 if(nearby.some(i=>world.height[i]>world.height[nodeId]+100))add('Below the Ridge','Named for the neighboring ground rising above the founding site.');
 if(world.height[nodeId]>600)add('High Ground','Named for the elevated founding site.');
 if(world.productivity[nodeId]>.4)add('Good Fields','Named for the productive ground available to the founding households.');
 return out;
}

export function createCommunityIdentity(world,nodeId,id,seed=104729){
 const h=hash(nodeId,seed+id*157),identity=(hash(0,seed)+id*1987)%(GIVEN.length*HOUSEHOLDS.length);
 const foundingHousehold=`${GIVEN[identity%GIVEN.length]} ${HOUSEHOLDS[Math.floor(identity/GIVEN.length)]}`,civicForm=CIVIC_FORMS[Math.floor(h/HOUSEHOLDS.length)%CIVIC_FORMS.length];
 const landscape=featuresAt(world,nodeId),local=landscape[h%Math.max(1,landscape.length)]?.name;
 const name=`${foundingHousehold} ${TITLE(civicForm)}`;
 return {id,name,foundingHousehold,civicForm,originNodeId:nodeId,
  nameOrigin:`The founding ${foundingHousehold} households organized this community as ${civicForm==='assembly'?'an':'a'} ${civicForm}.`,
  localIdentity:local||`${foundingHousehold} households`};
}

export function namePlace(world,{nodeId,id,seed=104729,group,usedNames=new Set()}){
 const h=hash(nodeId+id*97,seed),features=featuresAt(world,nodeId),household=group?.foundingHousehold||HOUSEHOLDS[h%HOUSEHOLDS.length];
 const civic=group?.civicForm||'commons',candidates=[];
 if(features.length){
  const feature=features[h%features.length];
  candidates.push(feature);
  candidates.push({name:`${household} ${feature.name.replace(/^The /,'')}`,nameOrigin:`${feature.nameOrigin} The ${household} founding households distinguish this community's name.`});
 }
 candidates.push({name:`${household} ${TITLE(civic)}`,nameOrigin:`Named for the founding ${household} households and their ${civic}.`});
 candidates.push({name:`${household} Common`,nameOrigin:`Named for the common ground of the founding ${household} households.`});
 // Rotate the first choices for varied geographical and civic names. Collision
 // alternatives carry actual generated household identity, never a numbered
 // place suffix or an invented king, battle, occupation, or biography.
 const start=h%candidates.length;
 for(let i=0;i<candidates.length;i++){
  const candidate=candidates[(start+i)%candidates.length];if(!usedNames.has(candidate.name))return candidate;
 }
 for(let attempt=0;attempt<GIVEN.length*HOUSEHOLDS.length;attempt++){
  const n=(h+attempt*1987)%(GIVEN.length*HOUSEHOLDS.length),founder=`${GIVEN[n%GIVEN.length]} ${HOUSEHOLDS[Math.floor(n/GIVEN.length)]}`;
  const name=`${founder} ${features.length?features[n%features.length].name.replace(/^The /,''):TITLE(civic)}`;
  if(!usedNames.has(name))return {name,nameOrigin:`Named for the generated founding household of ${founder}, within the ${group?.name||`${household} ${TITLE(civic)}`}.${features.length?' '+features[n%features.length].nameOrigin:''}`,foundingHousehold:founder};
 }
 throw new Error('Place-name capacity exceeded');
}
