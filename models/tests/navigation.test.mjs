import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveModel, stepModel, modelURL, createSelection } from '../navigation.mjs';
const models = [{id:'dot', version:'v1'}, {id:'white-mech', version:'v1'}, {id:'white-mech', version:'v2'}];
test('a deep link selects the exact revision, invalid version falls back explicitly', () => {
  assert.deepEqual(resolveModel(models, '?model=white-mech&v=v2'), {model:models[2], fallback:false});
  assert.deepEqual(resolveModel(models, '?model=white-mech&v=v99'), {model:models[0], fallback:true});
  assert.deepEqual(resolveModel(models, ''), {model:models[0], fallback:false});
  assert.equal(modelURL('https://example.org/models/?q=test#old', models[1]).href,
               'https://example.org/models/?model=white-mech&v=v1');
});
test('next and previous traverse and wrap in the catalog', () => {
  assert.equal(stepModel(models, models[0], -1), models[2]);
  assert.equal(stepModel(models, models[2], 1), models[0]);
});
test('last request wins and stale parsed models are disposed', async () => {
  const installed = [], discarded = [], pending = {};
  const select = createSelection({
    load: (entry, signal) => new Promise(resolve => { pending[entry.id] = { resolve, signal }; }),
    install: (entry, result) => installed.push([entry.id,result]),
    discard: result => discarded.push(result),
  });
  const first = select(models[0]);
  const second = select(models[1]);
  assert.equal(pending.dot.signal.aborted, true);
  pending['white-mech'].resolve('new');
  await second;
  pending.dot.resolve('old');
  await first;
  assert.deepEqual(installed, [['white-mech','new']]);
  assert.deepEqual(discarded, ['old']);
});
test('a failed current selection can be retried', async () => {
  let attempt=0;
  const installed=[], errors=[];
  const select=createSelection({
    load: async () => {if (!attempt++) throw Error('missing'); return 'success';},
    install: (...args) => installed.push(args),
    discard: () => {},
    fail: (entry,error) => errors.push([entry.id,error.message]),
  });
  await select(models[0]); await select(models[0]);
  assert.deepEqual(errors,[['dot','missing']]);
  assert.deepEqual(installed,[[models[0],'success']]);
});
