// src/app/screens/progress.js
import { el, pageHeader } from '../shell/page.js';
import { createStatisticsView } from '../ui/statistics-view.js';

export async function renderProgress(ctx) {
  const { document, i18n, services } = ctx;
  const screen = el(document, 'section', { className: 'screen screen-progress' }, [
    pageHeader({ document, title: i18n.t('app.progress'), backLabel: i18n.t('app.back'), onBack: () => ctx.back('/me') }),
  ]);
  let memberships = [];
  try {
    memberships = await services.group.listMyMemberships();
  } catch {
    memberships = [];
  }
  const groups = memberships.filter((membership) => membership.state === 'active' && membership.group && !membership.group.archived_at);
  const root = el(document, 'div', { className: 'progress-panel' });
  const view = createStatisticsView({
    document, service: services.statistics, i18n, profile: ctx.profile, timezone: ctx.timezone, today: ctx.now(), root,
  });
  if (groups.length > 1) {
    const picker = el(document, 'select', { className: 'field-input', attrs: { name: 'rankingGroup' } },
      groups.map((membership) => el(document, 'option', { text: membership.group.name, attrs: { value: membership.group_id } })));
    picker.addEventListener('change', () => view.setGroup(picker.value));
    screen.append(el(document, 'label', { className: 'field-label' }, [i18n.t('progress.rankingGroup'), picker]));
  }
  screen.append(root);
  view.loadPersonal();
  view.setGroup(groups[0]?.group_id ?? null);
  return screen;
}
