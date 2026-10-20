# Gmail (`gmail` modul)

Bekötött levélfiókok csak olvasható betöltése, a levélszálak projekthez rendelése (szabály alapú javaslattal és
kézzel, a „Hozzárendeletlen levelek” listából), a hozzárendelt szálak levelei az idővonalon. A 11. munkacsomag
mock-forrással készült (`MAIL_SOURCE=mock`); az élő Gmail-forrás (`GmailSource`, OAuth-bekötés, csatolmány letöltése)
a 14. munkacsomagban jön ugyanerre a felületre. Nincs függősége.

## Levélforrás (`server/source.ts`)

```ts
interface MailSource {
  kind: 'mock' | 'gmail';
  currentHistoryId(account): Promise<string>;                    // users.getProfile
  listMessageIds(account, after: Date): Promise<string[]>;       // users.messages.list q=after:
  getMessage(account, id): Promise<MailMessage | null>;          // users.messages.get
  listHistory(account, startHistoryId): Promise<{ messageIds, historyId }>;  // users.history.list (messageAdded)
}
```

- `MailMessage`: Gmail-azonosító, szál-azonosító, RFC 822 `Message-ID`, dátum (ISO, UTC), `From` fejléc, címzettek,
  másolat, tárgy, kivonat, címkék, szöveges és HTML-törzs, csatolmány-metaadat (`name`, `mimeType`, `size`,
  `attachmentId`).
- Elévült `historyId`-nál (a Gmail `history.list` 404-et ad) a forrás `HistoryExpiredError`-t dob.
- `MAIL_SOURCE`: `mock` (alapérték) vagy `gmail`. A `gmail` értékkel a szerver ma nem indul el (a forrás a 14.
  munkacsomagban készül); ismeretlen értékkel sem.
- Mock (`server/mock-source.ts`): minden bekötött fiók a `server/fixtures/mock-mailbox.json` postafiókját látja
  (kitalált szereplők; köztük a közös forgatókönyv „Re: Minta Kft. ajánlatkérés” szála). Az időpontok a folyamat
  indulásához képest (`minutesAgo`), így a 90 napos ablakba esnek. A `historyId` időalapú és csak nő, így a szerver
  újraindítása után sem marad ki levél. Tesztben `deliver()` (új levél) és `expireHistory()` (elévülés).

## Betöltés (`server/sync.ts`)

- Első alkalommal 90 napra visszamenőleg (`currentHistoryId`, majd `listMessageIds`); utána a tárolt `historyId`
  óta érkezett levelek (`listHistory`). Elévült `historyId`-nál teljes újrabetöltés az utolsó ismert levél dátumától
  (egy óra átfedéssel). A duplikációt a `(fiók, Gmail-azonosító)` egyedi kulcs zárja ki; a már tárolt levelet le sem
  kéri.
- Ütemezés: induláskor (5 s múlva), majd 15 percenként minden fiók; a betöltések sorban futnak. `NODE_ENV=test`
  mellett nincs ütemezés (seed, kézi gomb, teszt-végpont).
- Osztályozás (`server/classify.ts`, a régi `classify.js` portja): irány (SENT címke vagy saját domain = kimenő; a
  saját domainek a bekötött fiókok domainjei, a `gmail.com` kivételével), levéltípus (`order`, `quote_in`, `rfq_out`,
  `client_rfq`, `msg`), a szál státusza (`deriveStatus`) és határidő-jelzés (`hasDeadline`).
- Ha a levél szála már projekthez tartozik, a levél azonnal az idővonalra kerül.

## Tárolás

- `gmail_accounts`: e-mail-cím (kis- és nagybetűtől függetlenül egyedi), forrás (`mock`/`gmail`), `history_id`,
  utolsó betöltés ideje és hibája.
- `gmail_threads`: fiók + Gmail-szálazonosító (egyedi), tárgy (az első levélé), első/utolsó levél ideje, `project_id`
  (egy szál egy projekthez), ki és mikor rendelte hozzá, `dismissed_at`/`dismissed_by` (elvetve, pl. hírlevél).
- `gmail_messages`: fiók + Gmail-azonosító (egyedi), szál, fejlécek, kivonat, szöveges és HTML-törzs, csatolmány-
  metaadat, irány, levéltípus, `event_id` (a `gmail.message` esemény).
- `gmail_rules`: kifejezés (kis- és nagybetűtől független reguláris kifejezés, projektkód vagy kulcsszó is lehet),
  projekt, sorrend.

## Végpontok

| Végpont | Mire | Jogosultság |
| --- | --- | --- |
| `GET /api/gmail/threads?limit=&offset=&view=open\|dismissed` | „Hozzárendeletlen levelek” (`view=dismissed`: az elvetettek): státusz, határidő, résztvevők, kivonat, csatolmányszám, javaslat (az első illeszkedő szabály projektje) | `gmail.assign` (admin, iroda) |
| `GET /api/gmail/threads/:id` | a szál levelei törzzsel (auditnapló: `view`) | hozzárendeletlen szálnál `gmail.assign`, különben aki a projektet látja |
| `PUT /api/gmail/threads/:id/project` `{ projectId }` | hozzárendelés: a levelek eseményként az idővonalra, az elvetés megszűnik; ha a szál már másik projekté, áthelyezés (a régi idővonalra `gmail.thread_moved`, a levelek az újra); ugyanahhoz újra nem változik (auditnapló: `update`) | `gmail.assign` és a projekt látható |
| `PUT /api/gmail/threads/:id/dismissed` `{ dismissed }` | hozzárendeletlen szál elvetése vagy visszaállítása; projekthez rendelt szálnál 409. Az elvetett szál új levele nem hozza vissza | `gmail.assign` |
| `GET /api/gmail/messages/:id` | egy levél törzzsel és csatolmánylistával (auditnapló: `view`) | mint a szálnál |
| `POST /api/gmail/sync` | kézi betöltés minden fiókra | `gmail.assign` |
| `GET/POST /api/gmail/rules`, `PATCH/DELETE /api/gmail/rules/:id` | szabályok; a `PATCH` `position`-nel (0-tól) átrendez | `gmail.rules` (admin, iroda) |
| `GET/POST /api/gmail/accounts` | bekötött fiókok; mock-forrásnál a felvétel azonnal betölt, élő forrásnál 400 (14.) | `gmail.accounts` (admin) |
| `POST /api/gmail/test/deliver` | csak `NODE_ENV=test` és mock mellett: új levél a mock-postafiókba, majd betöltés | belépve |

A terepes a levelek oldalait nem látja; a projekthez rendelt szál leveleit csak a hozzárendelt projektjében
(`ctx.requireProject`), az idővonalon és a levél megnyitásakor.

## Események

- `gmail.message` („Levél: <tárgy>”), `source: 'gmail'`, az időpont a levél dátuma; `data`: `{ messageId, threadId,
  from, to, cc, direction, kind, snippet, attachments: [{ name, mimeType, size }] }`. A törzs nincs az eseményben:
  a megjelenítő kibontáskor kéri le (`GET /api/gmail/messages/:id`).
- `gmail.thread_moved` („Levélszál áthelyezve másik projektbe: <tárgy>”), a régi projekt idővonalán; `data`:
  `{ threadId, subject, toProjectId, messages }`. Az események csak hozzáfűzhetők, ezért a régi `gmail.message`
  események megmaradnak; megnyitáskor a levél már az új projekt szerint látható, és a megjelenítő jelzi, hogy a szál
  azóta másik projekthez tartozik.

## Felület

`/gmail` (Hozzárendeletlen levelek: szálak státusszal, határidővel, javaslattal, levelek megtekintése, projekt
választása és „Hozzárendelés”, „Elvetés”; „Elvetett” nézet „Visszaállítás”-sal; „Betöltés most”), `/gmail/rules` (szabályszerkesztő), `/gmail/accounts` (admin:
bekötött fiókok). Menüpont: „Levelek” (admin, iroda). Az idővonalon a levél iránya, partnere, típusa és kivonata;
„Levél megnyitása” után a törzs és a csatolmánylista, az irodának „Áthelyezés másik projektbe” (új projekt + „Áthelyezés”).

## Tesztadat

A `seedE2E` egy mock-fiókot köt be (`levelek@derp.test`), és betölti a fixture-postafiókot.
