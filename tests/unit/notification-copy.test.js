// tests/unit/notification-copy.test.js
import { describe, expect, it } from 'vitest';

import { dayWord, formatNotification, timeText } from '../../supabase/functions/send-notifications/copy.js';

const BEFORE = {
  url: '/app#/calendar/2030-01-15', role: 'student', class_kind: 'group', group_name: 'Grupo Lua', person_name: 'Mestre Lua',
  starts_at: '2030-01-15T19:00:00+00:00', lead_minutes: 60, zone: 'Europe/Lisbon',
};
const AFTER = { url: '/app#/training/o1', class_kind: 'group', local_date: '2030-01-15', zone: 'Europe/Lisbon' };
const FINISH = {
  url: '/app#/class/s1', reason: 'finish', class_kind: 'group', group_name: 'Grupo Lua', local_date: '2030-01-15', zone: 'Europe/Lisbon',
};
const EVENING = new Date('2030-01-15T21:30:30Z');
const NEXT_MORNING = new Date('2030-01-16T08:00:30Z');

describe('notification copy', () => {
  it('writes Finish setting up in both languages', () => {
    expect(formatNotification('setup', { url: '/app#/', round: 1 })).toEqual({
      url: '/app#/', title: 'Finish setting up roda', body: 'Add your city and your group so classes find you.',
    });
    expect(formatNotification('setup', { url: '/app#/' }, { locale: 'pt' })).toMatchObject({
      title: 'Termina a configuração da roda', body: 'Adiciona a tua cidade e o teu grupo para as aulas te encontrarem.',
    });
  });

  it('names the class and its time in the person\'s zone', () => {
    expect(formatNotification('before_class', BEFORE)).toEqual({
      url: '/app#/calendar/2030-01-15', title: 'Class in 1 hour', body: 'Group class · Grupo Lua at 7:00 PM',
    });
    expect(formatNotification('before_class', BEFORE, { locale: 'pt' })).toMatchObject({
      title: 'Aula daqui a 1 hora', body: 'Aula de grupo · Grupo Lua às 19:00',
    });
    expect(formatNotification('before_class', { ...BEFORE, zone: 'America/New_York' }).body).toBe('Group class · Grupo Lua at 2:00 PM');
    expect(formatNotification('before_class', { ...BEFORE, lead_minutes: 15 }).title).toBe('Class in 15 minutes');
    expect(formatNotification('before_class', { ...BEFORE, lead_minutes: 120 }, { locale: 'pt' }).title).toBe('Aula daqui a 2 horas');
    expect(formatNotification('before_class', { ...BEFORE, class_kind: 'personal_class', group_name: null, person_name: 'Bia Santos' }).body)
      .toBe('Personal class · Bia Santos at 7:00 PM');
  });

  it('asks about today\'s class, or yesterday\'s when quiet hours held it overnight', () => {
    expect(formatNotification('after_class', AFTER, { now: EVENING })).toEqual({
      url: '/app#/training/o1', title: "How did today's class go?", body: "Rate it and add the video while it's fresh.",
    });
    expect(formatNotification('after_class', AFTER, { now: NEXT_MORNING }).title).toBe("How did yesterday's class go?");
    expect(formatNotification('after_class', AFTER, { now: new Date('2030-01-20T10:00:00Z') }).title).toBe('How did your class go?');
    expect(formatNotification('after_class', AFTER, { locale: 'pt', now: NEXT_MORNING })).toMatchObject({
      title: 'Como correu a aula de ontem?', body: 'Avalia-a e adiciona o vídeo enquanto está fresca.',
    });
  });

  it('writes the three coach requests', () => {
    const join = { url: '/app#/group/g1', reason: 'join', person_name: 'Bia Santos', group_name: 'Grupo Lua' };
    expect(formatNotification('coach', join)).toEqual({
      url: '/app#/group/g1', title: 'New join request', body: 'Bia Santos wants to join Grupo Lua.',
    });
    expect(formatNotification('coach', join, { locale: 'pt' })).toMatchObject({
      title: 'Novo pedido de entrada', body: 'Bia Santos quer entrar em Grupo Lua.',
    });
    expect(formatNotification('coach', { url: '/app#/me/teaching', reason: 'coaching', person_name: 'Bia Santos' })).toMatchObject({
      title: 'New coaching request', body: 'Bia Santos asked you to coach them.',
    });
    expect(formatNotification('coach', FINISH, { now: EVENING })).toMatchObject({
      title: "Finish today's class", body: 'Mark who came to Group class · Grupo Lua.',
    });
    expect(formatNotification('coach', FINISH, { locale: 'pt', now: EVENING })).toMatchObject({
      title: 'Termina a aula de hoje', body: 'Marca quem veio: Aula de grupo · Grupo Lua.',
    });
  });

  it('falls back to English, UTC, and plain words when something is missing', () => {
    expect(formatNotification('setup', {}, { locale: 'fr' }).title).toBe('Finish setting up roda');
    expect(formatNotification('setup', {}).url).toBe('/app');
    expect(timeText('2030-01-15T19:00:00Z', 'Not/AZone', 'en')).toBe('7:00 PM');
    expect(formatNotification('coach', { reason: 'join' }).body).toBe('Someone wants to join your group.');
    expect(() => formatNotification('weather', {})).toThrow('unknown notification: weather');
  });

  it('tells today from yesterday in the person\'s zone', () => {
    // 01:00 on the 16th in UTC is still the evening of the 15th in New York.
    expect(dayWord('2030-01-15', 'America/New_York', new Date('2030-01-16T01:00:00Z'))).toBe('today');
    expect(dayWord('2030-01-15', 'Europe/Lisbon', new Date('2030-01-16T01:00:00Z'))).toBe('yesterday');
  });
});
