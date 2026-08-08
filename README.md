# Madrasah Hadir Digital - PWA

Aplikasi presensi digital madrasah berbasis **Progressive Web App (PWA)**.

## Fitur PWA
- ✅ Bisa dipasang ke home screen Android/iOS (Add to Home Screen)
- ✅ Berjalan fullscreen seperti app native
- ✅ Offline-ready (service worker caching)
- ✅ Auto-update saat versi baru di-deploy
- ✅ Shortcut langsung ke Scan QR & Presensi Manual
- ✅ Tetap single-file SPA, data di localStorage

## Cara Install di Android
1. Buka https://subariyanto.github.io/madrasah-hadir-digital/ di Chrome
2. Tekan tombol **Pasang** di bar bawah, atau menu Chrome → "Install app" / "Add to Home screen"
3. Icon MHD akan muncul di home screen, klik = buka fullscreen

## Cara Install di iOS (Safari)
1. Buka URL di Safari
2. Tekan tombol Share → "Add to Home Screen"

## File Tambahan untuk PWA
- `manifest.json` — metadata app (nama, icon, theme color, shortcut)
- `sw.js` — service worker, cache strategy
- `icons/` — icon 192/512/maskable + apple-touch + favicon
- `generate-icons.js` — pembuat icon (Node.js, tanpa dependency)

## Update Icon
Icon dibuat programatik dari Node.js (tidak butuh `sharp` / `canvas`):
```
node generate-icons.js
```

## Deploy
Sama seperti sebelumnya — push ke branch `gh-pages`, GitHub Pages auto-publish.
File baru yang harus ikut:
- `manifest.json`
- `sw.js`
- `icons/*.png`
- `index.html` (yang sudah disisipi PWA hooks)

## Upgrade ke APK (kalau diperlukan nanti)
PWA ini bisa langsung dibungkus jadi APK pakai:
- **Bubblewrap (TWA)** → APK ringan, tetap pakai web yang sama
- **Capacitor** → APK + akses native lebih dalam (kamera, notifikasi, file)

Status sekarang: PWA sudah cukup untuk semua fitur eksisting (scan QR, presensi, cetak, dll) karena Chrome HP sudah expose kamera & storage.
