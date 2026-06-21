# Setup Supabase untuk Madrasah Hadir Digital

Panduan untuk Pak Yanto / admin pusat yang setup project Supabase. **Hanya dilakukan SEKALI**, lalu credentials dishare ke semua madrasah.

## 1. Buat Akun & Project Supabase

1. Buka https://supabase.com → Sign up (pakai GitHub atau email)
2. New Project:
   - Name: `madrasah-hadir-digital`
   - Database Password: (catat di password manager, JANGAN hilang)
   - Region: **Singapore** (terdekat untuk Indonesia)
   - Plan: **Free**
3. Tunggu ±2 menit sampai project provisioned

## 2. Jalankan Schema SQL

1. Di Supabase dashboard → menu kiri **SQL Editor** → klik "New Query"
2. Copy isi file `schema.sql` dari folder ini
3. Paste ke editor → klik **Run**
4. Cek Table Editor → harus ada 8 tabel: `madrasah`, `kelas`, `siswa`, `guru`, `presensi`, `presensi_guru`, `settings`, `aktivasi_log`
5. Cek tabel `madrasah` → harus ada 12 row seed (kode aktivasi yang sudah ada di app)

## 3. Ambil Credentials

1. Menu kiri **Project Settings** → **API**
2. Catat 2 nilai ini:
   - **Project URL** (contoh: `https://xxxxxxxxxxxx.supabase.co`)
   - **anon public** key (panjang, dimulai `eyJ...`)

⚠️ **JANGAN bagikan service_role key.** Yang dishare ke madrasah cuma URL + anon key.

## 4. Aktifkan Realtime

1. Menu kiri **Database** → **Replication**
2. Pastikan tabel berikut ON:
   - `kelas`, `siswa`, `guru`, `presensi`, `presensi_guru`, `settings`

## 5. Konfigurasi di Aplikasi

### Cara A: Manual (per device)

1. Buka aplikasi MHD di browser → login admin (`?mode=admin`)
2. Sidebar → **Pengaturan** → scroll ke bawah → **Cloud Sync**
3. Klik **Konfigurasi Cloud**
4. Paste:
   - URL: dari step 3
   - Anon Key: dari step 3
5. Klik **Simpan & Reload**
6. Setelah reload, harusnya muncul "✅ Cloud aktif. Data otomatis sync antar device."

### Cara B: Lewat URL (lebih cepat, sekali klik)

Encode credentials ke base64:

```js
btoa(JSON.stringify({
  url: 'https://xxx.supabase.co',
  key: 'eyJ...'
}))
```

Lalu kirim link ke madrasah:

```
https://subariyanto.github.io/madrasah-hadir-digital/?supabase=<base64>
```

Begitu user buka link → cloud auto-config + tersimpan. Buka tanpa param di kemudian hari tetap cloud-aktif.

## 6. Migrasi Data Lokal (untuk madrasah yang sudah punya data)

1. Login ke aplikasi
2. **Pengaturan** → **Cloud Sync** → **⬆️ Upload Data Lokal ke Cloud**
3. Tunggu sampai toast "Upload selesai: N sukses"

## 7. Multi-Device Test

1. Laptop: aktivasi pakai kode `MHD-MIDARUSSALAM02JBR-2026`
2. HP: buka aplikasi, aktivasi pakai kode yang sama
3. Tambah siswa di laptop
4. Refresh HP → siswa muncul (atau tunggu beberapa detik untuk realtime push)

## Tambah Madrasah Baru

Jalankan SQL ini di Supabase SQL Editor:

```sql
insert into public.madrasah (kode_aktivasi, nama, alamat, tier, berlaku, aktivasi_tanggal)
values ('MHD-NAMAKODE-2026', 'MA Nama Madrasah', 'Alamat lengkap', 'full', '2027-12-31', current_date);
```

Kode ini juga bisa ditambah di `LISENSI_DB` di `index.html` untuk keperluan offline/sebelum konek cloud (opsional).

## Backup

Supabase auto-backup tiap hari di plan Pro. Untuk Free plan:
- Manual backup: Database → Backups → Download
- Atau pakai pg_dump via connection string

## Troubleshooting

**"Cloud belum aktif"** → cek `localStorage.mhd_supabase_cfg` di DevTools. Kalau kosong, ulang step 5.

**CORS error** → Supabase default allow all origin. Kalau muncul error, cek Project Settings → API → "Exposed schemas" pastikan `public` ada.

**RLS error 401/403** → cek policy di Supabase Auth → Policies. Pastikan policy `anon all` aktif (sudah otomatis dari schema.sql).

**Data tidak sync realtime** → cek Database → Replication, tabel harus ON.
