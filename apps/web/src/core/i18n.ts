// A mag felületi szövegei. A modulok szövegei a `modules/<id>/web/i18n.ts`-ben vannak; a modulregiszter
// (`modules.ts`) betöltéskor ide fűzi őket (`registerMessages`), így a menüpontok és eseménytípusok i18n-kulcsai
// a mag felületén is fordíthatók.
export const coreMessages = {
  'app.name': 'dERP',
  'auth.title': 'Belépés',
  'auth.email': 'E-mail-cím',
  'auth.devLogin': 'Belépés (fejlesztői)',
  'auth.google': 'Belépés Google-fiókkal',
  'auth.unavailable': 'A belépés jelenleg nem érhető el.',
  'auth.logout': 'Kilépés',
  'auth.error.not_allowed': 'Ezzel a Google-fiókkal nem lehet belépni: az e-mail-cím nincs felvéve a rendszerbe. Kérd az admint, hogy vegyen fel.',
  'auth.error.google_failed': 'A Google-belépés nem sikerült. Próbáld újra.',
  'auth.error.google_cancelled': 'A Google-belépés megszakadt.',
  'privacy.link': 'Adatvédelmi tájékoztató',
  'nav.main': 'Főmenü',
  'nav.open': 'Menü megnyitása',
  'nav.close': 'Menü bezárása',
  'nav.projects': 'Projektek',
  'nav.clients': 'Ügyfelek',
  'nav.users': 'Felhasználók',
  'nav.audit': 'Auditnapló',
  'projects.title': 'Projektek',
  'projects.new': 'Új projekt',
  'projects.name': 'Projekt neve',
  'projects.client': 'Ügyfél',
  'projects.noClient': '– nincs –',
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
  'projects.forbidden': 'Nincs jogosultság ehhez a projekthez.',
  'projects.members': 'Hozzárendelt kollégák',
  'projects.membersEmpty': 'Még senki nincs hozzárendelve.',
  'projects.addMember': 'Kolléga',
  'projects.assign': 'Hozzárendelés',
  'projects.unassign': 'Levétel',
  'projects.contacts': 'Ügyfél-elérhetőség',
  'clients.title': 'Ügyfelek',
  'clients.new': 'Új ügyfél',
  'clients.name': 'Ügyfél neve',
  'clients.address': 'Cím',
  'clients.note': 'Megjegyzés',
  'clients.create': 'Ügyfél felvétele',
  'clients.empty': 'Még nincs ügyfél.',
  'clients.back': 'Vissza az ügyfelekhez',
  'clients.notFound': 'Az ügyfél nem található.',
  'clients.forbidden': 'Nincs jogosultság ehhez az ügyfélhez.',
  'clients.deleteConfirm': 'Biztosan törlöd az ügyfelet?',
  'clients.projects': 'Projektek',
  'clients.noProjects': 'Még nincs projektje.',
  'contacts.title': 'Kapcsolattartók',
  'contacts.empty': 'Még nincs kapcsolattartó.',
  'contacts.new': 'Új kapcsolattartó',
  'contacts.name': 'Név',
  'contacts.position': 'Beosztás',
  'contacts.phone': 'Telefon',
  'contacts.email': 'E-mail',
  'contacts.note': 'Megjegyzés',
  'contacts.create': 'Kapcsolattartó felvétele',
  'contacts.deleteConfirm': 'Biztosan törlöd a kapcsolattartót?',
  'users.title': 'Felhasználók',
  'users.new': 'Új felhasználó',
  'users.email': 'E-mail-cím',
  'users.name': 'Név',
  'users.role': 'Szerepkör',
  'users.status': 'Állapot',
  'users.active': 'aktív',
  'users.inactive': 'kikapcsolva',
  'users.create': 'Felhasználó felvétele',
  'users.deactivate': 'Kikapcsolás',
  'users.activate': 'Bekapcsolás',
  'users.hint': 'Belépni a felvett e-mail-címhez tartozó Google-fiókkal lehet (céges vagy személyes is).',
  'role.admin': 'admin',
  'role.iroda': 'iroda',
  'role.terepes': 'terepes',
  'audit.title': 'Auditnapló',
  'audit.at': 'Időpont',
  'audit.user': 'Felhasználó',
  'audit.action': 'Művelet',
  'audit.entity': 'Mit',
  'audit.all': 'mind',
  'audit.empty': 'Nincs bejegyzés.',
  'audit.more': 'Továbbiak',
  'audit.action.view': 'Megtekintés',
  'audit.action.create': 'Létrehozás',
  'audit.action.update': 'Módosítás',
  'audit.action.delete': 'Törlés',
  'audit.action.login': 'Belépés',
  'audit.entity.project': 'Projekt',
  'audit.entity.client': 'Ügyfél',
  'audit.entity.contact': 'Kapcsolattartó',
  'audit.entity.user': 'Felhasználó',
  'common.forbidden': 'Nincs jogosultság.',
  'common.save': 'Mentés',
  'common.cancel': 'Mégse',
  'common.edit': 'Szerkesztés',
  'common.delete': 'Törlés',
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
