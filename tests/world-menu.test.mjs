import test from 'node:test';
import assert from 'node:assert/strict';
import {ATLAS_MENU_SECTIONS,CITY_MENU_SECTIONS,reduceMenuState} from '../assets/world-lab/world-menu.mjs';

test('atlas and city expose the approved compact menu categories',()=>{
  assert.deepEqual(ATLAS_MENU_SECTIONS,['explore','build','history','layers','world','tools']);
  assert.deepEqual(CITY_MENU_SECTIONS,['detail','places','layers','tools']);
});

test('menu opens one category at a time and remembers the last category',()=>{
  let state={open:false,context:'atlas',active:'explore',last:{atlas:'explore',city:'detail'}};
  state=reduceMenuState(state,{type:'toggle-menu'});
  assert.deepEqual(state,{open:true,context:'atlas',active:'explore',last:{atlas:'explore',city:'detail'}});
  state=reduceMenuState(state,{type:'select',section:'history'});
  assert.equal(state.open,true);assert.equal(state.active,'history');assert.equal(state.last.atlas,'history');
  state=reduceMenuState(state,{type:'select',section:'layers'});
  assert.equal(state.active,'layers');assert.equal(state.last.atlas,'layers');
  state=reduceMenuState(state,{type:'toggle-menu'});
  assert.equal(state.open,false);assert.equal(state.active,'layers');
  state=reduceMenuState(state,{type:'toggle-menu'});
  assert.equal(state.open,true);assert.equal(state.active,'layers');
});

test('switching map context uses the appropriate category set without leaking atlas-only panels',()=>{
  let state={open:true,context:'atlas',active:'world',last:{atlas:'world',city:'detail'}};
  state=reduceMenuState(state,{type:'context',context:'city'});
  assert.equal(state.context,'city');assert.equal(state.active,'detail');assert.equal(state.open,true);
  state=reduceMenuState(state,{type:'select',section:'places'});
  assert.equal(state.active,'places');assert.equal(state.last.city,'places');
  state=reduceMenuState(state,{type:'context',context:'atlas'});
  assert.equal(state.active,'world');
});

test('invalid categories are ignored in the current context',()=>{
  const state={open:true,context:'city',active:'detail',last:{atlas:'explore',city:'detail'}};
  assert.deepEqual(reduceMenuState(state,{type:'select',section:'world'}),state);
});
