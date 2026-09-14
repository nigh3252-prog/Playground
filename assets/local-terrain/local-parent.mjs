import {generateParentTerrain} from '../world-lab/parent-world.mjs';
import {predictFromTerrain} from '../world-lab/benchmark-pipeline.mjs';

export function generateSolvedParent(options={}){
 const terrain=generateParentTerrain(options),stages=predictFromTerrain(terrain);
 return stages[stages.length-1];
}
