# Dokumentumtár (`docs` modul)

Fotók és fájlok projektmappákban, bélyegképpel. A jegyzet/felmérés (5.), a chat (7.), az offline sor (8.) és az
árajánlat oldalpanelje (10.) is ezen át tölt fel és olvas.

## Tárolás

- `DATA_DIR` (alapérték `/data/files`) alatt, tartalom szerint címzve: `blobs/ab/cd/<sha256>`, bélyegkép
  `thumbs/ab/cd/<sha256>.webp` (400 px hosszú él, `sharp`, EXIF szerint elforgatva), átmenetileg `tmp/` és `trash/`.
- Táblák: `docs_blobs` (sha256, méret, van-e bélyegkép), `docs_files` (a fájl metaadata, a kliens UUID-ja az
  azonosító), `docs_folders` (projektmappák, tetszőleges mélységben, szintenként egyedi névvel).
- Azonos tartalom egyszer van a lemezen, akárhány fájl-sor hivatkozik rá (más néven, más mappában, más projektben).
  Törléskor csak a fájl-sor törlődik; a blob sora és a lemezen lévő fájl az utolsó hivatkozás törlésekor. A blob sorát
  a feltöltés és a törlés is zárolja, így egy párhuzamos feltöltés nem veszíti el a fájlt.

## Végpontok

| Végpont | Mire | Jogosultság |
| --- | --- | --- |
| `GET /api/docs/projects/:projectId` | a projekt minden mappája és fájlja (`ProjectDocs`) | a projektet látja |
| `PUT /api/docs/projects/:projectId/files/:fileId?name=&type=&folderId=&sha256=&parentEventId=&capturedAt=` | feltöltés (a `capturedAt` a terepi időpont, lásd a modules/README „Terepi mód” részét); a törzs a fájl bájtjai (`Content-Type: application/octet-stream`); új fájlnál 201, ugyanazzal az azonosítóval újra küldve 200 (ugyanaz a fájl), más tartalommal 409; eltérő `sha256` 400; 200 MB fölött 413 | `docs.upload` |
| `GET /api/docs/files/:fileId` | metaadat | a projektet látja |
| `GET /api/docs/files/:fileId/content[?download=1]` | tartalom; kép, PDF, szöveg, MP4 böngészőben (inline), más típus és `download=1` letöltésként; ETag; auditnapló: megtekintés | a projektet látja |
| `GET /api/docs/files/:fileId/thumb` | WebP bélyegkép (404, ha nincs) | a projektet látja |
| `PATCH /api/docs/files/:fileId` `{version, name?, folderId?}` | átnevezés, áthelyezés; eltérő verzió 409 | `docs.manage` vagy a feltöltő |
| `DELETE /api/docs/files/:fileId` | törlés (blob az utolsó hivatkozás után) | `docs.manage` vagy a feltöltő |
| `POST /api/docs/projects/:projectId/folders` `{name, parentId?}` | mappa; azonos néven 409 | `docs.upload` |
| `PATCH /api/docs/folders/:folderId` `{version, name}` | mappa átnevezése | `docs.manage` |
| `DELETE /api/docs/folders/:folderId` | csak üres mappa (különben 409) | `docs.manage` |

`docs.upload`: admin, iroda, terepes; `docs.manage`: admin, iroda. Minden végpont a fájl projektjére
`ctx.requireProject`-et hív: a terepes a nem hozzá rendelt projekt fájljaira is 403-at kap.

## Események

- `docs.file_uploaded` („Fotó feltöltve: …” vagy „Fájl feltöltve: …”), `docs.file_deleted`. A `data`:
  `{ fileId, name, mime, size, folderId, thumb }`. A feltöltésnél megadott `parentEventId` az esemény `parentId`-je
  lesz (ugyanabból a projektből), így pl. a felmérés fotói az idővonalon a felmérés alatt, egy csoportban látszanak.
- A kliens megjelenítője bélyegképet és linket ad a dokumentumtár mappájára.

## Más modulokból

- **Szerver:** a csatolmány a `docs_files.id` (UUID). Ha a modul ellenőrizni akarja, hogy a csatolt fájl a projekthez
  tartozik, a `manifest.dependsOn: ['docs']` után olvashatja a `docs_files` táblát (`id`, `project_id`). Írni csak a
  fenti végpontokon át kell.
- **Kliens:** `modules/docs/web/upload.ts`:
  - `prepareUpload(projectId, file, { folderId?, parentEventId?, capturedAt? })` → `PreparedUpload` (2560 px-re
    kicsinyített kép, sha256, kliens UUID, a rögzítés ideje; a `blob` IndexedDB-be tehető, így az offline sor ezt tárolja);
  - `sendUpload(prepared)` → `DocsFile` (idempotens `PUT`, újrajátszva sem duplikál);
  - `uploadFile(projectId, file, opts)` a kettő együtt; `fileUrls(fileId)` (`content`, `download`, `thumb`) a
    `web/api.ts`-ben; a `FileThumb` komponens a `web/ProjectDocsPage.tsx`-ben.
- **Offline sor (8.):** elemfajta `docs.upload` (payload: `PreparedUpload`); a dokumentumtár feltöltőpanelje ezen át
  küld, offline a fájl „Feltöltésre vár”. Offline olvasáshoz: `GET /api/docs/projects/:id`, a bélyegképek a megnyitáskor
  tárolódnak.
- **Útvonalak:** `/docs` (projektválasztó), `/docs/:projectId?folder=<mappa>` (a projekt dokumentumtára).
