const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const version = /^v[1-9][0-9]*[a-z]?$/;

export function assetURL(entry, pageURL) {
  const {id, version:revision, asset, sourceCollection, sourceId} = entry;
  if (typeof id !== "string" || typeof revision !== "string" || !slug.test(id) || !version.test(revision)) throw Error('Invalid asset location');
  let expected;
  if (sourceCollection === 'armory') {
    if (typeof sourceId !== 'string' || !slug.test(sourceId) || id !== `armory-${sourceId}` || revision !== 'v1') {
      throw Error('Invalid asset location');
    }
    expected = `../armory/models/${sourceId}.glb`;
  } else {
    if (sourceCollection != null || id.startsWith('armory-')) throw Error('Invalid asset location');
    expected = `assets/${id}-${revision}.glb`;
  }
  if (asset !== expected) throw Error('Invalid asset location');
  return new URL(expected, pageURL);
}
