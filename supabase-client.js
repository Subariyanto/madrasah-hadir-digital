/* Madrasah Hadir Digital - Supabase Client
 * Mode dual: kalau credentials nggak ada, fallback ke localStorage (mode lokal)
 * Kalau ada, sync ke Supabase + cache di localStorage (mode online)
 *
 * Cara aktivasi mode online:
 *   <script>
 *     window.MHD_SUPABASE_URL = 'https://xxx.supabase.co';
 *     window.MHD_SUPABASE_ANON_KEY = 'eyJ...';
 *   </script>
 *   <script src="supabase-client.js"></script>
 */

(function(){
  'use strict';

  const SB_URL = window.MHD_SUPABASE_URL || '';
  const SB_KEY = window.MHD_SUPABASE_ANON_KEY || '';
  const ENABLED = !!(SB_URL && SB_KEY);

  // Public API namespace
  const MHD = window.MHDCloud = window.MHDCloud || {};
  MHD.enabled = ENABLED;
  MHD.url = SB_URL;
  MHD.headers = function(){
    return {
      'apikey': SB_KEY,
      'Authorization': 'Bearer ' + SB_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };
  };

  if(!ENABLED){
    console.info('[MHDCloud] Disabled (no credentials). Running in local mode.');
    MHD.enabled = false;
    return;
  }

  // ===== REST helper =====
  async function rest(path, options){
    options = options || {};
    const url = SB_URL + '/rest/v1' + path;
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers: Object.assign(MHD.headers(), options.headers || {}),
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    if(!res.ok){
      const text = await res.text();
      throw new Error('Supabase '+res.status+': '+text);
    }
    const ct = res.headers.get('content-type')||'';
    if(ct.indexOf('application/json')>=0) return res.json();
    return null;
  }
  MHD.rest = rest;

  // ===== Madrasah lookup by kode aktivasi =====
  MHD.findMadrasahByKode = async function(kode){
    const k = (kode||'').trim().toUpperCase();
    if(!k) return null;
    const list = await rest('/madrasah?kode_aktivasi=eq.'+encodeURIComponent(k)+'&select=*&limit=1');
    return (list && list[0]) || null;
  };

  // ===== Aktivasi: cari madrasah by kode, kalau belum ada di server bikin =====
  MHD.aktivasi = async function(kode, fallbackNama, fallbackAlamat){
    const found = await MHD.findMadrasahByKode(kode);
    if(found) return found;
    // Insert (kalau RLS allow)
    const inserted = await rest('/madrasah', {
      method:'POST',
      body:{
        kode_aktivasi:(kode||'').trim().toUpperCase(),
        nama: fallbackNama || 'Madrasah',
        alamat: fallbackAlamat || '',
        tier:'full',
        berlaku:'2027-12-31',
        aktivasi_tanggal: new Date().toISOString().slice(0,10)
      }
    });
    return inserted && inserted[0];
  };

  // ===== CRUD generic =====
  MHD.list = async function(table, madrasahId, extra){
    extra = extra || '';
    return rest('/'+table+'?madrasah_id=eq.'+madrasahId+(extra?'&'+extra:'')+'&order=created_at.asc');
  };
  MHD.upsert = async function(table, row, conflictCol){
    return rest('/'+table+(conflictCol?'?on_conflict='+conflictCol:''), {
      method:'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates,return=representation' },
      body: row
    });
  };
  MHD.insert = async function(table, row){
    return rest('/'+table, { method:'POST', body: row });
  };
  MHD.update = async function(table, id, patch){
    return rest('/'+table+'?id=eq.'+id, { method:'PATCH', body: patch });
  };
  MHD.del = async function(table, id){
    return rest('/'+table+'?id=eq.'+id, { method:'DELETE' });
  };
  MHD.deleteMissing = async function(table, madrasahId, keepIds){
    const rows = await rest('/'+table+'?madrasah_id=eq.'+madrasahId+'&select=id');
    const keep = new Set((keepIds||[]).map(String));
    for(const r of (rows||[]).filter(r=>!keep.has(String(r.id)))) await MHD.del(table, r.id);
  };

  // ===== Sync helpers =====
  // Pull: ambil semua data madrasah dari server, simpan ke localStorage (cache)
  MHD.pullAll = async function(madrasahId){
    const [kelas, siswa, guru, presensi, presensiGuru, settings] = await Promise.all([
      MHD.list('kelas', madrasahId),
      MHD.list('siswa', madrasahId),
      MHD.list('guru', madrasahId),
      MHD.list('presensi', madrasahId),
      MHD.list('presensi_guru', madrasahId),
      rest('/settings?madrasah_id=eq.'+madrasahId+'&select=*&limit=1')
    ]);
    return { kelas, siswa, guru, presensi, presensiGuru, settings: settings && settings[0] };
  };

  // Push: upload semua data localStorage ke server (one-shot migration)
  MHD.pushAll = async function(madrasahId, payload){
    const tasks = [];
    if(payload.kelas && payload.kelas.length){
      for(const k of payload.kelas){
        tasks.push(MHD.upsert('kelas', { id:k.id, madrasah_id:madrasahId, nama:k.nama, wali_kelas:k.waliKelas||null }, 'id'));
      }
    }
    if(payload.siswa && payload.siswa.length){
      for(const s of payload.siswa){
        tasks.push(MHD.upsert('siswa', {
          id:s.id, madrasah_id:madrasahId, kelas_id:s.kelas||null,
          nama:s.nama, nisn:s.nisn||null, jk:s.jk||null,
          tgl_lahir:s.tglLahir||null, alamat:s.alamat||null,
          nama_ortu:s.namaOrtu||null, no_wa_ortu:s.noWaOrtu||null
        }, 'id'));
      }
    }
    if(payload.guru && payload.guru.length){
      for(const g of payload.guru){
        tasks.push(MHD.upsert('guru', {
          id:g.id, madrasah_id:madrasahId, nama:g.nama,
          nip:g.nip||null, jabatan:g.jabatan||null, no_wa:g.noWa||null
        }, 'id'));
      }
    }
    if(payload.presensi && payload.presensi.length){
      for(const p of payload.presensi){
        const sid = p.siswa || p.siswaId;
        if(!sid || !p.tanggal) continue;
        tasks.push(MHD.upsert('presensi', {
          id: p.id || (crypto&&crypto.randomUUID?crypto.randomUUID():('p_'+Date.now()+'_'+Math.random().toString(36).slice(2,8))),
          madrasah_id:madrasahId, siswa_id:sid,
          tanggal:p.tanggal, status:p.status||'hadir',
          waktu:p.waktuMasuk||p.waktu||null,
          keterangan:p.keterangan||null,
          recorded_by:p.recordedBy||null
        }, 'id'));
      }
    }
    if(payload.presensiGuru && payload.presensiGuru.length){
      for(const p of payload.presensiGuru){
        const gid = p.guru || p.guruId;
        if(!gid || !p.tanggal) continue;
        tasks.push(MHD.upsert('presensi_guru', {
          id: p.id || (crypto&&crypto.randomUUID?crypto.randomUUID():('pg_'+Date.now()+'_'+Math.random().toString(36).slice(2,8))),
          madrasah_id:madrasahId, guru_id:gid,
          tanggal:p.tanggal, status:p.status||'hadir',
          waktu_masuk:p.waktuMasuk||null,
          waktu_pulang:p.waktuPulang||null,
          keterangan:p.keterangan||null
        }, 'id'));
      }
    }
    if(payload.settings){
      const x=payload.settings;
      tasks.push(MHD.upsert('settings', { madrasah_id:madrasahId, jam_masuk:x.jamMasuk||'07:00', batas_terlambat:x.batasTerlambat||'07:15', jam_pulang:x.jamPulang||'14:00', tahun_ajaran:x.tahunAjaran||null, semester:x.semester||null, extras:x, updated_at:new Date().toISOString() }, 'madrasah_id'));
    }
    // Run in batches of 5 to avoid overload
    const results = [];
    for(let i=0;i<tasks.length;i+=5){
      const batch = tasks.slice(i,i+5);
      results.push(...await Promise.allSettled(batch));
    }
    const maps=[['kelas','kelas'],['siswa','siswa'],['guru','guru'],['presensi','presensi'],['presensiGuru','presensi_guru']];
    for(const pair of maps){ if(Object.prototype.hasOwnProperty.call(payload,pair[0])){ try{ await MHD.deleteMissing(pair[1],madrasahId,(payload[pair[0]]||[]).map(x=>x.id).filter(Boolean)); } catch(e){ results.push({status:'rejected',reason:e}); } } }
    return results;
  };

  // ===== Realtime subscribe =====
  // Pakai Server-Sent Events / WebSocket Supabase Realtime
  MHD.subscribe = function(madrasahId, onChange){
    if(!window.WebSocket) return null;
    const wsUrl = SB_URL.replace(/^http/,'ws') + '/realtime/v1/websocket?apikey='+encodeURIComponent(SB_KEY)+'&vsn=1.0.0';
    let ws;
    try{ ws = new WebSocket(wsUrl); }catch(e){ console.warn('[MHDCloud] WS failed:',e); return null; }
    ws.onopen = function(){
      // Subscribe ke schema=public, semua tabel filter madrasah_id
      const tables = ['kelas','siswa','guru','presensi','presensi_guru','settings'];
      tables.forEach(t=>{
        ws.send(JSON.stringify({
          topic: 'realtime:public:'+t+':madrasah_id=eq.'+madrasahId,
          event: 'phx_join',
          payload: { config: { postgres_changes: [{ event:'*', schema:'public', table:t, filter:'madrasah_id=eq.'+madrasahId }] } },
          ref: String(Date.now())
        }));
      });
    };
    ws.onmessage = function(ev){
      try{
        const msg = JSON.parse(ev.data);
        if(msg.event === 'postgres_changes' && msg.payload && msg.payload.data){
          onChange && onChange(msg.payload.data);
        }
      }catch(e){}
    };
    ws.onerror = function(e){ console.warn('[MHDCloud] WS error:',e); };
    return ws;
  };

  console.info('[MHDCloud] Enabled. URL:', SB_URL);
})();
