import { formatRankValue, statisticsRange } from '../statistics-state.js';

const PERIODS = ['week', 'month', 'year', 'all'];
const METRICS = ['time', 'sessions'];

function element(document, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createStatisticsView({
  document,
  service,
  i18n,
  profile,
  timezone = 'UTC',
  today = new Date(),
  onAccessRevoked = () => {},
  root: rootElement = null,
}) {
  const root = rootElement ?? document.querySelector('#trainingStatisticsPanel');
  let period = 'month';
  let metric = 'time';
  let groupId = null;
  let personalData = null;
  let groupData = [];
  let personalBusy = false;
  let groupBusy = false;
  let personalError = false;
  let groupError = false;
  let memberResults = [];
  let memberSearchState = '';
  let personalRequest = 0;
  let groupRequest = 0;
  let memberRequest = 0;

  function selector(label, values, selected, dataName) {
    const section = element(document, 'div', 'statistics-selector');
    section.setAttribute('role', 'group');
    section.setAttribute('aria-label', label);
    values.forEach((value) => {
      const button = element(document, 'button', 'statistics-choice', i18n.t(`statistics.${value}`));
      button.type = 'button';
      button.dataset[dataName] = value;
      button.setAttribute('aria-pressed', String(value === selected));
      section.append(button);
    });
    return section;
  }

  function statCard(label, value, extraClass = '') {
    const card = element(document, 'article', `statistics-card ${extraClass}`.trim());
    card.append(element(document, 'span', 'statistics-card-label', label));
    card.append(element(document, 'strong', 'statistics-card-value', value));
    return card;
  }

  function renderPersonal(container) {
    container.replaceChildren();
    if (personalBusy) {
      container.append(element(document, 'p', 'statistics-status', i18n.t('statistics.loading')));
      return;
    }
    if (personalError) {
      const status = element(document, 'p', 'statistics-status', i18n.t('statistics.loadError'));
      status.dataset.personalStatus = '';
      const retry = element(document, 'button', 'secondary-button', i18n.t('statistics.retry'));
      retry.type = 'button';
      retry.dataset.retryPersonal = '';
      container.append(status, retry);
      return;
    }
    if (!personalData) return;
    if (!Number(personalData.session_count)) {
      container.append(element(document, 'p', 'statistics-empty', i18n.t('statistics.empty')));
      return;
    }

    const cards = element(document, 'div', 'statistics-cards');
    cards.append(
      statCard(i18n.t('statistics.totalTime'), i18n.formatDuration(personalData.total_minutes)),
      statCard(i18n.t('statistics.totalSessions'), formatRankValue({
        metric: 'sessions', sessionCount: personalData.session_count,
      }, i18n.locale())),
      statCard(i18n.t('statistics.streak'), i18n.t(
        (personalData.current_streak ?? 0) === 1 ? 'statistics.dayOne' : 'statistics.days',
        { count: personalData.current_streak ?? 0 },
      )),
      statCard(i18n.t('statistics.weeklyAverage'), String(personalData.average_trainings_per_week ?? 0)),
      statCard(i18n.t('statistics.monthlyHours'), `${personalData.average_hours_per_month ?? 0}h`),
    );
    container.append(cards);

    const details = element(document, 'div', 'statistics-details');
    const favorites = element(document, 'section', 'statistics-detail');
    favorites.append(element(document, 'h3', '', i18n.t('statistics.favorite')));
    const favoriteList = element(document, 'ul', 'statistics-simple-list');
    (personalData.favorite_movements ?? []).forEach((movement) => {
      favoriteList.append(element(document, 'li', '', `${movement.movement_name} · ${movement.session_count}`));
    });
    if (!favoriteList.children.length) favoriteList.append(element(document, 'li', '', '—'));
    favorites.append(favoriteList);

    const contexts = element(document, 'section', 'statistics-detail');
    contexts.append(element(document, 'h3', '', i18n.t('statistics.contexts')));
    const contextList = element(document, 'ul', 'statistics-simple-list');
    (personalData.context_distribution ?? []).forEach((context) => {
      contextList.append(element(document, 'li', '', `${i18n.t(`training.${context.kind === 'personal_class' ? 'personalClass' : context.kind}`)} · ${context.session_count}`));
    });
    if (!contextList.children.length) contextList.append(element(document, 'li', '', '—'));
    contexts.append(contextList);

    const trends = element(document, 'section', 'statistics-detail');
    trends.append(element(document, 'h3', '', i18n.t('statistics.improving')));
    const trendList = element(document, 'ul', 'statistics-simple-list');
    (personalData.difficulty_trends ?? []).filter(({ improving }) => improving).forEach((movement) => {
      trendList.append(element(document, 'li', '', movement.movement_name));
    });
    if (!trendList.children.length) trendList.append(element(document, 'li', '', '—'));
    trends.append(trendList);
    const transitions = element(document, 'section', 'statistics-detail');
    transitions.dataset.hardestTransitions = '';
    transitions.append(element(document, 'h3', '', i18n.t('statistics.hardestTransitions')));
    const transitionRows = personalData.hardest_transitions ?? [];
    if (!transitionRows.length) {
      transitions.append(element(document, 'p', 'calendar-empty', i18n.t('statistics.noTransitions')));
    } else {
      const transitionList = element(document, 'ol', 'statistics-simple-list');
      transitionRows.forEach((row) => {
        transitionList.append(element(document, 'li', '', i18n.t('statistics.transitionLine', {
          from: row.from_name, to: row.to_name, hard: row.hard_count, total: row.rating_count,
        })));
      });
      transitions.append(transitionList);
    }
    details.append(favorites, contexts, trends, transitions);
    container.append(details);
  }

  function rankingEntry(row, className, attribute) {
    const entry = element(document, 'li', className);
    entry.dataset[attribute] = '';
    const rank = element(document, 'span', 'ranking-position', String(row.rank_position ?? '—'));
    const identity = element(document, 'span', 'ranking-name', row.display_name ?? '');
    const value = element(document, 'strong', 'ranking-value', formatRankValue({
      metric, totalMinutes: row.total_minutes, sessionCount: row.session_count,
    }, i18n.locale()));
    entry.append(rank, identity, value);
    return entry;
  }

  function renderGroup(container) {
    container.replaceChildren();
    if (!groupId) {
      container.append(element(document, 'p', 'statistics-empty', i18n.t('statistics.noGroup')));
      return;
    }
    if (groupBusy) {
      container.append(element(document, 'p', 'statistics-status', i18n.t('statistics.loading')));
      return;
    }
    if (groupError) {
      container.append(element(document, 'p', 'statistics-status', i18n.t('statistics.loadError')));
      const retry = element(document, 'button', 'secondary-button', i18n.t('statistics.retry'));
      retry.type = 'button';
      retry.dataset.retryGroup = '';
      container.append(retry);
      return;
    }
    const named = groupData.filter(({ profile_id: id }) => id);
    if (!named.length) {
      container.append(element(document, 'p', 'statistics-empty', i18n.t('statistics.empty')));
    } else {
      const podium = element(document, 'section', 'statistics-podium');
      podium.append(element(document, 'h3', '', i18n.t('statistics.podium')));
      const podiumList = element(document, 'ol', 'podium-list');
      named.slice(0, 3).forEach((row) => podiumList.append(rankingEntry(row, 'podium-entry', 'podiumEntry')));
      podium.append(podiumList);

      const full = element(document, 'section', 'statistics-ranking');
      full.append(element(document, 'h3', '', i18n.t('statistics.completeRanking')));
      const list = element(document, 'ol', 'ranking-list');
      named.forEach((row) => list.append(rankingEntry(row, 'ranking-entry', 'rankingEntry')));
      full.append(list);
      container.append(podium, full);

      const current = named.find(({ profile_id: id }) => id === profile.id);
      if (current) {
        const pinned = element(document, 'section', 'ranking-current');
        pinned.dataset.currentMember = '';
        pinned.append(element(document, 'span', 'statistics-card-label', i18n.t('statistics.yourPosition')));
        const currentList = element(document, 'ol', 'ranking-list');
        currentList.append(rankingEntry(current, 'ranking-entry', 'currentEntry'));
        pinned.append(currentList);
        container.append(pinned);
      }
    }

    const anonymousCount = Number(groupData[0]?.anonymous_member_count ?? 0);
    if (anonymousCount) {
      const note = element(document, 'p', 'statistics-privacy', i18n.t('statistics.anonymous', {
        count: anonymousCount,
      }));
      note.dataset.anonymousNote = '';
      container.append(note);
    }

    const search = element(document, 'form', 'statistics-member-search');
    search.dataset.memberSearch = '';
    const label = element(document, 'label', 'field-label', i18n.t('statistics.memberSearch'));
    const input = document.createElement('input');
    input.className = 'field-input';
    input.type = 'search';
    input.name = 'member-search';
    label.append(input);
    const button = element(document, 'button', 'secondary-button', i18n.t('statistics.search'));
    button.type = 'submit';
    search.append(label, button);
    container.append(search);

    const results = element(document, 'ul', 'statistics-member-results');
    results.dataset.memberResults = '';
    memberResults.forEach((member) => {
      const item = element(document, 'li', 'statistics-member-result');
      item.append(element(document, 'span', '', member.display_name));
      if (member.graduation) item.append(element(document, 'small', '', member.graduation));
      results.append(item);
    });
    if (memberSearchState === 'empty') results.append(element(document, 'li', '', i18n.t('statistics.searchEmpty')));
    if (memberSearchState === 'error') results.append(element(document, 'li', '', i18n.t('statistics.searchError')));
    container.append(results);
  }

  function render() {
    root.replaceChildren();
    const heading = element(document, 'div', 'statistics-heading');
    heading.append(element(document, 'div', 'dashboard-eyebrow', i18n.t('statistics.title')));
    heading.append(selector(i18n.t('statistics.period'), PERIODS, period, 'period'));
    root.append(heading);

    const personalSection = element(document, 'section', 'statistics-section');
    personalSection.dataset.personalStatistics = '';
    personalSection.append(element(document, 'h2', '', i18n.t('statistics.personal')));
    const personalContent = element(document, 'div', 'statistics-content');
    renderPersonal(personalContent);
    personalSection.append(personalContent);
    root.append(personalSection);

    const groupSection = element(document, 'section', 'statistics-section');
    groupSection.dataset.groupStatistics = '';
    const groupHeader = element(document, 'div', 'statistics-group-header');
    groupHeader.append(element(document, 'h2', '', i18n.t('statistics.group')));
    groupHeader.append(selector(i18n.t('statistics.metric'), METRICS, metric, 'metric'));
    groupSection.append(groupHeader);
    const groupContent = element(document, 'div', 'statistics-content');
    renderGroup(groupContent);
    groupSection.append(groupContent);
    root.append(groupSection);
  }

  function range() {
    return statisticsRange(period, today, timezone);
  }

  async function loadPersonal() {
    const request = ++personalRequest;
    personalBusy = true;
    personalError = false;
    render();
    try {
      const result = await service.getPersonal({ ...range(), timezone });
      if (request !== personalRequest) return;
      personalData = result;
    } catch (_error) {
      if (request !== personalRequest) return;
      personalData = null;
      personalError = true;
    } finally {
      if (request === personalRequest) {
        personalBusy = false;
        render();
      }
    }
  }

  async function loadGroup() {
    const selectedGroup = groupId;
    const request = ++groupRequest;
    groupData = [];
    memberResults = [];
    memberSearchState = '';
    if (!selectedGroup) {
      groupBusy = false;
      groupError = false;
      render();
      return;
    }
    groupBusy = true;
    groupError = false;
    render();
    try {
      const result = await service.getGroup({
        groupId: selectedGroup, ...range(), metric,
      });
      if (request !== groupRequest || selectedGroup !== groupId) return;
      groupData = result ?? [];
    } catch (error) {
      if (request !== groupRequest || selectedGroup !== groupId) return;
      if (error?.kind === 'authorization' || error?.kind === 'authentication') {
        groupId = null;
        groupData = [];
        onAccessRevoked(selectedGroup);
      } else {
        groupError = true;
      }
    } finally {
      if (request === groupRequest) {
        groupBusy = false;
        render();
      }
    }
  }

  async function searchMembers(search) {
    if (!groupId) return;
    const selectedGroup = groupId;
    const request = ++memberRequest;
    memberSearchState = 'loading';
    try {
      const result = await service.searchMembers({
        groupId: selectedGroup, search, limit: 20, offset: 0,
      });
      if (request !== memberRequest || selectedGroup !== groupId) return;
      memberResults = (result ?? []).map(({ profile_id, display_name, avatar_path, graduation }) => ({
        profile_id, display_name, avatar_path, graduation,
      }));
      memberSearchState = memberResults.length ? 'loaded' : 'empty';
    } catch (_error) {
      if (request !== memberRequest || selectedGroup !== groupId) return;
      memberResults = [];
      memberSearchState = 'error';
    }
    render();
  }

  root.addEventListener('click', (event) => {
    const periodButton = event.target.closest('[data-period]');
    if (periodButton) {
      period = periodButton.dataset.period;
      personalRequest += 1;
      groupRequest += 1;
      render();
      Promise.all([loadPersonal(), loadGroup()]);
      return;
    }
    const metricButton = event.target.closest('[data-metric]');
    if (metricButton) {
      metric = metricButton.dataset.metric;
      groupRequest += 1;
      render();
      loadGroup();
      return;
    }
    if (event.target.closest('[data-retry-personal]')) loadPersonal();
    if (event.target.closest('[data-retry-group]')) loadGroup();
  });

  root.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-member-search]');
    if (!form) return;
    event.preventDefault();
    searchMembers(new FormData(form).get('member-search'));
  });

  render();

  return {
    loadPersonal,
    loadGroup,
    async setPeriod(nextPeriod) {
      period = PERIODS.includes(nextPeriod) ? nextPeriod : 'month';
      personalRequest += 1;
      groupRequest += 1;
      return Promise.all([loadPersonal(), loadGroup()]);
    },
    async setMetric(nextMetric) {
      metric = METRICS.includes(nextMetric) ? nextMetric : 'time';
      groupRequest += 1;
      return loadGroup();
    },
    async setGroup(nextGroupId) {
      groupId = nextGroupId || null;
      groupRequest += 1;
      memberRequest += 1;
      return loadGroup();
    },
    setLocale() {
      render();
    },
    clear() {
      personalRequest += 1;
      groupRequest += 1;
      memberRequest += 1;
      personalData = null;
      groupData = [];
      memberResults = [];
      groupId = null;
      personalError = false;
      groupError = false;
      render();
    },
  };
}
