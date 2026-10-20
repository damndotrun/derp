import { moduleT } from '@/core/i18n.ts';

export const messages = {
  'catalog.menu': 'Cikktörzs',
  'catalog.title': 'Cikktörzs',
  'catalog.audit.import': 'Cikktörzs-import',

  'catalog.search': 'Keresés',
  'catalog.searchPlaceholder': 'Cikkszám, megnevezés vagy beszállító',
  'catalog.count': '{count} cikk',
  'catalog.empty': 'A cikktörzs még üres.',
  'catalog.noMatch': 'Nincs a keresésnek megfelelő cikk.',
  'catalog.more': 'Továbbiak betöltése',
  'catalog.table': 'Cikkek',

  'catalog.field.sku': 'Cikkszám',
  'catalog.field.name': 'Megnevezés',
  'catalog.field.unit': 'Egység',
  'catalog.field.netUnitPriceFiller': 'Nettó egységár',
  'catalog.field.vatRate': 'ÁFA',
  'catalog.field.supplier': 'Beszállító',

  'catalog.import.title': 'CSV-import',
  'catalog.import.intro':
    'Az első sor az oszlopneveket tartalmazza: Cikkszám; Megnevezés; Egység; Nettó egységár; ÁFA-kulcs; Beszállító (nem kötelező). A magyar Excel „CSV (pontosvesszővel tagolt)” mentése megfelel; az ár lehet vesszős tizedes (pl. 1 234,50). A már meglévő cikkszámú cikkek frissülnek.',
  'catalog.import.sample': 'Minta CSV letöltése',
  'catalog.import.file': 'CSV-fájl',
  'catalog.import.reading': 'Fájl ellenőrzése…',
  'catalog.import.preview': 'Előnézet',
  'catalog.import.fileInfo': '{name} · {encoding} · elválasztó: {delimiter}',
  'catalog.import.summary': 'Összesítés',
  'catalog.import.summary.new': '{count} új',
  'catalog.import.summary.changed': '{count} módosul',
  'catalog.import.summary.unchanged': '{count} változatlan',
  'catalog.import.summary.error': '{count} hibás sor',
  'catalog.import.errorsSkipped': 'A hibás sorok nem kerülnek be; javítsd őket a fájlban, és importáld újra.',
  'catalog.import.omitted': 'és még {count} sor (az előnézet csak az első sorokat mutatja)',
  'catalog.import.line': 'Sor',
  'catalog.import.status': 'Állapot',
  'catalog.import.status.new': 'Új',
  'catalog.import.status.changed': 'Módosul',
  'catalog.import.status.unchanged': 'Változatlan',
  'catalog.import.status.error': 'Hibás',
  'catalog.import.submit': 'Importálás ({count} cikk)',
  'catalog.import.nothing': 'Nincs mit importálni: minden sor változatlan vagy hibás.',
  'catalog.import.cancel': 'Mégse',
  'catalog.import.done': 'Import kész: {new} új, {changed} frissített cikk.',
  'catalog.import.tab': 'tabulátor',
} as const;

export const t = moduleT(messages);
