import { SYSTEM, INSTRUCTION, BILINGUAL, BOOK_SCHEMA } from './model.js';
import { compileTree } from '../public/tree.js';

export function check(value, schema) {
  if (schema.anyOf) {
    if (!schema.anyOf.some(s => { try { check(value, s); return true; } catch { return false; } })) throw new Error('Invalid story structure.');
    return;
  }
  if (schema.type === 'null') { if (value !== null) throw new Error('Expected null.'); }
  else if (schema.type === 'string') {
    if (typeof value !== 'string' || !value.trim() || value.length > 3000 || (schema.enum && !schema.enum.includes(value))) throw new Error('Invalid story text.');
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length !== schema.minItems) throw new Error('Invalid item count.');
    value.forEach(v => check(v, schema.items));
  } else if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== Object.keys(schema.properties).length) throw new Error('Invalid story fields.');
    for (const [k, s] of Object.entries(schema.properties)) check(value[k], s);
  }
}

export function validate(data) {
  if (data?.kind === 'turn') throw new Error('实时续写已关闭。 / Live continuation is disabled.');
  if (!data || data.kind !== 'book' || typeof data.concept !== 'string' || !data.concept.trim() || data.concept.trim().length > 320 || !['4–5', '6–8', '9–12'].includes(data.age)) throw new Error('请选择年龄并填写学习愿望。 / Choose an age and a learning wish.');
  if (typeof data.request_id !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(data.request_id)) throw new Error('Invalid request identifier.');
  const params = { kind: data.kind, concept: data.concept.trim(), age: data.age };
  if (data.kind === 'book') {
    if (!['forest', 'lake', 'village', 'space'].includes(data.world)) throw new Error('Invalid world.');
    params.world = data.world;
    if (data.wish_label !== undefined) { check(data.wish_label, BILINGUAL); params.wish_label = data.wish_label; }
    if (data.preparation_id !== undefined) {
      if (typeof data.preparation_id !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(data.preparation_id) || !Number.isInteger(data.story_index) || data.story_index < 0 || data.story_index > 2) throw new Error('Invalid story preparation.');
      if (!Array.isArray(data.knowledge_points) || data.knowledge_points.length < 1 || data.knowledge_points.length > 3 || data.knowledge_points.some(p => typeof p !== 'string' || !p.trim() || p.length > 320)) throw new Error('请输入 1–3 个知识点，一行一个。 / Enter 1–3 knowledge points, one per line.');
      if (params.concept !== data.knowledge_points[data.story_index % data.knowledge_points.length].trim()) throw new Error('Story concept does not match the parent settings.');
      params.preparation_id = data.preparation_id;
      params.story_index = data.story_index;
      params.knowledge_points = data.knowledge_points.map(p => p.trim());
    }
    if (data.wish_id !== undefined) {
      if (typeof data.wish_id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(data.wish_id)) throw new Error('Invalid learning wish.');
      params.wish_id = data.wish_id;
    }
  }
  return params;
}

export function completionRequest(params, model) {
  if (params.kind !== 'book') throw Error('Live continuation is disabled.');
  return {
    model, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: INSTRUCTION + '\n任务数据：' + JSON.stringify(params) }],
    temperature: 0.7, max_tokens: 10500,
    reasoning: { effort: 'low' }, provider: { require_parameters: true },
    response_format: { type: 'json_schema', json_schema: { name: 'storybook_tree', strict: true, schema: BOOK_SCHEMA } }
  };
}

export function storyResult(receipt, params) {
  if (params.kind !== 'book') throw Error('Live continuation is disabled.');
  const content = receipt.choices?.[0]?.message?.content;
  if (receipt.error || typeof content !== 'string' || !content.trim()) throw new Error('No usable model content.');
  const result = JSON.parse(content);
  check(result, BOOK_SCHEMA);
  if (new Set(result.pages.map(p => p.scene.hero)).size !== 1) throw new Error('Inconsistent hero.');
  return compileTree(result);
}
