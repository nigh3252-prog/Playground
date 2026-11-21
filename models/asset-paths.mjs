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

const digest = /^[a-f0-9]{64}$/;
const originalName = /^[A-Za-z0-9_-]+\.glb$/;
const validLength = n => Number.isSafeInteger(n) && n > 0 && n <= 6_000_000;

export async function fetchSplitGLB(entry, pageURL, signal, fetchPart = fetch) {
  const {id, version:revision, asset, sourceCollection, originalFile, parts, bytes, sha256} = entry;
  if (typeof id !== 'string' || !slug.test(id) || id.startsWith('armory-') ||
      typeof revision !== 'string' || !version.test(revision) || asset !== null || sourceCollection != null ||
      typeof originalFile !== 'string' || !originalName.test(originalFile) ||
      !Array.isArray(parts) || parts.length !== 3 || typeof sha256 !== 'string' || !digest.test(sha256) ||
      !parts.every((p,i) => p && p.asset === `assets/${id}-${revision}.glb.part${i+1}` &&
        validLength(p.bytes) && typeof p.sha256 === 'string' && digest.test(p.sha256)) ||
      bytes !== parts.reduce((total, p) => total + p.bytes, 0)) throw Error('Invalid split asset');
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  async function hash(data) {
    const result = await globalThis.crypto.subtle.digest('SHA-256', data);
    signal.throwIfAborted();
    return Array.from(new Uint8Array(result), n => n.toString(16).padStart(2,'0')).join('');
  }
  for (const part of parts) {
    signal.throwIfAborted();
    const response = await fetchPart(new URL(part.asset, pageURL), {signal,redirect:'error'});
    signal.throwIfAborted();
    if (!response.ok) throw Error(`Model request returned ${response.status}`);
    const data = await response.arrayBuffer();
    signal.throwIfAborted();
    if (data.byteLength !== part.bytes || await hash(data) !== part.sha256) throw Error('Part integrity mismatch');
    buffer.set(new Uint8Array(data),offset);
    offset += part.bytes;
  }
  if (await hash(buffer) !== sha256) throw Error('GLB integrity mismatch');
  return buffer.buffer;
}
