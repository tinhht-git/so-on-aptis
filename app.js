(() => {
'use strict';
const A = window.APTIS;
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (a, n) => shuffle(a).slice(0, n);
const wc = s => (String(s).trim().match(/\S+/g) || []).length;
const fmt = sec => { sec = Math.max(0, Math.round(sec)); return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0'); };
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LETTER = 'ABCDEFGH';

/* ---------------- progress + sync ---------------- */
const LS = 'aptis-progress-v1';
let P = { v: 1, it: {}, done: {}, mock: [] };
let remote = null, saveTimer = null, syncState = 'loading';
function loadLocal() { try { const x = JSON.parse(localStorage.getItem(LS) || 'null'); if (x && x.it) P = { v: 1, it: x.it || {}, done: x.done || {}, mock: x.mock || [] }; } catch (e) { } }
function saveLocal() { try { localStorage.setItem(LS, JSON.stringify(P)); } catch (e) { } }
function merge(a, b) {
  const o = { v: 1, it: { ...(a.it || {}) }, done: { ...(a.done || {}) }, mock: [] };
  for (const k in (b.it || {})) if (!o.it[k] || (b.it[k].t || 0) > (o.it[k].t || 0)) o.it[k] = b.it[k];
  for (const k in (b.done || {})) if (!o.done[k] || b.done[k] > o.done[k]) o.done[k] = b.done[k];
  const m = new Map(); [...(a.mock || []), ...(b.mock || [])].forEach(x => m.set(x.ts, x));
  o.mock = [...m.values()].sort((x, y) => x.ts - y.ts).slice(-60); return o;
}
function setSync(s) {
  syncState = s; const el = $('#sync');
  el.className = 'chip ' + (s === 'ok' ? 'ok' : s === 'local' ? 'local' : '');
  el.querySelector('span').textContent = s === 'ok' ? 'Đã đồng bộ' : s === 'saving' ? 'Đang lưu…' : s === 'local' ? 'Lưu trên máy này' : 'Đang tải…';
  el.title = s === 'ok' ? 'Tiến độ được lưu vào tài khoản và đồng bộ giữa các thiết bị' : s === 'local' ? 'Tiến độ chỉ lưu trong trình duyệt này' : '';
}
function persist() { saveLocal(); if (remote) { setSync('saving'); clearTimeout(saveTimer); saveTimer = setTimeout(pushRemote, 1500); } }
async function pushRemote() {
  try { await remote.set(P); setSync('ok'); }
  catch (e) { if (e && (e.code === 'invalid_argument' || e.code === 'not_granted')) { remote = null; setSync('local'); } else setTimeout(() => { if (remote) pushRemote(); }, 4000 + Math.random() * 3000); }
}
function record(id, ok) { const r = P.it[id] || { c: 0, w: 0 }; ok ? r.c++ : r.w++; r.ok = !!ok; r.t = Date.now(); P.it[id] = r; persist(); }
function markDone(key, on = true) { if (on) P.done[key] = Date.now(); else delete P.done[key]; persist(); }
async function initSync() {
  loadLocal(); setSync('local');
  let tries = 0; while (!(window.claude && window.claude.use) && tries < 20) { await new Promise(r => setTimeout(r, 250)); tries++; }
  if (!(window.claude && window.claude.use)) return;
  try {
    const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
    if (!db || !user) return;
    const id = await user.id(); if (!id) return;
    const ref = db.collection('data/users/' + id).doc('progress');
    const snap = await ref.get();
    if (snap.exists) { P = merge(P, snap.data() || {}); saveLocal(); }
    remote = ref; await ref.set(P); setSync('ok'); render();
  } catch (e) { remote = null; setSync('local'); }
}

/* ---------------- toast ---------------- */
let toastT; function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 1800); }

/* ---------------- question bank ---------------- */
const QB = {};      // id -> question
const FB = {};      // id -> flash card
const add = q => (QB[q.id] = q, q.id);
const addF = f => (FB[f.id] = f, f.id);
const SK = {};
const hl = (txt, ans) => { const re = new RegExp('\\b(' + reEsc(ans) + ')\\b', 'i'); return esc(txt).replace(new RegExp('\\b(' + reEsc(esc(ans)) + ')\\b', 'i'), '<mark>$1</mark>'); };
const ul = (txt, kws) => { let h = esc(txt); (kws || []).forEach(k => { const i = h.toLowerCase().indexOf(esc(k).toLowerCase()); if (i >= 0) h = h.slice(0, i) + '<span class="u">' + h.slice(i, i + esc(k).length) + '</span>' + h.slice(i + esc(k).length); }); return h; };

// READING
(() => {
  const R = A.reading;
  const p1 = R.p1.map((tp, ti) => {
    const answers = tp.s.map(s => s.a);
    const ids = tp.s.map(s => {
      const re = new RegExp('\\b' + reEsc(s.a) + '\\b', 'i'); const blank = re.test(s.s) ? s.s.replace(re, '_____') : s.s + ' (_____)';
      const others = shuffle([...new Set(answers.filter(a => a.toLowerCase() !== s.a.toLowerCase()))]).slice(0, 2);
      const id = 'r1:' + hash(tp.t + s.s);
      addF({ id: 'f:' + id, front: `<div class="face-label">${esc(tp.t)}</div><div>${esc(blank)}</div>`, back: `<div class="ans"><mark>${esc(s.a)}</mark></div><div>${hl(s.s, s.a)}</div><div class="vi">${esc(s.v)}</div>` });
      return add({ id, kind: 'mcq', topic: tp.t, ctx: 'Ví dụ: ' + tp.ex, prompt: esc(blank), opts: shuffle([s.a, ...others]), ans: s.a, explain: `<p>${hl(s.s, s.a)}</p><p class="vi">${esc(s.v)}</p>` });
    });
    return { key: 'r1:' + ti, t: tp.t, sub: tp.s.length + ' câu', qids: ids, fids: ids.map(i => 'f:' + i) };
  });
  const p23 = R.p23.map(d => {
    const id = 'r23:' + d.id;
    add({ id, kind: 'order', topic: d.t, first: d.first, items: d.s });
    addF({ id: 'f:' + id, front: `<div class="face-label">Sắp xếp câu</div><div><b>${esc(d.t)}</b></div><div class="small muted">${esc(d.first)}</div>`, back: `<div class="list">${d.s.map((s, i) => `<div><b>${i + 1}.</b> ${ul(s.e, s.kw)}<div class="vi">${esc(s.v)}</div></div>`).join('')}</div>` });
    return { key: id, t: d.t, sub: d.s.length + ' câu cần xếp', qids: [id], fids: ['f:' + id] };
  });
  const p4 = R.p4.map((d, ti) => {
    const names = d.people.map(p => p.n);
    const ids = d.qa.map(x => {
      const id = 'r4:' + hash(d.t + x.q);
      addF({ id: 'f:' + id, front: `<div class="face-label">${esc(d.t)}</div><div>${esc(x.q)}</div><div class="vi">${esc(x.vq)}</div>`, back: `<div class="ans"><mark>${esc(x.a)}</mark></div><div>“${esc(x.ev)}”</div><div class="vi">${esc(x.why)}</div>` });
      return add({ id, kind: 'mcq', topic: d.t, prompt: esc(x.q), vi: x.vq, opts: names, ans: x.a, people: d, explain: `<p><b>${esc(x.a)}</b>: “<mark>${esc(x.ev)}</mark>”</p><p class="vi">${esc(x.why)}</p>` });
    });
    return { key: 'r4:' + ti, t: d.t, sub: '4 người · 7 câu hỏi', qids: ids, fids: ids.map(i => 'f:' + i), read: d };
  });
  const p5 = R.p5.map((d, ti) => {
    const id = 'r5:' + hash(d.t);
    add({ id, kind: 'match', topic: d.t, intro: 'Chọn tiêu đề phù hợp cho từng đoạn (câu mở đầu đoạn được hiển thị).', rows: d.h.map((h, i) => ({ label: `<b>Đoạn ${i + 1}.</b> ${esc(h.f)}` })), opts: d.h.map(h => h.h), ans: d.h.map(h => h.h),
      explain: `<p>Câu ghi nhớ: <mark><b>${esc(d.mn)}</b></mark></p><p class="small">${d.map.map(([v, e]) => `<b>${esc(v)}</b> = ${esc(e)}`).join(' · ')}</p>`, vis: d.h.map(h => h.v) });
    addF({ id: 'f:' + id, front: `<div class="face-label">7 heading theo thứ tự</div><div><b>${esc(d.t)}</b></div>`, back: `<div class="ans"><mark>${esc(d.mn)}</mark></div><div class="list">${d.h.map((h, i) => `<div><b>${i + 1}.</b> ${esc(h.h)} <span class="vi">· ${esc(h.v)}</span></div>`).join('')}</div>` });
    return { key: id, t: d.t, sub: 'Câu nhớ: ' + d.mn, qids: [id], fids: ['f:' + id] };
  });
  SK.reading = { name: 'Reading', c: 'var(--r)', parts: [
    { id: 'r1', n: 'Part 1', name: 'Sentence comprehension', desc: 'Chọn từ đúng điền vào chỗ trống trong 5 câu của một đoạn ngắn.', topics: p1, modes: ['quiz', 'flash'] },
    { id: 'r23', n: 'Part 2 + 3', name: 'Text cohesion', desc: 'Sắp xếp các câu theo đúng thứ tự. Từ gạch chân là từ nối giúp nhận ra thứ tự.', topics: p23, modes: ['quiz', 'flash'] },
    { id: 'r4', n: 'Part 4', name: 'Opinion matching', desc: 'Đọc ý kiến của 4 người, chọn người phù hợp với từng câu hỏi.', topics: p4, modes: ['quiz', 'flash'] },
    { id: 'r5', n: 'Part 5', name: 'Long text – headings', desc: 'Chọn tiêu đề cho 7 đoạn văn. Mỗi bài có một câu ghi nhớ 7 chữ.', topics: p5, modes: ['quiz', 'flash'] },
  ] };
})();

// LISTENING
(() => {
  const L = A.listening;
  const CATS = ['Số tiền · số lượng · con số', 'Thời gian · ngày giờ', 'Địa điểm · nơi chốn', 'Lý do (Why)', 'Sự việc · đồ vật · khác'];
  const split = q => { const m = q.match(/^(.*?[.!])\s+([^.!]*\?+.*|[^.!]*\.\.\.)$/); return m ? [m[1], m[2]] : ['', q]; };
  const byCat = CATS.map(() => []);
  L.p1.forEach(x => {
    const [ctx, qs] = split(x.q); const id = 'l1:' + hash(x.q + '|' + x.o[x.k]);
    add({ id, kind: 'mcq', topic: CATS[x.c], ctx, prompt: esc(qs), opts: x.o, ans: x.o[x.k], explain: `<p>Đáp án: <mark><b>${esc(x.o[x.k])}</b></mark></p>` });
    addF({ id: 'f:' + id, front: `<div class="small muted">${esc(ctx)}</div><div>${esc(qs)}</div>`, back: `<div class="ans"><mark>${esc(x.o[x.k])}</mark></div>` });
    byCat[x.c].push(id);
  });
  const p1 = CATS.map((c, i) => ({ key: 'l1:c' + i, t: c, sub: byCat[i].length + ' câu', qids: byCat[i], fids: byCat[i].map(x => 'f:' + x) }));
  const p2 = L.p2.map((d, ti) => {
    const id = 'l2:' + hash(d.t + d.a.map(x => x.a).join('|'));
    add({ id, kind: 'match', topic: d.t, intro: d.i, rows: d.a.map(x => ({ label: `<b>Speaker ${esc(x.sp)}</b>` })), opts: d.o, ans: d.a.map(x => x.a), vis: d.a.map(x => x.v), explain: '' });
    addF({ id: 'f:' + id, front: `<div class="face-label">4 người nói</div><div><b>${esc(d.t)}</b></div>`, back: `<div class="list">${d.a.map(x => `<div><b>${esc(x.sp)}</b> → <mark>${esc(x.a)}</mark> <span class="vi">· ${esc(x.v)}</span></div>`).join('')}</div>` });
    return { key: id, t: d.t, sub: d.a.map(x => x.a).join(' · '), qids: [id], fids: ['f:' + id] };
  });
  const LBL = { Man: 'Man · Nam', Woman: 'Woman · Nữ', Both: 'Both · Cả hai' };
  const p3 = L.p3.map((d, ti) => {
    const ids = d.s.map(x => {
      const id = 'l3:' + hash(d.t + x.s);
      addF({ id: 'f:' + id, front: `<div class="face-label">${esc(d.t)}</div><div>${esc(x.s)}</div><div class="vi">${esc(x.v)}</div>`, back: `<div class="ans"><mark>${esc(LBL[x.a])}</mark></div>` });
      return add({ id, kind: 'mcq', topic: d.t, ctx: 'Ai có ý kiến này?', prompt: esc(x.s), vi: x.v, opts: ['Man', 'Woman', 'Both'], labels: LBL, noShuffle: true, ans: x.a, explain: `<p>Đáp án: <mark><b>${esc(LBL[x.a])}</b></mark></p>` });
    });
    return { key: 'l3:' + ti, t: d.t, sub: ids.length + ' ý kiến', qids: ids, fids: ids.map(i => 'f:' + i) };
  });
  const p4 = L.p4quiz.map((b, ti) => {
    const ids = b.qs.map(q => add({ id: 'l4:' + hash(q.q + '|' + q.o[q.k]), kind: 'mcq', topic: b.t, prompt: esc(q.q), opts: q.o, ans: q.o[q.k], explain: `<p>Đáp án: <mark><b>${esc(q.o[q.k])}</b></mark></p>${q.tip ? `<p class="small">Mẹo nhớ: ${esc(q.tip)}</p>` : ''}` }));
    return { key: 'l4q:' + ti, t: b.t, sub: b.vn && b.vn !== b.t ? b.vn : ids.length + ' câu', qids: ids, fids: [] };
  });
  const p4c = L.p4cards.map((d, ti) => {
    const id = 'f:l4c:' + hash(d.t);
    addF({ id, front: `<div class="face-label">4 đáp án cần nhớ</div><div><b>${esc(d.t)}</b></div>`, back: `<div class="list">${d.parts.map((p, i) => `<div><b>Bài nghe ${i + 1}</b>${p.map(x => `<div>• <mark>${esc(x.a)}</mark><div class="vi">${esc(x.v)}</div></div>`).join('')}</div>`).join('')}</div>` });
    return { key: 'l4c:' + ti, t: d.t, sub: 'Flashcard', qids: [], fids: [id] };
  });
  SK.listening = { name: 'Listening', c: 'var(--l)', parts: [
    { id: 'l1', n: 'Part 1', name: 'Word recognition', desc: 'Câu 1–13: nghe đoạn ngắn, chọn đáp án đúng. Câu hỏi được chia theo dạng thông tin cần nghe.', topics: p1, modes: ['quiz', 'flash'] },
    { id: 'l2', n: 'Part 2', name: 'Matching information', desc: 'Câu 14: ghép 4 người nói với 4 trong 6 lựa chọn.', topics: p2, modes: ['quiz', 'flash'] },
    { id: 'l3', n: 'Part 3', name: 'Opinion matching', desc: 'Câu 15: ý kiến là của người nam, người nữ hay cả hai.', topics: p3, modes: ['quiz', 'flash'] },
    { id: 'l4', n: 'Part 4', name: 'Monologues', desc: 'Câu 16–17: mỗi topic 2 bài nghe, mỗi bài 2 câu hỏi.', topics: p4, flashTopics: p4c, modes: ['quiz', 'flash'] },
  ], note: 'Bản ôn này không có audio: dùng để nhớ câu hỏi và đáp án đúng trước khi luyện nghe.' };
})();

// WRITING
(() => {
  const W = A.writing;
  const profF = W.profile.flatMap(g => g.l.map(x => addF({ id: 'f:wp:' + hash(x.q), front: `<div class="face-label">${esc(g.g)}</div><div>${esc(x.q)}</div>`, back: `<div class="ans">${esc(x.a)}</div><div class="vi">${esc(x.v)}</div>${x.voc ? `<div class="small muted">${esc(x.voc)}</div>` : ''}` })));
  const p1 = W.p1.map((d, i) => ({ key: 'w1:' + d.t, t: d.t, sub: '5 tin nhắn', d, fids: d.qa.map(x => addF({ id: 'f:w1:' + hash(x.q + x.a), front: `<div class="face-label">${esc(d.t)}</div><div>${esc(x.q)}</div>`, back: `<div class="ans">${esc(x.a)}</div><div class="vi">${esc(x.v)}</div>` })) }));
  SK.writing = { name: 'Writing', c: 'var(--w)', parts: [
    { id: 'w1', n: 'Part 1', name: 'Short answers', desc: 'Trả lời 5 tin nhắn, mỗi câu 1–5 từ.', topics: p1, modes: ['write', 'flash', 'profile'], profileF: profF, limit: [1, 5] },
    { id: 'w2', n: 'Part 2', name: 'Form filling', desc: 'Điền form gia nhập club bằng câu hoàn chỉnh, 20–30 từ.', topics: W.p2.map(d => ({ key: 'w2:' + d.t, t: d.t, sub: d.q, d })), modes: ['write'], limit: [20, 30] },
    { id: 'w3', n: 'Part 3', name: 'Chat responses', desc: 'Trả lời 3 câu hỏi trong club chat, mỗi câu 30–40 từ.', topics: W.p3.map(d => ({ key: 'w3:' + d.t, t: d.t, sub: '3 câu hỏi', d })), modes: ['write', 'frame'], frame: W.frame3, limit: [30, 40] },
    { id: 'w4', n: 'Part 4', name: 'Informal & formal emails', desc: 'Email gửi bạn (~50 từ) và email gửi quản lý (120–150 từ).', topics: W.p4.map(d => ({ key: 'w4:' + d.t, t: d.t, sub: d.type, d })), modes: ['write', 'frame', 'types'], frame: W.frame4 },
  ] };
})();

// SPEAKING
(() => {
  const S = A.speaking;
  const cfg = { 1: { name: 'Personal questions', desc: '3 câu hỏi cá nhân, mỗi câu 30 giây.', sec: 30 }, 2: { name: 'Describe a picture', desc: 'Tả 1 bức tranh và trả lời 2 câu hỏi, mỗi câu 45 giây.', sec: 45 }, 3: { name: 'Compare two pictures', desc: 'So sánh 2 bức tranh và trả lời 2 câu hỏi, mỗi câu 45 giây.', sec: 45 }, 4: { name: 'Personal experience & opinion', desc: '3 câu hỏi về một chủ đề: chuẩn bị 1 phút, nói liên tục 2 phút.', sec: 120, prep: 60 } };
  SK.speaking = { name: 'Speaking', c: 'var(--s)', parts: [1, 2, 3, 4].map(p => ({ id: 's' + p, p, n: 'Part ' + p, name: cfg[p].name, desc: cfg[p].desc, sec: cfg[p].sec, prep: cfg[p].prep || 0, modes: ['speak'],
    topics: S['p' + p].map(d => ({ key: 's' + p + ':' + d.t, t: d.t, sub: d.img.length ? (d.img.length + ' hình') : (p === 4 ? 'Không hình' : '3 câu hỏi'), d })) })) };
})();

const ORDER = ['reading', 'listening', 'writing', 'speaking'];
const VNAME = { reading: 'Đọc', listening: 'Nghe', writing: 'Viết', speaking: 'Nói' };

/* ---------------- stats ---------------- */
function topicState(tp) {
  if (tp.qids && tp.qids.length) {
    const r = tp.qids.map(i => P.it[i]); const n = r.filter(Boolean).length;
    if (!n) return ''; if (r.some(x => x && x.ok === false)) return 'bad'; return n === tp.qids.length ? 'done' : 'part';
  }
  return P.done[tp.key] ? 'done' : '';
}
function partStats(part) {
  const tps = part.topics; let q = 0, a = 0, ok = 0, td = 0;
  tps.forEach(tp => { if (tp.qids && tp.qids.length) { q += tp.qids.length; tp.qids.forEach(i => { const r = P.it[i]; if (r) { a++; if (r.ok) ok++; } }); } if (topicState(tp) === 'done') td++; });
  return { q, a, ok, td, tt: tps.length, pct: q ? Math.round(100 * a / q) : Math.round(100 * td / Math.max(1, tps.length)) };
}
function globalStats() {
  let a = 0, ok = 0; Object.keys(P.it).forEach(k => { if (k.startsWith('f:')) return; if (!QB[k]) return; a++; if (P.it[k].ok) ok++; });
  const done = Object.keys(P.done).length; return { a, ok, acc: a ? Math.round(100 * ok / a) : 0, done };
}
const wrongIds = () => Object.keys(P.it).filter(k => QB[k] && P.it[k].ok === false);

/* ---------------- routing / render ---------------- */
let V = { v: 'home' };
let cleanup = [];
function go(v) { cleanup.forEach(f => f()); cleanup = []; V = v; render(); window.scrollTo(0, 0); }
function renderNav() {
  const items = [['home', 'Tổng quan'], ...ORDER.map(k => [k, SK[k].name]), ['mock', 'Thi thử'], ['review', 'Ôn câu sai']];
  const cur = V.v === 'home' ? 'home' : V.v === 'mock' || V.v === 'mockrun' ? 'mock' : V.v === 'review' ? 'review' : V.skill || '';
  $('#nav').innerHTML = items.map(([k, n]) => `<button type="button" data-nav="${k}" aria-current="${cur === k}">${esc(n)}${k === 'review' && wrongIds().length ? ` (${wrongIds().length})` : ''}</button>`).join('');
}
function render() {
  renderNav();
  const app = $('#app');
  const f = { home: vHome, skill: vSkill, part: vPart, quiz: vQuiz, flash: vFlash, write: vWrite, speak: vSpeak, mock: vMock, review: vReview, frame: vFrame, types: vTypes }[V.v] || vHome;
  app.innerHTML = f();
  after.forEach(fn => fn()); after = [];
}
let after = [];
document.addEventListener('click', e => {
  const n = e.target.closest('[data-nav]'); if (n) { const k = n.dataset.nav; go(k === 'home' ? { v: 'home' } : k === 'mock' ? { v: 'mock' } : k === 'review' ? { v: 'review' } : { v: 'skill', skill: k }); return; }
});
$('#brand').addEventListener('click', () => go({ v: 'home' }));

const back = (label, v) => { after.push(() => { const b = document.querySelector('[data-back]'); if (b) b.onclick = () => go(v); }); return `<button class="back" type="button" data-back>← ${esc(label)}</button>`; };
const bind = (sel, fn, ev = 'click') => after.push(() => document.querySelectorAll(sel).forEach(el => el.addEventListener(ev, e => fn(el, e))));
const findPart = id => { for (const k of ORDER) { const p = SK[k].parts.find(x => x.id === id); if (p) return [k, p]; } };

/* ---------------- views ---------------- */
function vHome() {
  const g = globalStats(); const w = wrongIds().length;
  bind('[data-part]', el => go({ v: 'part', skill: el.dataset.skill, part: el.dataset.part }));
  bind('[data-go]', el => go({ v: el.dataset.go }));
  return `<section class="hero"><div><div class="eyebrow">Ôn thi Aptis General · mục tiêu B2</div><h1>Học đúng đề, nhớ đúng đáp án.</h1>
  <p>Đề và đáp án tổng hợp cho 4 kỹ năng: luyện trắc nghiệm có chấm điểm, flashcard, luyện viết có đếm từ, luyện nói theo đồng hồ và thi thử.</p></div>
  <div class="stats"><div class="stat"><b>${g.a}</b><span>câu đã làm</span></div><div class="stat"><b>${g.acc}%</b><span>trả lời đúng</span></div><div class="stat"><b>${g.done}</b><span>topic đã luyện</span></div></div></section>
  <div class="row" style="margin-bottom:16px"><button class="btn pri" type="button" data-go="mock">Thi thử theo thời gian</button><button class="btn" type="button" data-go="review" ${w ? '' : 'disabled'}>Ôn lại ${w} câu sai</button></div>
  <div class="grid">${ORDER.map(k => { const s = SK[k]; return `<div class="card skillcard" style="--c:${s.c}"><div class="row" style="justify-content:space-between"><h2>${s.name}</h2><span class="eyebrow">${VNAME[k]}</span></div>
    ${s.parts.map(p => { const st = partStats(p); return `<button class="partrow" type="button" data-skill="${k}" data-part="${p.id}"><div><b>${esc(p.n)} · ${esc(p.name)}</b><span>${p.topics.length} topic${st.q ? ` · ${st.a}/${st.q} câu` : ` · ${st.td} đã luyện`}</span></div><div class="bar" style="--c:${s.c}"><i style="width:${st.pct}%"></i></div></button>`; }).join('')}</div>`; }).join('')}</div>`;
}
function vSkill() {
  const s = SK[V.skill];
  bind('[data-part]', el => go({ v: 'part', skill: V.skill, part: el.dataset.part }));
  return `<div class="section-h"><div><div class="eyebrow">${VNAME[V.skill]}</div><h1 style="color:${s.c}">${s.name}</h1></div></div>${s.note ? `<p class="note">${esc(s.note)}</p>` : ''}
  <div class="grid">${s.parts.map(p => { const st = partStats(p); return `<button class="card topic" type="button" data-part="${p.id}" style="--c:${s.c};flex-direction:column;align-items:stretch;gap:8px"><div class="eyebrow" style="color:${s.c}">${esc(p.n)}</div><div style="font-family:var(--display);font-size:20px;font-weight:600">${esc(p.name)}</div><div class="small muted">${esc(p.desc)}</div><div class="bar" style="--c:${s.c}"><i style="width:${st.pct}%"></i></div><div class="small muted">${p.topics.length} topic${st.q ? ` · ${st.a}/${st.q} câu đã làm · đúng ${st.a ? Math.round(100 * st.ok / st.a) : 0}%` : ` · ${st.td} đã luyện`}</div></button>`; }).join('')}</div>`;
}
const MODE_N = { quiz: 'Trắc nghiệm', flash: 'Flashcard', write: 'Luyện viết', profile: 'Câu trả lời cá nhân', frame: 'Khung bài', types: 'Theo dạng đề', speak: 'Luyện nói' };
function vPart() {
  const s = SK[V.skill], p = s.parts.find(x => x.id === V.part); const mode = V.mode || p.modes[0];
  const tps = mode === 'flash' && p.flashTopics ? [...p.flashTopics] : p.topics;
  bind('[data-mode]', el => go({ ...V, mode: el.dataset.mode }));
  bind('[data-topic]', el => { const tp = tps[+el.dataset.topic]; startMode(p, mode, [tp], tp.t); });
  bind('[data-rand]', () => { if (mode === 'quiz') { const ids = shuffle(p.topics.flatMap(t => t.qids)).slice(0, p.id === 'l1' ? 13 : 10); startQuiz({ title: p.n + ' · ngẫu nhiên', ids, ret: { ...V } }); } else if (mode === 'flash') { startFlash(p, shuffle(tps.flatMap(t => t.fids || [])).slice(0, 30), p.n + ' · ngẫu nhiên'); } else { const tp = tps[Math.random() * tps.length | 0]; startMode(p, mode, [tp], tp.t); } });
  bind('[data-new]', () => { const ids = p.topics.flatMap(t => t.qids).filter(i => !P.it[i]); if (!ids.length) return toast('Bạn đã làm hết câu của part này'); startQuiz({ title: p.n + ' · câu chưa làm', ids: shuffle(ids).slice(0, 15), ret: { ...V } }); });
  bind('[data-wrong]', () => { const ids = p.topics.flatMap(t => t.qids).filter(i => P.it[i] && P.it[i].ok === false); startQuiz({ title: p.n + ' · câu sai', ids, ret: { ...V } }); });
  if (mode === 'frame') return vFrame(p, s);
  if (mode === 'types') return vTypes(p, s);
  if (mode === 'profile') { after.push(() => { const b = document.querySelector('[data-prof]'); if (b) b.onclick = () => startFlash(p, p.profileF, 'Câu trả lời cá nhân'); }); }
  const wrongN = (p.topics.flatMap(t => t.qids || [])).filter(i => P.it[i] && P.it[i].ok === false).length;
  const head = `${back(s.name, { v: 'skill', skill: V.skill })}<div class="section-h"><div><div class="eyebrow" style="color:${s.c}">${s.name} · ${esc(p.n)}</div><h1>${esc(p.name)}</h1><p class="muted" style="margin:.3em 0 0">${esc(p.desc)}</p></div></div>
  <div class="tabs" role="group" aria-label="Chế độ">${p.modes.map(m => `<button type="button" data-mode="${m}" aria-pressed="${m === mode}">${MODE_N[m]}</button>`).join('')}</div>`;
  if (mode === 'profile') {
    const W = A.writing;
    return head + `<div class="row" style="margin-bottom:12px"><button class="btn pri" type="button" data-prof>Học bằng flashcard</button></div><div class="grid">${W.profile.map(g => `<div class="card"><div class="eyebrow" style="margin-bottom:6px">${esc(g.g)}</div>${g.l.map(x => `<div style="padding:6px 0;border-bottom:1px solid var(--line)"><div class="small muted">${esc(x.q)}</div><div><b>${esc(x.a)}</b></div><div class="vi">${esc(x.v)}</div></div>`).join('')}</div>`).join('')}</div>`;
  }
  const tools = mode === 'quiz' ? `<button class="btn pri" type="button" data-rand>Luyện ngẫu nhiên ${p.id === 'l1' ? '13' : '10'} câu</button><button class="btn" type="button" data-new>Câu chưa làm</button><button class="btn" type="button" data-wrong ${wrongN ? '' : 'disabled'}>Câu sai (${wrongN})</button>`
    : mode === 'flash' ? `<button class="btn pri" type="button" data-rand>Trộn ngẫu nhiên</button>` : `<button class="btn pri" type="button" data-rand>Chọn ngẫu nhiên 1 topic</button>`;
  return head + `<div class="row" style="margin-bottom:14px">${tools}</div><div class="topics" style="--c:${s.c}">${tps.map((tp, i) => `<button class="topic" type="button" data-topic="${i}"><span class="dot ${topicState(tp)}"></span><span class="t">${esc(tp.t)}<small>${esc(tp.sub || '')}</small></span></button>`).join('')}</div>
  <p class="small muted" style="margin-top:14px"><span class="dot done" style="display:inline-block;vertical-align:middle"></span> đã làm đúng hết · <span class="dot part" style="display:inline-block;vertical-align:middle"></span> làm dở · <span class="dot bad" style="display:inline-block;vertical-align:middle"></span> còn câu sai</p>`;
}
function startMode(p, mode, tps, title) {
  const ret = { ...V };
  if (mode === 'quiz') return startQuiz({ title, ids: tps.flatMap(t => t.qids), ret, read: tps[0].read });
  if (mode === 'flash') return startFlash(p, tps.flatMap(t => t.fids || []), title);
  if (mode === 'write') return go({ v: 'write', part: p.id, topic: tps[0], ret });
  if (mode === 'speak') return go({ v: 'speak', steps: speakSteps(p, tps[0]), title: p.n + ' · ' + tps[0].t, doneKey: tps[0].key, ret });
}

/* ---------- quiz ---------- */
function startQuiz(o) { if (!o.ids.length) return toast('Chưa có câu nào'); go({ v: 'quiz', title: o.title, ids: o.ids, i: 0, score: 0, res: {}, ret: o.ret || { v: 'home' }, mock: o.mock || null, read: o.read || null, limit: o.limit || 0, start: Date.now() }); }
function vQuiz() {
  if (V.mock && V.limit && V.i < V.ids.length) { const tick = () => { const left = V.limit - (Date.now() - V.start) / 1000; const el = document.querySelector('#qtimer'); if (el) { el.textContent = fmt(left); el.classList.toggle('warn', left < 120); } if (left <= 0) { finishQuiz(); } }; const t = setInterval(tick, 1000); cleanup.push(() => clearInterval(t)); after.push(tick); }
  if (V.i >= V.ids.length) return vQuizResult();
  const q = QB[V.ids[V.i]]; const done = V.res[q.id];
  const pr = `<div class="prog"><span>${V.i + 1}/${V.ids.length}</span><div class="bar"><i style="width:${100 * V.i / V.ids.length}%"></i></div>${V.mock ? '' : `<span>đúng ${fmtScore(V.score)}</span>`}</div>`;
  const head = `${back('Thoát', V.ret)}<div class="qhead"><div><div class="eyebrow">${esc(V.title)}</div><div class="small muted">${esc(q.topic || '')}</div></div>${V.mock && V.limit ? '<span class="timer" id="qtimer">--:--</span>' : ''}</div>${pr}`;
  const readPanel = (q.people || (V.read)) ? `<details ${V.mock ? 'open' : ''}><summary>Đọc ý kiến của 4 người</summary><div>${(q.people || V.read).people.map(p => `<p><b>${esc(p.n)}:</b> ${esc(p.txt)}</p><p class="vi">${esc(p.vi)}</p>`).join('')}</div></details>` : '';
  let body = '';
  if (q.kind === 'mcq') body = mcqBody(q, done);
  if (q.kind === 'order') body = orderBody(q, done);
  if (q.kind === 'match') body = matchBody(q, done);
  const nav = `<div class="row" style="justify-content:space-between"><span></span><button class="btn pri" type="button" id="qnext" ${done ? '' : 'hidden'}>${V.i + 1 >= V.ids.length ? 'Xem kết quả' : 'Câu tiếp →'}</button></div>`;
  after.push(() => { const n = document.querySelector('#qnext'); if (n) n.onclick = () => { V.i++; render(); window.scrollTo(0, 0); }; });
  return head + `<div style="height:12px"></div><div class="qcard">${readPanel}${body}${nav}</div>`;
}
const fmtScore = x => Math.round(x * 10) / 10;
function finishQuiz() { if (V.v !== 'quiz') return; V.i = V.ids.length; cleanup.forEach(f => f()); cleanup = []; render(); }
function grade(q, ok, frac) { if (V.res[q.id]) return; V.res[q.id] = { ok, frac }; V.score += frac; record(q.id, ok); }
function mcqBody(q, done) {
  if (!q._o) q._o = q.noShuffle ? q.opts : shuffle(q.opts);
  const opts = q._o; const showFb = done && !V.mock;
  bind('[data-opt]', el => { if (V.res[q.id]) return; const v = opts[+el.dataset.opt]; const ok = v === q.ans; grade(q, ok, ok ? 1 : 0); V.res[q.id].pick = v; if (V.mock) { V.i++; } render(); });
  return `<div class="prompt">${q.ctx ? `<span class="ctx">${esc(q.ctx)}</span>` : ''}${q.prompt}</div>${q.vi && !V.mock ? `<div class="vi">${esc(q.vi)}</div>` : ''}
  <div class="opts">${opts.map((o, i) => { let cls = ''; if (showFb) { if (o === q.ans) cls = 'right'; else if (done.pick === o) cls = 'wrong'; } return `<button class="opt ${cls}" type="button" data-opt="${i}" ${done ? 'disabled' : ''}><span class="k">${LETTER[i]}</span><span>${esc(q.labels ? q.labels[o] : o)}</span></button>`; }).join('')}</div>
  ${showFb ? `<div class="explain">${done.ok ? '<b style="color:var(--good)">Chính xác.</b>' : '<b style="color:var(--bad)">Chưa đúng.</b>'} ${q.explain}</div>` : ''}`;
}
function orderBody(q, done) {
  if (!q._st || q._st.qid !== V.ids[V.i] + V.start) q._st = { qid: V.ids[V.i] + V.start, pool: shuffle(q.items.map((_, i) => i)), placed: [] };
  const st = q._st;
  bind('[data-pool]', el => { if (done) return; const i = +el.dataset.pool; st.pool = st.pool.filter(x => x !== i); st.placed.push(i); render(); });
  bind('[data-placed]', el => { if (done) return; const i = +el.dataset.placed; st.placed = st.placed.filter(x => x !== i); st.pool.push(i); render(); });
  bind('[data-check]', () => { const right = st.placed.filter((x, k) => x === k).length; const ok = right === q.items.length; grade(q, ok, right / q.items.length); V.res[q.id].right = right; if (V.mock) V.i++; render(); });
  const showFb = done && !V.mock;
  return `<div class="prompt">Sắp xếp các câu theo đúng thứ tự<span class="ctx">${esc(q.topic)}</span></div>
  <div class="first"><span class="small muted">Câu mở đầu (cố định):</span><br>${esc(q.first)}</div>
  <div class="order-ans">${st.placed.map((i, k) => `<button class="sent placed ${showFb ? (i === k ? 'right' : 'wrong') : ''}" type="button" data-placed="${i}">${esc(q.items[i].e)}</button>`).join('') || '<div class="small muted">Chạm vào câu bên dưới theo thứ tự bạn nghĩ là đúng.</div>'}</div>
  ${st.pool.length ? `<div class="eyebrow">Các câu còn lại</div><div class="order-pool">${st.pool.map(i => `<button class="sent" type="button" data-pool="${i}">${esc(q.items[i].e)}</button>`).join('')}</div>` : ''}
  ${!done ? `<div><button class="btn pri" type="button" data-check ${st.pool.length ? 'disabled' : ''}>Kiểm tra</button></div>` : ''}
  ${showFb ? `<div class="explain"><p><b>${done.right}/${q.items.length} câu đúng vị trí.</b> Thứ tự đúng (từ gạch chân là dấu hiệu nối câu):</p>${q.items.map((s, i) => `<p>${i + 1}. ${ul(s.e, s.kw)}<br><span class="vi">${esc(s.v)}</span></p>`).join('')}</div>` : ''}`;
}
function matchBody(q, done) {
  if (!q._st || q._st.qid !== V.ids[V.i] + V.start) q._st = { qid: V.ids[V.i] + V.start, opts: shuffle(q.opts), sel: q.rows.map(() => '') };
  const st = q._st; const showFb = done && !V.mock;
  bind('[data-sel]', (el) => { st.sel[+el.dataset.sel] = el.value; const b = document.querySelector('[data-check]'); if (b) b.disabled = st.sel.some(x => !x); }, 'change');
  bind('[data-check]', () => { const right = st.sel.filter((v, i) => v === q.ans[i]).length; const ok = right === q.rows.length; grade(q, ok, right / q.rows.length); V.res[q.id].right = right; if (V.mock) V.i++; render(); });
  return `<div class="prompt">${esc(q.topic)}<span class="ctx">${esc(q.intro || '')}</span></div>
  <div>${q.rows.map((r, i) => `<div class="matchrow"><div>${r.label}</div><div><select id="m-${q.id}-${i}" data-sel="${i}" class="${showFb ? (st.sel[i] === q.ans[i] ? 'right' : 'wrong') : ''}" ${done ? 'disabled' : ''} aria-label="Đáp án ${i + 1}"><option value="">— chọn —</option>${st.opts.map(o => `<option ${st.sel[i] === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>${showFb && st.sel[i] !== q.ans[i] ? `<div class="small" style="margin-top:4px">Đúng: <mark>${esc(q.ans[i])}</mark></div>` : ''}${showFb && q.vis ? `<div class="vi">${esc(q.vis[i])}</div>` : ''}</div></div>`).join('')}</div>
  ${!done ? `<div><button class="btn pri" type="button" data-check ${st.sel.some(x => !x) ? 'disabled' : ''}>Kiểm tra</button></div>` : ''}
  ${showFb ? `<div class="explain"><p><b>${done.right}/${q.rows.length} đúng.</b></p>${q.explain || ''}</div>` : ''}`;
}
function vQuizResult() {
  const total = V.ids.length; const pct = Math.round(100 * V.score / total);
  const wrong = V.ids.filter(i => V.res[i] && !V.res[i].ok); const skipped = V.ids.filter(i => !V.res[i]);
  if (V.mock && !V.saved) { V.saved = true; P.mock.push({ ts: Date.now(), skill: V.mock, score: fmtScore(V.score), total, sec: Math.round((Date.now() - V.start) / 1000) }); persist(); }
  bind('[data-retry]', () => startQuiz({ title: V.title + ' · làm lại câu sai', ids: [...wrong, ...skipped], ret: V.ret }));
  bind('[data-again]', () => startQuiz({ title: V.title, ids: shuffle(V.ids), ret: V.ret }));
  after.push(() => { const b = document.querySelector('[data-done]'); if (b) b.onclick = () => go(V.ret); });
  const rev = V.mock ? `<details open><summary>Xem lại đáp án (${wrong.length + skipped.length} câu sai hoặc chưa làm)</summary><div>${[...wrong, ...skipped].map(id => { const q = QB[id]; return `<div style="padding:8px 0;border-bottom:1px solid var(--line)"><div class="small muted">${esc(q.topic)}</div>${q.kind === 'mcq' ? `<div>${q.prompt}</div><div>→ <mark>${esc(q.labels ? q.labels[q.ans] : q.ans)}</mark></div>` : q.kind === 'order' ? q.items.map((s, i) => `<div class="small">${i + 1}. ${esc(s.e)}</div>`).join('') : q.ans.map((a, i) => `<div class="small">${i + 1}. ${esc(a)}</div>`).join('')}</div>`; }).join('') || '<p>Không có.</p>'}</div></details>` : '';
  return `<div class="qcard result"><div class="eyebrow">${esc(V.title)}</div><div class="big">${fmtScore(V.score)}/${total}</div><div class="muted">${pct}% · ${fmt((Date.now() - V.start) / 1000)}</div>
  <div class="row" style="justify-content:center;margin-top:10px">${wrong.length + skipped.length ? `<button class="btn pri" type="button" data-retry>Làm lại ${wrong.length + skipped.length} câu sai</button>` : ''}<button class="btn" type="button" data-again>Làm lại tất cả</button><button class="btn ghost" type="button" data-done>Xong</button></div></div><div style="height:14px"></div>${rev}`;
}

/* ---------- flashcards ---------- */
function startFlash(p, fids, title) { if (!fids.length) return toast('Chưa có thẻ'); go({ v: 'flash', title, fids, i: 0, flip: false, known: 0, ret: { ...V } }); }
function vFlash() {
  const n = V.fids.length;
  after.push(() => {
    const card = document.querySelector('#fcard'); if (card) card.onclick = () => { V.flip = !V.flip; render(); };
    const mk = (sel, ok) => { const b = document.querySelector(sel); if (b) b.onclick = () => { record(V.fids[V.i], ok); if (ok) V.known++; V.i++; V.flip = false; render(); }; };
    mk('[data-yes]', true); mk('[data-no]', false);
    const prev = document.querySelector('[data-prev]'); if (prev) prev.onclick = () => { V.i = Math.max(0, V.i - 1); V.flip = false; render(); };
    const again = document.querySelector('[data-again]'); if (again) again.onclick = () => { const miss = V.fids.filter(id => P.it[id] && !P.it[id].ok); go({ ...V, fids: shuffle(miss.length ? miss : V.fids), i: 0, flip: false, known: 0 }); };
    const done = document.querySelector('[data-done]'); if (done) done.onclick = () => go(V.ret);
    const key = e => { if (V.v !== 'flash') return; if (e.key === ' ') { e.preventDefault(); V.flip = !V.flip; render(); } else if (e.key === 'ArrowRight' && V.flip) document.querySelector('[data-yes]')?.click(); else if (e.key === 'ArrowLeft' && V.flip) document.querySelector('[data-no]')?.click(); };
    document.addEventListener('keydown', key); cleanup.push(() => document.removeEventListener('keydown', key));
  });
  const head = `${back('Thoát', V.ret)}<div class="qhead"><div><div class="eyebrow">Flashcard</div><div class="small muted">${esc(V.title)}</div></div></div><div class="prog"><span>${Math.min(V.i + 1, n)}/${n}</span><div class="bar"><i style="width:${100 * V.i / n}%"></i></div><span>đã thuộc ${V.known}</span></div><div style="height:12px"></div>`;
  if (V.i >= n) { const miss = V.fids.filter(id => P.it[id] && !P.it[id].ok).length; return head + `<div class="qcard result"><div class="big">${V.known}/${n}</div><div class="muted">thẻ đã thuộc trong lượt này</div><div class="row" style="justify-content:center;margin-top:10px"><button class="btn pri" type="button" data-again>${miss ? `Ôn lại ${miss} thẻ chưa thuộc` : 'Học lại từ đầu'}</button><button class="btn ghost" type="button" data-done>Xong</button></div></div>`; }
  const f = FB[V.fids[V.i]]; const st = P.it[V.fids[V.i]];
  return head + `<div class="qcard flash" id="fcard" role="button" tabindex="0" aria-label="Lật thẻ">${V.flip ? f.back : f.front}<div class="small muted">${V.flip ? '' : 'Chạm hoặc nhấn <span class="kbd">Space</span> để lật thẻ'}${st ? ` · lần trước: ${st.ok ? 'đã thuộc' : 'chưa thuộc'}` : ''}</div></div>
  <div class="row" style="justify-content:space-between;margin-top:12px"><button class="btn ghost" type="button" data-prev ${V.i ? '' : 'disabled'}>← Thẻ trước</button>${V.flip ? `<div class="row"><button class="btn" type="button" data-no>Chưa thuộc</button><button class="btn pri" type="button" data-yes>Đã thuộc</button></div>` : ''}</div>`;
}

/* ---------- writing ---------- */
const DKEY = 'aptis-draft:';
const draftGet = k => { try { return localStorage.getItem(DKEY + k) || ''; } catch (e) { return ''; } };
const draftSet = (k, v) => { try { localStorage.setItem(DKEY + k, v); } catch (e) { } };
function counter(id, min, max) {
  after.push(() => { const ta = document.getElementById(id), out = document.getElementById(id + '-wc'); if (!ta || !out) return;
    const up = () => { const n = wc(ta.value); out.textContent = n + ' từ' + (max ? ` · mục tiêu ${min}–${max}` : ''); out.className = 'wc ' + (!n ? '' : max && n > max ? 'over' : n >= min ? 'ok' : ''); draftSet(id, ta.value); };
    ta.addEventListener('input', up); up(); });
  return `<div class="wc" id="${id}-wc"></div>`;
}
function sampleBlock(a, v, voc, label = 'Bài mẫu') { return `<details class="reveal"><summary>${label} (${wc(a)} từ)</summary><div><div class="sample">${esc(a)}</div>${v ? `<div class="vi">${esc(v)}</div>` : ''}${voc && voc.length ? `<div class="voc" style="margin-top:8px">${(Array.isArray(voc) ? voc : [voc]).map(x => `<span>${esc(x)}</span>`).join('')}</div>` : ''}</div></details>`; }
function vWrite() {
  const [sk, p] = findPart(V.part); const tp = V.topic, d = tp.d; const id = 'w-' + hash(tp.key);
  const doneOn = !!P.done[tp.key];
  bind('[data-revealall]', () => document.querySelectorAll('details.reveal').forEach(x => x.open = true));
  bind('[data-mark]', () => { markDone(tp.key, !doneOn); render(); toast(doneOn ? 'Đã bỏ đánh dấu' : 'Đã đánh dấu đã luyện'); });
  bind('[data-next]', () => { const i = p.topics.indexOf(tp); const nt = p.topics[(i + 1) % p.topics.length]; go({ ...V, topic: nt }); });
  let timerHtml = '';
  if (V.mockW) timerHtml = `<span class="timer" id="wtimer">--:--</span>`;
  const head = `${back('Thoát', V.ret)}<div class="qhead"><div><div class="eyebrow" style="color:var(--w)">Writing · ${esc(p.n)}</div><h1 style="font-size:26px">${esc(tp.t)}</h1></div>${timerHtml}</div>`;
  const foot = `<div class="row" style="justify-content:space-between;margin-top:14px"><button class="btn" type="button" data-revealall>Mở tất cả bài mẫu</button><div class="row"><button class="btn ${doneOn ? '' : 'pri'}" type="button" data-mark>${doneOn ? '✓ Đã luyện' : 'Đánh dấu đã luyện'}</button><button class="btn ghost" type="button" data-next>Topic tiếp →</button></div></div>`;
  return head + writeBody(p, d, id) + foot;
}
function writeBody(p, d, id) {
  if (p.id === 'w1') return `<div class="qcard"><p class="small muted" style="margin:0">${esc(d.instr)}</p>${d.qa.map((x, i) => `<div><label for="${id}-${i}" style="font-weight:600">${i + 1}. ${esc(x.q)}</label><input type="text" id="${id}-${i}" value="${esc(draftGet(id + '-' + i))}" autocomplete="off">${counter(id + '-' + i, 1, 5)}${sampleBlock(x.a, x.v, '', 'Câu mẫu')}</div>`).join('')}</div>`;
  if (p.id === 'w2') return `<div class="qcard"><p class="small muted" style="margin:0">${esc(d.instr)}</p><div class="prompt">${esc(d.q)}</div><div class="vi">${esc(d.vq)}</div><textarea id="${id}" aria-label="Bài viết">${esc(draftGet(id))}</textarea>${counter(id, 20, 30)}${sampleBlock(d.a, d.va, d.voc)}</div>`;
  if (p.id === 'w3') return `<div class="qcard"><p class="small muted" style="margin:0">${esc(d.instr)}</p>${d.qa.map((x, i) => `<div style="display:grid;gap:8px"><div class="prompt" style="font-size:16px">${i + 1}. ${esc(x.q)}</div><div class="vi">${esc(x.vq)}</div><textarea id="${id}-${i}" aria-label="Trả lời câu ${i + 1}">${esc(draftGet(id + '-' + i))}</textarea>${counter(id + '-' + i, 30, 40)}${sampleBlock(x.a, x.va, x.voc)}</div>`).join('<hr style="border:0;border-top:1px solid var(--line);width:100%">')}</div>`;
  if (p.id === 'w4') return `<div class="qcard"><div class="sample" style="white-space:pre-line">${esc(d.sc)}</div><details><summary>Tóm tắt đề & dạng đề</summary><div><p>${esc(d.summary_vi)}</p><p><b>Dạng đề:</b> ${esc(d.type)}</p></div></details>
    <div style="display:grid;gap:8px"><div class="eyebrow" style="color:var(--good)">Email 1 · gửi bạn · khoảng 50 từ</div><div class="small">${esc(d.t1)}</div><textarea id="${id}-1" style="min-height:150px" aria-label="Email 1">${esc(draftGet(id + '-1'))}</textarea>${counter(id + '-1', 40, 80)}</div>
    <div style="display:grid;gap:8px"><div class="eyebrow" style="color:var(--bad)">Email 2 · gửi quản lý · 120–150 từ</div><div class="small">${esc(d.t2)}</div><textarea id="${id}-2" style="min-height:260px" aria-label="Email 2">${esc(draftGet(id + '-2'))}</textarea>${counter(id + '-2', 120, 160)}</div>
    <details class="reveal"><summary>Ý chính dùng cho cả 2 email</summary><div><p>${esc(d.ideas_vi)}</p></div></details>${sampleBlock(d.s1, d.vi1, '', 'Email mẫu gửi bạn')}${sampleBlock(d.s2, d.vi2, d.vocab, 'Email mẫu gửi quản lý')}</div>`;
  return '';
}
function vFrame(p, s) {
  p = p || findPart(V.part)[1]; s = s || SK.writing; const F = p.frame;
  return `${back(s.name, { v: 'skill', skill: 'writing' })}<div class="section-h"><div><div class="eyebrow" style="color:var(--w)">Writing · ${esc(p.n)}</div><h1>${esc(p.name)}</h1></div></div>
  <div class="tabs" role="group">${p.modes.map(m => `<button type="button" data-mode="${m}" aria-pressed="${m === 'frame'}">${MODE_N[m]}</button>`).join('')}</div>
  <h2 style="font-size:20px;margin-bottom:10px">${esc(F.title)}</h2><div class="grid">${F.blocks.map(([h, lines]) => `<div class="card"><div class="eyebrow" style="color:var(--w);margin-bottom:8px">${esc(h)}</div>${lines.map(l => `<div style="padding:5px 0;border-bottom:1px solid var(--line);font-size:14.5px">${esc(l)}</div>`).join('')}</div>`).join('')}</div>`;
}
function vTypes(p, s) {
  p = p || findPart(V.part)[1]; s = s || SK.writing; const T = A.writing.types;
  bind('[data-club]', el => { const tp = p.topics.find(t => t.t === el.dataset.club); go({ v: 'write', part: 'w4', topic: tp, ret: { ...V } }); });
  return `${back(s.name, { v: 'skill', skill: 'writing' })}<div class="section-h"><div><div class="eyebrow" style="color:var(--w)">Writing · ${esc(p.n)}</div><h1>Các topic theo dạng đề</h1></div></div>
  <div class="tabs" role="group">${p.modes.map(m => `<button type="button" data-mode="${m}" aria-pressed="${m === 'types'}">${MODE_N[m]}</button>`).join('')}</div>
  ${T.map(([t, opener], i) => { const list = p.topics.filter(x => x.d.type === t); if (!list.length) return ''; return `<div class="card" style="margin-bottom:14px"><div class="row" style="justify-content:space-between"><h2 style="font-size:19px">${i + 1}. ${esc(t)}</h2><span class="chip">${list.length} club</span></div><p class="small" style="margin:.4em 0 .8em"><b>Đoạn 2:</b> <i>${esc(opener)}</i></p><div class="tbl"><table><thead><tr><th>Club</th><th>Ý chính</th></tr></thead><tbody>${list.map(x => `<tr><td><button class="btn ghost" style="padding:2px 6px" type="button" data-club="${esc(x.t)}">${esc(x.t)}</button></td><td class="small">${esc(x.d.ideas_vi.replace(/\s*\([^)]*\)/g, ''))}</td></tr>`).join('')}</tbody></table></div></div>`; }).join('')}`;
}

/* ---------- speaking ---------- */
function speakSteps(p, tp) {
  const d = tp.d;
  if (p.p === 4) return [{ part: p, tp, qs: d.qa.map((x, i) => i), prep: 60, sec: 120 }];
  return d.qa.map((x, i) => ({ part: p, tp, qs: [i], prep: 0, sec: p.sec }));
}
function vSpeak() {
  V.si = V.si || 0; const steps = V.steps;
  const st = steps[Math.min(V.si, steps.length - 1)]; const p = st.part, d = st.tp.d;
  const allDone = V.si >= steps.length;
  bind('[data-sstart]', () => runSpeak());
  bind('[data-sskip]', () => { stopSpeak(); V.si++; V.phase = null; render(); });
  bind('[data-sreset]', () => { stopSpeak(); go({ ...V, si: 0, phase: null }); });
  bind('[data-mark]', () => { if (V.doneKey) { markDone(V.doneKey, !P.done[V.doneKey]); render(); } else { steps.forEach(s => markDone(s.tp.key)); toast('Đã lưu buổi luyện nói'); } });
  bind('[data-next]', () => { const ps = p.topics; const i = ps.indexOf(st.tp); const nt = ps[(i + 1) % ps.length]; go({ v: 'speak', steps: speakSteps(p, nt), title: p.n + ' · ' + nt.t, doneKey: nt.key, ret: V.ret }); });
  cleanup.push(stopSpeak);
  const head = `${back('Thoát', V.ret)}<div class="qhead"><div><div class="eyebrow" style="color:var(--s)">Speaking · ${esc(p.n)}${steps.length > 1 && V.mock ? ` · bước ${Math.min(V.si + 1, steps.length)}/${steps.length}` : ''}</div><h1 style="font-size:26px">${esc(st.tp.t)}</h1></div></div>`;
  if (allDone) {
    const tps = [...new Set(steps.map(s => s.tp))];
    return head + `<div class="qcard"><div class="result" style="padding:6px"><div class="eyebrow">Hoàn thành</div><p class="muted">Đọc lại bài mẫu và so với câu trả lời của bạn.</p></div>${tps.map(tp => `<h3 style="font-size:17px">${esc(tp.t)}</h3>${tp.d.qa.map((x, i) => `<div><div style="font-weight:600">${i + 1}. ${esc(x.q)}</div>${sampleBlock(x.a, x.va, x.voc)}</div>`).join('')}`).join('')}
      <div class="row" style="justify-content:space-between"><button class="btn" type="button" data-sreset>Luyện lại</button><div class="row">${V.doneKey ? `<button class="btn ${P.done[V.doneKey] ? '' : 'pri'}" type="button" data-mark>${P.done[V.doneKey] ? '✓ Đã luyện' : 'Đánh dấu đã luyện'}</button><button class="btn ghost" type="button" data-next>Topic tiếp →</button>` : `<button class="btn pri" type="button" data-mark>Lưu buổi luyện</button>`}</div></div></div>`;
  }
  if (window.APTIS_IMG_URL && !window.APTIS_IMG && !window.__imgLoading) { window.__imgLoading = true; const sc = document.createElement('script'); sc.src = window.APTIS_IMG_URL; sc.onload = () => { if (V.v === 'speak') render(); }; document.head.appendChild(sc); }
  const imgSrc = f => (window.APTIS_IMG && window.APTIS_IMG[f]) || (window.APTIS_IMG_URL ? '' : 'img/' + f);
  const imgs = d.img && d.img.length ? `<div class="imgs">${d.img.map((f, i) => `<img src="${esc(imgSrc(f))}" alt="${d.img.length > 1 ? 'Picture ' + (i + 1) : 'Tranh của đề'}" loading="lazy">`).join('')}</div>` : '';
  const qsHtml = st.qs.map(i => `<div class="prompt" style="font-size:17px">${st.qs.length > 1 ? (i + 1) + '. ' : 'Câu ' + (i + 1) + ': '}${esc(d.qa[i].q)}</div><div class="vi">${esc(d.qa[i].vq)}</div>`).join('');
  const ph = V.phase;
  const clock = `<div class="phase" id="sphase">${ph ? (ph.name === 'prep' ? 'Thời gian chuẩn bị' : 'Bắt đầu nói') : (st.prep ? `Chuẩn bị ${st.prep} giây, nói ${st.sec / 60} phút` : `Nói trong ${st.sec} giây`)}</div><div class="ring" id="sclock">${fmt(ph ? ph.left : (st.prep || st.sec))}</div>`;
  const samples = `<details><summary>Xem bài mẫu</summary><div>${st.qs.map(i => `<div style="margin-bottom:8px"><div class="small" style="font-weight:600">${i + 1}. ${esc(d.qa[i].q)}</div>${sampleBlock(d.qa[i].a, d.qa[i].va, d.qa[i].voc)}</div>`).join('')}</div></details>`;
  return head + `<div class="qcard">${imgs}${qsHtml}${clock}<div class="row" style="justify-content:center"><button class="btn pri" type="button" data-sstart ${ph ? 'disabled' : ''}>${ph ? 'Đang chạy…' : 'Bắt đầu'}</button><button class="btn" type="button" data-sskip>${V.si + 1 >= steps.length ? 'Kết thúc' : 'Câu tiếp →'}</button></div>${V.mock ? '' : samples}</div>
  <p class="small muted" style="margin-top:10px">Trình duyệt trong trang này không cho ghi âm. Bạn có thể dùng app ghi âm của điện thoại khi bấm Bắt đầu, rồi nghe lại và so với bài mẫu.</p>`;
}
let spT = null;
function stopSpeak() { if (spT) clearInterval(spT); spT = null; }
function beep() { try { const C = window.AudioContext || window.webkitAudioContext; const c = new C(); const o = c.createOscillator(), g = c.createGain(); o.frequency.value = 880; g.gain.value = .08; o.connect(g); g.connect(c.destination); o.start(); setTimeout(() => { o.stop(); c.close(); }, 220); } catch (e) { } }
function runSpeak() {
  const st = V.steps[V.si]; const phases = []; if (st.prep) phases.push({ name: 'prep', len: st.prep }); phases.push({ name: 'talk', len: st.sec });
  let k = 0; let end = Date.now() + phases[0].len * 1000; V.phase = { name: phases[0].name, left: phases[0].len }; render(); beep();
  spT = setInterval(() => {
    const left = (end - Date.now()) / 1000; V.phase.left = left;
    const c = document.getElementById('sclock'); if (c) c.textContent = fmt(left);
    if (left <= 0) { k++; if (k < phases.length) { end = Date.now() + phases[k].len * 1000; V.phase = { name: phases[k].name, left: phases[k].len }; beep(); render(); } else { stopSpeak(); beep(); V.phase = null; V.si++; if (V.mock && V.si < V.steps.length) { render(); setTimeout(() => { if (V.v === 'speak' && !V.phase) runSpeak(); }, 2500); } else render(); } }
  }, 250);
}

/* ---------- mock exams ---------- */
function vMock() {
  bind('[data-mock]', el => startMock(el.dataset.mock));
  const hist = [...P.mock].reverse().slice(0, 12);
  const C = { reading: ['Reading', '35 phút', 'Part 1 (5 câu) · Part 2+3 (2 bài xếp câu) · Part 4 (7 câu) · Part 5 (7 heading)'], listening: ['Listening', '40 phút', '13 câu Part 1 · 1 bài Part 2 · 4 ý kiến Part 3 · 2 bài Part 4 (không có audio, luyện nhớ đáp án)'], writing: ['Writing', '50 phút', '1 club ngẫu nhiên, đủ 4 part, đồng hồ đếm ngược; xong thì mở bài mẫu để so'], speaking: ['Speaking', '12 phút', '1 đề ngẫu nhiên mỗi part, đồng hồ tự chạy liên tục như thi thật'] };
  return `<div class="section-h"><div><div class="eyebrow">Thi thử</div><h1>Ghép đề ngẫu nhiên, bấm giờ như thi thật</h1></div></div>
  <div class="grid">${ORDER.map(k => `<div class="card skillcard" style="--c:${SK[k].c}"><div class="row" style="justify-content:space-between"><h2>${C[k][0]}</h2><span class="timer">${C[k][1]}</span></div><p class="small muted" style="margin:0">${C[k][2]}</p><div><button class="btn pri" type="button" data-mock="${k}">Bắt đầu</button></div></div>`).join('')}</div>
  <h2 style="font-size:20px;margin:24px 0 10px">Lịch sử thi thử</h2>${hist.length ? `<div class="tbl card" style="padding:4px 8px"><table><thead><tr><th>Ngày</th><th>Kỹ năng</th><th>Điểm</th><th>Thời gian</th></tr></thead><tbody>${hist.map(h => `<tr><td>${new Date(h.ts).toLocaleDateString('vi-VN')}</td><td>${esc(SK[h.skill] ? SK[h.skill].name : h.skill)}</td><td style="font-variant-numeric:tabular-nums">${h.total ? `${h.score}/${h.total} (${Math.round(100 * h.score / h.total)}%)` : 'Đã hoàn thành'}</td><td style="font-variant-numeric:tabular-nums">${fmt(h.sec || 0)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Chưa có lượt thi thử nào. Chọn một kỹ năng ở trên để bắt đầu.</p>'}`;
}
function startMock(k) {
  const pr = id => SK[k].parts.find(p => p.id === id); const rt = a => a[Math.random() * a.length | 0];
  if (k === 'reading') { const ids = [...pick(rt(pr('r1').topics).qids, 5), ...pick(pr('r23').topics, 2).flatMap(t => t.qids), ...rt(pr('r4').topics).qids, ...rt(pr('r5').topics).qids]; return startQuiz({ title: 'Thi thử Reading', ids, mock: 'reading', limit: 35 * 60, ret: { v: 'mock' } }); }
  if (k === 'listening') { const ids = [...pick(pr('l1').topics.flatMap(t => t.qids), 13), ...rt(pr('l2').topics).qids, ...pick(rt(pr('l3').topics).qids, 4), ...pick(pr('l4').topics, 2).flatMap(t => t.qids)]; return startQuiz({ title: 'Thi thử Listening', ids, mock: 'listening', limit: 40 * 60, ret: { v: 'mock' } }); }
  if (k === 'writing') { const club = rt(SK.writing.parts[0].topics).t; return go({ v: 'write', mockW: club, part: 'w1', topic: SK.writing.parts[0].topics.find(t => t.t === club), ret: { v: 'mock' }, wstart: Date.now() }); }
  if (k === 'speaking') { const steps = SK.speaking.parts.flatMap(p => speakSteps(p, rt(p.topics))); return go({ v: 'speak', steps, title: 'Thi thử Speaking', mock: true, ret: { v: 'mock' }, start: Date.now() }); }
}
// writing mock: show all 4 parts of one club on one page
const _vWrite = vWrite;
vWrite = function () {
  if (!V.mockW) return _vWrite();
  const club = V.mockW; const parts = SK.writing.parts; const limit = 50 * 60;
  const tick = () => { const left = limit - (Date.now() - V.wstart) / 1000; const el = document.querySelector('#wtimer'); if (el) { el.textContent = fmt(left); el.classList.toggle('warn', left < 300); } if (left <= 0 && !V.reveal) { V.reveal = true; finishW(); } };
  const t = setInterval(tick, 1000); cleanup.push(() => clearInterval(t)); after.push(tick);
  const finishW = () => { if (!V.saved) { V.saved = true; P.mock.push({ ts: Date.now(), skill: 'writing', score: 0, total: 0, sec: Math.round((Date.now() - V.wstart) / 1000) }); parts.forEach(p => { const tp = p.topics.find(x => x.t === club); if (tp) P.done[tp.key] = Date.now(); }); persist(); } document.querySelectorAll('details.reveal').forEach(x => x.open = true); toast('Đã mở toàn bộ bài mẫu'); };
  bind('[data-finish]', () => { V.reveal = true; finishW(); });
  return `${back('Thoát', V.ret)}<div class="qhead"><div><div class="eyebrow" style="color:var(--w)">Thi thử Writing</div><h1 style="font-size:26px">${esc(club)}</h1></div><span class="timer" id="wtimer">--:--</span></div>
  <p class="note">Bài mẫu nằm trong các mục đóng bên dưới mỗi câu, chỉ mở sau khi bạn bấm Nộp bài.</p>
  ${parts.map(p => { const tp = p.topics.find(x => x.t === club); return tp ? `<h2 style="font-size:19px;margin:18px 0 8px">${esc(p.n)} · ${esc(p.name)}</h2>${writeBody(p, tp.d, 'wm-' + hash(tp.key))}` : ''; }).join('')}
  <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn pri" type="button" data-finish>Nộp bài và xem bài mẫu</button></div>`;
};

/* ---------- review ---------- */
function vReview() {
  const ids = wrongIds();
  const by = {}; ids.forEach(id => { const k = id.split(':')[0]; (by[k] = by[k] || []).push(id); });
  const name = { r1: 'Reading Part 1', r23: 'Reading Part 2+3', r4: 'Reading Part 4', r5: 'Reading Part 5', l1: 'Listening Part 1', l2: 'Listening Part 2', l3: 'Listening Part 3', l4: 'Listening Part 4' };
  bind('[data-rall]', () => startQuiz({ title: 'Ôn câu sai', ids: shuffle(ids), ret: { v: 'review' } }));
  bind('[data-rk]', el => startQuiz({ title: 'Ôn câu sai · ' + name[el.dataset.rk], ids: shuffle(by[el.dataset.rk]), ret: { v: 'review' } }));
  return `<div class="section-h"><div><div class="eyebrow">Ôn câu sai</div><h1>${ids.length ? ids.length + ' câu đang chờ ôn lại' : 'Không còn câu sai nào'}</h1></div>${ids.length ? '<button class="btn pri" type="button" data-rall>Làm lại tất cả</button>' : ''}</div>
  <p class="muted">Câu nào trả lời sai ở lần gần nhất sẽ nằm ở đây. Làm đúng lại thì câu đó tự rời khỏi danh sách.</p>
  <div class="topics">${Object.keys(name).filter(k => by[k]).map(k => `<button class="topic" type="button" data-rk="${k}"><span class="dot bad"></span><span class="t">${name[k]}<small>${by[k].length} câu</small></span></button>`).join('')}</div>`;
}

/* ---------- boot ---------- */
const H = (location.hash || '').slice(1);
if (ORDER.includes(H)) V = { v: 'skill', skill: H }; else if (H === 'mock' || H === 'review') V = { v: H };
loadLocal(); render(); initSync();
window.claude?.hot?.snapshot?.(() => ({}));
})();
