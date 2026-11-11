// ================================================================ DPS meter (bottom right, WoW-style)
// Bars for every damage source you have: your hero, each tower, and effects (phoenix, glaive orbit, burns…).
// Click the header to switch between NOW (damage per second over the last 10 s) and RUN (whole-run total + average DPS).
// Settings > Gameplay > DPS meter turns it on/off (off by default on touch screens, where the buttons live there).
(() => {
  const css = `
#dps{position:fixed;right:10px;bottom:10px;width:236px;z-index:50;font:12px/1 system-ui,sans-serif;color:#fff;user-select:none;pointer-events:none;
 background:rgba(10,9,16,.62);border:1px solid #ffffff26;border-radius:8px;overflow:hidden;box-shadow:0 3px 12px #0006}
#dps .hd{display:flex;justify-content:space-between;align-items:center;padding:4px 7px;background:rgba(0,0,0,.45);pointer-events:auto;cursor:pointer;font-weight:700;letter-spacing:.3px}
#dps .hd span:last-child{color:#ffd76a;font-variant-numeric:tabular-nums}
#dps .rw{position:relative;height:19px;margin:2px 3px;border-radius:3px;overflow:hidden;background:rgba(255,255,255,.05)}
#dps .fill{position:absolute;inset:0 auto 0 0;opacity:.78;transition:width .35s ease}
#dps .tx{position:absolute;inset:0;display:flex;align-items:center;gap:4px;padding:0 5px 0 2px;text-shadow:0 1px 2px #000,0 0 3px #000}
#dps canvas{width:17px;height:17px;flex:none}
#dps .nm{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#dps .v{font-variant-numeric:tabular-nums;font-weight:700}
#dps .p{width:30px;text-align:right;color:#ddd;font-variant-numeric:tabular-nums}
#dps .em{padding:6px 8px;color:#aaa}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const box = document.createElement('div'); box.id = 'dps'; box.style.display = 'none';
  box.innerHTML = '<div class="hd"><span>DPS · NOW</span><span></span></div><div class="bd"></div>';
  document.body.appendChild(box);
  const hd = box.querySelector('.hd'), title = hd.firstChild, tot = hd.lastChild, body = box.querySelector('.bd');
  let mode = 'now', hist = [], run0 = null, rows = new Map();
  try { mode = localStorage.getItem('bss_dpsmode') || 'now'; } catch (e) { }
  hd.onclick = () => { mode = mode === 'now' ? 'run' : 'now'; try { localStorage.setItem('bss_dpsmode', mode); } catch (e) { } draw(); };

  const COLORS = ['#c41e3a', '#ff7c0a', '#33937f', '#a330c9', '#aad372', '#3fc7eb', '#00ff98', '#f48cba', '#fff468', '#0070dd', '#8788ee', '#c69b6d', '#e8e0d0'];
  const color = id => { if (id === 'hero') return '#ffd76a'; let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
  const fmt = v => v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e4 ? (v / 1e3).toFixed(1) + 'k' : v >= 100 ? Math.round(v).toString() : v.toFixed(1);
  const EFFECT = { fire: null, boomer: null };   // effects that report under a tower id use that tower's name
  function info(id) {
    if (id === 'hero') return { name: G.ch.name, icon: G.ch.spr };
    const sk = G.skillOf && G.skillOf[id];
    if (sk) return { name: sk.paragon ? sk.def.name : SKILLS[id] ? SKILLS[id].name : sk.def.name, icon: sk.def.icon };
    if (SKILLS[id]) return { name: SKILLS[id].name, icon: SKILLS[id].icon };
    return { name: id.replace(/^\w/, c => c.toUpperCase()), icon: null };
  }
  const on = () => SETTINGS.dpsMeter !== undefined ? !!SETTINGS.dpsMeter : !(typeof TOUCH_DEV !== 'undefined' && TOUCH_DEV);

  function totals() {
    const out = {};
    for (const [k, v] of Object.entries(G.runStats || {})) if (k !== 'debug' && v.dmg > 0) out[k] = v.dmg;
    return out;
  }
  function draw() {
    if (typeof G === 'undefined' || !G || !G.player || G.spec || !on() || !(G.state === 'play' || G.state === 'levelup')) { box.style.display = 'none'; return; }
    box.style.display = '';
    if (run0 !== G) { run0 = G; hist = []; rows.clear(); body.replaceChildren(); }
    const now = totals();
    if (!hist.length || G.t - hist[hist.length - 1].t >= 0.25) hist.push({ t: G.t, tot: now });
    while (hist.length > 2 && G.t - hist[0].t > 10) hist.shift();
    const old = hist[0], span = Math.max(1, G.t - old.t), runT = Math.max(1, G.t);
    let list = Object.entries(now).map(([id, d]) => ({ id, d, dps: mode === 'now' ? (d - (old.tot[id] || 0)) / span : d / runT }));
    if (mode === 'now') list = list.filter(r => r.dps > 0.05);
    list.sort((a, b) => b.dps - a.dps);
    const sumDps = list.reduce((a, r) => a + r.dps, 0), sumD = list.reduce((a, r) => a + r.d, 0), top = list.length ? list[0].dps : 1;
    title.textContent = mode === 'now' ? 'DPS · NOW (10s)' : 'DPS · WHOLE RUN';
    tot.textContent = fmt(sumDps);
    list = list.slice(0, 8);
    const keep = new Set(list.map(r => r.id));
    for (const [id, r] of rows) if (!keep.has(id)) { r.el.remove(); rows.delete(id); }
    if (!list.length) { if (!body.querySelector('.em')) body.replaceChildren(Object.assign(document.createElement('div'), { className: 'em', textContent: 'No damage yet' })); return; }
    const em = body.querySelector('.em'); if (em) em.remove();
    list.forEach((r, i) => {
      let row = rows.get(r.id);
      if (!row) {
        const el = document.createElement('div'); el.className = 'rw';
        el.innerHTML = `<div class="fill"></div><div class="tx"><canvas width="34" height="34"></canvas><span class="nm"></span><span class="v"></span><span class="p"></span></div>`;
        const inf = info(r.id); el.querySelector('.fill').style.background = color(r.id);
        const cv = el.querySelector('canvas');
        try { if (inf.icon) spriteToCanvas(cv, pickSpr(inf.icon), null); else cv.style.display = 'none'; } catch (e) { cv.style.display = 'none'; }
        row = { el, nm: el.querySelector('.nm'), v: el.querySelector('.v'), p: el.querySelector('.p'), fill: el.querySelector('.fill') };
        rows.set(r.id, row);
      }
      row.nm.textContent = `${i + 1}. ${info(r.id).name}`;
      row.v.textContent = fmt(r.dps);
      row.p.textContent = Math.round(100 * (mode === 'now' ? r.dps / (sumDps || 1) : r.d / (sumD || 1))) + '%';
      row.fill.style.width = Math.max(2, Math.round(100 * r.dps / (top || 1))) + '%';
      if (body.children[i] !== row.el) body.insertBefore(row.el, body.children[i] || null);
    });
  }
  setInterval(() => { try { draw(); } catch (e) { console.warn('dps meter', e); } }, 500);
})();
