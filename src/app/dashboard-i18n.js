const STORAGE_KEY = 'roda.dashboard.locale';
const LOCALES = Object.freeze({ en: 'en-US', pt: 'pt-PT' });

const STRINGS = Object.freeze({
  en: Object.freeze({
    'training.alone': 'Alone',
    'connections.title': 'Coaches and students',
    'connections.findCoach': 'Find a coach',
    'connections.findStudent': 'Find a student',
    'connections.searchTitle': 'Find a coaching connection',
    'connections.searchCoaches': 'Search coaches',
    'connections.searchStudents': 'Search students',
    'connections.direct': 'Direct connection',
    'connections.group': 'Through {group}',
    'connections.pending': 'Pending',
    'connections.active': 'Active',
    'connections.declined': 'Declined',
    'connections.request': 'Request {name}',
    'connections.accept': 'Accept {name}',
    'connections.decline': 'Decline {name}',
    'connections.end': 'End connection with {name}',
    'connections.requested': 'Request sent to {name}.',
    'connections.ended': 'This coaching connection has ended.',
    'connections.empty': 'No coaching connections yet.',
    'connections.noResults': 'No matching people found.',
    'connections.accessRevoked': 'You no longer have access to those coaching details.',
    'connections.close': 'Close coaching search',
  }),
  pt: Object.freeze({
    'training.alone': 'Sozinho',
    'connections.title': 'Treinadores e alunos',
    'connections.findCoach': 'Encontrar treinador',
    'connections.findStudent': 'Encontrar aluno',
    'connections.searchTitle': 'Encontrar ligação de treino',
    'connections.searchCoaches': 'Pesquisar treinadores',
    'connections.searchStudents': 'Pesquisar alunos',
    'connections.direct': 'Ligação direta',
    'connections.group': 'Através de {group}',
    'connections.pending': 'Pendente',
    'connections.active': 'Ativa',
    'connections.declined': 'Recusada',
    'connections.request': 'Pedir ligação a {name}',
    'connections.accept': 'Aceitar {name}',
    'connections.decline': 'Recusar {name}',
    'connections.end': 'Terminar ligação com {name}',
    'connections.requested': 'Pedido enviado para {name}.',
    'connections.ended': 'Esta ligação de treino terminou.',
    'connections.empty': 'Ainda não existem ligações de treino.',
    'connections.noResults': 'Não foram encontradas pessoas.',
    'connections.accessRevoked': 'Já não tem acesso a estes detalhes de treino.',
    'connections.close': 'Fechar pesquisa de ligações',
  }),
});

function normalizeLocale(value) {
  const language = String(value ?? '').toLocaleLowerCase().split('-')[0];
  return Object.hasOwn(STRINGS, language) ? language : null;
}

function interpolate(template, variables) {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, name) => String(variables[name] ?? ''));
}

export function createDashboardI18n({ document, storage, navigator }) {
  const saved = normalizeLocale(storage?.getItem(STORAGE_KEY));
  const detected = (navigator?.languages ?? [navigator?.language])
    .map(normalizeLocale)
    .find(Boolean);
  let current = saved ?? detected ?? 'en';

  function applyLanguage() {
    if (document?.documentElement) document.documentElement.lang = current;
  }

  applyLanguage();

  return {
    locale: () => current,
    setLocale(locale) {
      const normalized = normalizeLocale(locale);
      if (!normalized) throw new RangeError(`Unsupported dashboard locale: ${locale}`);
      current = normalized;
      storage?.setItem(STORAGE_KEY, current);
      applyLanguage();
      return current;
    },
    t(key, variables = {}) {
      const template = STRINGS[current][key];
      if (template === undefined) throw new RangeError(`Missing dashboard translation: ${key}`);
      return interpolate(template, variables);
    },
    formatDate(value, options = {}) {
      return new Intl.DateTimeFormat(LOCALES[current], {
        dateStyle: 'medium',
        ...options,
      }).format(new Date(value));
    },
    formatDuration(totalMinutes) {
      const minutes = Math.max(0, Math.round(Number(totalMinutes) || 0));
      const hours = Math.floor(minutes / 60);
      const remainder = minutes % 60;
      if (!hours) return `${remainder}m`;
      if (!remainder) return `${hours}h`;
      return `${hours}h ${remainder}m`;
    },
  };
}

export { STRINGS as DASHBOARD_STRINGS };
