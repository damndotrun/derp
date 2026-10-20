# Cikktörzs (`catalog` modul)

Cikkek (cikkszám, megnevezés, egység, nettó egységár, ÁFA-kulcs, beszállító), CSV-import előnézettel és
hibasor-jelzéssel, ékezetfüggetlen keresés. Az árajánlat (10.) innen vesz fel tételt; a végponttól végpontig tartó
forgatókönyv 3 cikke a `seedE2E` hookban van (`server/seed.ts`, `E2E_ITEMS`).

## Adatok

- `catalog_item`: `sku` (cikkszám, egyedi, kis-nagybetű számít, a szélső szóközök nélkül), `name`, `unit`,
  `net_unit_price_filler`, `vat_rate`, `supplier` (üres is lehet), `version` (minden tényleges változásnál nő),
  `created_at`, `updated_at`, és a keresőmező (`search_text`: a cikkszám, a megnevezés és a beszállító kisbetűs,
  ékezet nélküli alakja).
- **Nettó egységár fillérben**, egész számként (12,50 Ft = `1250`; API-mező: `netUnitPriceFiller`). A forintra
  kerekítés az ajánlat dolga (a spec szerint a bruttó végösszegnél). Megjelenítés: `formatFiller()` (`shared/format.ts`):
  „48 500 Ft”, „12,50 Ft”.
- **ÁFA-kulcs** százalékban: `0`, `5`, `18` vagy `27` (`VAT_RATES`). Különleges jelölés (AAM, TAM, fordított adózás)
  nincs; ha kell, az a spec bővítése.
- Törlés és egyenkénti szerkesztés nincs (a spec nem írja); a cikk az újbóli importtal frissíthető.

## CSV-import

- **Kódolás:** UTF-8 (BOM-mal vagy anélkül), UTF-16 BOM-mal (Excel „Unicode szöveg”), különben Windows-1250 (a magyar
  Excel „CSV (pontosvesszővel tagolt)” mentése). Az ékezetek mindhárommal épen maradnak.
- **Elválasztó:** a fejlécsorból (abban nincs tizedesvessző) a leggyakoribb a `;`, tabulátor és `,` közül; az
  elválasztót tartalmazó értéket idézőjelbe kell tenni (többsoros érték is mehet).
- **Fejléc** (az első nem üres sor), kis-nagybetűtől, ékezettől, írásjeltől és „(Ft)”/„HUF” végződéstől függetlenül:
  Cikkszám (cikkkód, termékkód), Megnevezés (terméknév), Egység (mértékegység, me), Nettó egységár (nettó ár,
  egységár), ÁFA-kulcs (ÁFA), Beszállító (szállító; nem kötelező). Más oszlop kimarad. Hiányzó kötelező vagy kétszer
  szereplő oszlop esetén a fájl egésze hibás (`fileError`).
- **Ár:** „1 234,50”, „1.234,50”, „1234,5”, „12 Ft”; vessző nélkül a pont tizedespont („1234.50”), kivéve ha ezres
  csoportokat választ el („1.234” = 1234). Legfeljebb 2 tizedesjegy, nem negatív.
- **Hibás sor** (a fájlbeli sorszámmal és okkal): hiányzó vagy túl hosszú mező (cikkszám 64, megnevezés 500, egység 20,
  beszállító 200 karakter), rossz ár vagy ÁFA-kulcs, a fejlécnél több mező, a fájlban korábban már szereplő cikkszám. A
  hibás sor nem importálódik, a többi igen.
- **Összevetés cikkszám szerint:** új, módosul (melyik mező), változatlan. Az import a változatlan sort nem írja (a
  verzió sem nő), így ismételhető.
- Korlát: 10 MB, 50 000 sor.

## Végpontok

| Végpont | Mire | Jogosultság |
| --- | --- | --- |
| `GET /api/catalog/items?q=&limit=&offset=` | `{ items, total }`, név, majd cikkszám szerint; a `q` minden szavának szerepelnie kell a cikkszámban, a megnevezésben vagy a beszállítóban (ékezettől, kis-nagybetűtől függetlenül); `limit` alap 50, max. 200 | belépve |
| `GET /api/catalog/items/:id` | egy cikk (10.: tétel felvételekor) | belépve |
| `POST /api/catalog/import/preview` `{fileName, content}` | előnézet, nem ír: `{ fileError, encoding, delimiter, summary, rows, omitted }`; a `rows`-ban előbb a hibás sorok (max. 200), utána a többi (max. 100) | `catalog.manage` (admin, iroda) |
| `POST /api/catalog/import` `{fileName, content}` | ugyanaz a fájl újra beolvasva és beírva (egyszerre egy import); `{ summary }`; fájlhibára 400 | `catalog.manage` |

A `content` a fájl base64-ben (`web/api.ts`: `fileToImport(file)`). Az import az auditnaplóba kerül (`catalog.import`,
`update`, a fájlnévvel és a darabszámokkal). Esemény nincs: a cikktörzs nem projekthez kötött.

## Felület

`/catalog` „Cikktörzs”: keresőmező (a `?q=` az URL-ben marad), cikklista (asztalon minden oszlop, telefonon a
megnevezés alatt a cikkszám és a beszállító, az ár alatt az egység és az ÁFA), „Továbbiak betöltése”. Az irodának és
az adminnak a „CSV-import” kártya: minta CSV letöltése, fájl kiválasztása → előnézet (összesítés, hibás sorok okkal és
nyers mezőkkel, a módosuló mezők kiemelve) → „Importálás (N cikk)”.

## 10. munkacsomagnak

- A tétel a cikk adatait (megnevezés, egység, nettó egységár fillérben, ÁFA-kulcs) **másolja** az ajánlatba: a
  cikktörzs későbbi importja ne írja át a kész ajánlatot.
- A cikkválasztóhoz a `GET /api/catalog/items?q=` elég; típusok: `shared/schemas.ts` (`CatalogItem`, `CatalogList`).
