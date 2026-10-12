// src/app/screens/catalog.js
import { el, pageHeader } from '../shell/page.js';
import { createCatalogView } from '../ui/catalog-view.js';

export async function renderCatalog(ctx) {
  const { document, i18n, services } = ctx;
  const panel = el(document, 'div', { className: 'catalog-panel' });
  const view = createCatalogView({ document, i18n, catalog: services.catalog, panel, onMappingsChanged: () => ctx.refreshTermMappings() });
  await view.load();
  return el(document, 'section', { className: 'screen screen-catalog' }, [
    pageHeader({ document, title: i18n.t('app.catalog'), backLabel: i18n.t('app.back'), onBack: () => ctx.back('/me') }),
    panel,
  ]);
}
