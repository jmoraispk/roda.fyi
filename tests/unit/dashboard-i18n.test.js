import { describe, expect, it } from 'vitest';

import { createDashboardI18n, DASHBOARD_STRINGS } from '../../src/app/dashboard-i18n.js';
import { AppError, SAFE_CODES } from '../../src/app/errors.js';

function harness({ savedLocale = null, languages = ['en-US'] } = {}) {
  const values = new Map(savedLocale ? [['roda.dashboard.locale', savedLocale]] : []);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const document = { documentElement: { lang: 'en' } };
  const i18n = createDashboardI18n({ document, storage, navigator: { languages } });
  return { i18n, storage, document, values };
}

describe('dashboard i18n', () => {
  it('uses English by default and Portuguese when the browser requests it', () => {
    expect(harness().i18n.t('training.alone')).toBe('Alone');
    const { i18n, document } = harness({ languages: ['pt-BR', 'en'] });
    expect(i18n.locale()).toBe('pt');
    expect(i18n.t('training.alone')).toBe('Sozinho');
    expect(document.documentElement.lang).toBe('pt');
  });

  it('persists an explicit locale and interpolates safe text values', () => {
    const { i18n, values } = harness();
    i18n.setLocale('pt');
    expect(i18n.t('connections.requested', { name: 'Mestre Lua' }))
      .toBe('Pedido enviado para Mestre Lua.');
    expect(values.get('roda.dashboard.locale')).toBe('pt');
  });

  it('falls back to English for an unsupported saved locale', () => {
    expect(harness({ savedLocale: 'fr', languages: ['fr-FR'] }).i18n.locale()).toBe('en');
  });

  it('formats dates and durations in the active locale', () => {
    const { i18n } = harness();
    expect(i18n.formatDuration(211)).toBe('3h 31m');
    expect(i18n.formatDate('2026-09-22T12:00:00Z', { timeZone: 'UTC' }))
      .toMatch(/Sep/);
    i18n.setLocale('pt');
    expect(i18n.formatDate('2026-09-22T12:00:00Z', { timeZone: 'UTC' }))
      .toBe('22/09/2026');
  });

  it('rejects unknown locale keys so untranslated UI cannot silently ship', () => {
    expect(() => harness().i18n.t('missing.key')).toThrow(/missing.key/);
  });

  it('keeps English and Portuguese translation catalogs structurally complete', () => {
    expect(Object.keys(DASHBOARD_STRINGS.pt).sort())
      .toEqual(Object.keys(DASHBOARD_STRINGS.en).sort());
  });

  it('uses American spelling in English copy', async () => {
    const { AppError } = await import('../../src/app/errors.js');
    const english = [...Object.values(DASHBOARD_STRINGS.en), new AppError('conflict', 'cancelled_training').message].join('\n');
    expect(english).not.toMatch(/cancell/i);
  });

  it('translates every safe error message, keeping the English text', () => {
    for (const code of SAFE_CODES) {
      expect(DASHBOARD_STRINGS.en[`errors.${code}`]).toBe(new AppError('validation', code).message);
      expect(DASHBOARD_STRINGS.pt[`errors.${code}`]).toEqual(expect.any(String));
    }
    expect(DASHBOARD_STRINGS.pt['errors.generic']).toBe('Algo correu mal.');
  });
});
