// supabase/functions/send-notifications/copy.js
// The words of each notification, in the device's language (Ruling 11). The
// database sends structured fields; this file turns them into text. It is plain
// JavaScript with no imports, so the Edge Function (Deno) and Vitest share it.

const LEADS = Object.freeze({
  en: Object.freeze({ 15: '15 minutes', 30: '30 minutes', 60: '1 hour', 120: '2 hours' }),
  pt: Object.freeze({ 15: '15 minutos', 30: '30 minutos', 60: '1 hora', 120: '2 horas' }),
});

const TEXT = Object.freeze({
  en: Object.freeze({
    setupTitle: 'Finish setting up roda',
    setupBody: 'Add your city and your group so classes find you.',
    beforeTitle: (lead) => `Class in ${lead}`,
    beforeBody: (label, time) => `${label} at ${time}`,
    afterTitle: { today: "How did today's class go?", yesterday: "How did yesterday's class go?", other: 'How did your class go?' },
    afterBody: "Rate it and add the video while it's fresh.",
    joinTitle: 'New join request',
    joinBody: (person, group) => `${person} wants to join ${group}.`,
    coachingTitle: 'New coaching request',
    coachingBody: (person) => `${person} asked you to coach them.`,
    finishTitle: { today: "Finish today's class", yesterday: "Finish yesterday's class", other: 'Finish your class' },
    finishBody: (label) => `Mark who came to ${label}.`,
    groupClass: 'Group class',
    personalClass: 'Personal class',
    someone: 'Someone',
    yourGroup: 'your group',
    minutes: (count) => `${count} minutes`,
  }),
  pt: Object.freeze({
    setupTitle: 'Termina a configuração da roda',
    setupBody: 'Adiciona a tua cidade e o teu grupo para as aulas te encontrarem.',
    beforeTitle: (lead) => `Aula daqui a ${lead}`,
    beforeBody: (label, time) => `${label} às ${time}`,
    afterTitle: { today: 'Como correu a aula de hoje?', yesterday: 'Como correu a aula de ontem?', other: 'Como correu a aula?' },
    afterBody: 'Avalia-a e adiciona o vídeo enquanto está fresca.',
    joinTitle: 'Novo pedido de entrada',
    joinBody: (person, group) => `${person} quer entrar em ${group}.`,
    coachingTitle: 'Novo pedido de treino',
    coachingBody: (person) => `${person} pediu-te para ser treinador.`,
    finishTitle: { today: 'Termina a aula de hoje', yesterday: 'Termina a aula de ontem', other: 'Termina a tua aula' },
    finishBody: (label) => `Marca quem veio: ${label}.`,
    groupClass: 'Aula de grupo',
    personalClass: 'Aula pessoal',
    someone: 'Alguém',
    yourGroup: 'o teu grupo',
    minutes: (count) => `${count} minutos`,
  }),
});

function language(locale) {
  return locale === 'pt' ? 'pt' : 'en';
}

function zoneOf(zone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone || 'UTC' });
    return zone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function timeText(iso, zone, locale) {
  const pt = language(locale) === 'pt';
  const options = pt
    ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: zoneOf(zone) }
    : { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: zoneOf(zone) };
  // Newer ICU puts a narrow no-break space before AM/PM; keep plain text.
  return new Intl.DateTimeFormat(pt ? 'pt-PT' : 'en-US', options).format(new Date(iso)).replace(/\u202f/g, ' ');
}

export function dayWord(localDate, zone, now) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: zoneOf(zone), year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  if (localDate === today) return 'today';
  const yesterday = new Date(`${today}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return localDate === yesterday.toISOString().slice(0, 10) ? 'yesterday' : 'other';
}

function classLabel(text, payload) {
  if (payload.class_kind === 'personal_class') {
    return payload.person_name ? `${text.personalClass} · ${payload.person_name}` : text.personalClass;
  }
  return payload.group_name ? `${text.groupClass} · ${payload.group_name}` : text.groupClass;
}

export function formatNotification(kind, payload = {}, { locale = 'en', now = new Date() } = {}) {
  const lang = language(locale);
  const text = TEXT[lang];
  const base = { url: payload.url || '/app' };
  if (kind === 'setup') return { ...base, title: text.setupTitle, body: text.setupBody };
  if (kind === 'before_class') {
    const lead = LEADS[lang][payload.lead_minutes] ?? text.minutes(payload.lead_minutes ?? 60);
    return {
      ...base,
      title: text.beforeTitle(lead),
      body: text.beforeBody(classLabel(text, payload), timeText(payload.starts_at, payload.zone, lang)),
    };
  }
  if (kind === 'after_class') {
    return { ...base, title: text.afterTitle[dayWord(payload.local_date, payload.zone, now)], body: text.afterBody };
  }
  if (kind === 'coach') {
    const person = payload.person_name || text.someone;
    if (payload.reason === 'join') {
      return { ...base, title: text.joinTitle, body: text.joinBody(person, payload.group_name || text.yourGroup) };
    }
    if (payload.reason === 'coaching') return { ...base, title: text.coachingTitle, body: text.coachingBody(person) };
    if (payload.reason === 'finish') {
      return {
        ...base,
        title: text.finishTitle[dayWord(payload.local_date, payload.zone, now)],
        body: text.finishBody(classLabel(text, payload)),
      };
    }
  }
  throw new Error(`unknown notification: ${kind}`);
}
