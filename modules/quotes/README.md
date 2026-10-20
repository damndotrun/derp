# Árajánlat (`quotes` modul)

Tételsoros árajánlat projekthez: tételek a cikktörzsből vagy kézzel, mennyiség, tételenkénti kedvezmény,
nettó/ÁFA/bruttó, megjegyzés, érvényesség; verziók, PDF a cég fejlécével, kézi státusz. A szerkesztő mellett a projekt
felmérései, fotói és idővonala látszanak. Függ: `catalog`, `docs`, `notes`.

## Adatok

- `quotes_quotes`: projekt, `number` (rendszerszinten folyamatos sorszám), létrehozó.
- `quotes_versions`: `version_no`, `status`, `revision` (minden mentéssel és státuszváltással nő), `items` (JSONB),
  `note`, `valid_until`, `event_id` (a verzió létrehozásának eseménye). Egy ajánlatnak egyszerre legfeljebb egy
  tervezete van (részleges egyedi index).
- `quotes_pdfs`: az elkészült PDF-ek (`bytea`, a verzió `revision`-jével és a végösszeggel); soha nem törlődnek.
- `quotes_settings`: egyetlen sor, a PDF fejléce (cégnév, cím, adószám, telefon, e-mail, bankszámla, lábléc, logó).
- Az ajánlat azonosítója a felületen és a PDF-en: `sorszám/verzió` (pl. `12/2`); a PDF neve `arajanlat-12-2.pdf`.

## Pénz és kerekítés (`shared/money.ts`, szerveren és kliensen ugyanaz)

- Minden összeg **fillérben**, egész számként (a cikktörzs döntése szerint). A mennyiség legfeljebb 3, a kedvezmény
  legfeljebb 2 tizedesjegy; a számítás egészekkel (BigInt) megy, kerekítés mindenhol fél felfelé.
- Tétel nettó = mennyiség × nettó egységár × (1 − kedvezmény%), fillérre kerekítve.
- **ÁFA-kulcsonként**: a tételnettók összege, az ÁFA = nettó × kulcs (a kulcs összegére, nem tételenként), fillérre
  kerekítve; bruttó = nettó + ÁFA.
- **Végösszeg** = a bruttók összege forintra kerekítve; a különbség „Kerekítés” sorként látszik.
- A **kedvezmény** tételenkénti százalék (a spec „kedvezmény” szavának legvalószínűbb olvasata); ajánlatszintű
  kedvezmény nincs.
- A tétel a cikk adatait (cikkszám, megnevezés, egység, nettó egységár, ÁFA-kulcs) **másolja**; a `catalogItemId` csak
  hivatkozás, a cikktörzs későbbi importja nem írja át az ajánlatot. A másolt adatok a tervezetben átírhatók.
- Bevitel magyar formában: „2 150,50”, „2,5” (`shared/format.ts`).

## Verziók és státusz

- Státusz (kézi): `tervezet`, `kikuldve`, `elfogadva`, `elutasitva`. Csak a tervezet szerkeszthető.
- A tervezetből bármelyik másik állapotba lehet lépni (tétel nélkül nem); tervezetbe vissza nem. A tervezet
  elhagyásakor, ha az aktuális állapotáról még nincs PDF, a szerver elkészíti, így minden kiküldött verziónak megvan a
  PDF-je. A lezárt verziók között a státusz tovább állítható (pl. kiküldve → elfogadva).
- Módosításhoz **új verzió** kell: a legújabb (már nem tervezet) verzió másolata, tervezetként. A korábbi verziók és
  PDF-jeik megmaradnak.
- Párhuzamos szerkesztés: a mentés, a státuszváltás és a PDF-kérés a `revision`-t küldi; eltérésnél 409.

## Végpontok

Minden végpont `quotes.manage` (admin, iroda) jogosultságot kér, és az ajánlat projektjére `ctx.requireProject`-et hív.
A terepes az árak miatt egyik végpontot sem éri el (403), a menüpont sem látszik neki.

| Végpont | Mire |
| --- | --- |
| `GET /api/quotes` | minden ajánlat a legújabb verziójával (`QuoteList`) |
| `GET /api/quotes/projects/:projectId` | a projekt ajánlatai |
| `POST /api/quotes/projects/:projectId` | új ajánlat üres tervezettel (201, `Quote`) |
| `GET /api/quotes/:quoteId` | az ajánlat minden verziójával, összesítővel és a PDF-ek adataival |
| `POST /api/quotes/:quoteId/versions` | új verzió (201); ha van tervezet, 409 |
| `PUT /api/quotes/versions/:versionId` `{revision, items, note, validUntil}` | a tervezet mentése; nem tervezetre vagy elavult `revision`-re 409 |
| `POST /api/quotes/versions/:versionId/status` `{revision, status}` | kézi státuszváltás |
| `POST /api/quotes/versions/:versionId/pdf` `{revision}` | PDF a tervezetről (201, `QuotePdf`); lezárt verzióra 409, tétel nélkül 400 |
| `GET /api/quotes/pdfs/:pdfId` | a PDF letöltése (`attachment`); auditnapló: megtekintés |
| `GET /api/quotes/settings` | a PDF fejléce |
| `PUT /api/quotes/settings` `{version, ...}` | a fejléc mentése (`quotes.settings`: admin); eltérő verzióra 409 |
| `GET/PUT/DELETE /api/quotes/settings/logo` | a logó (PNG vagy JPEG, base64-ben, legfeljebb 1 MB; írni az admin tud) |

## Események és audit

- `quotes.created` („Árajánlat létrehozva: 12/1 (Tervezet)”), `quotes.version_created` („Új ajánlatverzió: 12/2
  (Tervezet)”), `quotes.status_changed` („Árajánlat 12/1: Kiküldve”), `quotes.pdf_created` („Árajánlat PDF elkészült:
  12/1”). A státusz és a PDF eseménye `parentId`-vel a verzió létrehozásának eseménye alatt van.
- `data`: `{ quoteId, versionId, number, versionNo, status }`, a státusznál `from`, a PDF-nél `pdfId`, `fileName`.
  Összeg nincs az eseményben, mert a projekt idővonalát a hozzá rendelt terepes is látja.
- Auditnapló: `quotes.quote` (létrehozás, mentés, státusz), `quotes.version`, `quotes.pdf` (létrehozás, letöltés),
  `quotes.settings`.

## PDF

`pdfmake` a szerveren (az első PDF-nél töltődik be), a `pdfmake` csomag Roboto betűivel (magyar ékezetek); külső URL-t
és a betűkészleten kívüli fájlt nem olvas. Tartalma: logó és cégadatok, „ÁRAJÁNLAT”, ajánlatkérő (az ügyfél neve és
címe), projekt, szám, kelte (`TZ_DISPLAY`), érvényesség, tételtábla, ÁFA-kulcsonkénti bontás, összesen, kerekítés,
végösszeg, megjegyzés, lábléc oldalszámmal. A PDF a `quotes_pdfs` táblában tárolódik (nem a dokumentumtárban).

## Felület

- `/quotes` „Árajánlatok” (admin, iroda): új ajánlat projektválasztóval, minden ajánlat listája; link a beállításokra.
- `/quotes/projects/:projectId`: a projekt ajánlatai, „Új árajánlat”. Projekt-adatlap link: „Árajánlatok”.
- `/quotes/:quoteId`: verzióválasztó, a tervezet szerkesztője (cikkválasztó, kézi tétel, sorrend, élő összesítő,
  „Mentés”, „PDF készítése” – mentés után letölt), lezárt verziónál csak olvasható nézet és „Új verzió készítése”;
  státuszváltás, a verzió PDF-jei. Oldalpanel (asztalon jobbra, telefonon alul): felmérések (`SurveyCard`) az
  anyagtételek átvételével („Kézi tétel”, „Cikkeresés” a tétel nevével), fotók (`FileThumb`), idővonal (`Timeline`).
- `/quotes/settings`: a PDF fejléce és a logó (az iroda csak olvassa).

## Tesztadat

A `seedE2E` a PDF fejlécét tölti ki („Dóka Kft. (teszt)”, egyszínű logó), ha a cégnév még üres.
