const STORAGE_KEY = 'roda.dashboard.locale';
const LOCALES = Object.freeze({ en: 'en-US', pt: 'pt-PT' });

const STRINGS = Object.freeze({
  en: Object.freeze({
    'training.alone': 'Alone',
    'training.group': 'Group',
    'training.personalClass': 'Personal class',
    'calendar.title': 'Training calendar',
    'calendar.previousMonth': 'Previous month',
    'calendar.nextMonth': 'Next month',
    'calendar.recordAlone': 'Record Alone training',
    'calendar.emptyDay': 'No training on this day.',
    'calendar.loading': 'Loading training…',
    'calendar.loadError': 'We could not load your training. Please try again.',
    'calendar.upcoming': 'Upcoming',
    'calendar.completed': 'Completed',
    'alone.title': 'Record Alone training',
    'alone.date': 'Training date',
    'alone.duration': 'Duration in minutes',
    'alone.notes': 'Personal notes',
    'alone.addRound': 'Add round',
    'alone.addMovement': 'Add movement',
    'alone.round': 'Round {number}',
    'alone.roundLabel': 'Round label',
    'alone.movement': 'Movement',
    'alone.repetitions': 'Repetitions',
    'alone.save': 'Save training',
    'alone.saving': 'Saving training…',
    'alone.saveError': 'We could not save this training. Your entries are still here.',
    'alone.close': 'Close Alone training',
    'training.personalNotes': 'Personal notes',
    'training.saveNotes': 'Save notes',
    'training.difficulty': 'How did this movement feel?',
    'training.easy': 'Easy',
    'training.okay': 'Okay',
    'training.hard': 'Hard',
    'training.movementNote': 'Movement note',
    'training.saveAssessment': 'Save assessment',
    'training.coachFeedback': 'Coach feedback',
    'training.groupContext': 'Group coaching',
    'training.directContext': 'Direct coaching',
    'training.feedbackContext': 'Feedback context',
    'training.feedbackBody': 'Coach feedback',
    'training.addFeedback': 'Add feedback',
    'training.saveError': 'We could not save this update. Your entries are still here.',
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
    'statistics.title': 'Training statistics',
    'statistics.personal': 'Your progress',
    'statistics.group': 'Group ranking',
    'statistics.week': 'This week',
    'statistics.month': 'This month',
    'statistics.year': 'This year',
    'statistics.all': 'All time',
    'statistics.period': 'Statistics period',
    'statistics.metric': 'Ranking metric',
    'statistics.time': 'Training time',
    'statistics.sessions': 'Number of trainings',
    'statistics.totalTime': 'Training time',
    'statistics.totalSessions': 'Trainings',
    'statistics.streak': 'Current streak',
    'statistics.days': '{count} days',
    'statistics.weeklyAverage': 'Average per week',
    'statistics.monthlyHours': 'Average hours per month',
    'statistics.favorite': 'Most practiced',
    'statistics.improving': 'Improving',
    'statistics.contexts': 'How you trained',
    'statistics.loading': 'Loading statistics…',
    'statistics.loadError': 'We could not load these statistics. Please try again.',
    'statistics.retry': 'Try again',
    'statistics.empty': 'No training in this period yet.',
    'statistics.noGroup': 'Choose a group to see its ranking.',
    'statistics.podium': 'Top three',
    'statistics.completeRanking': 'Complete ranking',
    'statistics.yourPosition': 'Your position',
    'statistics.anonymous': '{count} members chose not to appear by name. Their activity still contributes to group totals.',
    'statistics.memberSearch': 'Find a group member',
    'statistics.search': 'Search',
    'statistics.searchEmpty': 'No matching members found.',
    'statistics.searchError': 'We could not search members. Please try again.',
  }),
  pt: Object.freeze({
    'training.alone': 'Sozinho',
    'training.group': 'Grupo',
    'training.personalClass': 'Aula pessoal',
    'calendar.title': 'Calendário de treinos',
    'calendar.previousMonth': 'Mês anterior',
    'calendar.nextMonth': 'Mês seguinte',
    'calendar.recordAlone': 'Registar treino sozinho',
    'calendar.emptyDay': 'Nenhum treino neste dia.',
    'calendar.loading': 'A carregar treinos…',
    'calendar.loadError': 'Não foi possível carregar os treinos. Tente novamente.',
    'calendar.upcoming': 'Próximo',
    'calendar.completed': 'Concluído',
    'alone.title': 'Registar treino sozinho',
    'alone.date': 'Data do treino',
    'alone.duration': 'Duração em minutos',
    'alone.notes': 'Notas pessoais',
    'alone.addRound': 'Adicionar ronda',
    'alone.addMovement': 'Adicionar movimento',
    'alone.round': 'Ronda {number}',
    'alone.roundLabel': 'Nome da ronda',
    'alone.movement': 'Movimento',
    'alone.repetitions': 'Repetições',
    'alone.save': 'Guardar treino',
    'alone.saving': 'A guardar treino…',
    'alone.saveError': 'Não foi possível guardar este treino. Os dados continuam aqui.',
    'alone.close': 'Fechar treino sozinho',
    'training.personalNotes': 'Notas pessoais',
    'training.saveNotes': 'Guardar notas',
    'training.difficulty': 'Como sentiu este movimento?',
    'training.easy': 'Fácil',
    'training.okay': 'Razoável',
    'training.hard': 'Difícil',
    'training.movementNote': 'Nota do movimento',
    'training.saveAssessment': 'Guardar avaliação',
    'training.coachFeedback': 'Feedback do treinador',
    'training.groupContext': 'Treino em grupo',
    'training.directContext': 'Treino direto',
    'training.feedbackContext': 'Contexto do feedback',
    'training.feedbackBody': 'Feedback do treinador',
    'training.addFeedback': 'Adicionar feedback',
    'training.saveError': 'Não foi possível guardar esta atualização. Os dados continuam aqui.',
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
    'statistics.title': 'Estatísticas de treino',
    'statistics.personal': 'O seu progresso',
    'statistics.group': 'Classificação do grupo',
    'statistics.week': 'Esta semana',
    'statistics.month': 'Este mês',
    'statistics.year': 'Este ano',
    'statistics.all': 'Todo o tempo',
    'statistics.period': 'Período das estatísticas',
    'statistics.metric': 'Métrica da classificação',
    'statistics.time': 'Tempo de treino',
    'statistics.sessions': 'Número de treinos',
    'statistics.totalTime': 'Tempo de treino',
    'statistics.totalSessions': 'Treinos',
    'statistics.streak': 'Sequência atual',
    'statistics.days': '{count} dias',
    'statistics.weeklyAverage': 'Média por semana',
    'statistics.monthlyHours': 'Média de horas por mês',
    'statistics.favorite': 'Mais praticado',
    'statistics.improving': 'A melhorar',
    'statistics.contexts': 'Como treinou',
    'statistics.loading': 'A carregar estatísticas…',
    'statistics.loadError': 'Não foi possível carregar estas estatísticas. Tente novamente.',
    'statistics.retry': 'Tentar novamente',
    'statistics.empty': 'Ainda não há treinos neste período.',
    'statistics.noGroup': 'Escolha um grupo para ver a classificação.',
    'statistics.podium': 'Três primeiros',
    'statistics.completeRanking': 'Classificação completa',
    'statistics.yourPosition': 'A sua posição',
    'statistics.anonymous': '{count} membros escolheram não aparecer pelo nome. A atividade continua a contribuir para os totais do grupo.',
    'statistics.memberSearch': 'Encontrar membro do grupo',
    'statistics.search': 'Pesquisar',
    'statistics.searchEmpty': 'Não foram encontrados membros.',
    'statistics.searchError': 'Não foi possível pesquisar membros. Tente novamente.',
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
      const hasExplicitStyle = Object.keys(options).some((key) => key !== 'timeZone');
      const formatOptions = hasExplicitStyle ? options : { dateStyle: 'medium', ...options };
      return new Intl.DateTimeFormat(LOCALES[current], formatOptions).format(new Date(value));
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
