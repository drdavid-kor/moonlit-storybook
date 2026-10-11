// A bounded topology is compiled on the server, never invented while reading.
export const MAIN_PATH = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'];
export const NODE_IDS = [...MAIN_PATH, 'a1', 'a2', 'b1', 'b2'];
export const EDGES = { m1: ['m2'], m2: ['m3', 'a1'], m3: ['m4'], m4: ['m5', 'b1'], m5: ['m6'], m6: [], a1: ['a2'], a2: [], b1: ['b2'], b2: [] };

export function compileTree(result) {
  if (result.pages.length !== NODE_IDS.length) throw Error('Invalid node count.');
  if (result.forks?.length !== 2 || result.endings?.length !== 3) throw Error('Missing prepared branches or endings.');
  result.pages.forEach((page, index) => {
    page.id = NODE_IDS[index];
    const edges = EDGES[page.id];
    page.interaction = page.id === 'm2' ? result.forks[0] : page.id === 'm4' ? result.forks[1] : null;
    page.ending = ['m6', 'a2', 'b2'].includes(page.id) ? result.endings[['m6', 'a2', 'b2'].indexOf(page.id)] : null;
    page.next = edges[0] || null;
    page.interaction?.choices.forEach((choice, i) => { choice.target = edges[i]; });
  });
  delete result.forks;delete result.endings;
  result.tree = { version: 1, root: 'm1', main_path: [...MAIN_PATH] };
  validateTree(result);
  return result;
}

export function targets(page) {
  return page.interaction ? page.interaction.choices.map(choice => choice.target) : page.next ? [page.next] : [];
}

export function validateTree(book) {
  const nodes = new Map(book.pages.map(page => [page.id, page]));
  if (nodes.size !== book.pages.length || book.pages.length > 10 || !nodes.has(book.tree?.root)) throw Error('Invalid story tree.');
  const seen = new Set(), active = new Set(), paths = [];
  function walk(id, path) {
    if (!nodes.has(id)) throw Error('Dangling story link.');
    if (active.has(id)) throw Error('Story cycle.');
    if (seen.has(id)) throw Error('A story node has multiple parents.');
    const page = nodes.get(id), next = targets(page), route = [...path, id];
    if (route.length > 6) throw Error('Story route is too long.');
    if (new Set(next).size !== next.length || (page.interaction && (next.length !== 2 || page.next !== next[0]))) throw Error('Invalid choices.');
    if (Boolean(page.ending) !== (next.length === 0)) throw Error('Every route must end.');
    seen.add(id);active.add(id);
    if (!next.length) paths.push(route);
    for (const target of next) walk(target, route);
    active.delete(id);
  }
  walk(book.tree.root, []);
  if (seen.size !== nodes.size) throw Error('Unreachable story node.');
  const main = book.tree.main_path;
  if (!Array.isArray(main) || main.length !== 6 || !paths.some(path => JSON.stringify(path) === JSON.stringify(main))) throw Error('Invalid story trunk.');
  return paths;
}

export function routeTo(book, target) {
  if (!book.tree) return book.pages.slice(0, target + 1).map((_, i) => i);
  const nodes = new Map(book.pages.map(page => [page.id, page]));
  const walk = (id, path) => {
    if (path.includes(id) || !nodes.has(id)) return null;
    const route = [...path, id];
    if (id === target) return route;
    for (const next of targets(nodes.get(id))) { const found = walk(next, route);if (found) return found; }
    return null;
  };
  return walk(book.tree.root, []) || [];
}

export function illustrationHistory(book, index) {
  if (!book.tree) return book.pages.slice(0, index + 1);
  return routeTo(book, book.pages[index].id).map(id => book.pages.find(page => page.id === id));
}
