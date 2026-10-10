// src/app/catalog-service.js
import { AppError, toAppError } from './errors.js';

const TERM = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function requireTerm(value) {
  if (!TERM.test(value ?? '')) throw new AppError('validation', 'invalid_term', 'Choose a valid term.');
  return value;
}

export function createCatalogService(client) {
  async function call(name, params = {}) {
    const result = await client.rpc(name, params);
    if (result.error) throw toAppError(result.error);
    return result.data;
  }
  return {
    async listTermMappings() {
      const result = await client.from('catalog_term_mappings')
        .select('term, action, target_slug, target_term, needs_video');
      if (result.error) throw toAppError(result.error);
      return result.data;
    },
    async amICurator() {
      return Boolean(await call('am_i_catalog_curator'));
    },
    async listUncataloguedTerms() {
      return call('list_uncatalogued_terms');
    },
    async mapTerm(term, targetSlug) {
      return call('map_catalog_term', { term: requireTerm(term), target_slug: requireTerm(targetSlug) });
    },
    async mergeTerm(term, targetTerm) {
      return call('merge_catalog_term', { term: requireTerm(term), target_term: requireTerm(targetTerm) });
    },
    async ignoreTerm(term) {
      return call('ignore_catalog_term', { term: requireTerm(term) });
    },
    async setNeedsVideo(term, needsVideo) {
      return call('set_catalog_term_needs_video', { term: requireTerm(term), needs_video: Boolean(needsVideo) });
    },
  };
}
