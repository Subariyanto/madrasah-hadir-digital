-- Migration 003: Tambah kolom photo di tabel siswa
-- Foto siswa sebelumnya disimpan di settings.extras.studentPhotos (key = ID lokal)
-- yang putus saat sync ke device baru karena ID berubah jadi UUID.
-- Fix: foto langsung di kolom siswa, ikut bareng data siswa.

alter table public.siswa add column if not exists photo text;

-- Opsional: migrasi foto lama dari settings.extras.studentPhotos ke kolom photo
-- Dijalankan sekali di Supabase SQL Editor (opsional, app juga auto-fix saat sync)
do $$
declare
  s_row record;
  photos jsonb;
  photo_val text;
begin
  select extras from public.settings limit 1 into photos;
  if photos is null then return; end if;

  for s_row in select id, nisn from public.siswa where photo is null loop
    -- Coba by UUID langsung
    photo_val := photos->'studentPhotos'->>s_row.id::text;
    -- Coba by NISN
    if photo_val is null and s_row.nisn is not null then
      photo_val := photos->'studentPhotos'->>('nisn:' || trim(s_row.nisn));
    end if;
    if photo_val is not null then
      update public.siswa set photo = photo_val where id = s_row.id;
    end if;
  end loop;
end $$;
