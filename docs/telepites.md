# Telepítés a plasticgarden NAS-ra (fejlesztői példány)

A NAS-on a dERP TrueNAS **Custom App** („derp”), a `deploy/compose.nas.yaml` alapján. A host-oldali tények
(datasetek, portok, Cloudflare) kánoni helye az `infra/host` repó `NAS-allapot.md` fájlja; itt a telepítés menete van.

| Mi | Hol |
|---|---|
| Cím | `https://derp.damndot.run` — Cloudflare Tunnel → `192.168.1.63:30080`; Access „Only me”, Bypass a `/api/ics/*` és az `/adatvedelem` útvonalra |
| Kép | `derp-app:<YYYYmmdd-HHMMSS>` és `derp-app:latest`, a NAS-on építve |
| Adatbázis | `/mnt/Tank/derp/db` (tulajdonos UID 70 = postgres az alpine képben), kizárva a napi snapshotból |
| Fájlok | `/mnt/Tank/derp/files` → `/data/files` (UID 1000 = node) |
| Mentés | `/mnt/Tank/derp/backup/derp-<címke>-frissites-elott.dump` (`pg_dump -Fc`, minden frissítés előtt) |
| Titkok | `/mnt/Tank/derp/secrets/.env` és `db.env` (700/600 root, egyik SMB-share sem fedi) |

⚠️ Custom Appnál **nincs Roll Back**. A visszaállás a korábbi képcímke és a dump (lent).

## Frissítés (minden munkacsomag után)

A fejlesztői gépen, a repó gyökeréből, a beolvasztott `main`-en:

```bash
git -c core.autocrlf=false archive --format=tar.gz -o derp.tgz HEAD
scp derp.tgz deploy/nas-telepites.sh nas-ts:/tmp/
ssh nas-ts 'sudo bash /tmp/nas-telepites.sh /tmp/derp.tgz'
```

A szkript: kicsomagol → képet épít → `pg_dump` a `backup` alá → `app.update` + `app.redeploy` → megvárja a
`/api/health`-et. A migrációt az app indulása futtatja. Ha a `compose.nas.yaml` nem változott, ugyanez a parancs.

## Első telepítés (egyszer, már megtörtént 2026-10-20)

1. A titkok a NAS-on (az értékek nem kerülnek ki a gépről):
   - `secrets/.env`: `DATABASE_URL=postgres://derp:<jelszó>@db:5432/derp`, `SESSION_SECRET=<≥32 bájt>`,
     `GOOGLE_LOGIN_CLIENT_ID`, `GOOGLE_LOGIN_CLIENT_SECRET` (Google Cloud projekt `derp-512213`, kliens „dERP login”).
   - `secrets/db.env`: `POSTGRES_PASSWORD=<ugyanaz a jelszó>`.
2. `chown 70:70 /mnt/Tank/derp/db`, `chown 1000:1000 /mnt/Tank/derp/files`.
3. A fenti frissítési parancs (`app.create`, mert még nincs app).
4. Az első admin (a felületen csak admin vehet fel felhasználót):
   ```bash
   ssh nas-ts "sudo docker exec ix-derp-db-1 psql -U derp -d derp -c \"INSERT INTO users (email, name, role) VALUES ('signingkd@gmail.com', 'Karesz', 'admin')\""
   ```

## Visszaállás

- **Korábbi kód:** `ssh nas-ts 'sudo docker images derp-app'`, majd
  `ssh nas-ts 'sudo docker tag derp-app:<régi címke> derp-app:latest && sudo midclt call -j app.redeploy derp'`.
  Ha a régebbi kód migrációja visszafelé nem kompatibilis, az adatbázist is vissza kell állítani.
- **Adatbázis a dumpból:**
  ```bash
  ssh nas-ts 'sudo cat /mnt/Tank/derp/backup/<dump> | sudo docker exec -i ix-derp-db-1 pg_restore -U derp -d derp --clean --if-exists'
  ```

## Ellenőrzés

```bash
ssh nas-ts 'curl -fsS http://127.0.0.1:30080/api/health'
ssh nas-ts 'sudo docker stats --no-stream --format "{{.Name}} {{.MemUsage}}" | grep ix-derp'
ssh nas-ts 'sudo midclt call replication.query' | python3 -c "import sys,json;[print(t['name'],t['state'].get('state'),t['state'].get('error')) for t in json.load(sys.stdin)]"
curl -s -o /dev/null -w '%{http_code}\n' https://derp.damndot.run/adatvedelem   # 200, Access nélkül
curl -s -o /dev/null -w '%{http_code}\n' https://derp.damndot.run/api/health    # 302 az Access-loginra
```
