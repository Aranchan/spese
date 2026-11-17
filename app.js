/* Spese di Casa — PWA per gestire e monitorare le spese mensili.
   Nessuna dipendenza esterna: i dati restano nel browser del telefono (localStorage). */
'use strict';
(() => {

// ───────────────────────── Costanti ─────────────────────────
const KEY = 'spese-di-casa-v1';
const MESI = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
const MESI_B = ['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'];
const FREQ = {
  mensile:{l:'Mensile',n:12}, bimestrale:{l:'Bimestrale',n:6}, trimestrale:{l:'Trimestrale',n:4},
  semestrale:{l:'Semestrale',n:2}, annuale:{l:'Annuale',n:1}
};
const TIPI = {fissa_mensile:'Fissa mensile', fissa_non_mensile:'Fissa non mensile', variabile:'Variabile'};
const METODI = {addebito:'Addebito', bonifico:'Bonifico', contanti:'Contanti', carta:'Carta'};
const PRIO = {essenziale:'Essenziale', utile:'Utile', tagliabile:'Tagliabile'};
const PALETTE = ['#2f7d5b','#3c6fb0','#c0792e','#8a5bb0','#b04a6a','#2f97a0','#7a8a2c','#b0553c','#5a6ab0','#a8862c','#3f8a74','#9a4ab0','#5f7486','#c4623f','#3f9a55','#8a6a5a'];
const DEFAULT_CATS = [
  ['Casa','🏠','fissa'],['Utenze','💡','fissa'],['Telefonia','📱','fissa'],['Internet','🌐','fissa'],
  ['Abbonamenti digitali','📺','fissa'],['Trasporti','🚗','entrambe'],['Finanziamenti e Rate','🏦','fissa'],
  ['Salute','🩺','entrambe'],['Assicurazioni','🛡️','fissa'],
  ['Spesa alimentare','🛒','extra'],['Ristoranti e bar','🍽️','extra'],['Svago','🎟️','extra'],
  ['Abbigliamento','👕','extra'],['Regali','🎁','extra'],['Cura personale','🧴','extra'],['Altro','📦','entrambe'],['Carburante','⛽','entrambe']
];

// ───────────────────────── Utilità ─────────────────────────
const $ = (s, r = document) => r.querySelector(s);
const eur = new Intl.NumberFormat('it-IT', {style:'currency', currency:'EUR'});
const fmt = v => eur.format(Math.round((+v || 0) * 100) / 100);
const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = v => { const n = parseFloat(String(v ?? '').replace(/\s|€/g,'').replace(/\.(?=\d{3}(\D|$))/g,'').replace(',', '.')); return isFinite(n) ? Math.round(n*100)/100 : 0; };
const numIn = v => v === '' || v == null ? '' : String(v).replace('.', ',');
const sum = (a, f) => a.reduce((t, x) => t + (+f(x) || 0), 0);
const pad = n => String(n).padStart(2, '0');
const ymKey = (y, m) => `${y}-${pad(m)}`;
const dim = (y, m) => new Date(y, m, 0).getDate();
let _uidc = 0;
const uid = () => Date.now().toString(36) + (_uidc++).toString(36) + Math.random().toString(36).slice(2, 6);
const today = () => { const d = new Date(); return {y:d.getFullYear(), m:d.getMonth()+1, d:d.getDate()}; };
const isoToday = () => { const t = today(); return `${t.y}-${pad(t.m)}-${pad(t.d)}`; };
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const fmtData = iso => { if (!iso) return ''; const [y,m,d] = iso.split('-').map(Number); return `${d} ${MESI_B[m-1]}${y !== today().y ? ' ' + y : ''}`; };
const fmtYM = k => { if (!k) return ''; const [y,m] = k.split('-').map(Number); return `${MESI_B[m-1]} ${y}`; };
const addMonths = (y, m, d) => { const t = y*12 + (m-1) + d; return {y: Math.floor(t/12), m: t%12 + 1}; };

// ───────────────────────── Stato ─────────────────────────
function fresh() {
  return {
    v: 1,
    categorie: DEFAULT_CATS.map((c, i) => ({id:'c'+(i+1), nome:c[0], icona:c[1], uso:c[2], colore:PALETTE[i % PALETTE.length], buoni: /spesa alimentare|ristoranti/i.test(c[0])})),
    previste: [], movimenti: [], entrate: [],
    buoni: {taglio: 0, ricariche: []},
    imp: {budgetExtra:0, preavviso:5, ultimaCat:'c10', mig11:true, mig12:true, mig13:true, notifOra:'09:00', notifQuando:'giorno', notifAuto:true, icsAt:'', icsSig:''}
  };
}
function normalize(s) {
  const f = fresh();
  const out = Object.assign(f, s || {});
  out.imp = Object.assign(fresh().imp, {mig11:false, mig12:false, mig13:false}, (s && s.imp) || {});
  // v1.1: categoria Carburante per chi aveva già dei dati
  if (!out.imp.mig11) {
    if (Array.isArray(out.categorie) && !out.categorie.some(c => (c.nome || '').toLowerCase() === 'carburante'))
      out.categorie.push({id: 'c' + uid(), nome: 'Carburante', icona: '⛽', uso: 'entrambe', colore: '#c4623f'});
    out.imp.mig11 = true;
  }
  // v1.2: le voci con "Fino al mese" nella categoria finanziamenti diventano rate
  if (!out.imp.mig12) {
    const fin = (out.categorie || []).filter(c => /finanz|rate/i.test(c.nome || '')).map(c => c.id);
    (out.previste || []).forEach(p => { if (p.fine && fin.includes(p.categoriaId) && p.rate === undefined) p.rate = true; });
    out.imp.mig12 = true;
  }
  // v1.4: buoni pasto
  if (!out.buoni || !Array.isArray(out.buoni.ricariche)) out.buoni = {taglio: (out.buoni && +out.buoni.taglio) || 0, ricariche: []};
  if (!out.imp.mig13) {
    (out.categorie || []).forEach(c => { if (c.buoni === undefined && /spesa alimentare|ristoranti/i.test(c.nome || '')) c.buoni = true; });
    out.imp.mig13 = true;
  }
  ['categorie','previste','movimenti','entrate'].forEach(k => { if (!Array.isArray(out[k])) out[k] = k === 'categorie' ? fresh().categorie : []; });
  return out;
}
let storageOk = true;
function load() {
  try { const raw = localStorage.getItem(KEY); if (raw) return normalize(JSON.parse(raw)); }
  catch (e) { storageOk = false; }
  return fresh();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); storageOk = true; }
  catch (e) { storageOk = false; }
}
let S = load();

// ───────────────────────── Calcoli ─────────────────────────
const cat = id => S.categorie.find(c => c.id === id) || {id:'', nome:'Senza categoria', icona:'📦', colore:'#888'};
const nAnno = p => (FREQ[p.frequenza] || FREQ.mensile).n;
// Bollette (v1.3): stima = media delle ultime 3 bollette pagate, se ce ne sono
function stimaPer(p, k) {
  if (!p.bolletta || !p.id) return +p.importo || 0;
  const pag = S.movimenti.filter(x => x.tipo === 'prevista' && x.previstaId === p.id && x.periodo < k)
    .sort((a, b) => b.periodo.localeCompare(a.periodo)).slice(0, 3);
  return pag.length ? Math.round(sum(pag, x => x.importo) / pag.length * 100) / 100 : (+p.importo || 0);
}
const impPrev = p => stimaPer(p, '9999-12');
const nStima = p => p.bolletta && p.id ? Math.min(3, S.movimenti.filter(x => x.tipo === 'prevista' && x.previstaId === p.id).length) : 0;
const annuo = p => impPrev(p) * nAnno(p);
const mensileEq = p => annuo(p) / 12;
const attive = () => S.previste.filter(p => p.attiva !== false);

function mesiDovuti(p) {
  const n = nAnno(p);
  if (n === 12) return [1,2,3,4,5,6,7,8,9,10,11,12];
  const step = 12 / n, rif = +p.meseRif || 1, out = [];
  for (let i = 0; i < n; i++) out.push(((rif - 1 + i*step) % 12) + 1);
  return out.sort((a, b) => a - b);
}
function dovuta(p, y, m) {
  if (p.attiva === false) return false;
  const k = ymKey(y, m);
  if (p.inizio && k < p.inizio) return false;
  if (p.fine && k > p.fine) return false;
  return mesiDovuti(p).includes(m);
}
function scadenzaTesto(p) {
  const g = p.giorno ? `il ${p.giorno}` : '';
  if (nAnno(p) === 12) return g ? `${g} di ogni mese` : 'entro fine mese';
  const ms = mesiDovuti(p);
  if (ms.length === 1) return `${g} ${MESI[ms[0]-1].toLowerCase()}`.trim();
  return `${g} ${ms.map(m => MESI_B[m-1]).join(', ')}`.trim();
}
function occorrenze(y, m) {
  const k = ymKey(y, m);
  return S.previste.filter(p => dovuta(p, y, m)).map(p => {
    const mov = S.movimenti.find(x => x.tipo === 'prevista' && x.previstaId === p.id && x.periodo === k);
    return Object.assign(occDi(p, y, m), {mov});
  }).sort((a, b) => (a.attesa - b.attesa) || a.scad.localeCompare(b.scad));
}
// dati di una scadenza: per le bollette inserite valgono data e importo della bolletta
function occDi(p, y, m) {
  const k = ymKey(y, m), base = `${k}-${pad(p.giorno ? Math.min(+p.giorno, dim(y, m)) : dim(y, m))}`;
  const ov = (p.bolletta && p.bollette && p.bollette[k]) || null;
  const stima = stimaPer(p, k);
  return {p, periodo: k, scad: ov ? ov.data : base, importo: ov ? +ov.importo : stima, stima, ov, attesa: !!p.bolletta && !ov};
}
// conferme "orfane": spese previste confermate per il mese ma poi disattivate/modificate
function confermeOrfane(y, m, occ) {
  const k = ymKey(y, m), ids = new Set(occ.map(o => o.mov && o.mov.id));
  return S.movimenti.filter(x => x.tipo === 'prevista' && x.periodo === k && !ids.has(x.id));
}
// ── Buoni pasto (v1.4): i buoni si consumano dal lotto più vecchio (FIFO)
const cassa = x => Math.max(0, Math.round(((+x.importo || 0) - (+x.buoniValore || 0)) * 100) / 100);  // parte pagata con lo stipendio
function lottiBuoni(escludiId) {
  const lotti = S.buoni.ricariche.slice().sort((a, b) => (a.data || '').localeCompare(b.data || '')).map(r => ({taglio: +r.taglio || 0, n: +r.numero || 0}));
  let usati = sum(S.movimenti.filter(x => +x.buoni > 0 && x.id !== escludiId), x => +x.buoni);
  for (const l of lotti) { const k = Math.min(l.n, usati); l.n -= k; usati -= k; }
  return lotti.filter(l => l.n > 0);
}
function saldoBuoni(escludiId) {
  const l = lottiBuoni(escludiId);
  return {n: sum(l, x => x.n), valore: Math.round(sum(l, x => x.n * x.taglio) * 100) / 100, tagli: [...new Set(l.map(x => x.taglio))], primo: l.length ? l[0].taglio : (+S.buoni.taglio || 0)};
}
function valoreBuoni(k, escludiId) {
  let v = 0;
  for (const l of lottiBuoni(escludiId)) { const q = Math.min(l.n, k); v += q * l.taglio; k -= q; if (!k) break; }
  return Math.round(v * 100) / 100;
}
const testoSaldoBuoni = sb => sb.tagli.length === 1 ? `${sb.n} × ${fmt(sb.tagli[0])} = ${fmt(sb.valore)}` : `${sb.n} buoni · ${fmt(sb.valore)}`;
const haBuoni = () => S.buoni.ricariche.length > 0;

// Budget per categoria: conta extra + previste confermate del mese
function spesoCategoria(cid, y, m) {
  const k = ymKey(y, m);
  const movs = S.movimenti.filter(x => x.categoriaId === cid && (x.tipo === 'extra' ? (x.data || '').startsWith(k) : x.periodo === k));
  const speso = sum(movs, cassa), inBuoni = sum(movs, x => +x.buoniValore || 0);
  const daConf = sum(occorrenze(y, m).filter(o => !o.mov && o.p.categoriaId === cid), o => o.importo);
  return {speso, daConf, inBuoni};
}
function mediaCategoria(cid, mesi) {
  const t = today(); let tot = 0;
  for (let i = 1; i <= mesi; i++) { const x = addMonths(t.y, t.m, -i); tot += spesoCategoria(cid, x.y, x.m).speso; }
  return tot / mesi;
}
// Conferma automatica degli addebiti: crea la conferma quando la scadenza è passata
function autoConferma() {
  const t = today(), iso = isoToday(), kNow = ymKey(t.y, t.m), nomi = [];
  S.previste.forEach(p => {
    if (!p.autoConferma || p.attiva === false || p.metodo !== 'addebito') return;
    let y = t.y, m = t.m;
    if (/^\d{4}-\d{2}$/.test(p.autoDal || '')) { y = +p.autoDal.slice(0, 4); m = +p.autoDal.slice(5, 7); }
    for (let guard = 0; ymKey(y, m) <= kNow && guard < 36; guard++) {
      const k = ymKey(y, m);
      if (dovuta(p, y, m) && !(p.autoSkip || []).includes(k)) {
        const o = occDi(p, y, m);  // le bollette si confermano solo dopo averle inserite
        if (!o.attesa && o.scad <= iso && !S.movimenti.some(x => x.tipo === 'prevista' && x.previstaId === p.id && x.periodo === k)) {
          S.movimenti.push({id: uid(), tipo: 'prevista', previstaId: p.id, periodo: k, data: o.scad, importo: o.importo, categoriaId: p.categoriaId, descrizione: p.voce, metodo: p.metodo, note: '', auto: true});
          nomi.push(p.voce);
        }
      }
      ({y, m} = addMonths(y, m, 1));
    }
  });
  if (nomi.length) {
    save();
    toast(nomi.length === 1 ? `⚡ ${nomi[0]} confermata in automatico` : `⚡ ${nomi.length} addebiti confermati in automatico`);
  }
  return nomi.length;
}
function avvisoBudget(cid, ym) {
  const c = cat(cid), b = +c.budget || 0; if (!b || !ym) return null;
  const {speso} = spesoCategoria(cid, +ym.slice(0, 4), +ym.slice(5, 7)), pct = speso / b * 100;
  if (pct >= 100) return `⚠️ ${c.nome}: budget superato di ${fmt(speso - b)}`;
  if (pct >= 80) return `${c.nome}: hai usato il ${Math.round(pct)}% del budget`;
  return null;
}
const extraMese = k => S.movimenti.filter(x => x.tipo === 'extra' && (x.data || '').startsWith(k));
const entrateMese = m => sum(S.entrate.filter(e => !+e.mese || +e.mese === m), e => e.importo);

function datiMese(y, m) {
  const k = ymKey(y, m), occ = occorrenze(y, m);
  const da = occ.filter(o => !o.mov), ok = occ.filter(o => o.mov), orf = confermeOrfane(y, m, occ);
  const ex = extraMese(k);
  const totOk = sum(ok, o => o.mov.importo) + sum(orf, x => x.importo);
  const totDa = sum(da, o => o.importo);
  const totEx = sum(ex, cassa), exBuoni = sum(ex, x => +x.buoniValore || 0), nBuoni = sum(ex, x => +x.buoni || 0);
  const ent = entrateMese(m);
  return {k, occ, da, ok, orf, ex, totOk, totDa, totEx, exBuoni, nBuoni, ent, pagato: totOk + totEx, resto: ent - totOk - totEx - totDa};
}

// ───────────────────────── Vista corrente ─────────────────────────
const VIEWS = ['mese','previste','categorie','report','altro'];
const TITOLI = {mese:'Il mio mese', previste:'Spese previste', categorie:'Per categoria', report:'Report', altro:'Altro'};
let view = 'mese';
let cur = (() => { const t = today(); return {y:t.y, m:t.m}; })();
const fPrev = {cat:'', prio:'', mode:'card'};

function readHash() { const v = (location.hash || '').replace('#',''); view = VIEWS.includes(v) ? v : 'mese'; }

function render() {
  $('#title').textContent = TITOLI[view];
  const mn = $('#month-nav');
  if (view === 'mese' || view === 'report') {
    mn.innerHTML = `<button class="arrow" data-a="mPrev" aria-label="Mese precedente">‹</button>
      <button class="m-lbl" data-a="mToday" title="Torna al mese corrente">${MESI[cur.m-1]} ${cur.y}</button>
      <button class="arrow" data-a="mNext" aria-label="Mese successivo">›</button>`;
  } else mn.innerHTML = '';
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.id === view));
  $('#fab').hidden = view === 'altro';
  const fn = {mese:vMese, previste:vPreviste, categorie:vCategorie, report:vReport, altro:vAltro}[view];
  $('#main').innerHTML = fn();
}

// ───────────────────────── Componenti ─────────────────────────
const catIc = (c, sm) => `<span class="cat-ic${sm ? ' sm' : ''}" style="--c:${h(c.colore)}">${h(c.icona)}</span>`;
const bar = (pct, color, over) => `<div class="bar${over ? ' over' : ''}"><i style="width:${Math.max(0, Math.min(100, pct)).toFixed(1)}%;${color ? `--c:${h(color)}` : ''}"></i></div>`;

function statoOcc(o) {
  const t = today(), kNow = ymKey(t.y, t.m);
  if (o.attesa) return o.periodo < kNow ? {cls:'danger', txt:'Bolletta non inserita'} : {cls:'', txt:'📄 In attesa della bolletta'};
  if (o.periodo < kNow && !o.ov) return {cls:'danger', txt:'Non confermata'};
  if (o.periodo > kNow && !o.ov) return {cls:'', txt:'Scade il ' + fmtData(o.scad)};
  const dd = daysBetween(isoToday(), o.scad);
  if (dd > 0 && o.periodo > kNow) return {cls:'', txt:'Scade il ' + fmtData(o.scad)};
  if (dd < 0) return {cls:'danger', txt:`Scaduta il ${fmtData(o.scad)}`};
  if (dd === 0) return {cls:'warn', txt:'Scade oggi'};
  if (dd <= (+S.imp.preavviso || 0)) return {cls:'warn', txt:`Tra ${dd} g · ${fmtData(o.scad)}`};
  return {cls:'', txt:'Scade il ' + fmtData(o.scad)};
}
const isAuto = p => !!p.autoConferma && p.metodo === 'addebito';

// ── Rate e finanziamenti: una rata per ogni periodo di pagamento fino all'ultima rata
function periodiDovuti(p, fromK, toK) {
  const out = [];
  if (!fromK || !toK || fromK > toK) return out;
  let y = +fromK.slice(0, 4), m = +fromK.slice(5, 7);
  const md = mesiDovuti(p);
  for (let g = 0; ymKey(y, m) <= toK && g < 720; g++) { if (md.includes(m)) out.push(ymKey(y, m)); ({y, m} = addMonths(y, m, 1)); }
  return out;
}
function nEsimoPeriodo(p, fromK, n) {
  if (!fromK || !(n > 0)) return '';
  let y = +fromK.slice(0, 4), m = +fromK.slice(5, 7), c = 0;
  const md = mesiDovuti(p);
  for (let g = 0; g < 720; g++) { if (md.includes(m) && ++c === n) return ymKey(y, m); ({y, m} = addMonths(y, m, 1)); }
  return '';
}
const confermataIn = (p, k) => S.movimenti.some(x => x.tipo === 'prevista' && x.previstaId === p.id && x.periodo === k);
function primoDaPagare(p) {
  const t = today(); let k = ymKey(t.y, t.m);
  if (p.inizio && p.inizio > k) k = p.inizio;
  let y = +k.slice(0, 4), m = +k.slice(5, 7);
  const md = mesiDovuti(p);
  for (let g = 0; g < 720; g++) { const kk = ymKey(y, m); if (md.includes(m) && !confermataIn(p, kk)) return kk; ({y, m} = addMonths(y, m, 1)); }
  return k;
}
function rateInfo(p) {
  if (!p.rate || !p.fine) return null;
  const t = today(), kNow = ymKey(t.y, t.m);
  const da = p.inizio && p.inizio > kNow ? p.inizio : kNow;
  const futuri = periodiDovuti(p, da, p.fine).filter(k => !confermataIn(p, k));
  const mancanti = futuri.length;
  const totali = +p.numRate || (p.inizio ? periodiDovuti(p, p.inizio, p.fine).length : null);
  const pagate = totali ? Math.max(0, totali - mancanti) : null;
  return {totali, mancanti, pagate, residuo: mancanti * (+p.importo || 0), ultima: p.fine, prossima: futuri[0] || null, finita: mancanti === 0};
}
function numeroRata(p, k) {
  const ri = rateInfo(p); if (!ri || !ri.totali) return null;
  const n = ri.totali - periodiDovuti(p, k, p.fine).length + 1;
  return n >= 1 && n <= ri.totali ? {n, tot: ri.totali} : null;
}
function pillRata(p, k) {
  if (!p.rate) return '';
  const r = numeroRata(p, k);
  if (r && r.n === r.tot) return '<span class="pill ok">🎉 ultima rata</span>';
  if (r) return `<span class="pill">rata ${r.n}/${r.tot}</span>`;
  return k === p.fine ? '<span class="pill ok">🎉 ultima rata</span>' : '';
}
function rowDaConfermare(o) {
  const p = o.p, c = cat(p.categoriaId), st = statoOcc(o);
  return `<div class="row">
    ${catIc(c)}
    <div class="row-main" data-a="${o.attesa ? 'bolletta' : 'conferma'}" data-id="${p.id}|${o.periodo}">
      <div class="row-t">${h(p.voce)}</div>
      <div class="row-s"><span class="pill ${st.cls}">${st.txt}</span><span>${METODI[p.metodo] || ''}${nAnno(p) < 12 ? ' · ' + FREQ[p.frequenza].l.toLowerCase() : ''}${o.attesa || (p.tipo === 'variabile' && !o.ov) ? ' · stima' : ''}</span>${o.ov ? '<span class="pill ok">📄 bolletta</span>' : ''}${isAuto(p) ? '<span class="pill ok">⚡ automatica</span>' : ''}${pillRata(p, o.periodo)}</div>
    </div>
    <div class="row-r"><div class="amt">${o.attesa ? '<span class="muted" style="font-weight:500">≈ </span>' : ''}${fmt(o.importo)}</div>${o.attesa
      ? `<button class="btn sm ghost" data-a="bolletta" data-id="${p.id}|${o.periodo}">📄 Inserisci</button>`
      : `<button class="btn sm" data-a="conferma" data-id="${p.id}|${o.periodo}">Conferma</button>`}</div>
  </div>`;
}
function rowConfermata(o) {
  const p = o.p, mv = o.mov, diff = Math.round((mv.importo - (o.ov ? o.ov.importo : o.stima)) * 100) / 100;
  return `<div class="row tap" data-a="conferma" data-id="${p.id}|${o.periodo}">
    <span class="check">✓</span>
    <div class="row-main"><div class="row-t">${h(p.voce)}</div>
      <div class="row-s"><span>Pagata il ${fmtData(mv.data)} · ${METODI[mv.metodo] || ''}</span>${mv.auto ? '<span class="pill ok">⚡ automatica</span>' : ''}${pillRata(p, o.periodo)}${diff ? `<span class="pill ${diff > 0 ? 'danger' : 'ok'}">${diff > 0 ? '+' : ''}${fmt(diff)} ${o.ov ? 'sulla bolletta' : 'sul previsto'}</span>` : ''}</div></div>
    <div class="amt">${fmt(mv.importo)}</div>
  </div>`;
}
function rowMov(x) {
  const c = cat(x.categoriaId);
  return `<div class="row tap" data-a="editMov" data-id="${x.id}">
    ${catIc(c)}
    <div class="row-main"><div class="row-t">${h(x.descrizione || c.nome)}</div>
      <div class="row-s"><span>${fmtData(x.data)} · ${h(c.nome)}${x.metodo && cassa(x) > 0 ? ' · ' + METODI[x.metodo] : ''}</span>${+x.buoni ? `<span class="pill ok">🍽️ ${x.buoni} ${+x.buoni === 1 ? 'buono' : 'buoni'}</span>` : ''}</div></div>
    <div class="amt">${fmt(x.importo)}${+x.buoni ? `<small>${cassa(x) > 0 ? fmt(cassa(x)) + ' in denaro' : 'tutto in buoni'}</small>` : ''}</div>
  </div>`;
}

function budgetCategorie(y, m, conTitolo) {
  const cats = S.categorie.filter(c => +c.budget > 0);
  if (!cats.length) return '';
  const rows = cats.map(c => ({c, b: +c.budget, ...spesoCategoria(c.id, y, m)})).sort((a, b) => b.speso / b.b - a.speso / a.b);
  return `<section>
    <div class="sec-h"><h2>Budget per categoria</h2><button class="link" data-a="budgets">Modifica</button></div>
    <div class="card bud-list">${rows.map(r => {
      const pct = r.speso / r.b * 100, over = r.speso > r.b, rest = r.b - r.speso;
      const col = over ? 'var(--danger)' : pct >= 80 ? 'var(--warn)' : r.c.colore;
      const sfora = !over && r.daConf > 0 && r.speso + r.daConf > r.b;
      return `<div class="bud">
        <div class="kv"><span>${h(r.c.icona)} ${h(r.c.nome)}</span><b class="small${over ? ' neg' : ''}">${fmt(r.speso)} <span class="muted" style="font-weight:500">/ ${fmt(r.b)}</span></b></div>
        <div style="margin:7px 0 5px">${bar(pct, col)}</div>
        <div class="row-s">${over ? `<span class="pill danger">Superato di ${fmt(-rest)}</span>` : `<span class="pill${pct >= 80 ? ' warn' : ''}">Restano ${fmt(rest)}</span>`}${r.inBuoni ? `<span>+ ${fmt(r.inBuoni)} in buoni pasto</span>` : ''}${r.daConf ? `<span>${fmt(r.daConf)} di spese previste ancora da pagare</span>` : ''}${sfora ? '<span class="pill warn">Con le previste sforerai</span>' : ''}</div>
      </div>`;
    }).join('')}</div>
  </section>`;
}

// ───────────────────────── Vista: Mese ─────────────────────────
function vMese() {
  if (!S.previste.length && !S.movimenti.length) return welcome();
  const d = datiMese(cur.y, cur.m), b = +S.imp.budgetExtra || 0;
  const ex = d.ex.slice().sort((a, b) => b.data.localeCompare(a.data));
  const acc = sum(attive().filter(p => nAnno(p) < 12), mensileEq);
  const prossimeNonMensili = d.da.filter(o => nAnno(o.p) < 12);
  return `
  <section class="card hero">
    <div class="hero-lbl">${d.ent ? 'Ti resta a fine mese (stima)' : 'Uscite stimate del mese'}</div>
    <div class="hero-val${d.ent && d.resto < 0 ? ' neg' : ''}">${fmt(d.ent ? d.resto : d.pagato + d.totDa)}</div>
    <div class="hero-grid">
      <div><span>Entrate</span><b>${fmt(d.ent)}</b></div>
      <div><span>Già speso</span><b>${fmt(d.pagato)}</b></div>
      <div><span>Ancora da pagare</span><b>${fmt(d.totDa)}</b></div>
    </div>
    ${haBuoni() ? (sb => `<button class="hero-buoni" data-a="buoni"><span>🍽️ Buoni pasto restanti</span><b>${testoSaldoBuoni(sb)}</b></button>`)(saldoBuoni()) : ''}
    ${d.ent ? '' : `<button class="link" data-a="nav" data-id="altro">Aggiungi le entrate per vedere quanto ti resta →</button>`}
  </section>

  ${b ? `<section class="card">
    <div class="kv"><span class="small muted">Budget spese extra</span><b class="small">${fmt(d.totEx)} / ${fmt(b)}</b></div>
    <div style="margin-top:10px">${bar(d.totEx / b * 100, null, d.totEx > b)}</div>
    <div class="hint" style="margin-top:8px">${d.totEx > b ? `Hai superato il budget di <b>${fmt(d.totEx - b)}</b>.` : `Puoi ancora spendere <b>${fmt(b - d.totEx)}</b> in extra questo mese.`}${d.exBuoni ? ` Conta solo la parte pagata in denaro: altri ${fmt(d.exBuoni)} sono stati pagati con ${d.nBuoni} buoni pasto.` : ''}</div>
  </section>` : ''}

  ${(() => { const att = d.da.filter(o => o.attesa); if (!att.length) return '';
    return `<div class="tip"><span class="em">📄</span><div>${att.length === 1 ? 'Hai una bolletta' : `Hai <b>${att.length}</b> bollette`} da inserire per ${MESI[cur.m - 1].toLowerCase()}: ${att.map(o => `<button class="link" data-a="bolletta" data-id="${o.p.id}|${o.periodo}">${h(o.p.voce)}</button>`).join(', ')}. Appena conosci data e importo, inseriscili: l'app li userà per scadenze, saldo e budget.</div></div>`; })()}

  ${avvisoCalendario()}

  ${budgetCategorie(cur.y, cur.m)}

  ${prossimeNonMensili.length ? `<div class="tip warn"><span class="em">📌</span><div>Questo mese ci sono <b>${prossimeNonMensili.length}</b> spese non mensili da pagare (${prossimeNonMensili.map(o => h(o.p.voce)).join(', ')}) per <b>${fmt(sum(prossimeNonMensili, o => o.importo))}</b>.</div></div>` : ''}

  <section>
    <div class="sec-h"><h2>Da confermare<span class="count">${d.da.length}</span></h2><span class="muted small">${fmt(d.totDa)}</span></div>
    ${d.da.length ? `<div class="list">${d.da.map(rowDaConfermare).join('')}</div>`
      : `<div class="card empty-s">${d.occ.length ? 'Tutte le spese previste del mese sono confermate ✓' : 'Nessuna spesa prevista per questo mese.'}</div>`}
  </section>

  ${d.ok.length || d.orf.length ? `<section><details class="more"${d.da.length ? '' : ' open'}>
    <summary>Confermate<span class="count">${d.ok.length + d.orf.length}</span> <span class="muted small" style="font-weight:500">· ${fmt(d.totOk)}</span></summary>
    <div class="list">${d.ok.map(rowConfermata).join('')}${d.orf.map(rowMov).join('')}</div>
  </details></section>` : ''}

  <section>
    <div class="sec-h"><h2>Spese extra<span class="count">${ex.length}</span></h2><span class="muted small">${fmt(d.totEx)}</span></div>
    ${ex.length ? `<div class="list">${ex.map(rowMov).join('')}</div>`
      : `<div class="card empty-s">Nessuna spesa extra registrata.<br><button class="link" style="margin-top:8px" data-a="newMov">+ Aggiungi spesa extra</button></div>`}
  </section>

  ${acc > 0 ? `<div class="tip"><span class="em">🐷</span><div>Per coprire le spese non mensili (annuali, bimestrali…) dovresti accantonare <b>${fmt(acc)} al mese</b>. <button class="link" data-a="nav" data-id="categorie">Dettaglio →</button></div></div>` : ''}
  `;
}

function welcome() {
  return `<section class="card welcome">
    <div class="big">👋</div>
    <h2>Benvenuto in Spese di Casa</h2>
    <p>Inizia inserendo le <b>spese previste</b>: affitto, bollette, abbonamenti, rate, assicurazioni. Ogni mese l'app ti mostra cosa c'è da pagare e tu lo confermi con un tocco.</p>
    <div class="btn-row" style="width:100%;max-width:420px;margin-top:6px">
      <button class="btn" data-a="addPrev">Aggiungi spesa prevista</button>
    </div>
    <button class="link" data-a="seed">Oppure prova con dati di esempio</button>
  </section>`;
}

// ───────────────────────── Vista: Previste ─────────────────────────
function vPreviste() {
  if (!S.previste.length) return welcome();
  const att = attive();
  let list = S.previste.slice();
  if (fPrev.cat) list = list.filter(p => p.categoriaId === fPrev.cat);
  if (fPrev.prio) list = list.filter(p => p.priorita === fPrev.prio);
  const ordCat = id => S.categorie.findIndex(c => c.id === id);
  list.sort((a, b) => (a.attiva === false) - (b.attiva === false) || ordCat(a.categoriaId) - ordCat(b.categoriaId) || a.voce.localeCompare(b.voce));
  const lAtt = list.filter(p => p.attiva !== false);
  const usate = S.categorie.filter(c => S.previste.some(p => p.categoriaId === c.id));
  const filtrato = fPrev.cat || fPrev.prio;

  const filters = `<div class="filters">
    <select data-ch="fCat" aria-label="Filtra per categoria"><option value="">Tutte le categorie</option>${usate.map(c => `<option value="${c.id}"${fPrev.cat === c.id ? ' selected' : ''}>${h(c.icona + ' ' + c.nome)}</option>`).join('')}</select>
    <select data-ch="fPrio" aria-label="Filtra per priorità"><option value="">Ogni priorità</option>${Object.entries(PRIO).map(([k, v]) => `<option value="${k}"${fPrev.prio === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
    <div class="seg"><button class="${fPrev.mode === 'card' ? 'on' : ''}" data-a="mode" data-id="card">Schede</button><button class="${fPrev.mode === 'table' ? 'on' : ''}" data-a="mode" data-id="table">Tabella</button></div>
  </div>`;

  const body = fPrev.mode === 'table' ? `<div class="table-wrap"><table>
      <thead><tr><th>Voce</th><th>Categoria</th><th>Tipo</th><th>Frequenza</th><th class="n">Importo</th><th class="n">Mensile eq.</th><th class="n">Annuo</th><th>Scadenza</th><th>Metodo</th><th>Priorità</th></tr></thead>
      <tbody>${list.map(p => { const c = cat(p.categoriaId); return `<tr data-a="editPrev" data-id="${p.id}" class="${p.attiva === false ? 'off' : ''}">
        <td><b>${h(p.voce)}</b></td><td>${h(c.icona)} ${h(c.nome)}</td><td>${TIPI[p.tipo] || ''}</td><td>${FREQ[p.frequenza].l}</td>
        <td class="n">${p.bolletta ? '≈ ' : ''}${fmt(impPrev(p))}</td><td class="n">${fmt(mensileEq(p))}</td><td class="n">${fmt(annuo(p))}</td>
        <td>${h(scadenzaTesto(p))}${(r => r ? ` · ${r.mancanti} rate mancanti` : '')(rateInfo(p))}</td><td>${METODI[p.metodo] || ''}${isAuto(p) ? ' ⚡' : ''}</td><td><span class="prio prio-${p.priorita}">${PRIO[p.priorita] || ''}</span></td></tr>`; }).join('')}</tbody>
      <tfoot><tr><td colspan="5">Totale${filtrato ? ' (filtro)' : ''} · solo attive</td><td class="n">${fmt(sum(lAtt, mensileEq))}</td><td class="n">${fmt(sum(lAtt, annuo))}</td><td colspan="3"></td></tr></tfoot>
    </table></div>`
    : `<div style="display:flex;flex-direction:column;gap:10px">${list.map(cardPrev).join('') || '<div class="card empty-s">Nessuna voce con questi filtri.</div>'}</div>`;

  return `
  <div class="stats">
    <div class="stat"><span>Mensile equiv.</span><b>${fmt(sum(att, mensileEq))}</b></div>
    <div class="stat"><span>Annuo</span><b>${fmt(sum(att, annuo))}</b></div>
    <div class="stat"><span>Voci attive</span><b>${att.length}</b></div>
  </div>
  ${filters}
  ${filtrato ? `<div class="hint">Filtro attivo: ${lAtt.length} voci · ${fmt(sum(lAtt, mensileEq))}/mese · ${fmt(sum(lAtt, annuo))}/anno</div>` : ''}
  ${body}`;
}
function rateBox(p) {
  const ri = rateInfo(p); if (!ri) return '';
  if (ri.finita) return `<div class="rate-line"><b>✓ Finanziamento concluso</b> <span class="muted small">· ultima rata ${fmtYM(ri.ultima)}</span></div>`;
  return `<div class="rate-line">
    <div class="kv small"><span>${ri.totali ? `Pagate <b>${ri.pagate}</b> di ${ri.totali}` : '💳 Finanziamento'}</span><span><b>${ri.mancanti}</b> ${ri.mancanti === 1 ? 'rata mancante' : 'rate mancanti'}</span></div>
    ${ri.totali ? `<div style="margin:7px 0">${bar(ri.pagate / ri.totali * 100)}</div>` : ''}
    <div class="kv small"><span class="muted">Debito residuo</span><b>${fmt(ri.residuo)}</b></div>
    <div class="kv small"><span class="muted">Ultima rata</span><b>${MESI[+ri.ultima.slice(5, 7) - 1].toLowerCase()} ${ri.ultima.slice(0, 4)}</b></div>
  </div>`;
}
function cardPrev(p) {
  const c = cat(p.categoriaId);
  return `<div class="card prev${p.attiva === false ? ' off' : ''}" data-a="editPrev" data-id="${p.id}">
    <div class="prev-top">${catIc(c)}<div><div class="row-t">${h(p.voce)}</div><div class="row-s">${h(c.nome)} · ${TIPI[p.tipo] || ''}${p.attiva === false ? ' · <b>disattivata</b>' : ''}</div></div>
      <span class="prio prio-${p.priorita}">${PRIO[p.priorita] || ''}</span></div>
    <div class="prev-nums">
      <div><span>${p.bolletta ? 'Stima' : 'Per pagamento'}</span><b>${fmt(impPrev(p))}</b><small>${p.bolletta && nStima(p) ? `media ultime ${nStima(p)}` : FREQ[p.frequenza].l}</small></div>
      <div><span>Mensile equiv.</span><b>${fmt(mensileEq(p))}</b></div>
      <div><span>Annuo</span><b>${fmt(annuo(p))}</b></div>
    </div>
    ${rateBox(p)}
    <div class="row-s">${p.bolletta ? '📄 data e importo dalla bolletta' : '📅 ' + h(scadenzaTesto(p))} · ${METODI[p.metodo] || ''}${isAuto(p) ? ' · ⚡ conferma automatica' : ''}${p.fine ? ' · fino a ' + fmtYM(p.fine) : ''}${p.inizio ? ' · da ' + fmtYM(p.inizio) : ''}</div>
  </div>`;
}

// ───────────────────────── Vista: Categorie ─────────────────────────
function vCategorie() {
  const att = attive();
  if (!att.length && !S.movimenti.length) return welcome();
  const tm = sum(att, mensileEq);
  const groups = S.categorie.map(c => {
    const items = att.filter(p => p.categoriaId === c.id);
    return {c, items, m: sum(items, mensileEq), a: sum(items, annuo)};
  }).filter(g => g.items.length).sort((a, b) => b.m - a.m);

  const prio = Object.keys(PRIO).map(k => { const it = att.filter(p => p.priorita === k); return {k, n: it.length, m: sum(it, mensileEq)}; });
  const tagl = att.filter(p => p.priorita === 'tagliabile').sort((a, b) => mensileEq(b) - mensileEq(a));
  const nonMens = att.filter(p => nAnno(p) < 12).sort((a, b) => mensileEq(b) - mensileEq(a));
  const tipi = Object.keys(TIPI).map(k => { const it = att.filter(p => p.tipo === k); return {k, n: it.length, m: sum(it, mensileEq)}; }).filter(x => x.n);

  // media spese extra ultimi 3 mesi completi
  const t = today(), mesi = [1, 2, 3].map(i => addMonths(t.y, t.m, -i)).map(x => ymKey(x.y, x.m));
  const exAll = S.movimenti.filter(x => x.tipo === 'extra' && mesi.some(k => (x.data || '').startsWith(k)));
  const exG = S.categorie.map(c => ({c, m: sum(exAll.filter(x => x.categoriaId === c.id), x => x.importo) / 3})).filter(g => g.m > 0).sort((a, b) => b.m - a.m);
  const exTot = sum(exG, g => g.m);

  return `
  <div class="stats">
    <div class="stat"><span>Mensile equiv.</span><b>${fmt(tm)}</b></div>
    <div class="stat"><span>Annuo</span><b>${fmt(tm * 12)}</b></div>
    <div class="stat"><span>Categorie</span><b>${groups.length}</b></div>
  </div>

  <section>
    <div class="sec-h"><h2>Spese previste per categoria</h2><span class="muted small">tocca per i dettagli</span></div>
    <div class="list">${groups.map(g => `<details class="catrow"><summary>${catIc(g.c)}<div class="grow">
        <div class="line1"><span>${h(g.c.nome)}</span><span class="amt">${fmt(g.m)}<span class="muted small" style="font-weight:500">/mese</span></span></div>
        ${bar(tm ? g.m / groups[0].m * 100 : 0, g.c.colore)}
        <div class="line2"><span>${g.items.length} ${g.items.length === 1 ? 'voce' : 'voci'} · ${tm ? Math.round(g.m / tm * 100) : 0}% del totale</span><span>${fmt(g.a)}/anno</span></div>
      </div></summary>
      <div class="items">${g.items.sort((a, b) => mensileEq(b) - mensileEq(a)).map(p => `<div><span>${h(p.voce)} <span class="small">(${fmt(p.importo)} ${FREQ[p.frequenza].l.toLowerCase()})</span></span><b>${fmt(mensileEq(p))}</b></div>`).join('')}</div>
    </details>`).join('') || '<div class="empty-s">Nessuna spesa prevista attiva.</div>'}</div>
  </section>

  <section>
    <div class="sec-h"><h2>Per priorità</h2></div>
    <div class="card">${prio.map(x => `<div style="margin-bottom:12px"><div class="kv"><span><span class="prio prio-${x.k}">${PRIO[x.k]}</span> <span class="muted small">${x.n} voci</span></span><b>${fmt(x.m)}/mese</b></div>
      <div style="margin-top:6px">${bar(tm ? x.m / tm * 100 : 0, x.k === 'essenziale' ? 'var(--accent)' : x.k === 'utile' ? '#3c6fb0' : 'var(--warn)')}</div></div>`).join('')}
      ${tipi.length ? `<div class="kv total" style="font-size:.9rem"><span class="muted">Per tipo</span><span></span></div>${tipi.map(x => `<div class="kv small"><span>${TIPI[x.k]} <span class="muted">(${x.n})</span></span><b>${fmt(x.m)}/mese</b></div>`).join('')}` : ''}
    </div>
  </section>

  ${sezioneRate(att)}

  ${tagl.length ? `<section>
    <div class="sec-h"><h2>✂️ Simulazione tagli</h2></div>
    <div class="tip warn"><span class="em">💡</span><div>Eliminando tutte le voci <b>tagliabili</b> risparmieresti <b>${fmt(sum(tagl, mensileEq))} al mese</b>, cioè <b>${fmt(sum(tagl, annuo))} all'anno</b>.</div></div>
    <div class="list">${tagl.map(p => `<div class="row tap" data-a="editPrev" data-id="${p.id}">${catIc(cat(p.categoriaId), 1)}<div class="row-main"><div class="row-t">${h(p.voce)}</div><div class="row-s">${fmt(annuo(p))} all'anno</div></div><div class="amt">${fmt(mensileEq(p))}<small>/mese</small></div></div>`).join('')}</div>
  </section>` : ''}

  ${nonMens.length ? `<section>
    <div class="sec-h"><h2>🐷 Accantonamento mensile</h2></div>
    <div class="tip"><span class="em">💶</span><div>Per non farti trovare impreparato dalle spese non mensili, metti da parte <b>${fmt(sum(nonMens, mensileEq))} ogni mese</b>.</div></div>
    <div class="list">${nonMens.map(p => `<div class="row tap" data-a="editPrev" data-id="${p.id}">${catIc(cat(p.categoriaId), 1)}<div class="row-main"><div class="row-t">${h(p.voce)}</div><div class="row-s">${fmt(p.importo)} · ${h(scadenzaTesto(p))}</div></div><div class="amt">${fmt(mensileEq(p))}<small>/mese</small></div></div>`).join('')}</div>
  </section>` : ''}

  ${exG.length ? `<section>
    <div class="sec-h"><h2>Spese extra: media mensile</h2><span class="muted small">ultimi 3 mesi</span></div>
    <div class="card">${exG.map(g => `<div style="margin-bottom:12px"><div class="kv"><span>${h(g.c.icona)} ${h(g.c.nome)}</span><b>${fmt(g.m)}</b></div><div style="margin-top:6px">${bar(g.m / exG[0].m * 100, g.c.colore)}</div></div>`).join('')}
    <div class="kv total"><span>Totale medio extra</span><b>${fmt(exTot)}/mese</b></div></div>
  </section>` : ''}
  `;
}

function sezioneRate(att) {
  const fin = att.map(p => ({p, ri: rateInfo(p)})).filter(x => x.ri && !x.ri.finita).sort((a, b) => a.ri.ultima.localeCompare(b.ri.ultima));
  if (!fin.length) return '';
  const tot = sum(fin, x => x.ri.residuo), mens = sum(fin, x => mensileEq(x.p));
  const prima = fin[0], libera = addMonths(+prima.ri.ultima.slice(0, 4), +prima.ri.ultima.slice(5, 7), 1);
  return `<section>
    <div class="sec-h"><h2>💳 Rate e finanziamenti</h2></div>
    <div class="stats">
      <div class="stat"><span>Debito residuo</span><b>${fmt(tot)}</b></div>
      <div class="stat"><span>Rate al mese</span><b>${fmt(mens)}</b></div>
      <div class="stat"><span>Finanziamenti</span><b>${fin.length}</b></div>
    </div>
    <div class="list">${fin.map(({p, ri}) => `<div class="row tap" data-a="editPrev" data-id="${p.id}">${catIc(cat(p.categoriaId), 1)}
      <div class="row-main"><div class="row-t">${h(p.voce)}</div><div class="row-s">${ri.mancanti} rate mancanti · ultima ${fmtYM(ri.ultima)}</div>
      ${ri.totali ? `<div style="margin-top:7px">${bar(ri.pagate / ri.totali * 100)}</div>` : ''}</div>
      <div class="amt">${fmt(ri.residuo)}<small>${fmt(p.importo)}/rata</small></div></div>`).join('')}</div>
    <div class="tip"><span class="em">🎯</span><div>Da <b>${MESI[libera.m - 1].toLowerCase()} ${libera.y}</b>, finito "${h(prima.p.voce)}", avrai <b>${fmt(mensileEq(prima.p))} in più al mese</b>.</div></div>
  </section>`;
}

// ───────────────────────── Vista: Report ─────────────────────────
function vReport() {
  if (!S.previste.length && !S.movimenti.length) return welcome();
  const d = datiMese(cur.y, cur.m), b = +S.imp.budgetExtra || 0;
  const nTot = d.occ.length, nOk = d.ok.length;
  const prevOk = sum(d.ok, o => o.stima), effOk = sum(d.ok, o => o.mov.importo), scost = effOk - prevOk;
  const diffs = d.ok.filter(o => Math.abs(o.mov.importo - o.stima) >= 0.01).sort((a, b) => Math.abs(b.mov.importo - b.stima) - Math.abs(a.mov.importo - a.stima));
  const exG = S.categorie.map(c => { const it = d.ex.filter(x => x.categoriaId === c.id); return {c, n: it.length, t: sum(it, x => x.importo), bv: sum(it, x => +x.buoniValore || 0)}; }).filter(g => g.n).sort((a, b) => b.t - a.t);
  const sb = saldoBuoni(), ricMese = S.buoni.ricariche.filter(r => (r.data || '').startsWith(d.k));

  // andamento ultimi 6 mesi
  const trend = [5, 4, 3, 2, 1, 0].map(i => { const x = addMonths(cur.y, cur.m, -i); const dd = datiMese(x.y, x.m); return {x, f: dd.totOk, e: dd.totEx}; });
  const maxT = Math.max(1, ...trend.map(t => t.f + t.e));

  return `
  <section>
    <div class="sec-h"><h2>Spese previste</h2><span class="muted small">${nOk} di ${nTot} confermate</span></div>
    <div class="card">
      ${bar(nTot ? nOk / nTot * 100 : 0)}
      <div class="stats" style="margin-top:14px">
        <div><span class="small muted">Confermate (${nOk})</span><b style="display:block">${fmt(effOk)}</b></div>
        <div><span class="small muted">Da confermare (${d.da.length})</span><b style="display:block">${fmt(d.totDa)}</b></div>
        <div><span class="small muted">Scostamento</span><b style="display:block;color:${scost > 0.004 ? 'var(--danger)' : scost < -0.004 ? 'var(--accent)' : 'inherit'}">${scost > 0 ? '+' : ''}${fmt(scost)}</b></div>
      </div>
      ${d.da.length ? `<div class="hint" style="margin-top:12px">Ancora da confermare: ${d.da.map(o => `<b>${h(o.p.voce)}</b>`).join(', ')}.</div>` : nTot ? `<div class="hint" style="margin-top:12px">Tutte confermate ✓</div>` : ''}
    </div>
  </section>

  ${diffs.length ? `<section>
    <div class="sec-h"><h2>Previsto vs effettivo</h2></div>
    <div class="list">${diffs.map(o => { const df = o.mov.importo - o.stima; return `<div class="row tap" data-a="conferma" data-id="${o.p.id}|${o.periodo}">${catIc(cat(o.p.categoriaId), 1)}<div class="row-main"><div class="row-t">${h(o.p.voce)}</div><div class="row-s">${o.p.bolletta ? 'stima' : 'previsto'} ${fmt(o.stima)} · pagato ${fmt(o.mov.importo)}</div></div><div class="amt ${df > 0 ? 'neg' : ''}">${df > 0 ? '+' : ''}${fmt(df)}</div></div>`; }).join('')}</div>
  </section>` : ''}

  <section>
    <div class="sec-h"><h2>Spese extra</h2><span class="muted small">${d.ex.length} spese · ${fmt(d.totEx + d.exBuoni)}</span></div>
    <div class="card">
      ${d.exBuoni ? `<div class="kv small" style="margin-bottom:10px"><span class="muted">In denaro ${fmt(d.totEx)} · in buoni ${fmt(d.exBuoni)}</span><span></span></div>` : ''}
      ${b ? `<div class="kv small"><span class="muted">Budget (solo denaro)</span><b>${fmt(d.totEx)} / ${fmt(b)}</b></div><div style="margin:8px 0 16px">${bar(d.totEx / b * 100, null, d.totEx > b)}</div>` : ''}
      ${exG.length ? exG.map(g => `<div style="margin-bottom:12px"><div class="kv"><span>${h(g.c.icona)} ${h(g.c.nome)} <span class="muted small">× ${g.n}</span></span><b>${fmt(g.t)}${g.bv ? ` <span class="muted small" style="font-weight:500">(${fmt(g.bv)} in buoni)</span>` : ''}</b></div><div style="margin-top:6px">${bar(g.t / exG[0].t * 100, g.c.colore)}</div></div>`).join('')
        : '<div class="empty-s" style="padding:6px">Nessuna spesa extra in questo mese.</div>'}
    </div>
  </section>

  ${haBuoni() ? `<section>
    <div class="sec-h"><h2>🍽️ Buoni pasto</h2><button class="link" data-a="buoni">Dettagli</button></div>
    <div class="card">
      <div class="kv"><span>Usati nel mese</span><b>${d.nBuoni} · ${fmt(d.exBuoni)}</b></div>
      <div class="kv"><span>Ricaricati nel mese</span><b>${sum(ricMese, r => +r.numero)} · ${fmt(sum(ricMese, r => r.numero * r.taglio))}</b></div>
      <div class="kv total"><span>Restanti oggi</span><b style="color:var(--accent)">${testoSaldoBuoni(sb)}</b></div>
    </div>
  </section>` : ''}

  ${budgetCategorie(cur.y, cur.m)}

  <section>
    <div class="sec-h"><h2>Bilancio del mese</h2></div>
    <div class="card">
      <div class="kv"><span>Entrate</span><b>${fmt(d.ent)}</b></div>
      <div class="kv"><span>Spese previste confermate</span><b>− ${fmt(d.totOk)}</b></div>
      <div class="kv"><span>Spese extra${d.exBuoni ? ' (in denaro)' : ''}</span><b>− ${fmt(d.totEx)}</b></div>
      <div class="kv"><span class="muted">Ancora da pagare (stima)</span><b class="muted">− ${fmt(d.totDa)}</b></div>
      <div class="kv total"><span>Saldo previsto</span><b style="color:${d.resto < 0 ? 'var(--danger)' : 'var(--accent)'}">${fmt(d.resto)}</b></div>
      ${haBuoni() ? `<div class="kv" style="margin-top:10px"><span class="muted">🍽️ A parte: buoni pasto restanti</span><b>${fmt(sb.valore)}</b></div>` : ''}
    </div>
  </section>

  <section>
    <div class="sec-h"><h2>Andamento ultimi 6 mesi</h2></div>
    <div class="card">
      <div class="legend"><span><i style="background:var(--accent)"></i>Previste confermate</span><span><i style="background:#c0792e"></i>Extra</span></div>
      <div class="trend">${trend.map(t => `<div class="col${t.x.y === cur.y && t.x.m === cur.m ? ' cur' : ''}" data-a="goMonth" data-id="${t.x.y}-${t.x.m}">
        <div class="val">${t.f + t.e ? Math.round(t.f + t.e) : ''}</div>
        <div class="stack" style="height:${((t.f + t.e) / maxT * 100).toFixed(1)}%"><i style="height:${t.f + t.e ? (t.f / (t.f + t.e) * 100).toFixed(1) : 0}%;background:var(--accent)"></i><i style="height:${t.f + t.e ? (t.e / (t.f + t.e) * 100).toFixed(1) : 0}%;background:#c0792e"></i></div>
        <span>${MESI_B[t.x.m - 1]}</span></div>`).join('')}</div>
    </div>
  </section>

  <button class="btn ghost block" data-a="exportMese">Esporta il mese in CSV</button>
  `;
}

// ───────────────────────── Vista: Altro ─────────────────────────
function vAltro() {
  const ent = S.entrate.slice().sort((a, b) => (+a.mese || 0) - (+b.mese || 0));
  return `
  <section>
    <div class="sec-h"><h2>Entrate</h2><button class="link" data-a="addEnt">+ Aggiungi</button></div>
    <div class="list">${ent.map(e => `<div class="row tap" data-a="editEnt" data-id="${e.id}"><span class="cat-ic" style="--c:#2f7d5b">💶</span><div class="row-main"><div class="row-t">${h(e.voce)}</div><div class="row-s">${+e.mese ? 'Ogni anno a ' + MESI[e.mese - 1].toLowerCase() : 'Ogni mese'}</div></div><div class="amt">${fmt(e.importo)}</div></div>`).join('')
      || '<div class="empty-s">Aggiungi stipendio e altre entrate per sapere quanto ti resta ogni mese.</div>'}</div>
  </section>

  <section>
    <div class="sec-h"><h2>🍽️ Buoni pasto</h2>${haBuoni() ? '<button class="link" data-a="buoni">Storico</button>' : ''}</div>
    ${haBuoni() ? (sb => `<div class="card buoni-card">
      <div><div class="muted small">Restanti</div><div class="buoni-big">${sb.n} <span class="muted" style="font-size:1rem;font-weight:600">buoni</span></div><div class="small muted">${sb.tagli.length === 1 ? `da ${fmt(sb.tagli[0])} · ` : ''}valore ${fmt(sb.valore)}</div></div>
      <button class="btn" data-a="ricarica">+ Ricarica</button>
    </div>`)(saldoBuoni()) : `<div class="list"><div class="empty-s">Se ricevi buoni pasto, inserisci la prima ricarica: potrai usarli nelle spese delle categorie abilitate.<br><button class="link" style="margin-top:8px" data-a="ricarica">+ Prima ricarica</button></div></div>`}
    <div class="hint">Categorie dove si possono usare: ${S.categorie.filter(c => c.buoni).map(c => h(c.icona + ' ' + c.nome)).join(', ') || 'nessuna'}. Puoi cambiarle da Categorie qui sotto.</div>
  </section>

  <section>
    <div class="sec-h"><h2>Impostazioni</h2></div>
    <div class="list">
      <div class="set-row"><div><div class="row-t">Budget spese extra</div><div class="row-s">Tetto mensile per le spese non previste</div></div><input type="text" inputmode="decimal" data-ch="budget" value="${numIn(S.imp.budgetExtra || '')}" placeholder="0,00"></div>
      <div class="set-row"><div><div class="row-t">Avviso scadenze</div><div class="row-s">Giorni di preavviso nell'elenco del mese</div></div><input type="number" min="0" max="30" data-ch="preavviso" value="${+S.imp.preavviso || 0}"></div>
    </div>
  </section>

  <section>
    <div class="sec-h"><h2>Budget per categoria</h2><button class="link" data-a="budgets">Imposta</button></div>
    <div class="list">${S.categorie.filter(c => +c.budget > 0).map(c => `<div class="set-row tap" data-a="budgets">${catIc(c, 1)}<div class="row-main"><div class="row-t">${h(c.nome)}</div></div><b>${fmt(c.budget)}/mese</b></div>`).join('')
      || '<div class="empty-s">Nessun budget impostato. <button class="link" data-a="budgets">Imposta i budget →</button></div>'}</div>
  </section>

  <section>
    <div class="sec-h"><h2>🔔 Notifiche scadenze</h2><button class="link" data-a="icsHelp">Come funziona</button></div>
    <div class="hint">Le notifiche arrivano da Google Calendar: esporti le scadenze dei prossimi 12 mesi e le importi una volta. Ricevi una notifica al giorno, solo nei giorni con scadenze.</div>
    <div class="list">
      <div class="set-row"><div><div class="row-t">Ora della notifica</div></div><input type="time" data-ch="notifOra" value="${h(S.imp.notifOra || '09:00')}"></div>
      <div class="set-row"><div><div class="row-t">Quando</div></div><select data-ch="notifQuando" style="max-width:170px"><option value="giorno"${S.imp.notifQuando !== 'prima' ? ' selected' : ''}>Il giorno stesso</option><option value="prima"${S.imp.notifQuando === 'prima' ? ' selected' : ''}>Il giorno prima</option></select></div>
      <label class="set-row" style="cursor:pointer"><div class="row-main"><div class="row-t">Includi addebiti automatici</div><div class="row-s">Avvisa anche per gli addebiti che si confermano da soli</div></div><input type="checkbox" class="tgl" data-ch="notifAuto"${S.imp.notifAuto ? ' checked' : ''}></label>
    </div>
    <button class="btn block" data-a="exportIcs">📅 Esporta calendario scadenze</button>
    <div class="hint" style="text-align:center">${S.imp.icsAt ? `Ultima esportazione: ${fmtData(S.imp.icsAt)}${S.imp.icsSig !== firmaCalendario() ? ' · <b style="color:var(--warn)">da aggiornare</b>' : ' · aggiornato ✓'}` : 'Non ancora esportato'}</div>
  </section>

  <section>
    <div class="sec-h"><h2>⚡ Conferma automatica addebiti</h2></div>
    ${(() => { const add = S.previste.filter(p => p.metodo === 'addebito' && p.attiva !== false).sort((a, b) => a.voce.localeCompare(b.voce));
      return add.length ? `<div class="hint">Gli addebiti attivati qui vengono confermati da soli il giorno della scadenza. Le bollette variabili vengono confermate con l'importo previsto: potrai correggerlo in seguito.</div>
      <div class="btn-row"><button class="btn ghost sm" data-a="autoAll" data-id="1">Attiva tutti</button><button class="btn ghost sm" data-a="autoAll" data-id="0">Disattiva tutti</button></div>
      <div class="list">${add.map(p => `<label class="set-row" style="cursor:pointer">${catIc(cat(p.categoriaId), 1)}<div class="row-main"><div class="row-t">${h(p.voce)}</div><div class="row-s">${fmt(p.importo)} · ${h(scadenzaTesto(p))}${p.tipo === 'variabile' ? ' · variabile' : ''}</div></div><input type="checkbox" class="tgl" data-ch="auto" data-id="${p.id}"${p.autoConferma ? ' checked' : ''}></label>`).join('')}</div>`
      : '<div class="list"><div class="empty-s">Nessuna spesa prevista con metodo "Addebito".</div></div>'; })()}
  </section>

  <section>
    <div class="sec-h"><h2>Categorie</h2><button class="link" data-a="addCat">+ Aggiungi</button></div>
    <div class="list">${S.categorie.map(c => `<div class="row tap" data-a="editCat" data-id="${c.id}">${catIc(c, 1)}<div class="row-main"><div class="row-t">${h(c.nome)}</div><div class="row-s">${c.uso === 'fissa' ? 'Spese previste' : c.uso === 'extra' ? 'Spese extra' : 'Previste ed extra'}${+c.budget > 0 ? ' · budget ' + fmt(c.budget) : ''}${c.buoni ? ' · 🍽️ buoni pasto' : ''}</div></div><span class="muted">›</span></div>`).join('')}</div>
  </section>

  <section>
    <div class="sec-h"><h2>Backup e dati</h2></div>
    <div class="tip"><span class="em">💾</span><div>I dati sono salvati <b>solo su questo dispositivo</b>. Fai un backup ogni tanto (per esempio su Google Drive) per non perderli se cambi telefono o cancelli i dati del browser.</div></div>
    ${storageOk ? '' : '<div class="tip warn"><span class="em">⚠️</span><div>Il salvataggio locale non è disponibile in questo contesto: i dati andranno persi alla chiusura. Apri l\'app dal suo indirizzo o installala.</div></div>'}
    <div class="btn-row"><button class="btn" data-a="exportJson">Esporta backup</button><button class="btn ghost" data-a="importJson">Ripristina backup</button></div>
    <div class="btn-row"><button class="btn ghost" data-a="exportPrev">CSV spese previste</button><button class="btn ghost" data-a="exportMov">CSV movimenti</button></div>
  </section>

  <section>
    <div class="sec-h"><h2>App</h2></div>
    <div class="list">
      ${installEvt ? `<div class="set-row tap" data-a="install"><div><div class="row-t">Installa l'app</div><div class="row-s">Aggiungila alla schermata home</div></div><span class="muted">›</span></div>` : ''}
      <div class="set-row tap" data-a="seed"><div><div class="row-t">Carica dati di esempio</div><div class="row-s">Sostituisce i dati attuali</div></div><span class="muted">›</span></div>
      <div class="set-row tap" data-a="reset"><div><div class="row-t" style="color:var(--danger)">Cancella tutti i dati</div><div class="row-s">Operazione non reversibile</div></div><span class="muted">›</span></div>
    </div>
    <div class="hint" style="text-align:center">Spese di Casa · v1.4 · ${S.previste.length} previste · ${S.movimenti.length} movimenti</div>
  </section>`;
}

// ───────────────────────── Sheet (finestre dal basso) ─────────────────────────
let sheetOpen = false, sheetPushed = false;
function openSheet(title, body, onMount) {
  const wasOpen = sheetOpen;   // se una finestra è già aperta la sostituiamo senza toccare la cronologia
  const root = $('#sheet-root');
  root.innerHTML = `<div class="sheet-bg" data-a="bgClose"><div class="sheet" role="dialog" aria-modal="true" aria-label="${h(title)}">
    <div class="sheet-grab"></div><div class="sheet-h"><h3>${h(title)}</h3><button class="x" data-a="closeSheet" aria-label="Chiudi">✕</button></div>
    <div class="sheet-body">${body}</div></div></div>`;
  sheetOpen = true;
  if (!wasOpen) { try { history.pushState({sheet: 1}, ''); sheetPushed = true; } catch (e) { sheetPushed = false; } }
  document.body.style.overflow = 'hidden';
  if (onMount) onMount($('.sheet', root));
}
function closeSheet(silent, fromPop) {
  if (!sheetOpen) return;
  $('#sheet-root').innerHTML = '';
  sheetOpen = false;
  document.body.style.overflow = '';
  if (sheetPushed && !fromPop) { sheetPushed = false; try { history.back(); } catch (e) {} }
  sheetPushed = false;
}
window.addEventListener('popstate', () => { if (sheetOpen) closeSheet(true, true); });

function askConfirm(msg, okLbl, cb, danger) {
  openSheet('Conferma', `<p style="margin:0 0 18px;line-height:1.45">${msg}</p>
    <div class="form-actions"><button class="btn ghost" data-a="closeSheet">Annulla</button><button class="btn${danger ? ' danger' : ''}" id="ok-btn">${h(okLbl)}</button></div>`,
    el => { $('#ok-btn', el).onclick = () => { closeSheet(); cb(); }; });
}
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200); }

const optList = (obj, sel) => Object.entries(obj).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${h(typeof v === 'object' ? v.l : v)}</option>`).join('');
const catOptions = (sel, ordine) => {
  const cats = S.categorie.slice();
  if (ordine) cats.sort((a, b) => (ordine.indexOf(a.uso) - ordine.indexOf(b.uso)));
  return cats.map(c => `<option value="${c.id}"${c.id === sel ? ' selected' : ''}>${h(c.icona + ' ' + c.nome)}</option>`).join('');
};
const chipsRadio = (name, obj, sel) => `<div class="chips">${Object.entries(obj).map(([k, v]) => `<label class="chip"><input type="radio" name="${name}" value="${k}"${k === sel ? ' checked' : ''}><span>${h(v)}</span></label>`).join('')}</div>`;

// ── Form: spesa prevista
function formPrevista(id) {
  const p = S.previste.find(x => x.id === id) || {voce:'', categoriaId:'c1', tipo:'fissa_mensile', frequenza:'mensile', importo:'', giorno:'', meseRif: today().m, metodo:'addebito', priorita:'essenziale', attiva:true, note:'', inizio:'', fine:''};
  const nuovo = !id;
  openSheet(nuovo ? 'Nuova spesa prevista' : 'Modifica spesa prevista', `
  <form id="fp" autocomplete="off">
    <div class="field"><label for="fp-voce">Voce</label><input type="text" id="fp-voce" name="voce" required value="${h(p.voce)}" placeholder="es. Affitto, Luce, Netflix"></div>
    <div class="field"><label for="fp-cat">Categoria</label><select id="fp-cat" name="categoriaId">${catOptions(p.categoriaId, ['fissa','entrambe','extra'])}</select></div>
    <div class="grid2">
      <div class="field"><label for="fp-tipo">Tipo</label><select id="fp-tipo" name="tipo">${optList(TIPI, p.tipo)}</select></div>
      <div class="field"><label for="fp-freq">Frequenza</label><select id="fp-freq" name="frequenza">${optList(FREQ, p.frequenza)}</select></div>
    </div>
    <div class="grid2">
      <div class="field"><label for="fp-imp">Importo per pagamento</label><input type="text" inputmode="decimal" id="fp-imp" name="importo" required value="${numIn(p.importo)}" placeholder="0,00"></div>
      <div class="field"><label for="fp-g">Giorno scadenza</label><input type="number" min="1" max="31" id="fp-g" name="giorno" value="${p.giorno || ''}" placeholder="fine mese"></div>
    </div>
    <div class="field" id="fp-mese-w"><label for="fp-mese">Mese del (primo) pagamento</label><select id="fp-mese" name="meseRif">${MESI.map((m, i) => `<option value="${i + 1}"${+p.meseRif === i + 1 ? ' selected' : ''}>${m}</option>`).join('')}</select><small id="fp-mesi-txt"></small></div>
    <div class="calc"><div><span>Mensile equiv.</span><b id="fp-me">—</b></div><div><span>Annuo</span><b id="fp-an">—</b></div></div>
    <div class="field"><span class="flabel">Metodo di pagamento</span>${chipsRadio('metodo', METODI, p.metodo)}</div>
    <div class="field"><span class="flabel">Priorità</span>${chipsRadio('priorita', PRIO, p.priorita)}</div>
    <label class="switch"><span>📄 Bolletta: data e importo cambiano ogni mese<br><small class="muted" id="fp-bol-h">Ogni mese inserisci data e importo appena li conosci. Finché non li inserisci, l'app usa come stima la media delle ultime 3 bollette.</small></span><input type="checkbox" name="bolletta"${p.bolletta ? ' checked' : ''}></label>
    <label class="switch"><span>💳 Pagamento a rate / finanziamento</span><input type="checkbox" name="rate"${p.rate ? ' checked' : ''}></label>
    <div id="fp-rate-box" class="rate-box">
      <div class="grid2">
        <div class="field"><label for="fp-nr">Rate totali</label><input type="number" min="1" max="600" inputmode="numeric" id="fp-nr" name="numRate" value="${+p.numRate || ''}" placeholder="es. 48"></div>
        <div class="field"><label for="fp-rm">Rate mancanti</label><input type="number" min="0" max="600" inputmode="numeric" id="fp-rm" placeholder="es. 19"></div>
      </div>
    </div>
    <div class="grid2">
      <div class="field"><label for="fp-in" id="fp-in-l">Dal mese (opz.)</label><input type="month" id="fp-in" name="inizio" value="${h(p.inizio || '')}"></div>
      <div class="field"><label for="fp-fi" id="fp-fi-l">Fino al mese (opz.)</label><input type="month" id="fp-fi" name="fine" value="${h(p.fine || '')}"></div>
    </div>
    <div class="hint" id="fp-dates-h" style="margin-top:-6px"></div>
    <div class="calc" id="fp-rate-sum"></div>
    <div class="field"><label for="fp-note">Note</label><input type="text" id="fp-note" name="note" value="${h(p.note || '')}" placeholder="es. codice cliente, IBAN…"></div>
    <label class="switch" id="fp-auto-w"><span>⚡ Conferma automatica alla scadenza<br><small class="muted" id="fp-auto-h">Il giorno della scadenza l'addebito viene confermato da solo.</small></span><input type="checkbox" name="autoConferma"${p.autoConferma ? ' checked' : ''}></label>
    <label class="switch"><span>Voce attiva</span><input type="checkbox" name="attiva"${p.attiva !== false ? ' checked' : ''}></label>
    <div class="form-actions">${nuovo ? '' : '<button type="button" class="btn danger" id="fp-del">Elimina</button>'}<button class="btn" type="submit">Salva</button></div>
  </form>`, el => {
    const f = $('#fp', el), tipo = f.tipo, freq = f.frequenza;
    const sync = () => {
      if (tipo.value === 'fissa_mensile') { freq.value = 'mensile'; freq.disabled = true; }
      else {
        freq.disabled = false;
        [...freq.options].forEach(o => o.disabled = tipo.value === 'fissa_non_mensile' && o.value === 'mensile');
        if (tipo.value === 'fissa_non_mensile' && freq.value === 'mensile') freq.value = 'annuale';
      }
      const tmp = {frequenza: freq.value, importo: num(f.importo.value), meseRif: +f.meseRif.value};
      $('#fp-mese-w', el).style.display = freq.value === 'mensile' ? 'none' : '';
      $('#fp-mesi-txt', el).textContent = freq.value === 'mensile' ? '' : 'Pagamenti in: ' + mesiDovuti(tmp).map(m => MESI_B[m - 1]).join(', ');
      $('#fp-me', el).textContent = tmp.importo ? fmt(mensileEq(tmp)) : '—';
      $('#fp-an', el).textContent = tmp.importo ? fmt(annuo(tmp)) : '—';
      const met = (f.querySelector('[name=metodo]:checked') || {}).value;
      $('#fp-imp', el).previousElementSibling.textContent = f.bolletta.checked ? 'Importo stimato' : 'Importo per pagamento';
      $('#fp-g', el).previousElementSibling.textContent = f.bolletta.checked ? 'Giorno indicativo' : 'Giorno scadenza';
      if (f.bolletta.checked && !nuovo && nStima(p)) $('#fp-bol-h', el).innerHTML = `Stima attuale: <b>${fmt(impPrev(p))}</b>, media delle ultime ${nStima(p)} bollette. L'importo qui sotto si usa solo finché non ci sono bollette pagate.`;
      $('#fp-auto-w', el).style.display = met === 'addebito' ? '' : 'none';
      $('#fp-auto-h', el).textContent = tipo.value === 'variabile'
        ? "Viene confermato con l'importo previsto: potrai correggerlo quando arriva la bolletta."
        : "Il giorno della scadenza l'addebito viene confermato da solo.";
    };
    // ── rate: due dati qualsiasi tra prima rata, ultima rata, rate totali e rate mancanti bastano a calcolare il resto
    const nr = f.numRate, rm = $('#fp-rm', el);
    const tmpP = () => {
      const fq = tipo.value === 'fissa_mensile' ? 'mensile' : freq.value;
      const mr = f.inizio.value && fq !== 'mensile' ? +f.inizio.value.slice(5, 7) : +f.meseRif.value;
      return {id: id || '__nuova__', frequenza: fq, meseRif: mr, importo: num(f.importo.value), inizio: f.inizio.value, fine: f.fine.value, rate: true, numRate: +nr.value || 0, attiva: true};
    };
    const updRate = keepRm => {
      const on = f.rate.checked;
      $('#fp-rate-box', el).style.display = on ? '' : 'none';
      $('#fp-in-l', el).textContent = on ? 'Prima rata (opz.)' : 'Dal mese (opz.)';
      $('#fp-fi-l', el).textContent = on ? 'Ultima rata' : 'Fino al mese (opz.)';
      $('#fp-dates-h', el).textContent = on
        ? 'Inserisci due dati qualsiasi (prima rata, ultima rata, rate totali o rate mancanti): il resto si calcola da solo, una rata per periodo. Dopo l\'ultima rata la voce smette di comparire.'
        : 'Facoltativi: per spese che iniziano o finiscono in un certo mese.';
      const box = $('#fp-rate-sum', el);
      if (on && f.fine.value) {
        const ri = rateInfo(tmpP());
        box.style.display = '';
        box.innerHTML = `<div><span>Rate mancanti</span><b>${ri.mancanti}${ri.totali ? ' / ' + ri.totali : ''}</b></div><div><span>Debito residuo</span><b>${fmt(ri.residuo)}</b></div>`;
        if (!keepRm) rm.value = ri.mancanti;
      } else { box.style.display = 'none'; if (!keepRm) rm.value = ''; }
    };
    f.addEventListener('input', sync); f.addEventListener('change', sync); sync();
    f.addEventListener('input', e => {
      const tg = e.target;
      if (f.rate.checked) {
        const tp = tmpP();
        if (tg === nr || tg === f.inizio) {
          if (f.inizio.value && +nr.value > 0) f.fine.value = nEsimoPeriodo(tp, f.inizio.value, +nr.value) || f.fine.value;
          else if (tg === f.inizio && f.inizio.value && f.fine.value) nr.value = periodiDovuti(tp, f.inizio.value, f.fine.value).length || '';
        } else if (tg === f.fine) {
          if (f.inizio.value && f.fine.value) nr.value = periodiDovuti(tp, f.inizio.value, f.fine.value).length || '';
        } else if (tg === rm) {
          const n = parseInt(rm.value, 10);
          if (n > 0) {
            f.fine.value = nEsimoPeriodo(tp, primoDaPagare(tp), n);
            if (f.inizio.value) nr.value = periodiDovuti(tmpP(), f.inizio.value, f.fine.value).length || '';
          }
        }
      }
      updRate(tg === rm);
    });
    f.addEventListener('change', e => { if (e.target === f.rate) updRate(false); });
    updRate(false);
    if (nuovo) setTimeout(() => f.voce.focus(), 250);
    f.onsubmit = e => {
      e.preventDefault();
      const imp = num(f.importo.value);
      if (!f.voce.value.trim()) return toast('Inserisci il nome della voce');
      if (imp <= 0) return toast('Inserisci un importo valido');
      const g = parseInt(f.giorno.value, 10);
      const data = {
        voce: f.voce.value.trim(), categoriaId: f.categoriaId.value, tipo: f.tipo.value,
        frequenza: f.tipo.value === 'fissa_mensile' ? 'mensile' : f.frequenza.value,
        importo: imp, giorno: g >= 1 && g <= 31 ? g : null, meseRif: +f.meseRif.value || 1,
        metodo: (f.querySelector('[name=metodo]:checked') || {}).value || 'addebito',
        priorita: (f.querySelector('[name=priorita]:checked') || {}).value || 'essenziale',
        inizio: f.inizio.value || '', fine: f.fine.value || '', note: f.note.value.trim(), attiva: f.attiva.checked
      };
      data.bolletta = f.bolletta.checked;
      data.rate = f.rate.checked;
      data.numRate = data.rate ? (parseInt(f.numRate.value, 10) || 0) : 0;
      if (data.rate && !data.fine) return toast("Indica l'ultima rata oppure le rate mancanti");
      if (data.inizio && data.fine && data.inizio > data.fine) return toast("La prima rata è dopo l'ultima: controlla le date");
      if (data.rate && data.inizio && data.frequenza !== 'mensile') data.meseRif = +data.inizio.slice(5, 7);
      data.autoConferma = data.metodo === 'addebito' && f.autoConferma.checked;
      if (data.autoConferma && !p.autoConferma) { const t = today(); data.autoDal = ymKey(t.y, t.m); data.autoSkip = []; }
      if (nuovo) S.previste.push(Object.assign({id: uid()}, data));
      else Object.assign(S.previste.find(x => x.id === id), data);
      save(); closeSheet(); const na = autoConferma(); render(); if (!na) toast(nuovo ? 'Spesa prevista aggiunta' : 'Modifiche salvate');
    };
    const del = $('#fp-del', el);
    if (del) del.onclick = () => {
      const n = S.movimenti.filter(x => x.previstaId === id).length;
      askConfirm(`Eliminare <b>${h(p.voce)}</b>?${n ? ` Le ${n} conferme già registrate resteranno nello storico.` : ''}<br><span class="hint">Se vuoi solo smettere di vederla nei prossimi mesi, puoi disattivarla o impostare "Fino al mese".</span>`, 'Elimina', () => {
        S.previste = S.previste.filter(x => x.id !== id);
        S.movimenti.forEach(x => { if (x.previstaId === id) { x.previstaId = null; } });
        save(); render(); toast('Voce eliminata');
      }, true);
    };
  });
}

// ── Form: conferma di una spesa prevista (o modifica conferma)
function formConferma(pid, periodo) {
  const p = S.previste.find(x => x.id === pid); if (!p) return;
  const mov = S.movimenti.find(x => x.tipo === 'prevista' && x.previstaId === pid && x.periodo === periodo);
  const [y, m] = periodo.split('-').map(Number);
  const o = occDi(p, y, m), scad = o.scad;
  const t = today(), defData = mov ? mov.data : o.ov ? (o.ov.data <= isoToday() ? o.ov.data : isoToday()) : (periodo === ymKey(t.y, t.m) ? isoToday() : scad);
  openSheet(mov ? 'Spesa confermata' : 'Conferma pagamento', `
  <form id="fc" autocomplete="off">
    <div class="prev-top">${catIc(cat(p.categoriaId))}<div><div class="row-t">${h(p.voce)}</div><div class="row-s">${MESI[m - 1]} ${y} · ${o.ov ? `bolletta ${fmt(o.ov.importo)}, scad. ${fmtData(o.ov.data)}` : `previsto ${fmt(o.importo)}${p.tipo === 'variabile' || p.bolletta ? ' (stima)' : ''}`}</div></div></div>
    <div class="field"><label>Importo pagato</label><label class="big-amt"><span>€</span><input type="text" inputmode="decimal" name="importo" value="${numIn(mov ? mov.importo : o.importo)}" required></label>
      ${p.tipo === 'variabile' && !o.ov ? '<small>Spesa variabile: inserisci l\'importo reale.</small>' : ''}</div>
    <div class="grid2">
      <div class="field"><label for="fc-d">Data pagamento</label><input type="date" id="fc-d" name="data" value="${defData}" required></div>
      <div class="field"><label for="fc-m">Metodo</label><select id="fc-m" name="metodo">${optList(METODI, mov ? mov.metodo : p.metodo)}</select></div>
    </div>
    <div class="field"><label for="fc-n">Note</label><input type="text" id="fc-n" name="note" value="${h(mov ? mov.note || '' : '')}" placeholder="opzionale"></div>
    <div class="form-actions">${mov ? '<button type="button" class="btn danger" id="fc-undo">Annulla conferma</button>' : ''}<button class="btn" type="submit">${mov ? 'Salva' : '✓ Conferma'}</button></div>
    ${p.bolletta ? `<button type="button" class="link" data-a="bolletta" data-id="${p.id}|${periodo}" style="align-self:center">📄 ${o.ov ? 'Modifica la bolletta' : 'Inserisci la bolletta'}</button>` : ''}
    <button type="button" class="link" id="fc-edit" style="align-self:center">Modifica la spesa prevista</button>
  </form>`, el => {
    const f = $('#fc', el);
    f.onsubmit = e => {
      e.preventDefault();
      const imp = num(f.importo.value);
      if (imp <= 0) return toast('Inserisci un importo valido');
      const data = {importo: imp, data: f.data.value || isoToday(), metodo: f.metodo.value, note: f.note.value.trim(), categoriaId: p.categoriaId, descrizione: p.voce};
      if (mov) { Object.assign(mov, data); mov.auto = false; }
      else S.movimenti.push(Object.assign({id: uid(), tipo: 'prevista', previstaId: pid, periodo}, data));
      save(); closeSheet(); render(); toast(avvisoBudget(p.categoriaId, periodo) || (mov ? 'Modifiche salvate' : `${p.voce} confermata ✓`));
    };
    const u = $('#fc-undo', el);
    if (u) u.onclick = () => {
      S.movimenti = S.movimenti.filter(x => x !== mov);
      if (p.autoConferma) { p.autoSkip = (p.autoSkip || []).concat(periodo); }
      save(); closeSheet(); render(); toast(p.autoConferma ? 'Conferma annullata: per questo mese non verrà riconfermata in automatico' : 'Conferma annullata');
    };
    $('#fc-edit', el).onclick = () => formPrevista(pid);
  });
}

// ── Form: bolletta del mese (data e importo noti in anticipo)
function linkGoogleCalendar(p, ov) {
  const [hh, mm] = (S.imp.notifOra || '09:00').split(':').map(n => parseInt(n, 10) || 0);
  const d = new Date(ov.data + 'T12:00:00Z'); if (S.imp.notifQuando === 'prima') d.setUTCDate(d.getUTCDate() - 1);
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
  const e = new Date(Date.UTC(2000, 0, 1, hh, mm + 15));
  const end = e.getUTCDate() === 1 ? `${ymd}T${pad(e.getUTCHours())}${pad(e.getUTCMinutes())}00` : `${ymd}T235900`;
  let tz = 'Europe/Rome'; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz; } catch (x) {}
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: `💶 ${S.imp.notifQuando === 'prima' ? 'Domani scade' : 'Scade oggi'} ${p.voce} (${fmt(ov.importo)})`,
    dates: `${ymd}T${pad(hh)}${pad(mm)}00/${end}`,
    details: `Bolletta ${p.voce}: ${fmt(ov.importo)}, scadenza ${fmtData(ov.data)} · ${METODI[p.metodo] || ''}\nApri Spese di Casa per confermarla.`,
    ctz: tz
  });
  return 'https://calendar.google.com/calendar/render?' + q.toString();
}
function formBolletta(pid, periodo) {
  const p = S.previste.find(x => x.id === pid); if (!p) return;
  const [y, m] = periodo.split('-').map(Number);
  const o = occDi(p, y, m), ov = o.ov;
  const giaPagata = confermataIn(p, periodo);
  openSheet(`Bolletta ${p.voce}`, `<form id="fbl" autocomplete="off">
    <div class="prev-top">${catIc(cat(p.categoriaId))}<div><div class="row-t">${h(p.voce)} · ${MESI[m - 1].toLowerCase()} ${y}</div><div class="row-s">Stima: ${fmt(o.stima)}${nStima(p) ? ` (media ultime ${nStima(p)})` : ''}</div></div></div>
    <div class="field"><label>Importo della bolletta</label><label class="big-amt"><span>€</span><input type="text" inputmode="decimal" name="importo" value="${numIn(ov ? ov.importo : '')}" placeholder="${numIn(o.stima)}" required></label></div>
    <div class="field"><label for="fbl-d">Data di scadenza</label><input type="date" id="fbl-d" name="data" value="${ov ? ov.data : ''}" required></div>
    ${giaPagata ? '<div class="hint">Questa bolletta risulta già confermata: le modifiche qui non cambiano l\'importo pagato.</div>' : ''}
    <div class="form-actions">${ov ? '<button type="button" class="btn danger" id="fbl-del">Rimuovi</button>' : ''}<button class="btn" type="submit">Salva bolletta</button></div>
  </form>`, el => {
    const f = $('#fbl', el);
    if (!ov) setTimeout(() => f.importo.focus(), 250);
    f.onsubmit = e => {
      e.preventDefault();
      const imp = num(f.importo.value);
      if (imp <= 0) return toast('Inserisci l\'importo della bolletta');
      if (!f.data.value) return toast('Inserisci la data di scadenza');
      p.bollette = p.bollette || {};
      p.bollette[periodo] = {data: f.data.value, importo: imp};
      save();
      const na = autoConferma();
      render();
      const nuovo = p.bollette[periodo];
      const futura = nuovo.data >= isoToday() && !confermataIn(p, periodo);
      openSheet('Bolletta salvata', `<div class="guide">
        <p>📄 <b>${h(p.voce)}</b>: ${fmt(nuovo.importo)}, scadenza <b>${fmtData(nuovo.data)}</b>.</p>
        ${futura ? `<p>Vuoi la notifica? Apri Google Calendar con il promemoria già compilato e premi <b>Salva</b>. Se te lo chiede, scegli il calendario <i>Scadenze spese</i>.</p>
        <a class="btn block" style="display:block;text-align:center;text-decoration:none" href="${h(linkGoogleCalendar(p, nuovo))}" target="_blank" rel="noopener">📅 Aggiungi promemoria a Google Calendar</a>`
          : na ? '<p>La scadenza è già passata ed era un addebito automatico: è stata confermata con l\'importo della bolletta.</p>' : ''}
        <button class="btn ghost block" style="margin-top:10px" data-a="closeSheet">Fatto</button>
      </div>`);
    };
    const d = $('#fbl-del', el);
    if (d) d.onclick = () => { delete p.bollette[periodo]; save(); closeSheet(); render(); toast('Bolletta rimossa: torna la stima'); };
  });
}

// ── Form: nuovo movimento (extra oppure conferma di una prevista)
function formNuovo(tab) {
  tab = tab || 'extra';
  const t = today();
  const yr = cur.y;
  openSheet('Nuova spesa', `
    <div class="seg" style="width:100%;margin-bottom:16px"><button style="flex:1" class="${tab === 'extra' ? 'on' : ''}" data-a="tabNuovo" data-id="extra">Spesa extra</button><button style="flex:1" class="${tab === 'prev' ? 'on' : ''}" data-a="tabNuovo" data-id="prev">Spesa prevista</button></div>
    ${tab === 'extra' ? extraFormHtml() : prevPickHtml(yr)}`, el => {
    if (tab === 'extra') mountExtra(el, null);
    else mountPrevPick(el, yr);
  });
}
function extraFormHtml(x) {
  x = x || {importo: '', categoriaId: S.imp.ultimaCat || 'c10', descrizione: '', data: defaultExtraDate(), metodo: 'carta', note: ''};
  const cats = S.categorie.slice().sort((a, b) => (a.uso === 'fissa') - (b.uso === 'fissa'));
  const sugg = [...new Set(S.movimenti.filter(m => m.tipo === 'extra' && m.descrizione).map(m => m.descrizione))].slice(-60);
  return `<form id="fx" autocomplete="off">
    <label class="big-amt"><span>€</span><input type="text" inputmode="decimal" name="importo" value="${numIn(x.importo)}" placeholder="0,00" required aria-label="Importo"></label>
    <div class="buoni-box" id="fx-buoni" hidden>
      <div class="kv"><span>🍽️ <b>Buoni pasto usati</b><br><small class="muted" id="fx-bdisp"></small></span>
        <div class="stepper"><button type="button" data-st="-1" aria-label="Un buono in meno">−</button><input type="number" inputmode="numeric" min="0" name="buoni" value="${+x.buoni || 0}" aria-label="Numero di buoni"><button type="button" data-st="1" aria-label="Un buono in più">+</button></div></div>
      <div class="buoni-calc" id="fx-bcalc"></div>
      <button type="button" class="link" id="fx-sugg-b" hidden></button>
    </div>
    <div class="field"><span class="flabel">Categoria</span><div class="chips">${cats.map(c => `<label class="chip"><input type="radio" name="categoriaId" value="${c.id}"${c.id === x.categoriaId ? ' checked' : ''}><span>${h(c.icona)} ${h(c.nome)}</span></label>`).join('')}</div></div>
    <div class="field"><label for="fx-desc">Descrizione</label><input type="text" id="fx-desc" name="descrizione" list="fx-sugg" value="${h(x.descrizione || '')}" placeholder="es. Supermercato"><datalist id="fx-sugg">${sugg.map(s => `<option value="${h(s)}">`).join('')}</datalist></div>
    <div class="grid2">
      <div class="field"><label for="fx-d">Data</label><input type="date" id="fx-d" name="data" value="${h(x.data)}" required></div>
      <div class="field"><label for="fx-m">Metodo</label><select id="fx-m" name="metodo">${optList(METODI, x.metodo)}</select></div>
    </div>
    <div class="form-actions">${x.id ? '<button type="button" class="btn danger" id="fx-del">Elimina</button>' : ''}<button class="btn" type="submit">${x.id ? 'Salva' : 'Aggiungi'}</button></div>
  </form>`;
}
function defaultExtraDate() {
  const t = today();
  if (cur.y === t.y && cur.m === t.m) return isoToday();
  return `${ymKey(cur.y, cur.m)}-${pad(Math.min(t.d, dim(cur.y, cur.m)))}`;
}
function mountExtra(el, x) {
  const f = $('#fx', el);
  if (!x) setTimeout(() => f.importo.focus(), 250);
  // ── buoni pasto: visibili solo per le categorie abilitate
  const exId = x && x.id;
  const box = $('#fx-buoni', el), nb = f.elements.buoni, bcalc = $('#fx-bcalc', el);
  const catSel = () => (f.querySelector('[name=categoriaId]:checked') || {}).value;
  const updBuoni = () => {
    const sb = saldoBuoni(exId), cc = cat(catSel());
    const usabile = cc.buoni && (sb.n > 0 || +nb.value > 0) && (!x || x.tipo === 'extra');
    box.hidden = !usabile;
    if (!usabile) return;
    let n = Math.max(0, parseInt(nb.value, 10) || 0);
    if (n > sb.n) { n = sb.n; nb.value = n; }
    const tot = num(f.importo.value), val = valoreBuoni(n, exId), den = Math.max(0, Math.round((tot - val) * 100) / 100);
    $('#fx-bdisp', el).textContent = `Disponibili: ${testoSaldoBuoni(sb)}`;
    const sugg = sb.primo ? Math.min(sb.n, Math.floor((tot + 0.001) / sb.primo)) : 0;
    let html = '';
    if (n > 0) {
      html = `<div class="kv"><span>${n} ${n === 1 ? 'buono' : 'buoni'}</span><b>− ${fmt(val)}</b></div>`
        + `<div class="kv"><span>Da pagare in denaro</span><b class="${den > 0 ? '' : 'ok-t'}">${fmt(den)}</b></div>`;
      if (tot > 0 && val > tot + 0.004) html += `<div class="pill warn" style="margin-top:6px">I buoni superano la spesa di ${fmt(val - tot)}: il resto non viene restituito</div>`;
    } else html = `<div class="muted small">Nessun buono: pagherai tutto in denaro.</div>`;
    bcalc.innerHTML = html;
    sbtn.hidden = !(sugg > 0 && sugg !== n);
    sbtn.dataset.n = sugg;
    sbtn.textContent = `Usa ${sugg} ${sugg === 1 ? 'buono' : 'buoni'} (${fmt(valoreBuoni(sugg, exId))})`;
  };
  const sbtn = $('#fx-sugg-b', el);
  sbtn.onclick = () => { nb.value = sbtn.dataset.n; updBuoni(); };
  el.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { nb.value = Math.max(0, (parseInt(nb.value, 10) || 0) + +b.dataset.st); updBuoni(); });
  f.addEventListener('input', updBuoni); f.addEventListener('change', updBuoni); updBuoni();
  f.onsubmit = e => {
    e.preventDefault();
    const imp = num(f.importo.value);
    if (imp <= 0) return toast('Inserisci un importo valido');
    const c = (f.querySelector('[name=categoriaId]:checked') || {}).value;
    if (!c) return toast('Scegli una categoria');
    const data = {importo: imp, categoriaId: c, descrizione: f.descrizione.value.trim(), data: f.data.value || isoToday(), metodo: f.metodo.value};
    const nB = !box.hidden ? Math.max(0, parseInt(nb.value, 10) || 0) : 0;
    if (nB > saldoBuoni(exId).n) return toast('Non hai abbastanza buoni pasto');
    data.buoni = nB; data.buoniValore = nB ? valoreBuoni(nB, exId) : 0;
    if (x) Object.assign(x, data);
    else S.movimenti.push(Object.assign({id: uid(), tipo: 'extra', note: ''}, data));
    S.imp.ultimaCat = c;
    save(); closeSheet(); render(); toast(avvisoBudget(c, data.data.slice(0, 7)) || (x ? 'Modifiche salvate' : 'Spesa aggiunta'));
  };
  const d = $('#fx-del', el);
  if (d) d.onclick = () => askConfirm('Eliminare questa spesa?', 'Elimina', () => { S.movimenti = S.movimenti.filter(m => m !== x); save(); render(); toast('Spesa eliminata'); }, true);
}
function prevPickHtml(yr) {
  const att = attive();
  if (!att.length) return `<div class="empty-s">Non hai ancora spese previste.<br><button class="link" style="margin-top:8px" data-a="addPrev">+ Aggiungi spesa prevista</button></div>`;
  const ord = att.slice().sort((a, b) => a.voce.localeCompare(b.voce));
  return `<div class="hint" style="margin-bottom:12px">Scegli una spesa prevista e il periodo a cui si riferisce: utile se hai pagato in anticipo o in ritardo.</div>
  <form id="fpp">
    <div class="field"><label for="fpp-p">Spesa prevista</label><select id="fpp-p" name="pid">${ord.map(p => `<option value="${p.id}">${h(cat(p.categoriaId).icona + ' ' + p.voce)} · ${fmt(p.importo)}</option>`).join('')}</select></div>
    <div class="field"><label for="fpp-per">Periodo</label><select id="fpp-per" name="periodo"></select><small id="fpp-info"></small></div>
    <div class="form-actions"><button class="btn" type="submit">Continua</button></div>
  </form>`;
}
function mountPrevPick(el, yr) {
  const f = $('#fpp', el); if (!f) return;
  const fill = () => {
    const p = S.previste.find(x => x.id === f.pid.value);
    const opts = [];
    for (let i = -6; i <= 12; i++) {
      const x = addMonths(cur.y, cur.m, i);
      if (!dovuta(p, x.y, x.m)) continue;
      const k = ymKey(x.y, x.m), done = S.movimenti.some(mv => mv.tipo === 'prevista' && mv.previstaId === p.id && mv.periodo === k);
      opts.push({k, lbl: `${MESI[x.m - 1]} ${x.y}${done ? ' · già confermata' : ''}`, done});
    }
    const firstOpen = opts.find(o => !o.done && o.k >= ymKey(cur.y, cur.m)) || opts.find(o => !o.done) || opts[0];
    f.periodo.innerHTML = opts.map(o => `<option value="${o.k}"${firstOpen && o.k === firstOpen.k ? ' selected' : ''}>${o.lbl}</option>`).join('');
    $('#fpp-info', el).textContent = `${FREQ[p.frequenza].l} · ${scadenzaTesto(p)}`;
  };
  f.pid.onchange = fill; fill();
  f.onsubmit = e => { e.preventDefault(); if (!f.periodo.value) return toast('Nessun periodo disponibile'); formConferma(f.pid.value, f.periodo.value); };
}
function formEditMov(id) {
  const x = S.movimenti.find(m => m.id === id); if (!x) return;
  if (x.tipo === 'prevista' && x.previstaId && S.previste.some(p => p.id === x.previstaId)) return formConferma(x.previstaId, x.periodo);
  if (x.tipo === 'prevista') {
    // conferma di una voce eliminata: si può solo modificare importo/data o eliminare
    openSheet('Spesa confermata', `<div class="hint" style="margin-bottom:12px">Questa conferma si riferisce a una voce prevista che è stata eliminata o modificata.</div>${extraFormHtml(x)}`, el => mountExtra(el, x));
    return;
  }
  openSheet('Modifica spesa', extraFormHtml(x), el => mountExtra(el, x));
}

// ── Buoni pasto: ricarica e storico
function formRicarica(id) {
  const r0 = S.buoni.ricariche.find(r => r.id === id);
  const ultima = S.buoni.ricariche.slice().sort((a, b) => (b.data || '').localeCompare(a.data || ''))[0];
  const r = r0 || {numero: ultima ? ultima.numero : '', taglio: +S.buoni.taglio || (ultima ? ultima.taglio : ''), data: isoToday(), note: ''};
  openSheet(r0 ? 'Modifica ricarica' : 'Ricarica buoni pasto', `<form id="fr" autocomplete="off">
    <div class="grid2">
      <div class="field"><label for="fr-n">Numero di buoni</label><input type="number" inputmode="numeric" min="1" id="fr-n" name="numero" value="${r.numero || ''}" placeholder="es. 20" required></div>
      <div class="field"><label for="fr-t">Taglio</label><input type="text" inputmode="decimal" id="fr-t" name="taglio" value="${numIn(r.taglio)}" placeholder="es. 6,20" required></div>
    </div>
    <div class="calc"><div><span>Valore ricarica</span><b id="fr-val">—</b></div><div><span>Dopo la ricarica</span><b id="fr-dopo">—</b></div></div>
    <div class="field"><label for="fr-d">Data</label><input type="date" id="fr-d" name="data" value="${h(r.data)}" required></div>
    <div class="field"><label for="fr-no">Note</label><input type="text" id="fr-no" name="note" value="${h(r.note || '')}" placeholder="es. ricarica di novembre"></div>
    <div class="form-actions">${r0 ? '<button type="button" class="btn danger" id="fr-del">Elimina</button>' : ''}<button class="btn" type="submit">${r0 ? 'Salva' : 'Ricarica'}</button></div>
  </form>`, el => {
    const f = $('#fr', el);
    const upd = () => {
      const n = parseInt(f.numero.value, 10) || 0, t = num(f.taglio.value), sb = saldoBuoni();
      const prima = r0 ? sb.n - (+r0.numero) : sb.n, primaV = r0 ? sb.valore - r0.numero * r0.taglio : sb.valore;
      $('#fr-val', el).textContent = n && t ? fmt(n * t) : '—';
      $('#fr-dopo', el).textContent = n && t ? `${prima + n} · ${fmt(primaV + n * t)}` : '—';
    };
    f.addEventListener('input', upd); upd();
    if (!r0) setTimeout(() => f.numero.focus(), 250);
    f.onsubmit = e => {
      e.preventDefault();
      const n = parseInt(f.numero.value, 10) || 0, t = num(f.taglio.value);
      if (n <= 0 || t <= 0) return toast('Inserisci numero e taglio dei buoni');
      const data = {numero: n, taglio: t, data: f.data.value || isoToday(), note: f.note.value.trim()};
      if (r0) {
        const usati = sum(S.movimenti, x => +x.buoni || 0), tot = sum(S.buoni.ricariche.filter(x => x !== r0), x => +x.numero) + n;
        if (tot < usati) return toast(`Hai già usato ${usati} buoni: la ricarica non può essere più piccola`);
        Object.assign(r0, data);
      } else S.buoni.ricariche.push(Object.assign({id: uid()}, data));
      S.buoni.taglio = t;
      save(); closeSheet(); render(); toast(r0 ? 'Ricarica aggiornata' : `🍽️ Ricaricati ${n} buoni (${fmt(n * t)})`);
    };
    const d = $('#fr-del', el);
    if (d) d.onclick = () => {
      const usati = sum(S.movimenti, x => +x.buoni || 0), tot = sum(S.buoni.ricariche.filter(x => x !== r0), x => +x.numero);
      if (tot < usati) return toast(`Non puoi eliminarla: hai già usato ${usati} buoni`);
      askConfirm(`Eliminare la ricarica di <b>${r0.numero} buoni</b> del ${fmtData(r0.data)}?`, 'Elimina', () => { S.buoni.ricariche = S.buoni.ricariche.filter(x => x !== r0); save(); render(); toast('Ricarica eliminata'); }, true);
    };
  });
}
function sheetBuoni() {
  const sb = saldoBuoni();
  const ric = S.buoni.ricariche.slice().sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  const usi = S.movimenti.filter(x => +x.buoni > 0).sort((a, b) => b.data.localeCompare(a.data)).slice(0, 30);
  openSheet('Buoni pasto', `
    <div class="card buoni-card" style="margin-bottom:16px"><div><div class="muted small">Restanti</div><div class="buoni-big">${sb.n} <span class="muted" style="font-size:1rem;font-weight:600">buoni</span></div><div class="small muted">valore ${fmt(sb.valore)}</div></div><button class="btn" data-a="ricarica">+ Ricarica</button></div>
    <div class="sec-h" style="margin-bottom:8px"><h2>Ricariche</h2></div>
    <div class="list" style="margin-bottom:16px">${ric.map(r => `<div class="row tap" data-a="editRicarica" data-id="${r.id}"><span class="cat-ic sm" style="--c:#2f7d5b">➕</span><div class="row-main"><div class="row-t">${r.numero} buoni da ${fmt(r.taglio)}</div><div class="row-s">${fmtData(r.data)}${r.note ? ' · ' + h(r.note) : ''}</div></div><div class="amt">${fmt(r.numero * r.taglio)}</div></div>`).join('') || '<div class="empty-s">Nessuna ricarica.</div>'}</div>
    <div class="sec-h" style="margin-bottom:8px"><h2>Ultimi utilizzi</h2></div>
    <div class="list">${usi.map(x => `<div class="row tap" data-a="editMov" data-id="${x.id}">${catIc(cat(x.categoriaId), 1)}<div class="row-main"><div class="row-t">${h(x.descrizione || cat(x.categoriaId).nome)}</div><div class="row-s">${fmtData(x.data)} · spesa ${fmt(x.importo)}${cassa(x) ? ` · ${fmt(cassa(x))} in denaro` : ''}</div></div><div class="amt">−${x.buoni}<small>${fmt(x.buoniValore)}</small></div></div>`).join('') || '<div class="empty-s">Nessun buono usato finora.</div>'}</div>`);
}

// ── Form: entrate
function formEntrata(id) {
  const e0 = S.entrate.find(x => x.id === id) || {voce: '', importo: '', mese: 0};
  openSheet(id ? 'Modifica entrata' : 'Nuova entrata', `<form id="fe" autocomplete="off">
    <div class="field"><label for="fe-v">Voce</label><input type="text" id="fe-v" name="voce" value="${h(e0.voce)}" placeholder="es. Stipendio" required></div>
    <div class="field"><label for="fe-i">Importo netto</label><input type="text" inputmode="decimal" id="fe-i" name="importo" value="${numIn(e0.importo)}" placeholder="0,00" required></div>
    <div class="field"><label for="fe-m">Quando</label><select id="fe-m" name="mese"><option value="0">Ogni mese</option>${MESI.map((m, i) => `<option value="${i + 1}"${+e0.mese === i + 1 ? ' selected' : ''}>Solo a ${m.toLowerCase()} (es. tredicesima)</option>`).join('')}</select></div>
    <div class="form-actions">${id ? '<button type="button" class="btn danger" id="fe-del">Elimina</button>' : ''}<button class="btn" type="submit">Salva</button></div>
  </form>`, el => {
    const f = $('#fe', el);
    f.onsubmit = ev => {
      ev.preventDefault();
      const imp = num(f.importo.value);
      if (!f.voce.value.trim() || imp <= 0) return toast('Compila voce e importo');
      const data = {voce: f.voce.value.trim(), importo: imp, mese: +f.mese.value};
      if (id) Object.assign(S.entrate.find(x => x.id === id), data); else S.entrate.push(Object.assign({id: uid()}, data));
      save(); closeSheet(); render(); toast('Entrata salvata');
    };
    const d = $('#fe-del', el);
    if (d) d.onclick = () => { S.entrate = S.entrate.filter(x => x.id !== id); save(); closeSheet(); render(); toast('Entrata eliminata'); };
  });
}

// ── Form: categorie
function formCategoria(id) {
  const c = S.categorie.find(x => x.id === id) || {nome: '', icona: '📦', colore: PALETTE[S.categorie.length % PALETTE.length], uso: 'entrambe'};
  const usata = id && S.previste.concat(S.movimenti).some(x => x.categoriaId === id);
  openSheet(id ? 'Modifica categoria' : 'Nuova categoria', `<form id="fk" autocomplete="off">
    <div class="field"><label for="fk-n">Nome</label><input type="text" id="fk-n" name="nome" value="${h(c.nome)}" required></div>
    <div class="grid2">
      <div class="field"><label for="fk-i">Icona (emoji)</label><input type="text" id="fk-i" name="icona" value="${h(c.icona)}" maxlength="4"></div>
      <div class="field"><label for="fk-c">Colore</label><input type="color" id="fk-c" name="colore" value="${h(c.colore)}"></div>
    </div>
    <div class="field"><label for="fk-b">Budget mensile <span style="text-transform:none;font-weight:500">(opz.)</span></label><input type="text" inputmode="decimal" id="fk-b" name="budget" value="${numIn(c.budget || '')}" placeholder="nessun budget"><small>Conta tutte le spese del mese in questa categoria: extra e previste confermate.</small></div>
    <label class="switch"><span>🍽️ Si possono usare i buoni pasto</span><input type="checkbox" name="buoni"${c.buoni ? ' checked' : ''}></label>
    <div class="field"><label for="fk-u">Usata per</label><select id="fk-u" name="uso">${optList({fissa: 'Spese previste', extra: 'Spese extra', entrambe: 'Previste ed extra'}, c.uso)}</select></div>
    <div class="form-actions">${id ? `<button type="button" class="btn danger" id="fk-del"${usata ? ' disabled title="Categoria in uso"' : ''}>Elimina</button>` : ''}<button class="btn" type="submit">Salva</button></div>
    ${usata ? '<div class="hint">La categoria è usata da alcune voci: non può essere eliminata, ma puoi rinominarla.</div>' : ''}
  </form>`, el => {
    const f = $('#fk', el);
    f.onsubmit = ev => {
      ev.preventDefault();
      if (!f.nome.value.trim()) return toast('Inserisci un nome');
      const data = {nome: f.nome.value.trim(), icona: f.icona.value.trim() || '📦', colore: f.colore.value, uso: f.uso.value, budget: num(f.budget.value) || 0, buoni: f.buoni.checked};
      if (id) Object.assign(S.categorie.find(x => x.id === id), data); else S.categorie.push(Object.assign({id: 'c' + uid()}, data));
      save(); closeSheet(); render(); toast('Categoria salvata');
    };
    const d = $('#fk-del', el);
    if (d && !usata) d.onclick = () => { S.categorie = S.categorie.filter(x => x.id !== id); save(); closeSheet(); render(); toast('Categoria eliminata'); };
  });
}

function formBudgets() {
  const cats = S.categorie.slice().sort((a, b) => (+b.budget > 0) - (+a.budget > 0) || (a.uso === 'fissa') - (b.uso === 'fissa'));
  openSheet('Budget per categoria', `<form id="fb" autocomplete="off">
    <div class="hint">Imposta un tetto mensile solo per le categorie che vuoi tenere d'occhio, per esempio spesa alimentare e carburante. Conta sia le spese extra sia le previste confermate. Lascia vuoto per nessun budget.</div>
    <div class="list">${cats.map(c => { const md = mediaCategoria(c.id, 3); return `<div class="set-row">${catIc(c, 1)}<div class="row-main" style="cursor:default"><div class="row-t">${h(c.nome)}</div><div class="row-s">${md ? 'Media ultimi 3 mesi: ' + fmt(md) : 'Nessuna spesa negli ultimi 3 mesi'}</div></div><input type="text" inputmode="decimal" name="b_${c.id}" value="${numIn(c.budget || '')}" placeholder="—" aria-label="Budget ${h(c.nome)}"></div>`; }).join('')}</div>
    <div class="form-actions"><button class="btn" type="submit">Salva</button></div>
  </form>`, el => {
    const f = $('#fb', el);
    f.onsubmit = e => { e.preventDefault(); S.categorie.forEach(c => { const i = f.elements['b_' + c.id]; if (i) c.budget = num(i.value) || 0; }); save(); closeSheet(); render(); toast('Budget salvati'); };
  });
}

// ───────────────────────── Notifiche tramite calendario (.ics) ─────────────────────────
function firmaCalendario() {
  const i = S.imp;
  const base = S.previste.map(p => [p.id, p.voce, p.importo, p.giorno, p.frequenza, p.meseRif, p.inizio, p.fine, p.attiva, p.metodo, p.autoConferma, p.rate, p.numRate, p.bolletta].join('|')).sort().join('#')
    + `#${i.notifOra}|${i.notifQuando}|${i.notifAuto}`;
  let hsh = 5381; for (let k = 0; k < base.length; k++) hsh = ((hsh << 5) + hsh + base.charCodeAt(k)) | 0;
  return String(hsh >>> 0);
}
function giorniCalendario() {
  const t = today(), oggi = isoToday(), giorni = new Map();
  for (let i = 0; i < 12; i++) {
    const {y, m} = addMonths(t.y, t.m, i);
    occorrenze(y, m).forEach(o => {
      if (o.mov || o.attesa || o.scad < oggi) return;
      if (!S.imp.notifAuto && isAuto(o.p)) return;
      if (!giorni.has(o.scad)) giorni.set(o.scad, []);
      giorni.get(o.scad).push(o);
    });
  }
  return giorni;
}
function buildIcs() {
  const esc = v => String(v).replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const enc = new TextEncoder();
  const fold = line => {
    if (enc.encode(line).length <= 75) return line;
    const parts = []; let cur = '', len = 0;
    for (const ch of line) { const l = enc.encode(ch).length; if (len + l > (parts.length ? 74 : 75)) { parts.push(cur); cur = ''; len = 0; } cur += ch; len += l; }
    parts.push(cur); return parts.join('\r\n ');
  };
  const [hh, mm] = (S.imp.notifOra || '09:00').split(':').map(n => parseInt(n, 10) || 0);
  const prima = S.imp.notifQuando === 'prima';
  const now = new Date(), stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const seq = Math.floor(now.getTime() / 60000) - 29000000;
  const giorni = giorniCalendario();
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Spese di Casa//IT', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Scadenze spese'];
  [...giorni.keys()].sort().forEach(iso => {
    const items = giorni.get(iso), tot = sum(items, o => o.importo);
    const d = new Date(iso + 'T12:00:00Z'); if (prima) d.setUTCDate(d.getUTCDate() - 1);
    const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
    const quando = prima ? 'Domani' : 'Oggi';
    const titolo = items.length === 1
      ? `💶 ${quando} scade ${items[0].p.voce} (${fmt(items[0].importo)})`
      : `💶 ${quando} ${items.length} scadenze: ${items.map(o => o.p.voce).join(', ')}`;
    const righe = items.map(o => {
      const r = o.p.rate ? numeroRata(o.p, o.periodo) : null;
      return `• ${o.p.voce}: ${fmt(o.importo)}${o.ov ? ' (bolletta)' : o.p.tipo === 'variabile' ? ' (stima)' : ''} · ${METODI[o.p.metodo] || ''}${isAuto(o.p) ? ' · automatica' : ''}${r ? ` · rata ${r.n}/${r.tot}` : ''}`;
    });
    const desc = `Scadenze del ${fmtData(iso)}:\n${righe.join('\n')}${items.length > 1 ? `\nTotale: ${fmt(tot)}` : ''}\n\nApri Spese di Casa per confermarle.`;
    const fine = new Date(Date.UTC(2000, 0, 1, hh, mm + 15));
    L.push('BEGIN:VEVENT', `UID:scadenze-${iso.replace(/-/g, '')}@spese-di-casa`, `DTSTAMP:${stamp}`, `SEQUENCE:${seq}`,
      `DTSTART:${ymd}T${pad(hh)}${pad(mm)}00`,
      fine.getUTCDate() === 1 ? `DTEND:${ymd}T${pad(fine.getUTCHours())}${pad(fine.getUTCMinutes())}00` : 'DURATION:PT15M',
      `SUMMARY:${esc(titolo)}`, `DESCRIPTION:${esc(desc)}`, 'TRANSP:TRANSPARENT',
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(titolo)}`, 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT');
  });
  L.push('END:VCALENDAR');
  return {text: L.map(fold).join('\r\n') + '\r\n', n: giorni.size};
}
function exportIcs() {
  const {text, n} = buildIcs();
  if (!n) return toast('Nessuna scadenza nei prossimi 12 mesi');
  S.imp.icsAt = isoToday(); S.imp.icsSig = firmaCalendario(); save();
  offerFile(`scadenze-spese-${isoToday()}.ics`, text, 'text/calendar');
  if (view === 'altro') setTimeout(() => { if (!sheetOpen) render(); }, 0);
}
function avvisoCalendario() {
  const i = S.imp; if (!i.icsAt || !S.previste.length) return '';
  const vecchio = daysBetween(i.icsAt, isoToday()) > 300;
  if (!vecchio && i.icsSig === firmaCalendario()) return '';
  return `<div class="tip warn"><span class="em">📅</span><div>${vecchio ? 'Il calendario delle notifiche sta per finire' : 'Hai modificato le spese previste o le notifiche'}: esporta di nuovo il calendario e reimportalo per avere le notifiche aggiornate. <button class="link" data-a="exportIcs">Esporta ora →</button></div></div>`;
}
function guidaCalendario() {
  openSheet('Notifiche nel calendario', `<div class="guide">
    <p>Le notifiche arrivano da Google Calendar, quindi funzionano anche ad app chiusa. La configurazione si fa <b>una volta sola, dal computer</b>: l'app Google Calendar per Android non importa i file .ics.</p>
    <ol>
      <li><b>Esporta</b> il file con il pulsante "Esporta calendario scadenze" e mandalo al computer, per esempio con Drive o per email.</li>
      <li>Sul computer apri <b>calendar.google.com</b> → ⚙️ <b>Impostazioni</b> → <b>Aggiungi calendario</b> → <b>Crea nuovo calendario</b>. Chiamalo <i>Scadenze spese</i>.</li>
      <li>Sempre nelle Impostazioni: <b>Importa ed esporta</b> → scegli il file .ics → come calendario seleziona <i>Scadenze spese</i> → <b>Importa</b>.</li>
      <li>Apri le impostazioni del calendario <i>Scadenze spese</i> → <b>Notifiche evento</b> → aggiungi <b>Notifica · 0 minuti</b>. Serve perché Google ignora gli avvisi contenuti nel file.</li>
      <li>Sul telefono, nell'app Google Calendar, controlla che <i>Scadenze spese</i> sia spuntato e che le notifiche dell'app siano attive.</li>
    </ol>
    <p><b>Aggiornare:</b> quando l'app te lo segnala, riesporta e reimporta nello <b>stesso</b> calendario: i giorni già presenti vengono aggiornati, non duplicati. Se togli una spesa, il vecchio promemoria resta: per ripulire del tutto elimina e ricrea il calendario <i>Scadenze spese</i> prima di importare.</p>
    <p class="hint">Il file contiene le scadenze dei prossimi 12 mesi non ancora confermate, una notifica al giorno all'ora che hai scelto. Le bollette entrano solo dopo che le hai inserite: per quelle, quando le inserisci, l'app ti propone di aggiungere il promemoria con un tocco, senza riesportare.</p>
  </div>`);
}

// ───────────────────────── Esportazione / importazione ─────────────────────────
function offerFile(name, text, mime) {
  const blob = new Blob([text], {type: mime});
  let file = null; try { file = new File([blob], name, {type: mime}); } catch (e) {}
  const canShare = file && navigator.canShare && navigator.canShare({files: [file]});
  openSheet('Esporta', `<p style="margin:0 0 6px"><b>${h(name)}</b></p><p class="hint" style="margin:0 0 16px">${(blob.size / 1024).toFixed(1)} KB</p>
    <div style="display:flex;flex-direction:column;gap:10px">
      ${canShare ? '<button class="btn" id="ex-share">Condividi (Drive, email, WhatsApp…)</button>' : ''}
      <button class="btn${canShare ? ' ghost' : ''}" id="ex-dl">Scarica file</button>
      <button class="btn ghost" id="ex-cp">Copia negli appunti</button>
    </div>`, el => {
    if (canShare) $('#ex-share', el).onclick = () => navigator.share({files: [file], title: name}).then(() => { closeSheet(); toast('Condiviso'); }).catch(() => {});
    $('#ex-dl', el).onclick = () => {
      try { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); toast('Download avviato'); }
      catch (e) { toast('Download non disponibile qui'); }
    };
    $('#ex-cp', el).onclick = () => navigator.clipboard.writeText(text).then(() => toast('Copiato negli appunti')).catch(() => toast('Copia non disponibile'));
  });
}
const csvCell = v => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csvNum = v => (Math.round((+v || 0) * 100) / 100).toFixed(2).replace('.', ',');
const toCsv = rows => '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n');
function csvMovimenti(list) {
  return toCsv([['Data', 'Tipo', 'Categoria', 'Descrizione', 'Importo', 'Buoni pasto', 'Valore buoni', 'Pagato in denaro', 'Metodo', 'Periodo di riferimento', 'Note'],
    ...list.slice().sort((a, b) => a.data.localeCompare(b.data)).map(x => [x.data, x.tipo === 'extra' ? 'Extra' : 'Prevista', cat(x.categoriaId).nome, x.descrizione || '', csvNum(x.importo), +x.buoni || '', +x.buoni ? csvNum(x.buoniValore) : '', csvNum(cassa(x)), METODI[x.metodo] || '', x.periodo || '', x.note || ''])]);
}
const actionsExport = {
  exportJson: () => offerFile(`spese-backup-${isoToday()}.json`, JSON.stringify(S, null, 1), 'application/json'),
  exportMov: () => offerFile(`spese-movimenti-${isoToday()}.csv`, csvMovimenti(S.movimenti), 'text/csv'),
  exportMese: () => {
    const k = ymKey(cur.y, cur.m);
    offerFile(`spese-${k}.csv`, csvMovimenti(S.movimenti.filter(x => x.tipo === 'extra' ? x.data.startsWith(k) : x.periodo === k)), 'text/csv');
  },
  exportPrev: () => offerFile(`spese-previste-${isoToday()}.csv`, toCsv([
    ['Voce', 'Categoria', 'Tipo', 'Frequenza', 'Importo per pagamento', 'Costo mensile equivalente', 'Costo annuo', 'Scadenza', 'Metodo', 'Priorità', 'Conferma automatica', 'Rate totali', 'Rate mancanti', 'Debito residuo', 'Attiva', 'Dal', 'Fino al', 'Note'],
    ...S.previste.map(p => [p.voce, cat(p.categoriaId).nome, TIPI[p.tipo], FREQ[p.frequenza].l, csvNum(p.importo), csvNum(mensileEq(p)), csvNum(annuo(p)), scadenzaTesto(p), METODI[p.metodo], PRIO[p.priorita], isAuto(p) ? 'Sì' : 'No', ...((r) => r ? [r.totali || '', r.mancanti, csvNum(r.residuo)] : ['', '', ''])(rateInfo(p)), p.attiva === false ? 'No' : 'Sì', p.inizio || '', p.fine || '', p.note || ''])
  ]), 'text/csv'),
  importJson: () => { const i = $('#import-file'); i.value = ''; i.click(); }
};
$('#import-file').addEventListener('change', ev => {
  const file = ev.target.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!d || !Array.isArray(d.previste) || !Array.isArray(d.movimenti)) throw new Error('formato');
      askConfirm(`Il backup contiene <b>${d.previste.length}</b> spese previste e <b>${d.movimenti.length}</b> movimenti. Sostituire i dati attuali?`, 'Ripristina', () => {
        S = normalize(d); save(); render(); toast('Backup ripristinato');
      });
    } catch (e) { toast('File non valido'); }
  };
  r.readAsText(file);
});

// ───────────────────────── Dati di esempio ─────────────────────────
function seed() {
  const keep = S.categorie;
  S = fresh(); S.categorie = keep.length ? keep : S.categorie;
  const C = n => (S.categorie.find(c => c.nome === n) || S.categorie[0]).id;
  const P = (voce, c, tipo, freq, imp, giorno, meseRif, metodo, prio, ext) => Object.assign({id: uid(), voce, categoriaId: C(c), tipo, frequenza: freq, importo: imp, giorno, meseRif, metodo, priorita: prio, attiva: true, note: '', inizio: '', fine: ''}, ext || {});
  S.previste = [
    P('Affitto', 'Casa', 'fissa_mensile', 'mensile', 650, 1, 1, 'bonifico', 'essenziale'),
    P('Spese condominiali', 'Casa', 'fissa_mensile', 'mensile', 55, 10, 1, 'bonifico', 'essenziale'),
    P('Luce', 'Utenze', 'variabile', 'mensile', 55, 20, 1, 'addebito', 'essenziale', {bolletta: true}),
    P('Gas', 'Utenze', 'variabile', 'mensile', 70, 25, 1, 'addebito', 'essenziale', {bolletta: true}),
    P('Acqua', 'Utenze', 'variabile', 'trimestrale', 48, 15, 3, 'addebito', 'essenziale'),
    P('TARI', 'Utenze', 'fissa_non_mensile', 'semestrale', 140, 16, 5, 'bonifico', 'essenziale'),
    P('Cellulare', 'Telefonia', 'fissa_mensile', 'mensile', 9.99, 5, 1, 'addebito', 'essenziale'),
    P('Fibra casa', 'Internet', 'fissa_mensile', 'mensile', 27.9, 8, 1, 'addebito', 'essenziale'),
    P('Netflix', 'Abbonamenti digitali', 'fissa_mensile', 'mensile', 13.99, 12, 1, 'addebito', 'tagliabile'),
    P('Spotify', 'Abbonamenti digitali', 'fissa_mensile', 'mensile', 10.99, 18, 1, 'addebito', 'tagliabile'),
    P('Spazio cloud', 'Abbonamenti digitali', 'fissa_mensile', 'mensile', 2.99, 3, 1, 'addebito', 'utile'),
    P('Amazon Prime', 'Abbonamenti digitali', 'fissa_non_mensile', 'annuale', 49.9, 14, 3, 'addebito', 'tagliabile'),
    P('Bollo auto', 'Trasporti', 'fissa_non_mensile', 'annuale', 215, 30, 9, 'bonifico', 'essenziale'),
    P('Rata auto', 'Finanziamenti e Rate', 'fissa_mensile', 'mensile', 210, 15, 1, 'addebito', 'essenziale', {rate: true, numRate: 48, inizio: '2024-07', fine: '2028-06'}),
    P('Lavatrice a rate', 'Finanziamenti e Rate', 'fissa_mensile', 'mensile', 45, 5, 1, 'addebito', 'utile', {rate: true, numRate: 12, inizio: '2026-04', fine: '2027-03'}),
    P('Palestra', 'Salute', 'fissa_mensile', 'mensile', 39, 1, 1, 'addebito', 'tagliabile'),
    P('RC Auto', 'Assicurazioni', 'fissa_non_mensile', 'annuale', 480, 10, 4, 'bonifico', 'essenziale'),
    P('Assicurazione casa', 'Assicurazioni', 'fissa_non_mensile', 'annuale', 180, 20, 2, 'addebito', 'utile')
  ];
  S.entrate = [{id: uid(), voce: 'Stipendio', importo: 2150, mese: 0}, {id: uid(), voce: 'Tredicesima', importo: 2000, mese: 12}];
  S.imp.budgetExtra = 650;
  const kAuto = (() => { const x = addMonths(today().y, today().m, -5); return ymKey(x.y, x.m); })();
  S.previste.forEach(p => { if (p.metodo === 'addebito' && p.tipo !== 'variabile') { p.autoConferma = true; p.autoDal = kAuto; p.autoSkip = []; } });
  const B = {'Spesa alimentare': 450, 'Carburante': 160, 'Ristoranti e bar': 120};
  S.categorie.forEach(c => { c.budget = B[c.nome] || 0; });
  let r = 11; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
  const t = today();
  const EX = [['Spesa alimentare', 'Supermercato', 35, 95, 8], ['Spesa alimentare', 'Mercato', 12, 30, 2], ['Carburante', 'Benzina', 40, 65, 2.6], ['Ristoranti e bar', 'Pizzeria', 25, 60, 2], ['Ristoranti e bar', 'Colazione al bar', 3, 8, 4],
    ['Svago', 'Cinema', 10, 25, 1], ['Abbigliamento', 'Scarpe', 40, 90, 0.5], ['Cura personale', 'Parrucchiere', 18, 35, 1], ['Salute', 'Farmacia', 8, 30, 1.5], ['Regali', 'Regalo compleanno', 20, 50, 0.6]];
  for (let off = 5; off >= 0; off--) {
    const {y, m} = addMonths(t.y, t.m, -off), k = ymKey(y, m), last = off === 0 ? t.d : dim(y, m);
    S.previste.filter(p => p.bolletta && dovuta(p, y, m)).forEach(p => {
      if (off === 0 && p.voce !== 'Luce') return;  // il gas di questo mese resta "in attesa della bolletta"
      const g = off === 0 ? Math.min(dim(y, m), t.d + 6) : 12 + Math.floor(rnd() * 14);
      p.bollette = p.bollette || {};
      p.bollette[k] = {data: `${k}-${pad(g)}`, importo: Math.round(p.importo * (0.75 + rnd() * 0.5) * 100) / 100};
    });
    occorrenze(y, m).forEach(o => {
      if (o.attesa || o.scad > `${k}-${pad(last)}`) return;
      let imp = o.importo;
      if (o.p.tipo === 'variabile' && !o.ov) imp = Math.round(imp * (0.82 + rnd() * 0.36) * 100) / 100;
      S.movimenti.push({id: uid(), tipo: 'prevista', previstaId: o.p.id, periodo: k, data: o.scad, importo: imp, categoriaId: o.p.categoriaId, descrizione: o.p.voce, metodo: o.p.metodo, note: '', auto: !!o.p.autoConferma});
    });
    EX.forEach(([cn, desc, a, b, fr]) => {
      const n = Math.floor(fr * last / dim(y, m) + rnd());
      for (let i = 0; i < n; i++) S.movimenti.push({id: uid(), tipo: 'extra', data: `${k}-${pad(1 + Math.floor(rnd() * last))}`, importo: Math.round((a + rnd() * (b - a)) * 100) / 100, categoriaId: C(cn), descrizione: desc, metodo: rnd() < .8 ? 'carta' : 'contanti', note: ''});
    });
  }
  // buoni pasto: 20 al mese da 6,20 €, usati per parte della spesa
  S.buoni = {taglio: 6.2, ricariche: []};
  for (let off = 5; off >= 0; off--) { const {y, m} = addMonths(t.y, t.m, -off); S.buoni.ricariche.push({id: uid(), numero: 20, taglio: 6.2, data: `${ymKey(y, m)}-01`, note: ''}); }
  const usoMese = {};
  S.movimenti.filter(x => x.tipo === 'extra' && cat(x.categoriaId).buoni).sort((a, b) => a.data.localeCompare(b.data)).forEach(x => {
    const km = x.data.slice(0, 7), gia = usoMese[km] || 0;
    const k = Math.min(saldoBuoni().n, Math.floor(x.importo / 6.2), 4, 17 - gia);
    if (k > 0 && rnd() < 0.7) { x.buoni = k; x.buoniValore = valoreBuoni(k); usoMese[km] = gia + k; }
  });
  // lascia un paio di voci del mese corrente da confermare
  const k0 = ymKey(t.y, t.m);
  const daTogliere = S.movimenti.filter(x => x.tipo === 'prevista' && x.periodo === k0 && !x.auto).slice(-2).map(x => x.id);
  S.movimenti = S.movimenti.filter(x => !daTogliere.includes(x.id));
  save(); render(); toast('Dati di esempio caricati');
}

// ───────────────────────── Eventi ─────────────────────────
const A = {
  nav: (el, id) => { closeSheet(); if (location.hash !== '#' + id) location.hash = id; else { view = id; render(); } window.scrollTo(0, 0); },
  mPrev: () => { cur = addMonths(cur.y, cur.m, -1); render(); },
  mNext: () => { cur = addMonths(cur.y, cur.m, 1); render(); },
  mToday: () => { const t = today(); cur = {y: t.y, m: t.m}; render(); },
  goMonth: (el, id) => { const [y, m] = id.split('-').map(Number); cur = {y, m}; render(); },
  fab: () => (view === 'previste' || view === 'categorie') ? formPrevista() : formNuovo('extra'),
  newMov: () => formNuovo('extra'),
  tabNuovo: (el, id) => formNuovo(id),
  addPrev: () => formPrevista(),
  editPrev: (el, id) => formPrevista(id),
  conferma: (el, id) => { const [pid, per] = id.split('|'); formConferma(pid, per); },
  editMov: (el, id) => formEditMov(id),
  addEnt: () => formEntrata(), editEnt: (el, id) => formEntrata(id),
  budgets: () => formBudgets(),
  buoni: () => sheetBuoni(),
  ricarica: () => formRicarica(),
  editRicarica: (el, id) => formRicarica(id),
  exportIcs: () => exportIcs(),
  bolletta: (el, id) => { const [pid, per] = id.split('|'); formBolletta(pid, per); },
  icsHelp: () => guidaCalendario(),
  autoAll: (el, id) => { const on = id === '1', k = ymKey(today().y, today().m);
    S.previste.forEach(p => { if (p.metodo !== 'addebito') return; if (on && !p.autoConferma) { p.autoDal = k; p.autoSkip = []; } p.autoConferma = on; });
    save(); if (!autoConferma()) toast(on ? 'Conferma automatica attivata' : 'Conferma automatica disattivata'); render(); },
  addCat: () => formCategoria(), editCat: (el, id) => formCategoria(id),
  mode: (el, id) => { fPrev.mode = id; render(); },
  seed: () => (S.previste.length || S.movimenti.length) ? askConfirm('Caricare i dati di esempio? <b>I dati attuali verranno sostituiti.</b>', 'Carica esempio', seed, true) : seed(),
  reset: () => askConfirm('Cancellare <b>tutti</b> i dati? Ti consiglio di esportare prima un backup.', 'Cancella tutto', () => { S = fresh(); save(); render(); toast('Dati cancellati'); }, true),
  install: () => { if (installEvt) { installEvt.prompt(); installEvt.userChoice.finally(() => { installEvt = null; render(); }); } },
  closeSheet: () => closeSheet(),
  bgClose: (el, id, e) => { if (e.target === el) closeSheet(); },
  ...actionsExport
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]'); if (!el) return;
  // nelle righe con pulsante interno, il pulsante ha la precedenza
  const fn = A[el.dataset.a]; if (!fn) return;
  if (el.tagName === 'A') e.preventDefault();
  fn(el, el.dataset.id, e);
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-ch]'); if (!el) return;
  const k = el.dataset.ch;
  if (k === 'fCat') { fPrev.cat = el.value; render(); }
  else if (k === 'fPrio') { fPrev.prio = el.value; render(); }
  else if (k === 'budget') { S.imp.budgetExtra = num(el.value); save(); el.value = numIn(S.imp.budgetExtra || ''); toast('Budget salvato'); }
  else if (k === 'notifOra') { if (/^\d{2}:\d{2}$/.test(el.value)) { S.imp.notifOra = el.value; save(); render(); toast('Ora salvata: riesporta il calendario'); } }
  else if (k === 'notifQuando') { S.imp.notifQuando = el.value; save(); render(); }
  else if (k === 'notifAuto') { S.imp.notifAuto = el.checked; save(); render(); }
  else if (k === 'auto') {
    const p = S.previste.find(x => x.id === el.dataset.id); if (!p) return;
    if (el.checked && !p.autoConferma) { p.autoDal = ymKey(today().y, today().m); p.autoSkip = []; }
    p.autoConferma = el.checked; save();
    if (!autoConferma()) toast(el.checked ? `⚡ ${p.voce}: conferma automatica attiva` : `${p.voce}: conferma automatica disattivata`);
  }
  else if (k === 'preavviso') { S.imp.preavviso = Math.max(0, Math.min(30, parseInt(el.value, 10) || 0)); save(); toast('Salvato'); }
});
window.addEventListener('hashchange', () => { readHash(); render(); window.scrollTo(0, 0); });
// al ritorno sull'app (es. il giorno dopo) aggiorna stati e scadenze
document.addEventListener('visibilitychange', () => { if (!document.hidden && !sheetOpen) { autoConferma(); render(); } });

// ───────────────────────── PWA ─────────────────────────
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (view === 'altro') render(); });
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  try { navigator.serviceWorker.register('sw.js').catch(() => {}); } catch (e) {}
}
try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) {}

try { if (localStorage.getItem(KEY)) save(); } catch (e) {} // salva eventuali migrazioni
readHash();
autoConferma();
render();
})();
