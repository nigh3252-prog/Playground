export const defaultFilters = Object.freeze({section:'all',family:'',collection:'',type:'all', motion:Object.freeze([]), complexity:'all', reviewQuality:'all', latest:false});

const types = new Set(['humanoid','creature','gear','environment','other']);
const legacyTypes = new Map([
  ['dot','other'],
  ['white-mech','humanoid'],
  ['lilac-walker','humanoid'],
  ['bulwark-modular','humanoid'],
  ['crocodilian','creature'],
  ['spirecoil','creature'],
]);

export function modelType(entry) {
  // Future intake may provide an explicit type. Do not guess types from clip/rig presence.
  if (types.has(entry.type)) return entry.type;
  if (legacyTypes.has(entry.id)) return legacyTypes.get(entry.id);
  if (typeof entry.id === 'string') {
    if (entry.id.startsWith('flying-')) return 'creature';
    if (entry.id.startsWith('vertical-pods-')) return 'gear';
  }
  return 'unknown';
}

export function modelMotion(entry) {
  const clips = Array.isArray(entry.clips) ? entry.clips : [];
  return {
    walk:clips.some(clip => typeof clip.name === 'string' && /(?:^|[^a-z])walk(?:ing)?(?:$|[^a-z])/i.test(clip.name)),
    skinned:Number.isFinite(entry.skinJointCount) ? entry.skinJointCount > 0 : entry.rig === 'skinned',
    animated:clips.length > 0,
  };
}

export function modelComplexity(entry) {
  if (!Number.isFinite(entry.triangles) || entry.triangles < 0) return 'unknown';
  return entry.triangles < 10000 ? 'low' : entry.triangles < 50000 ? 'medium' : 'high';
}

function numericVersion(entry) {
  const version = /^v?(\d+(?:\.\d+)*)([a-z]?)$/i.exec(String(entry.version));
  return version ? {numbers:version[1].split('.').map(Number),suffix:version[2].toLowerCase()} : null;
}
function compareVersions({numbers:a,suffix:am},{numbers:b,suffix:bm}) {
  for (let i = 0; i < Math.max(a.length,b.length); i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference) return difference;
  }
  return am > bm ? 1 : am < bm ? -1 : 0;
}
const sections = new Set(['entities','gear','environments']);

export function modelSection(entry) {
  if (sections.has(entry.section)) return entry.section;
  const type = modelType(entry);
  if (type === 'humanoid' || type === 'creature' || entry.type === 'character') return 'entities';
  if (type === 'gear' || entry.type === 'prop') return 'gear';
  if (type === 'environment') return 'environments';
  return 'all';
}

function facetValue(entry, field) {
  const value = typeof entry[field] === 'string' ? entry[field].trim() : '';
  return value || (field === 'collection' && entry.sourceCollection === 'armory' ? 'Armory' : '');
}

export function modelFacetOptions(models, field) {
  return [...new Set(models.map(entry => facetValue(entry,field)).filter(Boolean))]
    .sort((a,b) => a.localeCompare(b,'en'));
}

export function filterModels(models, options = defaultFilters) {
  const filters = {...defaultFilters,...options};
  const latest = new Map();
  if (filters.latest) {
    for (const entry of models) {
      const version = numericVersion(entry);
      const previous = latest.get(entry.id);
      if (version && (!previous || compareVersions(version,previous) > 0)) latest.set(entry.id,version);
    }
  }
  return models.filter(entry => {
    const newest = latest.get(entry.id), version = numericVersion(entry);
    if (newest && version && compareVersions(version,newest) < 0) return false;
    const type = modelType(entry);
    if (sections.has(filters.section) && modelSection(entry) !== filters.section) return false;
    if (filters.type !== 'all' && type !== filters.type) return false;
    if (filters.family && facetValue(entry,'family') !== filters.family) return false;
    if (filters.collection && facetValue(entry,'collection') !== filters.collection) return false;
    if (filters.complexity !== 'all' && modelComplexity(entry) !== filters.complexity) return false;
    if (filters.reviewQuality && filters.reviewQuality !== 'all') {
      const quality = !entry.review ? 'unreviewed' : entry.review.visualQuality ?? 'not-rated';
      if (quality !== filters.reviewQuality) return false;
    }
    const motion = modelMotion(entry);
    return filters.motion.every(criterion => Boolean(motion[criterion]));
  });
}
