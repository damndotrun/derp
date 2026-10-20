# Jegyzet és felmérés (`notes` modul)

Szabad szöveges helyszíni jegyzet, illetve kötelező mezős felmérés fotókkal, projekthez kötve. A fotók a
dokumentumtárba kerülnek (`docs` modul), az eseményük a felmérés eseménye alá, így az idővonalon egy csoportban
látszanak. Mindkettő hozzáfűzés jellegű: nincs szerkesztés és törlés.

## Adatok

- `notes_notes`: `id` (a kliens UUID-ja), projekt, szerző, `body` (1–4000 karakter), `event_id`.
- `notes_surveys`: `id` (a kliens UUID-ja), projekt, szerző, `location` (helyszín), `condition` (észlelt állapot),
  `proposed_work` (javasolt munka), `materials` (becsült anyag tételesen: `[{ name, quantity, unit }]`, legalább egy
  tétel, a mennyiség pozitív szám), `photos` (`[{ id, name }]` előre kiosztott `docs_files.id`-vel), `event_id`.

## Végpontok

| Végpont | Mire | Jogosultság |
| --- | --- | --- |
| `GET /api/notes/projects/:projectId` | a projekt jegyzetei és felmérései (`{ notes, surveys }`, a legújabbal kezdve) | a projektet látja |
| `PUT /api/notes/projects/:projectId/notes/:noteId` `{ body, capturedAt? }` | új jegyzet; új azonosítónál 201, ugyanazzal újraküldve 200, eltérő tartalommal (szerzővel, projekttel) 409 | `notes.write` |
| `PUT /api/notes/projects/:projectId/surveys/:surveyId` `{ location, condition, proposedWork, materials, photos?, capturedAt? }` | új felmérés; hiányzó kötelező mező 400, idempotencia mint fent; másik projekt fotója 400 | `notes.write` |
| `GET /api/notes/surveys/:surveyId` | egy felmérés | a felmérés projektjét látja |

`notes.write`: admin, iroda, terepes. Minden végpont `ctx.requireProject`-tel indul: a terepes a nem hozzá rendelt
projektre 403-at kap. A `capturedAt` a terepi időpont (a rekord `createdAt`-je és az esemény `occurredAt`-je,
lásd a modules/README „Terepi mód” részét). A felmérés fotói állapottal jönnek vissza: `ready` (a dokumentumtárban), `pending` (még nem
töltődött fel, pl. offline sorban vár), `deleted` (azóta törölték a dokumentumtárból).

## Események

- `notes.note_added` („Helyszíni jegyzet: …”), `data: { noteId, body }`.
- `notes.survey_added` („Felmérés: <helyszín>”), `data: { surveyId, location, condition, proposedWork, materials,
  photos }` (a `photos` a fotók száma). A fotók `docs.file_uploaded` eseménye `parentId`-vel erre mutat.
- Auditnapló: `notes.note` és `notes.survey`, `create`.

## Kliens

- Útvonalak: `/notes` (projektválasztó), `/notes/:projectId` (lista, „Új felmérés”, „Új jegyzet”),
  `/notes/:projectId/surveys/:surveyId` (egy felmérés). Projekt-adatlap link: „Jegyzet és felmérés”.
- `web/save.ts` (az offline sornak, 8.): `prepareSurvey(projectId, fields, files)` → `PreparedSurvey` (kliens
  UUID-k, 2560 px-re kicsinyített fotók; IndexedDB-be tehető, a felmérés és a fotói egy elem), `sendSurvey(prepared)`
  (előbb a felmérés, utána a fotók a dokumentumtár „Felmérések” mappájába `parentEventId`-vel; újrajátszva sem
  duplikál; a fotók a felmérés `capturedAt`-jét kapják); `prepareNote` / `sendNote` ugyanígy. 401-nél a mag
  `ApiError`-ját dobják.
- Offline sor (8.): elemfajták `notes.survey` és `notes.note`; az űrlapok ezen át küldenek, a sorban várakozó elem a
  lista elején „feltöltésre vár” kártyaként látszik.
- `web/SurveyView.tsx`: `SurveyCard`, `MaterialsTable` (pl. az ajánlat oldalpaneljéhez, 10.).
