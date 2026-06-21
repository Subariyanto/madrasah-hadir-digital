-- ============================================================
-- Madrasah Hadir Digital - Supabase Schema
-- Multi-tenant via kode aktivasi
-- ============================================================

-- 1. Tabel madrasah (tenant root)
create table if not exists public.madrasah (
  id uuid primary key default gen_random_uuid(),
  kode_aktivasi text unique not null,
  nama text not null,
  alamat text,
  npsn text,
  nss text,
  kepala_madrasah text,
  nip_kepala text,
  logo_url text,
  tier text not null default 'full' check (tier in ('full','trial')),
  berlaku date,
  trial_expires_at timestamptz,
  aktivasi_tanggal date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_madrasah_kode on public.madrasah(kode_aktivasi);

-- 2. Tabel kelas
create table if not exists public.kelas (
  id uuid primary key default gen_random_uuid(),
  madrasah_id uuid not null references public.madrasah(id) on delete cascade,
  nama text not null,
  wali_kelas text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_kelas_madrasah on public.kelas(madrasah_id);

-- 3. Tabel siswa
create table if not exists public.siswa (
  id uuid primary key default gen_random_uuid(),
  madrasah_id uuid not null references public.madrasah(id) on delete cascade,
  kelas_id uuid references public.kelas(id) on delete set null,
  nama text not null,
  nisn text,
  nis text,
  jk text check (jk in ('L','P') or jk is null),
  tgl_lahir date,
  alamat text,
  nama_ortu text,
  no_wa_ortu text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_siswa_madrasah on public.siswa(madrasah_id);
create index if not exists idx_siswa_kelas on public.siswa(kelas_id);
create index if not exists idx_siswa_nisn on public.siswa(madrasah_id, nisn);

-- 4. Tabel guru
create table if not exists public.guru (
  id uuid primary key default gen_random_uuid(),
  madrasah_id uuid not null references public.madrasah(id) on delete cascade,
  nama text not null,
  nip text,
  jabatan text,
  no_wa text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_guru_madrasah on public.guru(madrasah_id);

-- 5. Tabel presensi siswa
create table if not exists public.presensi (
  id uuid primary key default gen_random_uuid(),
  madrasah_id uuid not null references public.madrasah(id) on delete cascade,
  siswa_id uuid not null references public.siswa(id) on delete cascade,
  tanggal date not null,
  status text not null check (status in ('hadir','sakit','izin','alpha','terlambat','dinas')),
  waktu time,
  keterangan text,
  recorded_by text,
  created_at timestamptz default now()
);
create index if not exists idx_presensi_madrasah_tgl on public.presensi(madrasah_id, tanggal);
create index if not exists idx_presensi_siswa on public.presensi(siswa_id);
create unique index if not exists uniq_presensi_siswa_tgl on public.presensi(siswa_id, tanggal);

-- 6. Tabel presensi guru
create table if not exists public.presensi_guru (
  id uuid primary key default gen_random_uuid(),
  madrasah_id uuid not null references public.madrasah(id) on delete cascade,
  guru_id uuid not null references public.guru(id) on delete cascade,
  tanggal date not null,
  status text not null check (status in ('hadir','sakit','izin','alpha','terlambat','dinas')),
  waktu_masuk time,
  waktu_pulang time,
  keterangan text,
  created_at timestamptz default now()
);
create index if not exists idx_presensi_guru_madrasah_tgl on public.presensi_guru(madrasah_id, tanggal);
create unique index if not exists uniq_presensi_guru_tgl on public.presensi_guru(guru_id, tanggal);

-- 7. Tabel settings (per madrasah)
create table if not exists public.settings (
  madrasah_id uuid primary key references public.madrasah(id) on delete cascade,
  jam_masuk text default '07:00',
  batas_terlambat text default '07:15',
  jam_pulang text default '14:00',
  tahun_ajaran text,
  semester text,
  extras jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- 8. Tabel kode_aktivasi_log (audit)
create table if not exists public.aktivasi_log (
  id uuid primary key default gen_random_uuid(),
  madrasah_id uuid references public.madrasah(id) on delete set null,
  kode text not null,
  device_info text,
  ip text,
  user_agent text,
  success boolean default true,
  created_at timestamptz default now()
);

-- ============================================================
-- HELPER FUNCTION: cari madrasah by kode aktivasi
-- ============================================================
create or replace function public.mhd_get_madrasah_by_kode(p_kode text)
returns public.madrasah
language sql
security definer
set search_path = public
as $$
  select * from public.madrasah where kode_aktivasi = upper(p_kode) limit 1;
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
-- Strategi: anon role boleh read/write data SELAMA mereka tahu kode aktivasi
-- (kode aktivasi = "tenant key"). Kita cek via session header `x-mhd-kode`.
--
-- Tapi karena Supabase anon key di-expose ke client, untuk simpel:
-- - Anon role bisa SELECT madrasah by kode_aktivasi (untuk login)
-- - Untuk operasi write, client harus include madrasah_id yang sudah diverifikasi via fn login
-- - Admin pusat (Yanto) pakai service_role key untuk akses semua

alter table public.madrasah enable row level security;
alter table public.kelas enable row level security;
alter table public.siswa enable row level security;
alter table public.guru enable row level security;
alter table public.presensi enable row level security;
alter table public.presensi_guru enable row level security;
alter table public.settings enable row level security;
alter table public.aktivasi_log enable row level security;

-- Policy: anon bisa SELECT madrasah by kode (untuk login)
drop policy if exists "anon select madrasah by kode" on public.madrasah;
create policy "anon select madrasah by kode" on public.madrasah
  for select to anon using (true);

-- Policy: anon bisa INSERT madrasah (untuk register / aktivasi pertama)
drop policy if exists "anon insert madrasah" on public.madrasah;
create policy "anon insert madrasah" on public.madrasah
  for insert to anon with check (true);

-- Policy: anon bisa UPDATE madrasah miliknya (full access — admin pusat tetap pakai service_role)
drop policy if exists "anon update madrasah" on public.madrasah;
create policy "anon update madrasah" on public.madrasah
  for update to anon using (true) with check (true);

-- Policy: full access untuk anon di tabel data madrasah (kelas, siswa, guru, presensi, settings)
-- Logika: client app yang sudah punya kode aktivasi valid → bisa CRUD semua data
-- Isolasi antar madrasah dijaga di sisi APP via filter madrasah_id (bukan di RLS)
-- Trade-off: less secure tapi simpel. Bisa di-tighten nanti dengan JWT custom.

do $$
declare t text;
begin
  for t in select unnest(array['kelas','siswa','guru','presensi','presensi_guru','settings','aktivasi_log']) loop
    execute format('drop policy if exists "anon all %1$s" on public.%1$s;', t);
    execute format('create policy "anon all %1$s" on public.%1$s for all to anon using (true) with check (true);', t);
  end loop;
end $$;

-- ============================================================
-- SEED DATA: 11 kode aktivasi yang sudah ada di app
-- ============================================================
insert into public.madrasah (kode_aktivasi, nama, tier, berlaku, aktivasi_tanggal)
values
  ('MHD-ADMIN-2026','ADMIN (Master)','full','2099-12-31',current_date),
  ('MHD-ALHIKMAH-2026','MA Al-Hikmah','full','2027-12-31',current_date),
  ('MHD-ANNUR-2026','MA An-Nur','full','2027-12-31',current_date),
  ('MHD-ALMAARIF-2026','MA Al-Maarif','full','2027-12-31',current_date),
  ('MHD-DARUSSALAM-2026','MA Darussalam','full','2027-12-31',current_date),
  ('MHD-ALFALAH-2026','MA Al-Falah','full','2027-12-31',current_date),
  ('MHD-ALHUDA-2026','MA Al-Huda','full','2027-12-31',current_date),
  ('MHD-ALMUNAWWAROH-2026','MA Al-Munawwaroh','full','2027-12-31',current_date),
  ('MHD-NURULJADID-2026','MA Nurul Jadid','full','2027-12-31',current_date),
  ('MHD-MIFTAHULULUM-2026','MA Miftahul Ulum','full','2027-12-31',current_date),
  ('MHD-RAUDLATULHASANAH-2026','MA Raudlatul Hasanah','full','2027-12-31',current_date),
  ('MHD-MIDARUSSALAM02JBR-2026','MI Darussalam 02 Jember','full','2027-12-31',current_date)
on conflict (kode_aktivasi) do nothing;

-- ============================================================
-- REALTIME: enable broadcast untuk tabel yang perlu sync
-- ============================================================
alter publication supabase_realtime add table public.kelas;
alter publication supabase_realtime add table public.siswa;
alter publication supabase_realtime add table public.guru;
alter publication supabase_realtime add table public.presensi;
alter publication supabase_realtime add table public.presensi_guru;
alter publication supabase_realtime add table public.settings;
