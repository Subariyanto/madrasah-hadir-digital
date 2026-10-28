/* Madrasah Hadir Digital - Cloud Sync Client (Cloudflare Worker + KV)
 * Menggantikan Supabase (project lama sudah dihapus / NXDOMAIN).
 *
 * Mode dual:
 *  - Kalau URL + App Key tersedia -> cloud aktif, data di-mirror ke Worker KV.
 *  - Kalau tidak -> mode lokal penuh (localStorage saja).
 *
 * Pola: OFFLINE-FIRST. localStorage tetap sumber utama; cloud hanya cermin.
 * Foto siswa tidak diunggah sebagai file — disimpan sebagai dataURL di
 * settings.extras.studentPhotos (dipakai bersama lintas device).
 *
 * Cara aktifkan:
 *   <script>
 *     window.MHD_SYNC_URL = 'https://mhd-sync.subariyantoss2.workers.dev';
 *     window.MHD_SYNC_KEY = 'MHDKV-...';
 *   </script>
 *   <script src="supabase-client.js"></script>
 */

(function(){
  'use strict';

  const SYNC_URL = (window.MHD_SYNC_URL || '').replace(/\/+$/, '');
  const SYNC_KEY = window.MHD_SYNC_KEY || '';
  const ENABLED = !!(SYNC_URL && SYNC_KEY);
  const COLLECTIONS = ['kelas', 'siswa', 'guru', 'presensi', 'presensiGuru', 'settings'];

  // Public API namespace (nama dipertahankan agar index.html tidak perlu diubah)
  const MHD = window.MHDCloud = window.MHDCloud || {};
  MHD.enabled = ENABLED;
  MHD.url = SYNC_URL;
  MHD.mode = 'cloudflare-worker';

  if(!ENABLED){
    console.info('[MHDCloud] Disabled (no sync credentials). Running in local mode.');
    MHD.enabled = false;
    return;
  }

  // ===== REST helper =====
  async function rest(path, options){
    options = options || {};
    const res = await fetch(SYNC_URL + path, {
      method: options.method || 'GET',
      headers: Object.assign({
        'x-mhd-key': SYNC_KEY,
        'Content-Type': 'application/json'
      }, options.headers || {}),
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: 'no-store'
    });
    let payload = null;
    try{ payload = await res.json(); }catch(e){}
    if(!res.ok || (payload && payload.ok === false)){
      const msg = (payload && payload.error) || ('HTTP ' + res.status);
      throw new Error('SyncCloud: ' + msg);
    }
    return payload;
  }
  MHD.rest = rest;

  function tenantOf(madrasahId){
    return String(madrasahId || '').toUpperCase().replace(/[^A-Z0-9._-]/g, '').slice(0, 64);
  }

  // ===== Daftar kode aktivasi yang dikenal (dari LISENSI_DB lokal, kalau ada) =====
  function localCodes(){
    try{
      if(typeof LISENSI_DB !== 'undefined' && Array.isArray(LISENSI_DB)) return LISENSI_DB;
    }catch(e){}
    return [];
  }

  // ===== Lisensi: sumber utama = server (VPS) =====
  // Server menyimpan semua kode aktivasi, jadi kode yang diterbitkan admin
  // langsung bisa dipakai madrasah di perangkat mana pun.
  MHD.cekLisensi = async function(kode, catatAktivasi){
    const res = await rest('/lisensi/' + (catatAktivasi ? 'aktivasi' : 'cek'), {
      method: 'POST', body: { kode: tenantOf(kode) }
    });
    return (res && res.lisensi) || null;
  };

  // ===== Madrasah lookup by kode aktivasi =====
  // Server jadi acuan. Kalau jaringan gagal, fallback ke daftar kode lokal
  // (LISENSI_DB + kode terbitan lama) supaya madrasah tetap bisa aktivasi offline.
  MHD.findMadrasahByKode = async function(kode){
    const k = tenantOf(kode);
    if(!k) return null;
    try{
      const lis = await MHD.cekLisensi(k, true);
      if(!lis) return null;                       // tidak terdaftar / sudah dihapus
      return {
        id: lis.kode,
        kode_aktivasi: lis.kode,
        nama: lis.madrasah,
        alamat: lis.alamat || '',
        berlaku: lis.berlaku,
        tier: lis.tier || 'full',
        status: lis.status || 'aktif',
        _sumber: 'server'
      };
    }catch(e){
      console.warn('[MHDCloud] cek lisensi ke server gagal, pakai daftar lokal:', e.message);
    }
    const list = localCodes();
    const found = list.find(function(l){ return tenantOf(l.kode) === k; });
    if(list.length && !found) return null;   // kode tidak dikenal
    return {
      id: k,
      kode_aktivasi: k,
      nama: (found && found.madrasah) || 'Madrasah',
      alamat: (found && found.alamat) || '',
      berlaku: (found && found.berlaku) || '2027-12-31',
      tier: 'full',
      status: 'aktif',
      _sumber: 'lokal'
    };
  };

  // ===== Admin: login & token disimpan sebagai token sesi (bukan password) =====
  const TOKEN_KEY = 'mhd_admin_token';
  MHD.getAdminToken = function(){ try{ return localStorage.getItem(TOKEN_KEY) || ''; }catch(e){ return ''; } };
  MHD.setAdminToken = function(t){ try{ t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); }catch(e){} };

  async function adminRest(path, options){
    options = options || {};
    const res = await fetch(SYNC_URL + path, {
      method: options.method || 'GET',
      headers: Object.assign({
        'x-mhd-key': SYNC_KEY,
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + MHD.getAdminToken()
      }, options.headers || {}),
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: 'no-store'
    });
    let payload = null;
    try{ payload = await res.json(); }catch(e){}
    if(res.status === 401){ MHD.setAdminToken(''); }
    if(!res.ok || (payload && payload.ok === false)){
      const err = new Error((payload && payload.error) || ('HTTP ' + res.status));
      err.status = res.status;
      throw err;
    }
    return payload;
  }

  MHD.adminLogin = async function(username, password){
    const res = await rest('/admin/login', { method:'POST', body:{ username:username, password:password } });
    MHD.setAdminToken(res.token);
    return res;
  };
  // null = sesi tidak valid, { offline:true } = tidak bisa cek (jaringan)
  MHD.adminSession = async function(){
    if(!MHD.getAdminToken()) return null;
    try{ return await adminRest('/admin/session'); }
    catch(e){ return e && e.status === 401 ? null : { offline:true }; }
  };
  MHD.adminLogout = async function(){
    try{ await adminRest('/admin/logout', { method:'POST' }); }catch(e){}
    MHD.setAdminToken('');
  };
  MHD.adminUbahPassword = async function(password){
    await adminRest('/admin/password', { method:'POST', body:{ password:password } });
    MHD.setAdminToken('');
  };
  MHD.adminLisensiList = async function(){
    const res = await adminRest('/admin/lisensi');
    return (res && res.list) || [];
  };
  MHD.adminLisensiCreate = async function(data){
    const res = await adminRest('/admin/lisensi', { method:'POST', body:data });
    return res.lisensi;
  };
  MHD.adminLisensiUpdate = async function(data){
    const res = await adminRest('/admin/lisensi', { method:'PATCH', body:data });
    return res.lisensi;
  };
  MHD.adminLisensiDelete = async function(kode){
    await adminRest('/admin/lisensi', { method:'DELETE', body:{ kode:kode } });
    return true;
  };

  // ===== Cek status lisensi perangkat (dipakai saat aplikasi dibuka) =====
  // Hasil: 'aktif' | 'nonaktif' | 'kadaluarsa' | null (tidak terdaftar) | 'offline'
  MHD.statusLisensi = async function(kode){
    try{
      const lis = await MHD.cekLisensi(kode, false);
      if(!lis) return null;
      return lis.status || 'aktif';
    }catch(e){ return 'offline'; }
  };


  // ===== Aktivasi =====
  // Di model KV, madrasah otomatis "ada" begitu kode valid — tidak perlu insert.
  MHD.aktivasi = async function(kode, fallbackNama, fallbackAlamat){
    const k = tenantOf(kode);
    if(!k) return null;
    return {
      id: k,
      kode_aktivasi: k,
      nama: fallbackNama || 'Madrasah',
      alamat: fallbackAlamat || '',
      berlaku: '2027-12-31',
      tier: 'full'
    };
  };

  // ===== Mapping lokal (camelCase) -> cloud (snake_case) =====
  function mapKelas(k){
    return { id:k.id, nama:k.nama, wali_kelas:k.waliKelas || k.wali_kelas || null };
  }
  function mapSiswa(s){
    return {
      id:s.id, kelas_id:s.kelas || s.kelas_id || null,
      nama:s.nama, nisn:s.nisn || null, jk:s.jk || null,
      tgl_lahir:s.tglLahir || s.tgl_lahir || null,
      alamat:s.alamat || null, nama_ortu:s.namaOrtu || s.nama_ortu || null,
      no_wa_ortu:s.noWaOrtu || s.no_wa_ortu || null,
      photo:s.photo || null
    };
  }
  function mapGuru(g){
    return { id:g.id, nama:g.nama, nip:g.nip || null, jabatan:g.jabatan || null, no_wa:g.noWa || g.no_wa || null, photo:g.photo || null };
  }
  function mapPresensi(p){
    const sid = p.siswa || p.siswaId || p.siswa_id;
    if(!sid || !p.tanggal) return null;
    return {
      id: p.id || ('p_' + p.tanggal + '_' + sid),
      siswa_id: sid, tanggal:p.tanggal, status:p.status || 'hadir',
      waktu:p.waktuMasuk || p.waktu || null,
      keterangan:p.keterangan || null,
      recorded_by:p.recordedBy || p.recorded_by || null
    };
  }
  function mapPresensiGuru(p){
    const gid = p.guru || p.guruId || p.guru_id;
    if(!gid || !p.tanggal) return null;
    return {
      id: p.id || ('pg_' + p.tanggal + '_' + gid),
      guru_id: gid, tanggal:p.tanggal, status:p.status || 'hadir',
      waktu_masuk:p.waktuMasuk || p.waktu_masuk || null,
      waktu_pulang:p.waktuPulang || p.waktu_pulang || null,
      keterangan:p.keterangan || null
    };
  }
  function mapSettings(x){
    x = x || {};
    return {
      jam_masuk:x.jamMasuk || '07:00',
      batas_terlambat:x.batasTerlambat || '07:15',
      jam_pulang:x.jamPulang || '14:00',
      tahun_ajaran:x.tahunAjaran || null,
      semester:x.semester || null,
      extras:x,
      updated_at:new Date().toISOString()
    };
  }

  function mapCollection(col, value){
    if(col === 'settings') return mapSettings(value);
    const fn = col === 'kelas' ? mapKelas
             : col === 'siswa' ? mapSiswa
             : col === 'guru' ? mapGuru
             : col === 'presensi' ? mapPresensi
             : col === 'presensiGuru' ? mapPresensiGuru : null;
    if(!fn) return [];
    return (value || []).map(fn).filter(Boolean);
  }

  // ===== Pull: ambil semua data dari cloud (sudah dalam bentuk snake_case) =====
  MHD.pullAll = async function(madrasahId){
    const t = tenantOf(madrasahId);
    if(!t) throw new Error('SyncCloud: tenant kosong');
    const res = await rest('/data?t=' + encodeURIComponent(t));
    const d = (res && res.data) || {};
    return {
      kelas: d.kelas || [],
      siswa: d.siswa || [],
      guru: d.guru || [],
      presensi: d.presensi || [],
      presensiGuru: d.presensiGuru || [],
      settings: d.settings || null,
      _updatedAt: res && res.updatedAt || null
    };
  };

  // ===== Push: kirim hanya koleksi yang ada di payload =====
  MHD.pushAll = async function(madrasahId, payload){
    const t = tenantOf(madrasahId);
    if(!t) throw new Error('SyncCloud: tenant kosong');
    payload = payload || {};
    const body = {};
    const results = [];
    COLLECTIONS.forEach(function(col){
      if(!Object.prototype.hasOwnProperty.call(payload, col)) return;
      body[col] = mapCollection(col, payload[col]);
    });
    const keys = Object.keys(body);
    if(!keys.length) return results;
    try{
      await rest('/data?t=' + encodeURIComponent(t), { method:'POST', body: body });
      keys.forEach(function(col){ results.push({ collection: col, status:'fulfilled' }); });
    }catch(e){
      keys.forEach(function(col){ results.push({ collection: col, status:'rejected', reason: e }); });
    }
    return results;
  };

  // ===== Notifikasi perubahan dari device lain =====
  // Worker KV tidak punya realtime channel, jadi pakai polling ringan
  // berdasarkan `updatedAt` per koleksi.
  MHD.subscribe = function(madrasahId, onChange){
    const t = tenantOf(madrasahId);
    if(!t || typeof onChange !== 'function') return null;
    let stopped = false;
    let lastSignature = null;
    let first = true;

    function signature(updatedAt){
      if(!updatedAt) return '';
      return Object.keys(updatedAt).sort().map(function(k){ return k + '=' + updatedAt[k]; }).join('|');
    }

    async function tick(){
      if(stopped || !navigator.onLine) return;
      try{
        const res = await rest('/data?t=' + encodeURIComponent(t));
        const sig = signature(res && res.updatedAt);
        if(first){ lastSignature = sig; first = false; return; }
        if(sig && sig !== lastSignature){
          lastSignature = sig;
          onChange(res && res.data);
        }
      }catch(e){ /* diamkan; status sync ditangani index.html */ }
    }

    const timer = setInterval(tick, 15000);
    setTimeout(tick, 4000);
    console.info('[MHDCloud] Polling subscribe aktif (15s).');
    return {
      close: function(){ stopped = true; clearInterval(timer); },
      get closed(){ return stopped; }
    };
  };

  console.info('[MHDCloud] Enabled. Worker:', SYNC_URL);
})();
