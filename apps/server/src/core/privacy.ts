import type { FastifyInstance } from 'fastify';

// Nyilvános adatvédelmi tájékoztató (`/adatvedelem`). A Google OAuth-márkaoldal erre hivatkozik, ezért belépés
// nélkül és a kliens buildje nélkül is elérhető: önálló HTML, külső erőforrás nélkül (a Cloudflare Access Bypass csak
// erre az útvonalra szól, a kliens fájljaira nem).

export const PRIVACY_PATH = '/adatvedelem';

const html = `<!doctype html>
<html lang="hu">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Adatvédelmi tájékoztató · dERP</title>
<style>
  :root { color-scheme: light dark; --fg: #1a1a1a; --muted: #555; --bg: #fff; --line: #ddd; }
  @media (prefers-color-scheme: dark) { :root { --fg: #eee; --muted: #aaa; --bg: #121212; --line: #333; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 46rem; margin: 0 auto; padding: 2rem 1rem 4rem; }
  h1 { font-size: 1.75rem; line-height: 1.25; margin: 0 0 .25rem; }
  h2 { font-size: 1.15rem; margin: 2rem 0 .5rem; padding-top: 1rem; border-top: 1px solid var(--line); }
  p.meta { color: var(--muted); margin: 0 0 1.5rem; }
  ul { padding-left: 1.25rem; }
  a { color: inherit; }
</style>
</head>
<body>
<main>
<h1>Adatvédelmi tájékoztató</h1>
<p class="meta">dERP – a Dóka Kft. belső ügyviteli rendszere · Hatályos: 2026. október 20.</p>

<h2>Az adatkezelő</h2>
<p>Dóka Kft., Kecskemét. A dERP a cég belső ügyviteli rendszere: a projekteket az első bejelentéstől a lezárásig
kezeli, irodai gépen és a terepen használt telefonokon. Csak a cég által felvett felhasználók léphetnek be.</p>

<h2>Belépés Google-fiókkal</h2>
<p>A belépés a Google OpenID Connect szolgáltatásával történik (<code>openid email profile</code> hatókör). A Google
által visszaadott adatokból csak az e-mail-címet használjuk annak ellenőrzésére, hogy a cím szerepel-e a rendszerben
felvett felhasználók között; a Google-fiók más adatát nem tároljuk, és a Google-fiókhoz nem kérünk további
hozzáférést. Belépés után egy munkamenet-süti (<code>derp_session</code>) azonosítja a böngészőt legfeljebb 30 napig;
a belépés közben egy legfeljebb 10 percig élő technikai süti (<code>derp_oidc</code>) védi a folyamatot. Követő vagy
hirdetési sütit nem használunk.</p>

<h2>Milyen adatokat kezelünk</h2>
<ul>
  <li><strong>Felhasználók:</strong> név, e-mail-cím, szerepkör (admin, iroda, terepes), a projekt-hozzárendelések.</li>
  <li><strong>Ügyfelek és kapcsolattartók:</strong> az ügyfél neve, címe, megjegyzés; a kapcsolattartó neve,
    beosztása, telefonszáma, e-mail-címe.</li>
  <li><strong>Projektadatok:</strong> projektek, események, fotók és fájlok, helyszíni jegyzetek és felmérések,
    projekt-chat üzenetek, kiszállások, árajánlatok.</li>
  <li><strong>Auditnapló:</strong> ki, mikor, mit nézett meg vagy módosított a rendszerben (pl. melyik projektet vagy
    ügyfél-adatlapot nyitotta meg), valamint a belépések ideje.</li>
</ul>

<h2>Céges Gmail-fiókok</h2>
<p>A rendszer adminisztrátora céges Gmail-fiókokat köthet be csak olvasható hozzáféréssel
(<code>gmail.readonly</code>), hogy a levélszálak a megfelelő projekthez rendelve megjelenjenek a projekt
idővonalán. A rendszer levelet nem küld, nem töröl és nem módosít. A Google API-kon keresztül kapott adatokat
kizárólag erre a célra használjuk, harmadik félnek nem adjuk át, hirdetésre nem használjuk, és a Google API Services
User Data Policy előírásait – a „Limited Use” követelményeket is – betartjuk.</p>

<h2>Az adatkezelés célja és jogalapja</h2>
<p>Az adatokat a cég ügyviteli feladatainak ellátásához (projektek, ügyfélkapcsolatok, kiszállások, ajánlatok
kezelése) kezeljük, a cég jogos érdeke és az ügyfelekkel kötött szerződések teljesítése alapján. Az auditnapló a
személyes adatokhoz való hozzáférés ellenőrizhetőségét és az adatbiztonságot szolgálja.</p>

<h2>Tárolás és hozzáférés</h2>
<p>Az adatokat a cég saját üzemeltetésű szerverén tároljuk. A rendszer internetes elérését a Cloudflare
szolgáltatása (Cloudflare Tunnel és Access) védi. Az adatokhoz csak a belépett felhasználók férnek hozzá a
szerepkörük szerint: a terepen dolgozó kollégák csak a hozzájuk rendelt projekteket és azok ügyfeleinek
elérhetőségét látják. Az adatokat csak addig őrizzük, amíg az ügyviteli célhoz vagy jogszabályi kötelezettség
teljesítéséhez szükséges.</p>

<h2>Az érintettek jogai</h2>
<p>Az érintett kérheti a róla kezelt adatokhoz való hozzáférést, azok helyesbítését, törlését vagy kezelésük
korlátozását, és tiltakozhat az adatkezelés ellen; kérelmét a Dóka Kft.-hez intézheti. Panasszal a Nemzeti
Adatvédelmi és Információszabadság Hatósághoz (NAIH, <a href="https://naih.hu">naih.hu</a>) fordulhat.</p>
</main>
</body>
</html>
`;

export async function privacyRoutes(app: FastifyInstance): Promise<void> {
  app.get(PRIVACY_PATH, async (_req, reply) =>
    reply.type('text/html; charset=utf-8').header('cache-control', 'public, max-age=3600').send(html),
  );
}
