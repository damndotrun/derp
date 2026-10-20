# dERP — moduláris céges ügyviteli rendszer, 1. fázis
Verzió: 6 · 2026-10-20 · Állapot: jóváhagyva

## Cél és kész-feltétel

**Cél:** a Dóka Kft. (épületgépészet / légtechnika) egy projektet az első bejelentéstől a lezárásig egyetlen felületen
lásson és kezeljen, irodai PC-n és a terepen lévő telefonokon is, így például egy árajánlat elkészítéséhez ne kelljen
felhívni a felmérőt, levelezést vagy szerver-mappákat nyitogatni, cetliket és Google Naptárt bújni. Az 1. fázis olyan
modulrendszert és közös eseménynaplót ad, amelyre később a HR, készlet, flotta, Billingo, AI-bejelentésfeldolgozás és
ármonitor modulok ráépülnek.

**Kész-feltétel (1. fázis), mind lefuttatható:**
1. `pnpm test` zöld (szerver és kliens egységtesztek).
2. `pnpm e2e` zöld: a lenti „Végponttól végpontig tartó ellenőrzés” forgatókönyv Playwrighttal, asztali (1440×900) és
   telefonos (Pixel 7 emuláció) nézetben, a telefonos ágban offline szakasszal; egyszer a helyi compose-on, egyszer a
   NAS-on az `e2e` compose-profillal (külön adatbázis, SSH-porttovábbítással, a publikus cím és az éles adat nélkül).
3. `docker compose -f deploy/compose.yaml up` tiszta gépen elindul, a `GET /api/health` 200-at ad, és tétlenül a
   konténerek együttes memóriafogyasztása 600 MB alatt van (`docker stats --no-stream` kimenete a jelentésben); a
   compose memóriakorlátjai felső határok, nem célértékek. Így a cél-hardveren (Synology DS220+, 2–6 GB RAM) is elfér.
4. A fejlesztői példány fut a plasticgarden NAS-on a `derp.damndot.run` címen; a mentésből való visszaállítás próbája
   sikeres; a host-doksik visszaírása megtörtént (15. munkacsomag jelentése).

## Hatókör

**Benne van (1. fázis):**
- Mag: bejelentkezés (Google), felhasználók és szerepkörök, ügyfelek és kapcsolattartók, projektek, modulrendszer,
  közös eseménynapló, auditnapló, fájltár-alap.
- Projekt-idővonal: minden modul eseménye egy idővonalon, napi/heti csoportokba és típus szerint összecsukható,
  kibontható, szűrhető, élőben frissül.
- Projekt dokumentumtár: fotók és fájlok projektmappákban, bélyegképekkel.
- Helyszíni jegyzet és felmérés: szabad szöveges jegyzet, illetve kötelező mezős felmérés fotókkal, projekthez kötve.
- Projekt-chat: projektenként üzenetszál, fotó/fájl csatolással, @említéssel, élő frissüléssel.
- Terepi mód (PWA): telefonra telepíthető, térerő nélkül is lehet fotózni, jegyzetet/felmérést és chat-üzenetet írni;
  ezek visszatéréskor maguktól szinkronizálnak.
- Kiszállás-ütemezés: kiszállások projekthez és kollégákhoz rendelve, napi/heti nézet kollégánként, „Mai kiszállásaim”
  a telefonon, kollégánkénti csak olvasható naptár-feed (ICS), amire a Google Naptár fel tud iratkozni.
- Árajánlat-tervezet: cikktörzs CSV-importtal, tételsoros ajánlat, verziók, PDF, kézi státusz; az ajánlatszerkesztő
  mellett a projekt idővonala, fotói és felmérései látszanak.
- Gmail modul: céges Gmail-fiókok csak olvasható bekötése, levélszálak hozzárendelése projekthez (szabály alapú
  javaslattal és kézzel), a szálak megjelennek az idővonalon.
- Mappafigyelő modul: egy szerver-mappa csak olvasható felcsatolása; projektenként egy almappa rendelhető hozzá; a
  fájlváltozások (új, módosult, törölt) eseményként megjelennek az idővonalon, a fájl letölthető.
- Telepítés a plasticgarden NAS-ra fejlesztői példányként, mentéssel és visszaállítási próbával.

**Nincs benne (későbbi fázisok, külön modulként):**
Billingo-kapcsolat (2. fázis); HR (munkavállalói adatok, képesítések és dokumentumok lejárata, szabadság, egyéni
védőeszköz, munkaruha); GDPR-nyilvántartás modul; készletkezelés; autók és szerszámok költségekkel; jegyzőkönyv-sablonok
aláírással; AI-réteg (bejelentő levelekből űrlapkitöltés); webes ármonitorozás; szerver-snapshot (ZFS/Btrfs) alapú
változásnapló; a második telephely (TrueNAS) bekötése; kétirányú Google Naptár-szinkron és az `utemezo` integrálása;
levél küldése a rendszerből; natív mobilapp; éles telepítés a cég Synology DS220+-ára.

## Kontextus

- **Cég:** Dóka Kft., Kecskemét. Levelezés: Google (domain `dokakft.hu`, több fiók). Számlázás: Billingo. Telephelyi
  tárhely: Synology DS220+ (később cél-szerver). Felhasználók: kb. 5–30 fő; irodai PC és terepen Android/iPhone.
- **Fejlesztői szerver:** plasticgarden NAS (Asustor AS6602T, Celeron J4125, 32 GB RAM, TrueNAS SCALE 25.10). Saját
  konténerek „Custom App”-ként futnak (`compose.yaml` + `app.update`, nincs Roll Back); minta: `utemezo-api`. Saját adat
  a `Tank` poolon; a dERP saját datasetjei a `Tank/derp/` alatt vannak (nem a `Tank/data` alatt, mert azt egy SMB-share teljesen fedi). Publikus elérés kizárólag Cloudflare Tunnel (+ Access) útján, portnyitás
  nincs. Új dataset automatikusan a szülő rekurzív snapshot-taskjába kerül; titok olyan datasetre, amit SMB-share nem
  fed. A NAS-on írni (dataset, Custom App, mount, cron), valamint a Cloudflare- és Google Cloud-beállításokat elvégezni
  csak a felhasználó gépén futó helyi munkamenet tud, a `nas` skill szerint. Olvasásra (állapot, naplók, mérés) a felhős
  munkamenet is használhatja a `nas` skill HTTPS-végpontos SSH-olvasóját, ha a skill már tartalmazza; ha nem, az olvasás
  is helyi munkamenetbe kerül.
- **Átvehető kód:** `damndotrun/email-project-timeline` (Node + Express + SQLite; React + Vite + TS + Tailwind v4 +
  shadcn/ui). A `src/classify.js` (irány, projekt-szabály, eseménytípus magyar regexekkel, státusz), a hozzá tartozó
  `src/test/classify.*.test.js` tesztek és a `MailSource` interfész mintája a Gmail modulba portolandó; a
  `web/src/components/Timeline.tsx` és a `web/src/components/ui/*` kiindulási pontként használható. Élő Gmail-letöltés
  ott sincs kész.
- **Meglévő ütemező:** `utemezo` (Google Naptár + Chrome-bővítmény, `utemezo-api` a NAS-on). Ebben a fázisban nem
  integráljuk.
- **A NAS-előkészítés eredménye (13. munkacsomag első fele, kész):** datasetek `Tank/derp/{db,files,backup,secrets,watch-test}`
  (a `db` kizárva a snapshot-taskból, a replikáció hibamentes; a `/mnt/Tank/derp/db` még root tulajdonú, telepítéskor a
  Postgres-konténer UID-jára kell állítani); host-port: `app` → 30080 (a Tunnel innen éri el:
  `derp.damndot.run` → `http://192.168.1.63:30080`), `app-e2e` → `127.0.0.1:30081`; a `secrets/.env` (600) tartalmazza
  a `GOOGLE_LOGIN_CLIENT_ID` / `_SECRET` értékét. Cloudflare Access: „dERP” alkalmazás 720 órás munkamenettel, egyelőre
  a meglévő „Only me” szabállyal (csak a felhasználó), mert a Cloudflare-fiókban nincs Google-identitásszolgáltató;
  „dERP ICS feed” Bypass a `/api/ics/*`-ra. Google Cloud projekt: `derp-512213`, „dERP login” webes kliens (External,
  még Testing állapotban; a Production-re állítás a felhasználó lépése). A `dokakft.hu` Google Workspace.
- **Repó:** új, privát `damndotrun/derp` (a felhasználó hozza létre). Munka ágakon, PR-ral; merge csak a felhasználó
  jóváhagyásával.
- **Fejlesztői környezet:** a tesztek a `DATABASE_URL`-ben megadott PostgreSQL 16-ra csatlakoznak. Ha a munkamenetben
  van Docker, `pnpm db:up` indít egy Postgres konténert; ha nincs, a munkamenetben helyben telepített PostgreSQL 16 is
  megfelel. Docker nélküli munkamenetben a compose-ellenőrzés a 13. munkacsomagra marad, és a jelentés ezt kimondja.
  Ha a felhős munkamenetben a Docker Hub 429-et ad, a képek a `mirror.gcr.io`-ról húzhatók; a repóban a szokásos
  képnév (`postgres:16-alpine`, `node:22-alpine`) marad.
- **Az 1. munkacsomag óta rögzített megoldások** (jelentés: `/mnt/project-files/specs/derp/jelentesek/01-vaz.md`): a
  szerver TypeScriptje build nélkül fut (Node 22.18+ típuslehántás), így a `modules/*/manifest.ts` futásidőben
  betölthető; a migrációs keret forráslistát vár (mag, utána a modulok); az `events` táblát trigger védi a módosítástól;
  a törlés rejtés (`deleted_at`); a szerkesztés verziószámmal megy, eltérésnél 409; a munkamenet-végpontok
  `GET /api/session` és `POST /api/logout`; a konténeren belüli port 8080; az app indításkor migrál, a frissítés előtti
  `pg_dump` a telepítő szkript dolga; a kliens útválasztója `react-router` 7, a felületi alap a shadcn (cva, clsx,
  tailwind-merge), a kliens tesztjei Testing Library + jsdom.

## Felépítés és fájltulajdonlás

```
apps/server/src/core/      mag: belépés, felhasználók, ügyfelek, projektek, events, audit, fájltár-alap, SSE, modulbetöltő
apps/web/src/core/         mag felület: elrendezés, menü, ügyfél- és projektnézetek, idővonal-keret, offline réteg
packages/shared/           közös típusok, Zod sémák, eseménytípus-regiszter típusai
modules/<id>/              egy modul: manifest.ts, server/, web/, migrations/, test/
deploy/                    compose.yaml, Dockerfile, backup szkript, .env.example
e2e/                       Playwright forgatókönyvek
```

**Modulok és létrehozó munkacsomag:** `docs` (4), `notes` (5: jegyzet és felmérés), `visits` (6), `chat` (7),
`catalog` (9: cikktörzs), `quotes` (10), `gmail` (11, 14), `watch` (12).

**Szabályok, hogy a párhuzamos munkacsomagok ne ütközzenek:**
- Egy modul-munkacsomag csak a saját `modules/<id>/**` alá ír. A mag fájljaihoz (`apps/**`, `packages/**`) csak az
  1., 2a., 2b., 3. és 8. munkacsomag nyúl, ezek egymással nem futnak párhuzamosan. A 13. és 15. csak a `deploy/**` és a
  `docs/**` alá ír; ha telepítéskor kódjavítás kell, az külön, sorosan futó javítás. Az `e2e/` (közös forgatókönyv) a
  16. munkacsomagé; a munkacsomagok saját Playwright-tesztjei a `modules/<id>/e2e/` alá kerülnek (a mag csomagjaié az
  `apps/web/e2e/` alá), a Playwright-konfiguráció mindegyiket felveszi.
- A felületi szövegek modulonként a `modules/<id>/web/i18n.ts`-ben vannak; a mag összefűzi őket. Központi szótárfájlba
  modul nem ír.
- A tesztadatokat a modul manifestjének `seedE2E` hookja adja; a `pnpm seed:e2e` a mag felhasználóit hozza létre, majd
  sorban meghívja a bekapcsolt modulok hookjait.
- A modulfelfedezés könyvtár-bejárással történik: a szerver induláskor beolvassa a `modules/*/manifest.ts` fájlokat, a
  kliens `import.meta.glob('/modules/*/web/index.ts')`-szel tölti be a modulokat. Központi importlista, menülista vagy
  eseménymegjelenítő-lista nincs; a menüpontot és az idővonal-megjelenítőt a modul manifestje adja.
- Migrációk modulonként (`modules/<id>/migrations/`), a mag migrációi `apps/server/src/core/migrations/`; a futtatási
  sorrend: mag, majd a modulok a manifestben megadott függőségek szerint.
- A `@playwright/test` és a Vitest az 1. munkacsomagban, minden további harmadik féltől származó függőség (`sharp`,
  `pdfmake`, `dexie`, `workbox-*`, `ical-generator`, `ical.js`, `googleapis`, `papaparse`) a 2a. munkacsomagban kerül a
  `pnpm-lock.yaml`-ba, így a modul-munkacsomagok nem módosítják a lockfile-t. Ha mégis új függőség kell, az eltérésként
  jelentendő.

## Konfiguráció (környezeti változók)

| Név | Alapérték | Kötelező | Mire |
| --- | --- | --- | --- |
| `DATABASE_URL` | – | igen | PostgreSQL kapcsolat |
| `SESSION_SECRET` | – | igen | munkamenet-süti aláírása (min. 32 bájt) |
| `PUBLIC_BASE_URL` | `http://localhost:8080` | igen | abszolút linkek, OAuth visszatérési cím |
| `DATA_DIR` | `/data/files` | nem | feltöltött fájlok és bélyegképek |
| `WATCH_ROOT` | `/watch` | nem | figyelt szerver-mappa (csak olvasható mount) |
| `WATCH_INTERVAL_SEC` | `300` | nem | mappabejárás gyakorisága |
| `DERP_MODULES` | `*` | nem | bekapcsolt modulok vesszővel, `*` = mind |
| `DEV_LOGIN` | `0` | nem | `1` esetén `POST /api/dev-login {email}` jelszó nélkül beléptet egy létező felhasználót; `NODE_ENV=production` mellett a szerver nem indul el, ha `1` |
| `GOOGLE_LOGIN_CLIENT_ID` / `_SECRET` | – | élesben igen | belépés (OpenID) |
| `GOOGLE_GMAIL_CLIENT_ID` / `_SECRET` | – | ha `MAIL_SOURCE=gmail` | Gmail readonly |
| `MAIL_SOURCE` | `mock` | nem | `mock` (fixture-ökből) vagy `gmail` |
| `NODE_ENV` | `production` | nem | `test` esetén elérhető a `POST /api/test/watch-file` végpont (fájlt ír a `WATCH_ROOT` alá az e2e-hez); `production`-ben ez a végpont nincs regisztrálva |
| `ICS_TOKEN_PEPPER` | – | ha a `visits` modul aktív | ICS-tokenek hash-eléséhez |
| `TZ_DISPLAY` | `Europe/Budapest` | nem | megjelenítési időzóna |

A kliens a bekapcsolt modulokat és azok menüpontjait a `GET /api/modules` válaszából tudja.

## Döntések

| Döntés | Választás | Miért |
| --- | --- | --- |
| Alap | Saját fejlesztésű moduláris webapp, nem Odoo/ERPNext | A chat, idővonal, levél- és mappafigyelés a kész ERP-kben gyenge; a felhasználó ezt választotta. |
| Nyelv, futtató | TypeScript, Node 22 LTS, pnpm workspace monorepo | Egy nyelv szerveren és kliensen; a meglévő repók is Node/TS-ek. |
| Szerver | Fastify + Zod sémák | Gyors, kis memória, sémából validál. |
| Adatbázis | PostgreSQL 16, Drizzle ORM | A háttérfolyamatok (Gmail-szinkron, mappabejárás, offline sorok feltöltése) és a felhasználók egyszerre írnak; `LISTEN/NOTIFY` hajtja az SSE-t több folyamat között; JSONB-lekérdezés az eseményadatokra; a későbbi AI- és riportmodulok is ezt igénylik. A SQLite egyetlen íróval ezekhez kevés, és a 256 MB-os Postgres a DS220+-on is elfér. |
| Kliens | React + Vite + TS + Tailwind v4 + shadcn/ui, TanStack Query | Egyezik a meglévő stackkel, átvehetők a komponensek. |
| Terepi működés | PWA (Workbox service worker), IndexedDB (Dexie) kimenő sor | Nincs app store; offline fotó/jegyzet/chat. iOS-en nincs Background Sync, ezért szinkron az `online` eseménynél és app-megnyitáskor is. |
| Idempotencia | Minden kliens által létrehozott elem (fotó, jegyzet, felmérés, chat-üzenet) kliensen generált UUID-t kap, a szerver ezzel tárolja (`ON CONFLICT DO NOTHING`); a fotó sha256-hashával együtt megy fel | Újraküldésnél nincs duplikáció. |
| Offline ütközés | Fotó, jegyzet, felmérés, chat hozzáfűzés jellegű; szerkesztésnél verziószám-ellenőrzés, ütközéskor a szerver nyer, a kliens jelzi | Egyszerű és kiszámítható. |
| Élő frissítés | Server-Sent Events, 25 másodpercenkénti `: ping` komment, kliens oldali automatikus újracsatlakozás `Last-Event-ID`-vel | Egyirányú push elég; a Cloudflare kb. 100 s tétlenség után bontaná a kapcsolatot. |
| Fájltárolás | Lemezen, sha256 szerinti útvonalon (`DATA_DIR`), metaadat Postgresben; bélyegkép `sharp`-pal; kliens oldali képtömörítés max. 2560 px hosszú élre. Törléskor csak a metaadat-sor törlődik; a blob akkor törlődik, ha már egy metaadat-sor sem hivatkozik rá | Duplikáció-mentes, a terepi feltöltés kicsi; egy blob több helyen is szerepelhet. |
| Bejelentkezés | Google OpenID Connect (`openid email profile`), csak az adminfelületen felvett e-mail-címek léphetnek be (bármely Google-fiók); szerver oldali munkamenet, 30 nap. Tesztben és fejlesztéskor `DEV_LOGIN` | Céges és személyes Google-fiók is mehet; nincs saját jelszókezelés. |
| Google OAuth-kliensek | Két külön kliens ugyanabban a Google Cloud projektben. **Belépés:** külső (External) típus, Production állapot, csak nem érzékeny scope-ok, így nincs ellenőrzési kötelezettség és nincs 7 napos tokenlejárat. **Gmail:** ha a `dokakft.hu` Google Workspace, belső (Internal) típus; ha nem, külső típus Production állapotban (ellenőrizetlen-alkalmazás figyelmeztetés, legfeljebb 100 felhasználó, nincs 7 napos lejárat). A 14. munkacsomag első lépése ennek megállapítása a felhasználóval | A belépésnek személyes fiókkal is működnie kell, a Gmail-hozzáférést viszont csak az admin köti be néhány céges fiókra. |
| Szerepkörök | `admin` (minden + beállítások), `iroda` (minden projekt), `terepes` (csak a hozzá rendelt projektek és kiszállások, ügyfél-elérhetőséggel) | Elveszett terepi eszköznél kisebb a kitettség; adattakarékosság. |
| Modulrendszer | `modules/<id>/manifest.ts`: azonosító, verzió, függőségek, migrációk, szerver-útvonalak, kliens-útvonalak és menüpontok, eseménytípusok (idővonal-megjelenítővel), jogosultságok. Bekapcsolás `DERP_MODULES`-szal | Új modul a mag módosítása nélkül adható hozzá. |
| Eseménynapló | Egy `events` tábla: azonosító, projekt, típus (`<modul>.<esemény>`), forrás, időpont (UTC), szereplő, rövid cím, JSONB adat, opcionális szülő-esemény; csak hozzáfűzés. Az idővonal ebből olvas | Egy helyen minden; a későbbi automatizmusok erre iratkoznak fel. |
| Idő | Tárolás UTC-ben, megjelenítés `TZ_DISPLAY` szerint; minden forrás (Gmail, fájlrendszer, kliens) importkor normalizálva; a hét hétfőn kezdődik | Vegyes időformátumokból különben hibás sorrend lesz. |
| Ütemezés | Saját kiszállás-tábla; a „Mai kiszállásaim” végpont `GET /api/visits/mine?date=YYYY-MM-DD` (alapból a mai nap `TZ_DISPLAY` szerint); kollégánként titkos tokenes, csak olvasható ICS-feed `GET /api/ics/<token>.ics` | Nem kell Google Naptár írási jog; a dátumparaméter tesztelhetővé teszi. A Google kb. 12–24 óránként frissíti az ICS-t, ez elfogadott. |
| Gmail | `gmail.readonly`, fiókonkénti OAuth (admin köti be a felületen), 90 napos visszamenőleges betöltés, utána 15 percenként `history.list`. Ha a `historyId` elévült (404), teljes újrabetöltés az utolsó ismert levél dátumától; a duplikációt a Gmail `messageId` egyedi kulcs zárja ki. Törzs és csatolmány-metaadat tárolódik, a csatolmány letöltése kérésre | Csak olvasás, nincs kockázat a postafiókra. |
| Szál ↔ projekt | Szabály alapú javaslat (projektkód vagy regex a tárgyban/törzsben, a régi `rules.json` mintájára) + kézi hozzárendelés a „Hozzárendeletlen levelek” listából; egy szál egy projekthez | Kiszámítható; az AI-alapú hozzárendelés későbbi modul. |
| Mappafigyelés | Csak olvasható mount (`WATCH_ROOT`); `WATCH_INTERVAL_SEC` szerinti bejárás (útvonal, méret, mtime; hash csak változáskor); átnevezés = törlés + új, ha a hash egyezik, „átnevezve” eseményként | SMB/NFS-en az inotify megbízhatatlan; a bejárás egyszerű és tesztelhető. |
| Árajánlat PDF | `pdfmake`, szerver oldalon, beépített sablon a cég fejlécével (logó a beállításokban tölthető fel) | Nincs fejléces böngésző a szerveren; kevés memória. |
| Pénz | Forint, egész számokban tárolva; tételenként nettó, ÁFA-kulcsonkénti összesítés, a bruttó kerekítése forintra a végösszegnél | Egyértelmű, tesztelhető. |
| UI nyelv | Magyar, szövegek i18n-kulcsokkal | Felhasználók magyarok. |
| Telepítés | Egyetlen `deploy/compose.yaml`: `app` (szerver + kliens build, korlát 384 MB), `db` (Postgres 16, 256 MB), `backup` (napi `pg_dump`, 14 napos megőrzés, 64 MB). A telepítő szkript minden frissítés előtt `pg_dump`-ot készít, és csak utána futtat migrációt. Külön `e2e` profil: `app-e2e` konténer ugyanabból a képből, `derp_e2e` adatbázissal, `NODE_ENV=test`, `DEV_LOGIN=1`, `MAIL_SOURCE=mock`, írható ideiglenes `WATCH_ROOT`-tal, csak `127.0.0.1`-re kötve; a Tunnel nem mutat rá | Ugyanaz a fájl fut a NAS-on és később a DS220+-on; a migráció nem visszafordítható, ezért előtte mentés. Az e2e a NAS-on sem érinti az éles adatot és a publikus címet. |
| Fejlesztői példány védelme | Cloudflare Tunnel + Cloudflare Access (Google-identitás, 30 napos munkamenet) a `derp.damndot.run` előtt, az app saját belépése mellett; Access „Bypass” szabály csak a `/api/ics/*` útvonalra (a tokenes URL véd) | Fejlesztés alatti kódot ne érjen el bárki; a Google Naptár nem tud Access-be belépni. |
| Tesztek | Vitest (szerver + kliens), Playwright e2e (asztali + Pixel 7, `context.setOffline`); `pnpm seed:e2e` tölti fel a tesztfelhasználókat | A kész-feltétel gépileg ellenőrizhető. |

## Munkacsomagok

Párhuzamosíthatónak csak az van jelölve, ami a fenti fájltulajdonlás szerint diszjunkt fájlokat ír.

| # | Mit | Függ ettől | Párhuzamosítható | Ellenőrzés (parancs vagy lépés) |
| --- | --- | --- | --- | --- |
| 1 | **Váz (próba):** pnpm monorepo a fenti szerkezettel, Vitest és Playwright, `deploy/compose.yaml` (app + db), Dockerfile, migrációs keret, `DEV_LOGIN` + `pnpm seed:e2e` egy admin felhasználóval, projektek CRUD (ügyfél egyelőre szöveges mező), `events` tábla, `GET /api/projects/:id/events`, `GET /api/health`, egyszerű projektlista és projekt-adatlap az eseménylistával | – | – | `pnpm test`; `curl -f localhost:8080/api/health` (compose-on, ha van Docker, különben a dev szerveren); Playwright: dev-login → projekt létrehozása → az adatlapon „Projekt létrehozva” esemény |
| 2a | **Modulkeret:** modulbetöltő és manifest-típus (menüpont, útvonalak, eseménymegjelenítő, `seedE2E`, i18n), `GET /api/modules`, egy `example` minta-modul, SSE-csatorna `LISTEN/NOTIFY`-jal, pingeléssel, `Last-Event-ID`-vel, a többi függőség a lockfile-ba, reszponzív elrendezés és menü, i18n-összefűzés | 1 | – | `pnpm test`; Playwright: a minta-modul menüpontja megjelenik és eltűnik a `DERP_MODULES` szerint; a minta-modul eseménye SSE-n újratöltés nélkül megjelenik |
| 2b | **Felhasználók és jogosultság:** felhasználók és szerepkörök (admin felület), terepes-szűrés minden projekt-végponton, ügyfelek és kapcsolattartók (a szöveges mező kiváltása migrációval), auditnapló (ki, mikor, mit nézett meg vagy módosított), a `seed:e2e` három felhasználóval, Google OIDC belépés megírva (élesítés a 13.-ban), nyilvános adatvédelmi oldal a `/adatvedelem` útvonalon (a Google OAuth-márkaoldal erre hivatkozik; belépés nélkül elérhető) | 2a | – | `pnpm test`; Playwright: terepes felhasználó 403-at kap nem hozzá rendelt projektre; ügyfél + kapcsolattartó felvétele; az auditnaplóban ott a megtekintés |
| 3 | **Idővonal:** összecsukható napi/heti csoportok, típus szerinti csoportosítás és szűrés, „mindet kibont / összecsuk”, eseménytípusonkénti megjelenítő a manifestből (alapértelmezett megjelenítővel), végtelen görgetés, élő frissítés SSE-vel | 2b | 4, 6, 9 | Vitest a csoportosításra (időzóna-határ, nyári időszámítás váltása, hétfői hétkezdés); Playwright: 30 esemény → csoport összecsuk/kibont, szűrő, új esemény újratöltés nélkül megjelenik |
| 4 | **Dokumentumtár** (`docs` modul): feltöltés (több fájl, húzd-és-ejtsd, telefonon kamera), projektmappák, bélyegkép, előnézet, letöltés, törlés jogosultsággal, blob-hivatkozásszámlálás, esemény az idővonalra | 2b | 3, 6, 9 | Vitest: hash-útvonal, duplikáció, blob törlése csak az utolsó hivatkozás után; Playwright: 3 fotó feltöltése → bélyegképek → esemény az eseménylistában |
| 5 | **Jegyzet és felmérés** (`notes` modul): szabad szöveges helyszíni jegyzet; felmérés kötelező mezőkkel (helyszín, észlelt állapot, javasolt munka, becsült anyag tételesen) és csatolt fotókkal (a `docs` modulon át); online űrlap; kliens UUID-val idempotens létrehozás; esemény az idővonalra | 3, 4 | 6, 9 | Vitest: kötelező mezők, ugyanazzal a UUID-val kétszer küldve egy rekord; Playwright: felmérés 2 fotóval → az idővonalon egy csoportban |
| 6 | **Kiszállás-ütemezés** (`visits` modul): kiszállás (projekt, kollégák, kezdés–vége, cím, feladat, állapot), napi/heti nézet kollégánként, ütközésjelzés, `GET /api/visits/mine?date=`, „Mai kiszállásaim” nézet, ICS-feed tokennel (token újragenerálható), esemény az idővonalra | 2b | 3, 4, 5, 7, 9, 11, 12 | Vitest: ütközés, ICS formátum `ical.js`-szel visszaolvasva, érvénytelen token 404; Playwright: kiszállás felvétele → heti nézet és a terepes „Mai kiszállásaim” |
| 7 | **Projekt-chat** (`chat` modul): üzenetek projektenként, fotó/fájl csatolás a `docs` modulon át, @említés, olvasottság, élő frissítés, olvasatlan-jelvény a menüpont manifestjén át, kliens UUID-val idempotens | 3, 4 | 6, 9, 11, 12 | Playwright két böngésző-kontextussal: A ír → B-nél újratöltés nélkül megjelenik; a csatolt fotó a dokumentumtárban is ott van |
| 8 | **Terepi mód (PWA, offline):** manifest és service worker, telepíthetőség, a „Mai kiszállásaim” és a hozzárendelt projektek offline gyorsítótára, IndexedDB kimenő sor fotóra, jegyzetre, felmérésre és chat-üzenetre (a modulok meglévő végpontjaival), sorállapot-jelzés („3 elem vár feltöltésre”), újrapróbálás, 401/átirányítás esetén „újra be kell lépni” jelzés a sor megtartásával, figyelmeztetés szinkronizálatlan elemre | 5, 6, 7 | 9, 10, 11, 12 | Playwright Pixel 7: `setOffline(true)` → 2 fotó + 1 felmérés + 1 chat → `setOffline(false)` → 30 s-on belül mind a szerveren, helyes sorrendben; a sor kétszeri lejátszása sem duplikál; 401 válaszra a sor megmarad |
| 9 | **Cikktörzs** (`catalog` modul): cikkek (cikkszám, megnevezés, egység, nettó egységár, ÁFA-kulcs, beszállító), CSV-import előnézettel és hibasor-jelzéssel, keresés, 3 cikk a `seedE2E` hookban | 2b | 3, 4, 5, 6, 7, 8, 11, 12 | Vitest: CSV-import (magyar ékezetek, vesszős tizedes, hibás sor); Playwright: 3 cikk importja → listában kereshető |
| 10 | **Árajánlat** (`quotes` modul): ajánlatszerkesztő (tételek a cikktörzsből vagy kézzel, mennyiség, kedvezmény, nettó/ÁFA/bruttó, megjegyzés, érvényesség), verziók, PDF, kézi státusz (tervezet / kiküldve / elfogadva / elutasítva), oldalpanelen a projekt idővonala, fotói és felmérései, esemény az idővonalra | 3, 4, 5, 9 | 8, 11, 12 | Vitest: összegzés és kerekítés, ÁFA-kulcsonkénti bontás; a PDF szövegét kinyerve a végösszeg egyezik; Playwright: felmérés mellett ajánlat szerkesztése → PDF letölthető |
| 11 | **Gmail, mock-forrással** (`gmail` modul): `MailSource` interfész, mock-forrás fixture-ökkel, a `classify.js` és tesztjei portolva, szabályszerkesztő, „Hozzárendeletlen levelek” lista, szál ↔ projekt hozzárendelés, levélesemények az idővonalon (kibontva a törzs és a csatolmánylista), `historyId`-elévülés kezelése a mock-forráson szimulálva | 3 | 7, 8, 9, 10, 12 | Vitest: a portolt osztályozó tesztek zöldek; elévült `historyId` → újrabetöltés duplikáció nélkül; Playwright mock-forrással: szál hozzárendelése → megjelenik az idővonalon |
| 12 | **Mappafigyelő** (`watch` modul): figyelt gyökér, projekt ↔ almappa hozzárendelés, ütemezett bejárás és kézi „Most ellenőrizd” gomb, új/módosult/törölt/átnevezett események, fájl letöltése a felületről | 3 | 7, 8, 9, 10, 11 | Vitest ideiglenes könyvtárral (létrehoz, módosít, töröl, átnevez → helyes események); 10 000 fájl bejárása 60 s alatt |
| 13 | **Első NAS-telepítés és Google-belépés:** helyi munkamenetben (a felhasználó gépén) mérés a `nas` skill szerint (szabad hely, RAM, portok, futó appok); datasetek `Tank/derp/{db,files,backup,secrets,watch-test}` (mountok: `/mnt/Tank/derp/...`) (`db` kizárva a snapshotból, mert a `pg_dump` menti; a `secrets` 700/600 és SMB-share nem fedi); Custom App a `deploy/compose.yaml`-lal; `derp.damndot.run` Tunnel + Access + `/api/ics/*` Bypass; a `/mnt/Tank/derp/db` tulajdonosa a Postgres-konténer UID-ja; Access Bypass a `/adatvedelem`-re is; a Google-alkalmazás Production-re állítása (a felhasználó); visszaírás a host-doksikba. Csak `deploy/**` és `docs/**` alá ír | 2b (az 1–2b. állapotával telepít; később bármikor frissíthető) | 3–12 | `curl -f https://derp.damndot.run/api/health` Access-szel; `curl` Access-süti nélkül a `/api/ics/<token>.ics`-re 200; belépés valódi Google-fiókkal; `docker stats --no-stream` < 600 MB; `sudo midclt call replication.query` hibamentes; a host `NAS-allapot.md` §1/§2 és `NAS-naplo.md` frissítve |
| 14 | **Gmail élő bekötése:** a `dokakft.hu` Workspace, ezért belső (Internal) típusú Gmail OAuth-kliens a `derp-512213` projektben (ehhez Workspace-admin jog kell, a felhasználóval ellenőrizni); bekötés az adminfelületen; `GmailSource` (`history.list`, elévülés-kezelés); egy céges fiók 90 napos betöltése a NAS-példányon | 11, 13 | 15 előtt bármikor | Vitest a `GmailSource`-ra rögzített API-válaszokkal; élő próba: egy fiók betöltve, a hozzárendeletlen levelek listája nem üres, egy szál projekthez rendelve az idővonalon |
| 15 | **Végső telepítés és visszaállítási próba:** a teljes 1–14. állapot a NAS-on, `pg_dump` a frissítés előtt; mentés ellenőrzése és visszaállítás egy ideiglenes adatbázisba | 1–14 | – | friss dump a `backup` könyvtárban; `pg_restore` ideiglenes adatbázisba, és a `SELECT count(*) FROM events` egyezik az élővel; host-doksik frissítve |
| 16 | **Végponttól végpontig tartó ellenőrzés:** a lenti forgatókönyv Playwright-tesztként (`pnpm e2e`, az `e2e/` alatt), asztali és Pixel 7 projekttel. Futtatás a helyi compose `e2e` profilján, majd a NAS-on: a felhasználó gépén futó helyi munkamenet elindítja az `e2e` profilt, `ssh -L 8081:127.0.0.1:<app-e2e port>` porttovábbítással `E2E_BASE_URL=http://localhost:8081`-re futtat, utána leállítja a profilt és törli a `derp_e2e` adatbázist | 1–12, 15 | – | `pnpm e2e` zöld mindkét helyen, HTML-riport és képernyőképek mentve; a NAS-on az `app-e2e` konténer a futás után nem fut |

## Végponttól végpontig tartó ellenőrzés

Előfeltétel: az `e2e` compose-profil fut (tiszta `derp_e2e` adatbázis, `NODE_ENV=test`, `DEV_LOGIN=1`,
`MAIL_SOURCE=mock`, írható ideiglenes `WATCH_ROOT`), lefutott a `pnpm seed:e2e` (Iroda Ildi `iroda`, Terepes Tamás
`terepes`, Admin Ádám `admin`, 3 cikk a cikktörzsben). Belépés: `POST /api/dev-login {email}`.

1. Ildi asztali nézetben felvesz egy ügyfelet („Minta Kft.”) és egy projektet („Minta Kft. – légtechnika felmérés”),
   Tamást hozzárendeli, és ütemez egy kiszállást mára, a futás időpontja után 2 órától 2 órára. **Várt:** az idővonalon
   „Projekt létrehozva” és „Kiszállás ütemezve”; Tamás ICS-feedjében ott az esemény.
2. Tamás Pixel 7 nézetben belép; a „Mai kiszállásaim” mutatja a kiszállást. A böngésző offline-ra vált. Tamás 2 fotót
   készít (fájl-bemenet), kitölt egy felmérést, és chatben kérdez: „Melyik gyártmányú legyen a ventilátor?”. **Várt:** a
   felület „3 elem vár feltöltésre” jelzést mutat (a felmérés és fotói egy elemnek számítanak, ha a fotók a felméréshez
   csatoltak; ha külön, akkor a jelzés a tényleges darabszámot mutatja), hibaüzenet nincs.
3. A böngésző online-ra vált. **Várt:** 30 másodpercen belül minden elem a szerveren; Ildi nézetében újratöltés nélkül
   megjelenik a chat-üzenet és a fotók; az idővonalon a felmérés és a fotói egy csoportban, összecsukva és kibontva is
   olvashatóan.
4. Ildi válaszol a chatben; Tamásnál újratöltés nélkül megjelenik.
5. A mock Gmail-forrás egy „Re: Minta Kft. ajánlatkérés” szálat ad; Ildi a „Hozzárendeletlen levelek” listából a
   projekthez rendeli. **Várt:** a levél az idővonalon, kibontva a törzzsel.
6. A teszt a `POST /api/test/watch-file` végponttal egy `arlista_beszallito.pdf` fájlt ír a projekthez rendelt figyelt
   almappába, és megnyomja a „Most ellenőrizd” gombot. **Várt:** „Új fájl a szerveren” esemény, a fájl a felületről letölthető.
7. Ildi árajánlatot készít: az oldalpanelen látja a felmérést és a fotókat, a cikktörzsből három és egy kézi tétellel
   négy sort vesz fel, majd PDF-et kér. **Várt:** a PDF letölthető, a végösszeg egyezik a tételek összegével, az ajánlat
   „Tervezet” státuszban az idővonalon.
8. Tamás egy nem hozzá rendelt projekt URL-jét nyitja meg. **Várt:** „Nincs jogosultság”, az API 403-at ad.

## Kockázatok és jóváhagyást igénylő lépések

**Kockázatok:**
- iOS Safari PWA: nincs Background Sync, és a tárhely hosszabb inaktivitás után törölhető. Kezelés: szinkron
  app-megnyitáskor, figyelmeztetés szinkronizálatlan elemre.
- A Cloudflare Access ma csak a felhasználót engedi be. Mielőtt kollégák (terepen is) használnák a fejlesztői példányt, a
  Cloudflare-fiókba Google-identitásszolgáltató vagy e-mailes egyszeri kód kell, és az Access-szabályt bővíteni kell
  (a felhasználó lépése, helyi szálban).
- Cloudflare Access munkamenet lejárta terepen, offline sorral: a kliens a sort megtartja és belépést kér (8.).
- DS220+ 2 GB RAM: a memóriakorlátok ehhez vannak szabva; az éles telepítés előtt ajánlott a 6 GB-ra bővítés.
- Ha a `dokakft.hu` nem Workspace, a Gmail-bekötéskor „ellenőrizetlen alkalmazás” figyelmeztetés jelenik meg; ez
  elfogadott, mert csak az admin köti be.
- Custom App-nál nincs Roll Back: a visszaállás a verziókövetett `compose.yaml` + képcímke + a frissítés előtti
  `pg_dump`.
- Visszafordíthatatlan: az adatbázis-migráció adatokkal teli példányon, és a blobok fizikai törlése. Mindkettő előtt
  automatikus `pg_dump`, illetve a blob csak az utolsó hivatkozás törlése után törlődik.

**Jóváhagyást igénylő lépések (a felhasználó igenje nélkül nem történnek meg):**
- A `damndotrun/derp` privát repó létrehozása (a felhasználó hozza létre).
- Bármilyen módosítás a plasticgarden NAS-on (datasetek, Custom App, mountok), csak helyi munkamenetben.
- A `derp.damndot.run` hostname, a Cloudflare Access szabály és a Bypass szabály létrehozása (a felhasználó végzi).
- Google Cloud OAuth-kliensek létrehozása és élő Gmail-fiók bekötése.
- Valós céges adatok (ügyfelek, levelek, szerver-mappák) betöltése a fejlesztői példányba.
- Pull requestek merge-e a `main` ágra.

## Nyitott kérdések

(nincs)

## Változásnapló

- v1 2026-10-20: első változat
- v2 2026-10-20: spec-review alapján: az 1. munkacsomag kisebb (próba), a mag külön 2. csomag; a felmérés önálló
  modul; fájltulajdonlási és modulfelfedezési szabály, a párhuzamosítás ehhez igazítva; konfigurációs tábla; két
  OAuth-kliens döntése; idempotencia, SSE-ping, blob-hivatkozásszámlálás, `historyId`-elévülés; ICS Access-Bypass;
  e2e seed és dátumkezelés; visszaállítási próba; a 7., 8., 10. csomag szétbontva; Postgres indoklása.
- v3 2026-10-20: spec-review 2. köre alapján: a NAS-on az e2e külön `e2e` compose-profilon, külön adatbázissal,
  porttovábbítással fut; `MAIL_SOURCE` és teszt-végpont a figyelt mappához; a mag 2a/2b-re bontva; i18n, seed és
  e2e-tesztek fájltulajdonlása; a 13. csak `deploy/**` alá ír.
- v4 2026-10-20: jóváhagyva. A repó (`damndotrun/derp`) létrejött; a NAS-olvasás felhős munkamenetből a `nas` skill
  HTTPS-végpontján át is mehet, minden írás és a Cloudflare/Google-beállítás helyi munkamenetben.
- v5 2026-10-20: az 1. munkacsomag (próba) jelentése alapján a Kontextusba kerültek az ott hozott megoldások és a
  Docker Hub tükör.
- v6 2026-10-20: a NAS- és Cloudflare-előkészítés eredménye: datasetek a `Tank/derp` alatt, portok 30080/30081, Access
  egyelőre csak a felhasználónak, `dokakft.hu` Workspace (Gmail: belső kliens), nyilvános `/adatvedelem` oldal (2b),
  Postgres-UID és Google Production a 13. második felében.
