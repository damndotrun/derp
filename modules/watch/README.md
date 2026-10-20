# Mappafigyelő (`watch` modul)

Egy szerver-mappa csak olvasható figyelése. Projektenként egy almappa rendelhető hozzá; a fájlváltozások (új,
módosult, törölt, átnevezett) eseményként a projekt idővonalára kerülnek, a fájl a felületről letölthető.

## Beállítás

| Változó | Alapérték | Mire |
| --- | --- | --- |
| `WATCH_ROOT` | `/watch` | a figyelt gyökér (csak olvasható mount). Teszt módban (`NODE_ENV=test`), ha nincs megadva: `<tmpdir>/derp-watch-test` |
| `WATCH_INTERVAL_SEC` | `300` | az ütemezett bejárás gyakorisága; `0` = nincs ütemezett bejárás, csak a „Most ellenőrizd” |

A `deploy/compose.yaml` a `DERP_WATCH_DIR` hoszt-mappát (alapból üres kötetet), a `deploy/compose.nas.yaml` a
`/mnt/Tank/derp/watch-test`-et csatolja `/watch`-ra, csak olvashatóan. A konténer UID 1000-ként olvas.

## Működés

- **Hozzárendelés:** az iroda a figyelt gyökér almappái közül választ. Egy almappa egyszerre egy projekté, és a gyökér
  egésze nem rendelhető. A hozzárendeléskor a mappában már meglévő fájlok **esemény nélkül** kerülnek be (alapállapot);
  csak az ezutáni változások lesznek események. Csere vagy megszüntetés esetén a korábbi fájlsorok esemény nélkül
  kikerülnek.
- **Bejárás:** útvonal, méret, módosítási idő; hash (sha256) csak az új és a megváltozott fájloké. Ütemezve
  (`WATCH_INTERVAL_SEC`) és kézzel („Most ellenőrizd”); egyszerre egy bejárás fut.
  - új útvonal → `watch.file_added` („Új fájl a szerveren: …”);
  - méret vagy mtime változott és a hash is → `watch.file_modified`; ha a hash azonos, csak az mtime frissül, esemény
    nélkül;
  - eltűnt útvonal → `watch.file_deleted`;
  - eltűnt + új fájl azonos hash-sel → `watch.file_renamed` (egy esemény; a fájl azonosítója megmarad).
- **Kihagyva:** rejtett fájlok és mappák (`.` kezdetű), Office-zárolófájlok (`~$…`, `~….tmp`), `Thumbs.db`,
  `desktop.ini`, Synology `@eaDir`, `#recycle`, `#snapshot`, és a szimbolikus linkek (nem követi őket).
- **Biztonság:** ha a gyökér vagy az almappa nem érhető el, vagy egy könyvtára nem olvasható, a bejárás nem változtat
  semmit (a fájlok nem látszanak töröltnek), csak a hibát jegyzi fel a hozzárendelésre (`lastError`), amit a felület
  mutat. Útvonal nem mutathat a gyökéren kívülre.
- **Esemény ideje:** törlés és átnevezés: az észlelés ideje; új és módosult fájl: a módosítási idő, ha az előző
  bejárás és most közé esik, különben (pl. régi dátummal másolt fájl) az észlelés ideje. Forrás: `filesystem`,
  szereplő nincs.

## Táblák

- `watch_mappings`: `project_id` (kulcs: projektenként egy), `path` (a gyökérhez képest, egyedi), `version`,
  `last_scan_at`, `last_error`.
- `watch_files`: `id`, `project_id`, `path` (a hozzárendelt almappához képest, `/`-rel), `size`, `mtime`, `sha256`,
  `deleted_at` (törléskor csak ez kap értéket).

## Végpontok

| Végpont | Mire | Jogosultság |
| --- | --- | --- |
| `GET /api/watch/mappings` | a látható projektek hozzárendelései fájlszámmal | belépve (terepes: csak a hozzá rendelt projektek) |
| `GET /api/watch/projects/:projectId` | `{ mapping, files }` | a projektet látja |
| `PUT /api/watch/projects/:projectId/mapping` `{ path, version? }` | hozzárendelés vagy csere (meglévőnél `version` kötelező, eltérésnél 409); nem létező, nem mappa, gyökéren kívüli útvonal 400; másik projekt mappája 409 | `watch.manage` |
| `DELETE /api/watch/projects/:projectId/mapping` | megszüntetés | `watch.manage` |
| `POST /api/watch/projects/:projectId/scan` | „Most ellenőrizd”: `{ added, modified, deleted, renamed, files, error }` | `watch.scan` |
| `GET /api/watch/folders?path=` | a gyökér egy könyvtárának almappái, a már hozzárendelteknél a projekttel | `watch.manage` |
| `GET /api/watch/files/:fileId/content` | letöltés (mindig csatolmányként), auditnapló: megtekintés; törölt fájlra 404 | a projektet látja |
| `POST /api/test/watch-file` `{ path, content, encoding? }` | csak `NODE_ENV=test`: fájl írása a `WATCH_ROOT` alá (e2e) | belépve |

`watch.manage`: admin, iroda; `watch.scan`: admin, iroda, terepes. Auditnapló: `watch.mapping` (létrehozás,
módosítás, törlés), `watch.file` (letöltés).

## Felület

- `/watch`: a látható projektek a hozzárendelt mappával és fájlszámmal.
- `/watch/:projectId`: a hozzárendelt mappa, utolsó ellenőrzés, hiba, „Most ellenőrizd”, mappaválasztó (iroda), a
  fájlok listája szűrővel és letöltéssel (500 fölött szűrni kell). Élőben frissül a `watch.*` eseményekre.
- Projekt-adatlap: „Szerver-mappa” link. Idővonal: útvonal, méret, letöltés-link (törlésnél nincs), átnevezésnél a
  korábbi útvonal.
