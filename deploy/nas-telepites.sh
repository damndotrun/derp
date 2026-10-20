#!/usr/bin/env bash
# dERP telepítése / frissítése a plasticgarden NAS-on (TrueNAS Custom App „derp”).
#
# A fejlesztői gépről (a repó gyökeréből, PowerShellben vagy bashben):
#   git -c core.autocrlf=false archive --format=tar.gz -o derp.tgz HEAD
#   scp derp.tgz deploy/nas-telepites.sh nas-ts:/tmp/
#   ssh nas-ts 'sudo bash /tmp/nas-telepites.sh /tmp/derp.tgz'
#
# Lépések: forrás kicsomagolása → kép építése (derp-app:<címke> és :latest) → ha már fut, pg_dump a
# /mnt/Tank/derp/backup alá → app.create (első telepítés) vagy app.update + app.redeploy → health-ellenőrzés.
# Visszaállás korábbi képre: `docker tag derp-app:<régi címke> derp-app:latest` + `midclt call -j app.redeploy derp`;
# az adatbázis visszaállítása a dumpból: docs/telepites.md.
set -euo pipefail

TARBALL="${1:-/tmp/derp.tgz}"
APP=derp
ROOT=/mnt/Tank/derp
SECRETS="$ROOT/secrets"
BUILD_DIR=/tmp/derp-build
TAG="$(date +%Y%m%d-%H%M%S)"

die() { echo "HIBA: $*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "rootként futtasd (sudo bash $0 ...)"
[ -f "$TARBALL" ] || die "nincs meg a forrás: $TARBALL"
for f in "$SECRETS/.env" "$SECRETS/db.env"; do
  [ -f "$f" ] || die "hiányzik: $f (első telepítés előtt létre kell hozni, ld. docs/telepites.md)"
done
for k in DATABASE_URL SESSION_SECRET GOOGLE_LOGIN_CLIENT_ID GOOGLE_LOGIN_CLIENT_SECRET; do
  grep -q "^$k=." "$SECRETS/.env" || die "üres vagy hiányzó kulcs a .env-ben: $k"
done
grep -q '^POSTGRES_PASSWORD=.' "$SECRETS/db.env" || die "üres vagy hiányzó kulcs a db.env-ben: POSTGRES_PASSWORD"

echo "== forrás kicsomagolása: $BUILD_DIR"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
tar xzf "$TARBALL" -C "$BUILD_DIR"

echo "== kép építése: derp-app:$TAG"
docker build -f "$BUILD_DIR/deploy/Dockerfile" -t "derp-app:$TAG" -t derp-app:latest "$BUILD_DIR"

EXISTS="$(midclt call app.query "[[\"name\",\"=\",\"$APP\"]]" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')"

if [ "$EXISTS" != 0 ] && docker ps --format '{{.Names}}' | grep -qx "ix-$APP-db-1"; then
  DUMP="$ROOT/backup/derp-$TAG-frissites-elott.dump"
  echo "== pg_dump: $DUMP"
  docker exec "ix-$APP-db-1" pg_dump -U derp -d derp -Fc > "$DUMP.tmp"
  [ -s "$DUMP.tmp" ] || die "üres a dump, a frissítést nem folytatom"
  mv "$DUMP.tmp" "$DUMP"
  chmod 600 "$DUMP"
fi

PAYLOAD="$(mktemp)"
trap 'rm -f "$PAYLOAD"' EXIT
python3 - "$BUILD_DIR/deploy/compose.nas.yaml" "$EXISTS" "$APP" > "$PAYLOAD" <<'PY'
import json, sys, yaml
compose = yaml.safe_load(open(sys.argv[1], encoding="utf-8"))
if sys.argv[2] == "0":
    print(json.dumps({"app_name": sys.argv[3], "custom_app": True, "custom_compose_config": compose}))
else:
    print(json.dumps({"custom_compose_config": compose}))
PY

if [ "$EXISTS" = 0 ]; then
  echo "== app.create $APP"
  midclt call -j app.create "$(cat "$PAYLOAD")" > /dev/null
else
  echo "== app.update + app.redeploy $APP"
  midclt call -j app.update "$APP" "$(cat "$PAYLOAD")" > /dev/null
  midclt call -j app.redeploy "$APP" > /dev/null
fi

echo "== health-ellenőrzés"
for i in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:30080/api/health; then
    echo
    echo "KÉSZ: derp-app:$TAG fut."
    exit 0
  fi
  sleep 5
done
die "a /api/health 5 perc után sem válaszolt; nézd: docker logs ix-$APP-app-1"
