export const qualityLevels = Object.freeze(['exceptional','high','medium','low']);
export const reviewKey = entry => `${entry.id}@${entry.version}`;

export function buildReviewIndex(registry, catalog) {
  if (registry?.schemaVersion !== 1 || !Array.isArray(registry.modelReviews)) {
    throw Error('Unsupported model-review registry');
  }
  const known = new Set(catalog.map(reviewKey));
  const index = new Map();
  for (const review of registry.modelReviews) {
    const key = reviewKey(review);
    if (!known.has(key)) throw Error(`Review target missing from catalog: ${key}`);
    if (index.has(key)) throw Error(`Duplicate model review: ${key}`);
    if (review.visualQuality !== null && !qualityLevels.includes(review.visualQuality)) {
      throw Error(`Invalid visual-quality assessment: ${key}`);
    }
    index.set(key, review);
  }
  return index;
}

export function reviewQuality(entry) {
  if (!entry.review) return 'unreviewed';
  return entry.review.visualQuality ?? 'not-rated';
}

export function familyVariants(catalog, entry) {
  if (!entry) return [];
  const family = typeof entry.family === 'string' ? entry.family.trim() : '';
  return catalog.filter(other => other.id === entry.id ||
    (family && typeof other.family === 'string' && other.family.trim() === family));
}
