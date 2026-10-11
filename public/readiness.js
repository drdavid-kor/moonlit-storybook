const imageRoute = /^\/api\/illustrations\/[a-f0-9]{24}\/[0-5]$/;

export function isBookReady(book) {
  return book?.status === 'completed' && book.result?.pages?.length > 0 &&
    book.result.pages.every(page => page.illustration?.status === 'completed' && imageRoute.test(page.illustration.url || ''));
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
    async preload(book) {
      if (!isBookReady(book)) throw new Error('The complete illustrated book is not ready.');
      await Promise.all(book.result.pages.map(async page => {
        const path = page.illustration.url;
        let entry = entries.get(path);
        if (!entry) {
          entry = {};
          entry.promise = Promise.resolve().then(() => load(path)).then(source => { entry.source = source; });
          entries.set(path, entry);
          entry.promise.catch(() => entries.delete(path));
        }
        await entry.promise;
      }));
    }
  };
}
