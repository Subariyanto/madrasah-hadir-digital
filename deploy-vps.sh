#!/usr/bin/env bash
# Deploy Madrasah Hadir Digital ke VPS (nginx static)
# Target: /var/www/presensi  ->  https://presensi.pokjawasjember.com
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="/var/www/presensi"

echo "==> Sync $SRC -> $DEST"
sudo rsync -a --delete \
  --exclude '.git' \
  --exclude 'supabase' \
  --exclude 'node_modules' \
  --exclude 'generate-icons.js' \
  --exclude 'build.js' \
  --exclude 'CNAME' \
  --exclude '.gitignore' \
  --exclude 'README.md' \
  --exclude 'deploy-vps.sh' \
  "$SRC"/ "$DEST"/

echo "==> Fix ownership & permissions"
sudo chown -R www-data:www-data "$DEST"
sudo find "$DEST" -type d -exec chmod 755 {} \;
sudo find "$DEST" -type f -exec chmod 644 {} \;

echo "==> Reload nginx"
sudo nginx -t && sudo systemctl reload nginx

echo "==> Verify"
for p in / index.html manifest.json sw.js icons/icon-192.png; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: presensi.pokjawasjember.com" "http://127.0.0.1/$p")
  printf "   %-24s %s\n" "$p" "$code"
done

echo "==> Done. Live: https://presensi.pokjawasjember.com/"
