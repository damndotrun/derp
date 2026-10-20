# Kiszállás-ütemezés (`visits` modul)

Kiszállások projekthez és kollégákhoz rendelve, napi/heti nézet kollégánként, ütközésjelzés, „Mai kiszállásaim” a
telefonon, kollégánkénti csak olvasható ICS-feed a Google Naptárnak, események az idővonalra. A terepi mód (8.) a
„Mai kiszállásaim” végpontot gyorsítótárazza.

## Adatok

- `visits_visit`: projekt, kezdés–vége (UTC, `ends_at > starts_at`), cím, feladat, állapot, verzió, törlés rejtéssel
  (`deleted_at`). Állapot: `utemezett` (alap), `folyamatban`, `kesz`, `elmaradt`.
- `visits_assignee`: a beosztott kollégák (legalább egy).
- `visits_ics_token`: kollégánként egy token **hash-e** (HMAC-SHA256 az `ICS_TOKEN_PEPPER`-rel); maga a token csak a
  létrehozó válaszban látszik. Újrageneráláskor a régi link azonnal megszűnik.
- Időzóna: a „mai nap”, a napi/heti nézet határai és az űrlap időpontjai a `TZ_DISPLAY` szerint értendők
  (`shared/time.ts`, szerveren és kliensen ugyanaz), a hét hétfőn kezdődik.

## Szabályok

- **Ütközés:** ugyanannak a kollégának két, időben átfedő kiszállása (az egymásba érő vég és kezdet nem az). A
  törölt, a törölt projekten lévő és az `elmaradt` kiszállás nem ütközik. Csak jelzés: a mentést nem akadályozza. A
  válasz minden kiszállásnál `conflicts` listát ad (ki, melyik másik kiszállás, mikor); a kérdező által nem látható
  projekt neve helyett `null`.
- **Beosztás:** aktív felhasználó lehet; a terepes csak akkor, ha a projekthez hozzá van rendelve (különben 400 „Előbb a
  projekthez kell rendelni: …”), mert különben a kiszállást sem látná. Az irodai kolléga hozzárendelés nélkül is.
- **Láthatóság:** az iroda és az admin mindent lát; a terepes csak a saját (beosztott) kiszállásait, a hozzá rendelt
  projekteken. Ugyanez érvényes a „Mai kiszállásaim”-ra és az ICS-feedre.

## Végpontok

| Végpont | Mire | Jogosultság |
| --- | --- | --- |
| `GET /api/visits?from=&to=&userId=` | a `[from, to)` időszakkal átfedő kiszállások (ISO időpontok, max. 62 nap), opcionálisan egy kollégáé | belépve (terepes: a sajátjai) |
| `GET /api/visits/mine?date=YYYY-MM-DD` | `{ date, items }`: a bejelentkezett kolléga kiszállásai a helyi napon (alap: ma, `TZ_DISPLAY`) | belépve |
| `GET /api/visits/:id` | egy kiszállás; nem látható projektre vagy más terepes kiszállására 403 | belépve |
| `POST /api/visits` `{projectId, assigneeIds, startsAt, endsAt, address?, task?, status?}` | új kiszállás (201), esemény: `visits.scheduled` | `visits.manage` (admin, iroda) |
| `PATCH /api/visits/:id` `{version, assigneeIds?, startsAt?, endsAt?, address?, task?, status?}` | módosítás; eltérő verzió 409; esemény: `visits.updated` (`data.changed`) | `visits.manage` |
| `DELETE /api/visits/:id` | törlés (rejtés); esemény: `visits.cancelled` | `visits.manage` |
| `GET /api/visits/ics-token` | `{ exists, createdAt }` a saját feedről | belépve |
| `POST /api/visits/ics-token` | új saját ICS-link (201, `{ url, createdAt }`), a régi megszűnik | belépve |
| `GET /api/ics/<token>.ics` | a kolléga feedje (`text/calendar`), belépés nélkül; ismeretlen, régi vagy formailag hibás tokenre és kikapcsolt felhasználóra 404 | token |

Az ICS-feed a kolléga elmúlt 90 napban kezdődött és jövőbeli kiszállásait adja; `UID` = `<kiszállás-id>@derp`,
`SEQUENCE` = verzió, `SUMMARY` = „Kiszállás: <projekt>”, `LOCATION` = cím, a leírásban a feladat, a kollégák, az
állapot, az ügyfél és a projekt linkje; az `elmaradt` kiszállás `STATUS:CANCELLED`. A Cloudflare Access Bypass a
`/api/ics/*`-ra vonatkozik.

## Események (idővonal)

`visits.scheduled` („Kiszállás ütemezve”), `visits.updated` („Kiszállás módosítva”), `visits.cancelled` („Kiszállás
törölve”); `data`: `visitId`, `startsAt`, `endsAt`, `address`, `task`, `status`, `assignees` (`[{id, name}]`), módosításnál
`changed`. A megjelenítő a napot, az időtartamot, a kollégákat, a címet és a feladatot mutatja.

## Felület

- `/visits/schedule` „Kiszállások”: napi/heti nézet (asztalon táblázat kollégánként, telefonon naponkénti lista),
  kollégaszűrő, az irodának új kiszállás űrlapja és kattintásra szerkesztés/törlés, a saját ICS-link kezelése.
- `/visits/mine` „Mai kiszállásaim”: a nap kiszállásai kártyákon (`?date=` és lapozás más napra). Terepi mód (8.): a
  `GET /api/visits/mine` a modul `offlineUrls`-a, így a terepesnél belépéskor előtöltődik és térerő nélkül is látszik.
- Az élő frissítés a `visits.*` és a hozzárendelés-eseményekre újratölti a nézeteket.

## Konfiguráció

`ICS_TOKEN_PEPPER` (min. 32 bájt): `NODE_ENV=production` mellett kötelező, ha a modul aktív (különben a szerver nem
indul el); tesztben és fejlesztéskor hiányában rögzített fejlesztői érték. Cseréje minden kiadott naptár-linket
érvénytelenít.
