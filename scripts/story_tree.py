"""Local counterpart of the bounded tree compiler; cloud and local share prompts/schema."""
MAIN = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']
IDS = MAIN + ['a1', 'a2', 'b1', 'b2']
EDGES = {'m1': ['m2'], 'm2': ['m3', 'a1'], 'm3': ['m4'], 'm4': ['m5', 'b1'], 'm5': ['m6'], 'm6': [], 'a1': ['a2'], 'a2': [], 'b1': ['b2'], 'b2': []}


def compile_tree(result):
    if len(result['pages']) != 10 or len(result.get('forks', [])) != 2 or len(result.get('endings', [])) != 3:
        raise ValueError('Missing prepared branches or endings.')
    for index, page in enumerate(result['pages']):
        page['id'] = IDS[index]
        edges = EDGES[page['id']]
        page['interaction'] = result['forks'][0] if page['id'] == 'm2' else result['forks'][1] if page['id'] == 'm4' else None
        page['ending'] = result['endings'][['m6', 'a2', 'b2'].index(page['id'])] if not edges else None
        page['next'] = edges[0] if edges else None
        if page['interaction']:
            for choice, target in zip(page['interaction']['choices'], edges):
                choice['target'] = target
    del result['forks']
    del result['endings']
    result['tree'] = {'version': 1, 'root': 'm1', 'main_path': MAIN.copy()}
    return result


def illustration_history(book, index):
    if not book.get('tree'):
        return book['pages'][:index + 1]
    nodes = {p['id']: p for p in book['pages']}
    target = book['pages'][index]['id']

    def walk(node_id, path):
        if node_id in path or node_id not in nodes:
            return None
        route = path + [node_id]
        if node_id == target:
            return [nodes[node] for node in route]
        page = nodes[node_id]
        edges = [c['target'] for c in page['interaction']['choices']] if page['interaction'] else [page['next']] if page['next'] else []
        for edge in edges:
            found = walk(edge, route)
            if found:
                return found
        return None

    return walk(book['tree']['root'], []) or []
