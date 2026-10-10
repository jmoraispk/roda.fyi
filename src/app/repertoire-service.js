// src/app/repertoire-service.js
import { AppError, toAppError } from './errors.js';

function invalid(code, message) {
  throw new AppError('validation', code, message);
}

export function normalizeSequenceInput({ title = '', sourceText = '' }) {
  const text = String(sourceText ?? '').trim();
  if (!text || text.length > 4000) invalid('invalid_sequence_text', 'Write the sequence first.');
  const cleanTitle = String(title ?? '').trim() || text.slice(0, 60);
  if (cleanTitle.length > 120) invalid('invalid_sequence_title', 'Use a title of 120 characters or fewer.');
  return { title: cleanTitle, text };
}

export function createRepertoireService(client) {
  async function call(name, params = {}) {
    const result = await client.rpc(name, params);
    if (result.error) throw toAppError(result.error);
    return result.data;
  }
  return {
    async list() {
      return call('list_practice_sequences');
    },
    async save({ id = null, title, sourceText, sequence = null }) {
      const normalized = normalizeSequenceInput({ title, sourceText });
      return call('save_practice_sequence', {
        sequence_id: id, title: normalized.title, source_text: normalized.text, sequence,
      });
    },
    async remove(id) {
      return call('delete_practice_sequence', { sequence_id: id });
    },
    async importItems(items) {
      return call('import_practice_sequences', { items });
    },
  };
}
