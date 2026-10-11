import schema from './book-schema.json' with { type: 'json' };
import prompts from './story-prompts.json' with { type: 'json' };
export const BOOK_SCHEMA = schema;
export const BILINGUAL = schema.properties.title;
export const SYSTEM = prompts.system;
export const INSTRUCTION = prompts.instruction;
