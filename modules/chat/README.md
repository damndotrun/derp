# Projekt-chat (`chat` modul)

Projektenként egy üzenetszál: szöveg, fotó/fájl csatolás (a `docs` modulon át), @említés, olvasottság, élő
frissülés, olvasatlan-jelvény a menüben és a projekt-adatlap „Chat” linkjén. Függ: `docs`.

## Tárolás

- `chat_messages`: az azonosító a kliens UUID-ja (újraküldve nem duplikál); `seq` a szerverre érkezés sorszáma (a
  szálon belüli sorrend és az olvasottság mértéke); `mentions` (felhasználó-azonosítók), `attachments`
  (`[{ id, name }]`, a `docs_files.id` előre kiosztva), `event_id` (a `chat.message_posted` esemény).
- `chat_reads`: felhasználónként és projektenként az utolsó olvasott `seq` (csak nő).

## Végpontok

| Végpont | Mire | Jogosultság |
| --- | --- | --- |
| `GET /api/chat/projects/:projectId/messages?before=&limit=` | üzenetek `seq` szerint növekvő sorrendben, lapozva (`MessagePage`: `nextBefore`, saját `lastReadSeq`, a többiek olvasottsága `reads`) | a projektet látja |
| `PUT /api/chat/projects/:projectId/messages/:messageId` `{ body, attachments?, capturedAt? }` | új üzenet (a `capturedAt` a terepi időpont, a `createdAt`-be kerül; a `seq` a beérkezés sorrendje): 201; ugyanazzal az azonosítóval és tartalommal 200 (ugyanaz az üzenet); más tartalom, szerző vagy projekt 409; másik projekt fájlja csatolmányként 400 | `chat.post` (minden szerepkör) |
| `PUT /api/chat/projects/:projectId/read` `{ seq }` | olvasott eddig (csak előre, legfeljebb a projekt utolsó üzenetéig) | a projektet látja |
| `GET /api/chat/projects/:projectId/people` | akik említhetők (aktív irodai felhasználók és a projekthez rendeltek) | a projektet látja |
| `GET /api/chat/unread` | olvasatlan üzenetek a látható, nem törölt projektekben (`total`, `mentions`, projektenként `unread`, `mentions`, `lastMessageAt`); a saját üzenet nem számít | belépve |

A terepes a nem hozzá rendelt projektre mindenhol 403-at kap (`ctx.requireProject`), az összesítőben csak a hozzá
rendelt projektek vannak (`ctx.visibleProjectIds`).

## @említés

`@` + a teljes név (kis- és nagybetűtől függetlenül), szó elején; a név után nem állhat betű vagy szám. Csak az
említhető, aki a projektet látja; több illeszkedő névből a leghosszabb nyer (`server/mentions.ts`). A felületen az `@`
után a projektet látók közül lehet választani; a megemlített név kiemelve látszik, és az összesítő külön számolja.

## Események

- `chat.message_posted` („Chat-üzenet: …”), `data`: `{ messageId, body, mentions, attachments }` (a csatolmányok
  száma).
- A csatolmány a dokumentumtár „Chat” mappájába kerül (a projekt gyökerében; ha nincs, a kliens létrehozza), a
  `docs.file_uploaded` esemény `parentId`-je az üzenet eseménye, így az idővonalon az üzenet alatt látszik.
- Az üzenet csatolmánya `pending`, amíg a fájl nincs feltöltve, `deleted`, ha a dokumentumtárból törölték.

## Más modulokból (8. offline sor)

`modules/chat/web/send.ts`:
- `prepareMessage(projectId, body, files)` → `PreparedMessage` (üzenet- és fájlazonosítók, kicsinyített képek; a
  `blob`-ok miatt IndexedDB-be tehető);
- `sendMessage(prepared)`: előbb az üzenet (idempotens `PUT`), utána a csatolmányok a „Chat” mappába, az üzenet
  eseménye alá. Megszakadás után ugyanazzal a `PreparedMessage`-dzsel újrahívható, nem duplikál.
- Elemfajta: `chat.message`; a chat írómezője ezen át küld, a sorban várakozó üzenet „feltöltésre vár” jelöléssel a
  lista végén látszik.

## Felület

`/chat` (projektek olvasatlan-jelvénnyel, a legutóbb aktív elöl), `/chat/:projectId` (a projekt chatje). A mag
projekt-adatlapja a `projectLinks`, a menü a `menuBadges` horgonyon át mutatja a „Chat” linket és a jelvényt.
