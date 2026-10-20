// A mag felületi szövegei. A modulok szövegei a `modules/<id>/web/i18n.ts`-ben vannak; a modulregiszter
// (`modules.ts`) betöltéskor ide fűzi őket (`registerMessages`), így a menüpontok és eseménytípusok i18n-kulcsai
// a mag felületén is fordíthatók.
export const coreMessages = {
  'app.name': 'dERP',
  'auth.title': 'Belépés',
  'auth.email': 'E-mail-cím',
  'auth.devLogin': 'Belépés (fejlesztői)',
  'auth.unavailable': 'A belépés jelenleg nem érhető el.',
  'auth.logout': 'Kilépés',
  'nav.main': 'Főmenü',
  'nav.open': 'Menü megnyitása',
  'nav.close': 'Menü bezárása',
  'nav.projects': 'Projektek',
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
  'modules.disabled': 'Ez a modul nincs bekapcsolva.',
  'common.loading': 'Betöltés…',
  'common.error': 'Hiba történt',
} as const;

export type MessageKey = keyof typeof coreMessages;

const messages: Record<string, string> = { ...coreMessages };

export function t(key: MessageKey): string {
  return coreMessages[key];
}

/** Futásidőben kapott kulcs (pl. menüpont a `GET /api/modules`-ból) fordítása; ismeretlen kulcsnál maga a kulcs. */
export function translate(key: string): string {
  return messages[key] ?? key;
}

/** Egy modul szövegeinek hozzáfűzése. A kulcsok a modul azonosítójával kezdődnek, így nem ütközhetnek. */
export function registerMessages(moduleId: string, moduleMessages: Record<string, string>): void {
  for (const [key, text] of Object.entries(moduleMessages)) {
    if (!key.startsWith(`${moduleId}.`)) throw new Error(`i18n: a(z) „${moduleId}” modul kulcsa nem „${moduleId}.” előtagú: ${key}`);
    if (key in messages) throw new Error(`i18n: kétszer megadott kulcs: ${key}`);
    messages[key] = text;
  }
}

/** Típusos fordító egy modul saját szövegeihez: `export const t = moduleT(messages)`. */
export function moduleT<M extends Record<string, string>>(moduleMessages: M): (key: keyof M & string) => string {
  return (key) => moduleMessages[key]!;
}
