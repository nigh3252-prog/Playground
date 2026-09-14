import test from 'node:test';
import assert from 'node:assert/strict';
import {localTextureSize} from '../assets/local-terrain/local-rendering.mjs';

test('local terrain texture supports WebGL1 mipmap sampling',()=>{
 const size=localTextureSize();
 assert.ok(size>=512,'texture retains enough diagnostic detail');
 assert.equal(size&(size-1),0,'texture dimensions must be powers of two');
});
