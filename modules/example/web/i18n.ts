import { moduleT } from '@/core/i18n.ts';

export const messages = {
  'example.menu': 'Minta modul',
  'example.title': 'Minta modul',
  'example.intro': 'A modulkeret mintája: a gomb egy „Minta esemény”-t ír a kiválasztott projekt eseménynaplójába.',
  'example.project': 'Projekt',
  'example.chooseProject': 'Válassz projektet…',
  'example.send': 'Minta esemény küldése',
  'example.sent': 'Elküldve.',
  'example.noProjects': 'Még nincs projekt.',
  'example.event.pinged': 'Minta esemény',
} as const;

export const t = moduleT(messages);
