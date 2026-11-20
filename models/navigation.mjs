const versionOf = entry => String(entry.version);
export function resolveModel(models, search) {
  if (!models.length) throw Error('Empty model catalog');
  const params = new URLSearchParams(search);
  if (!params.has('model') && !params.has('v')) return {model:models[0], fallback:false};
  const model = models.find(entry => entry.id === params.get('model') && versionOf(entry) === params.get('v'));
  return {model:model ?? models[0], fallback:!model};
}
export function modelURL(location, entry) {
  const url = new URL(location);
  url.search = new URLSearchParams({model:entry.id, v:versionOf(entry)});
  url.hash = '';
  return url;
}
export function stepModel(models, current, delta) {
  const index = models.findIndex(entry => entry.id === current.id && versionOf(entry) === versionOf(current));
  return models[(Math.max(index, 0) + delta + models.length) % models.length];
}
export function createSelection({load, install, discard, fail = () => {}}) {
  let latest;
  return async entry => {
    latest?.abort();
    const controller = new AbortController();
    latest = controller;
    try {
      const result = await load(entry, controller.signal);
      if (latest !== controller) discard(result);
      else install(entry, result);
    } catch (error) {
      if (latest === controller) fail(entry, error);
    }
  };
}
