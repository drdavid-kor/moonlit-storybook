const imageRoute = /^\/api\/illustrations\/[a-f0-9]{24}\/[0-9]$/;
const motionRoute = /^\/api\/motion\/[a-f0-9]{24}\/[0-9]$/;

export function isBookReady(book) {
  return book?.status === 'completed' && book.result?.pages?.length > 0 &&
    book.result.pages.every(page => page.illustration?.status === 'completed' && imageRoute.test(page.illustration.url || '') &&
      (!book.metadata?.motion_required || (page.motion?.status === 'completed' && motionRoute.test(page.motion.url || ''))));
}

export function selectShelf(books, savedIds = []) {
  const ready = books.filter(isBookReady), byId = new Map(ready.map(book => [book.id, book]));
  const saved = savedIds.map(id => byId.get(id)).filter(Boolean);
  if (saved.length && saved.length === savedIds.length) return saved;
  const groups = new Map();
  for (const book of ready) {
    const id = book.params?.preparation_id;
    if (!id) continue;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(book);
  }
  const complete = [...groups.values()].find(group => new Set(group.map(book => book.params.story_index)).size === 3);
  return complete ? complete.sort((a, b) => a.params.story_index - b.params.story_index) : ready.filter(book => !book.params?.preparation_id).slice(0, 3);
}

// Keep decoded images in this document, so opening a prepared cover needs no image request.
export function createArtworkCache(load) {
  const entries = new Map();
  return {
    source(path) { return entries.get(path)?.source; },
    blob(path) { return entries.get(path)?.blob; },
    async preload(book, { motion = false } = {}) {
      if (!isBookReady(book)) throw new Error('The complete illustrated book is not ready.');
      const paths = book.result.pages.flatMap(page => [page.illustration.url, ...(motion && page.motion?.status === 'completed' ? [page.motion.url] : [])]);
      await Promise.all(paths.map(async path => {
        let entry = entries.get(path);
        if (!entry) {
          entry = {};
          entry.promise = Promise.resolve().then(() => load(path)).then(result => { entry.source = typeof result === 'string' ? result : result.source;entry.blob = result.blob; });
          entries.set(path, entry);
          entry.promise.catch(() => entries.delete(path));
        }
        await entry.promise;
      }));
    }
  };
}
