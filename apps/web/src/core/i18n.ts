// A mag felületi szövegei. A modulok saját i18n.ts-ét a 2a. munkacsomag fűzi össze ezzel.
export const coreMessages = {
  'app.name': 'dERP',
  'auth.title': 'Belépés',
  'auth.email': 'E-mail-cím',
  'auth.devLogin': 'Belépés (fejlesztői)',
  'auth.unavailable': 'A belépés jelenleg nem érhető el.',
  'auth.logout': 'Kilépés',
  'projects.title': 'Projektek',
  'projects.new': 'Új projekt',
  'projects.name': 'Projekt neve',
  'projects.client': 'Ügyfél',
  'projects.create': 'Projekt létrehozása',
  'projects.empty': 'Még nincs projekt.',
  'projects.back': 'Vissza a projektekhez',
  'projects.edit': 'Szerkesztés',
  'projects.save': 'Mentés',
  'projects.cancel': 'Mégse',
  'projects.delete': 'Törlés',
  'projects.deleteConfirm': 'Biztosan törlöd a projektet?',
  'projects.notFound': 'A projekt nem található.',
  'projects.createdAt': 'Létrehozva',
  'events.title': 'Események',
  'events.empty': 'Még nincs esemény.',
  'common.loading': 'Betöltés…',
  'common.error': 'Hiba történt',
} as const;

export type MessageKey = keyof typeof coreMessages;

export function t(key: MessageKey): string {
  return coreMessages[key];
}
