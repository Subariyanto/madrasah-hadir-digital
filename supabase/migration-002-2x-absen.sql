-- Migrasi: presensi siswa support 2x absen (masuk + pulang)
alter table public.presensi 
  add column if not exists waktu_masuk time,
  add column if not exists waktu_pulang time;

-- Copy data lama: waktu -> waktu_masuk
update public.presensi 
  set waktu_masuk = waktu 
  where waktu is not null and waktu_masuk is null;

-- Drop unique index lama dan bikin baru (1 row per siswa per hari, tapi bisa update)
drop index if exists uniq_presensi_siswa_tgl;
create unique index if not exists uniq_presensi_siswa_tgl on public.presensi(siswa_id, tanggal);

select 'siswa migration done' as status;
