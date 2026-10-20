# dERP

A Dóka Kft. moduláris ügyviteli rendszere: ügyfelek, projektek, idővonal, projekt-chat, dokumentumtár,
kiszállás-ütemezés, árajánlat, Gmail- és mappafigyelés, terepen offline is.

Az 1. fázis specifikációja: [`specs/derp/SPEC.md`](specs/derp/SPEC.md).

## Fejlesztés

Előfeltétel: Node 22.18+ (a szerver TypeScriptje fordítás nélkül, a Node beépített típuslehántásával fut), pnpm 10
(`corepack enable`), PostgreSQL 16 (Dockerrel: `pnpm db:up`).

```sh
pnpm install
pnpm db:up                                   # Postgres 16 konténer a 127.0.0.1:5432-n
export DATABASE_URL=postgres://derp:derp@localhost:5432/derp
pnpm seed:e2e                                # migráció + admin@derp.test (Admin Ádám)
SESSION_SECRET=$(openssl rand -base64 48) NODE_ENV=development DEV_LOGIN=1 pnpm dev
# kliens: http://localhost:5173 (az /api a 8080-as szerverre megy)
```

| Parancs | Mit csinál |
| --- | --- |
| `pnpm test` | Vitest: közös sémák, szerver (ideiglenes adatbázisban a `DATABASE_URL` szerverén), kliens |
| `pnpm typecheck` | TypeScript-ellenőrzés minden csomagban |
| `pnpm e2e` | Playwright (asztali 1440×900 és Pixel 7). `E2E_BASE_URL` nélkül maga indít szervert a `DATABASE_URL`-re `NODE_ENV=test`, `DEV_LOGIN=1` mellett; előre telepített Chromiumhoz `PLAYWRIGHT_CHROMIUM_EXECUTABLE` |
| `pnpm migrate` | a még nem futott migrációk: a mag (`apps/server/src/core/migrations/`), majd a bekapcsolt modulok (`modules/<id>/migrations/`) |
| `pnpm seed:e2e` | migráció + tesztfelhasználók + a bekapcsolt modulok `seedE2E` hookjai |

Az `E2E_BASE_URL` nélküli `pnpm e2e` két szervert indít: a 8080-ason minden modul be van kapcsolva, a 8082-esen
egyik sem (`DERP_MODULES=` üres; a modulmenü eltűnésének ellenőrzéséhez). Külső futtatásnál a modulok nélküli
példány címe `E2E_NO_MODULES_BASE_URL`; ha nincs megadva, az a teszt kimarad.

## Modulok

A modulok a [`modules/`](modules/) alatt vannak; a felépítésük és a mag felé nyújtott felület a
[`modules/README.md`](modules/README.md)-ben. Bekapcsolásuk a `DERP_MODULES` környezeti változóval megy (`*` = mind,
alapérték). Az élő frissítés a `GET /api/stream` SSE-folyamon jön (`LISTEN/NOTIFY`, 25 mp-es ping, `Last-Event-ID`).

## Telepítés (compose)

```sh
cp deploy/.env.example deploy/.env           # POSTGRES_PASSWORD, SESSION_SECRET kitöltése
docker compose -f deploy/compose.yaml up -d --build
curl -f localhost:8080/api/health
```

Az app konténer indításkor lefuttatja a migrációkat, majd elindítja a szervert.
