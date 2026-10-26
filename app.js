'use strict';
/* 나만의 TEF 트레이너 — vanilla JS, no build step. Progress lives in localStorage only. */
const LS_KEY = 'tef-trainer-v1';
const WORD_STATES = ['아직 낯설어요', '헷갈려요', '이제 익숙해요'];

const CE_PRACTICE = ['CE-A 연습 1','CE-A 연습 2','CE-B 연습 1','CE-B 연습 2','CE-B 연습 3','CE-C 연습','CE-D 연습 (2024)','CE-E 연습','CE-F 연습'];
const CE_MOCK = ['CE-B 모의고사 (1)(2)','CE-B 모의고사 (3)(4)','CE-C 모의고사','CE 모의고사 A'];
const CO_A1 = ['CO-A 세트 1'];
const CO_PRACTICE = ['CO-B 세트 1','CO-B 세트 2','CO-C 세트 1','CO-C 세트 2','CO-C 세트 3','CO-D 세트 1','CO-D 세트 2','CO-D 세트 3','CO-D Sujet 10','CO-F Pre 1','CO-F Pre 2'];
const CO_MOCK = ['모의고사 CO 2-A','모의고사 CO-B 세트 1','모의고사 CO-B 세트 2','모의고사 CO-B 세트 3','모의고사 CO-B 세트 4','모의고사 CO-B 세트 5','모의고사 CO-C 세트 1','모의고사 CO-C 세트 3','모의고사 CO-C 세트 4','모의고사 CO-C 세트 5'];
const CO_A2 = ['CO-A 세트 2 (미채점 연습)'];
const COB_SETS = ['모의고사 CO-B 세트 1','모의고사 CO-B 세트 2','모의고사 CO-B 세트 3','모의고사 CO-B 세트 4','모의고사 CO-B 세트 5'];
const COC_SETS = ['모의고사 CO-C 세트 1','모의고사 CO-C 세트 3','모의고사 CO-C 세트 4','모의고사 CO-C 세트 5'];

let DATA = null;
let state = loadState();
let route = { tab: 'home', view: 'home', param: null };
let navStack = [];
let sharedAudio = null;
let blobCache = new Map();
let attemptPlays = {}; // per-item plays in the current attempt (before answering)
let ui = { sentOpen: {}, optKoOpen: {}, dcOpen: {}, repeat: {}, transOpen: false, shadowMode: {}, dictInput: {}, dictResult: {}, sentInput: {}, sentResult: {}, drillSel: {}, eoIntroSel: {}, posterReveal: {}, flashFace: {}, idiomOpen: {}, sujetFilter: '전체', wordSub: 'core', coVocabSection: 0, calCursor: null, calSel: null };

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) { const s = JSON.parse(raw); if (s && typeof s === 'object') return Object.assign(defaultState(), s); }
  } catch (e) {}
  return defaultState();
}
function defaultState() {
  return { answers: {}, plays: {}, wordStates: {}, myWords: [], activity: {}, drill: {}, posterDone: {}, eoCheck: {}, last: null, lastItem: null, pin: null };
}
function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {} }
function todayKey(d) { d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function logActivity(kind) {
  const k = todayKey();
  if (!state.activity[k]) state.activity[k] = { items: 0, words: 0 };
  state.activity[k][kind] = (state.activity[k][kind] || 0) + 1;
  save();
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function normWs(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
function $(sel) { return document.querySelector(sel); }
function appEl() { return document.getElementById('app'); }

/* ---------- pronunciation ---------- */
function speak(text) {
  if (!text) return;
  const map = DATA.tts || {};
  let file = map[text] || map[normWs(text)];
  if (!file) { // normalized lookup over the whole map
    for (const k of Object.keys(map)) { if (normWs(k) === normWs(text)) { file = map[k]; break; } }
  }
  if (file) {
    try { speechSynthesis.cancel(); } catch (e) {}
    if (!sharedAudio) { sharedAudio = new Audio(); sharedAudio.preload = 'auto'; }
    try { sharedAudio.pause(); } catch (e) {}
    sharedAudio.src = 'assets/tts/' + file;
    const p = sharedAudio.play();
    if (p && p.catch) p.catch((err) => { if (err && err.name !== 'AbortError') fallbackVoice(text); });
  } else {
    if (sharedAudio) { try { sharedAudio.pause(); } catch (e) {} }
    fallbackVoice(text);
  }
}
/* Android Chrome drops or delays an utterance that is spoken in the same tick
   right after cancel() — the previous text then plays one tap late. When the
   synth is busy, cancel first and speak after a short flush delay; when idle,
   speak immediately without cancelling. */
function fallbackVoice(text) {
  try {
    text = String(text).replace(/_+/g, '…'); // blanks are read as a pause, never spelled out
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'fr-FR'; u.rate = 0.92;
    if (speechSynthesis.speaking || speechSynthesis.pending) {
      speechSynthesis.cancel();
      setTimeout(() => { try { speechSynthesis.speak(u); } catch (e) {} }, 90);
    } else speechSynthesis.speak(u);
  } catch (e) {}
}
function stopSpeak() {
  if (sharedAudio) { try { sharedAudio.pause(); } catch (e) {} }
  try { speechSynthesis.cancel(); } catch (e) {}
}
function speakBtn(text, label) {
  return '<button class="speak" data-speak="' + esc(text) + '" aria-label="발음 듣기" title="발음 듣기">🔊</button>' + (label ? '<span class="fr16">' + esc(label) + '</span>' : '');
}

/* ---------- word diff (LCS alignment; order matters) ---------- */
function tokenize(s) { return normWs(s).split(' ').filter(Boolean); }
/* Dictation normalization: punctuation is stripped from BOTH sides before
   comparing, whitespace is collapsed, case is ignored — but letters and
   accents (à, é, è…) are compared exactly as written. */
function normWord(w) { return w.toLowerCase().replace(/[.,;:!?…·«»"'’‘“”\-—()]/g, ''); }
function normTokens(s) {
  // tokens that are pure punctuation (e.g. French-style " !" or "«") vanish
  return tokenize(s)
    .map((w) => ({ orig: w, norm: normWord(w) }))
    .filter((p) => p.norm.length > 0);
}
function wordDiff(target, attempt) {
  const Tp = normTokens(target), Ap = normTokens(attempt);
  const T = Tp.map((p) => p.orig), A = Ap.map((p) => p.orig);
  const t = Tp.map((p) => p.norm), a = Ap.map((p) => p.norm);
  const n = t.length, m = a.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = t[i] === a[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0, firstBad = [];
  while (i < n && j < m) {
    if (t[i] === a[j]) { out.push({ type: 'ok', w: T[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'miss', w: T[i] }); if (firstBad.length < 4) firstBad.push(T[i]); i++; }
    else { out.push({ type: 'extra', w: A[j] }); j++; }
  }
  while (i < n) { out.push({ type: 'miss', w: T[i] }); if (firstBad.length < 4) firstBad.push(T[i]); i++; }
  while (j < m) { out.push({ type: 'extra', w: A[j] }); j++; }
  const correct = out.filter((o) => o.type === 'ok').length;
  return { out, score: n ? correct / n : 0, firstBad };
}
function renderDiff(d) {
  return d.out.map((o) => {
    if (o.type === 'ok') return esc(o.w);
    if (o.type === 'miss') return '<span class="diff-miss">' + esc(o.w) + '</span>';
    return '<span class="diff-extra">' + esc(o.w) + '</span>';
  }).join(' ');
}

/* ---------- data helpers ---------- */
function ceBySet(set) { return DATA.ce.items.filter((i) => i.set === set); }
function coBySet(set) { return DATA.co.items.filter((i) => i.set === set); }
function findItem(id) {
  return DATA.ce.items.find((i) => i.id === id) || DATA.co.items.find((i) => i.id === id) || null;
}
function isDone(id) { const a = state.answers[id]; return !!(a && (a.correct === true || a.correct === false)); }
function isAnswered(id) { return !!state.answers[id]; }
function setProgress(items) {
  const done = items.filter((i) => isDone(i.id)).length;
  return { done, total: items.length };
}
function globalOrder() {
  const seq = [];
  const push = (items, mod, set) => items.forEach((it) => seq.push({ it, mod, set }));
  CE_PRACTICE.forEach((s) => push(ceBySet(s), '읽기', s));
  CO_A1.forEach((s) => push(coBySet(s), '듣기', s));
  CO_PRACTICE.forEach((s) => push(coBySet(s), '듣기', s));
  CE_MOCK.forEach((s) => push(ceBySet(s), '읽기', s));
  CO_MOCK.forEach((s) => push(coBySet(s), '듣기', s));
  CO_A2.forEach((s) => push(coBySet(s), '듣기', s));
  return seq;
}
function firstUnfinishedInSet(mod, set) {
  const items = mod === '읽기' ? ceBySet(set) : coBySet(set);
  return items.find((i) => !isDone(i.id)) || items[0] || null;
}

/* ---------- navigation ---------- */
function pushHist() { try { history.pushState({ tef: 1 }, ''); } catch (e) {} }
function go(tab, view, param, pushStack) {
  if (pushStack !== false) { navStack.push({ tab: route.tab, view: route.view, param: route.param }); pushHist(); }
  route = { tab, view, param: param || null };
  state.last = { tab, view, param: route.param }; save();
  render();
  window.scrollTo(0, 0);
}
function back() {
  const prev = navStack.pop();
  if (prev) { route = prev; render(); window.scrollTo(0, 0); }
  else go(route.tab, route.tab === 'home' ? 'home' : route.tab + 'Home', null, false);
}
/* 폰의 뒤로가기 버튼/제스처: 앱 안에서 한 단계씩 돌아가고, 첫 화면에서만 앱을 나가게 한다 */
window.addEventListener('popstate', () => {
  if (navStack.length) back();
  else history.back();
});
function setTab(tab) {
  navStack = [];
  const views = { home: 'home', ce: 'ceList', co: 'coHome', expr: 'exprHome', words: 'wordsHome' };
  go(tab, views[tab], null, false);
}

/* ---------- shared fragments ---------- */
function speakableLine(fr, cls) {
  return '<div class="row" style="align-items:flex-start"><span class="' + (cls || 'fr') + '" style="flex:1">' + esc(fr) + '</span>' + speakBtn(fr) + '</div>';
}
function wordRows(words, keyPrefix) {
  if (!words || !words.length) return '';
  return words.map((w, idx) => {
    const fr = w[0], kr = w[1];
    const inMine = state.myWords.some((m) => m.fr === fr);
    return '<div class="wordrow"><span class="frw">' + esc(fr) + '</span>' + speakBtn(fr) +
      '<span class="muted krw">' + esc(kr) + '</span>' +
      (inMine ? '<span class="chip-added">추가됨 ✓</span>' : '<button class="chip-add" data-addword="' + esc(fr) + '" data-addwordkr="' + esc(kr) + '">+ 추가</button>') + '</div>';
  }).join('');
}
function optionsHtml(item, answered) {
  const ko = (DATA.optionKo || {})[item.id];
  const rows = item.options.map((opt, idx) => {
    const a = state.answers[item.id];
    let cls = 'opt';
    if (a && a.choice === idx) cls += ' sel';
    if (answered && item.scored !== false && item.answer != null) {
      if (idx === item.answer) cls += ' correct';
      else if (a && a.choice === idx) cls += ' wrong';
    }
    const isDessin = /Dessin/i.test(opt);
    const key = item.id + ':' + idx;
    const showKo = ui.optKoOpen[key] && ko && ko[idx];
    let side = '';
    if (!isDessin) {
      side = '<div class="opt-side">' + speakBtn(opt) +
        (ko && ko[idx] ? '<button class="trans-toggle' + (ui.optKoOpen[key] ? ' open' : '') + '" data-optko="' + esc(key) + '">해석 ' + (ui.optKoOpen[key] ? '숨기기' : '보기') + '</button>' : '') +
        '</div>';
    }
    return '<div><div class="opt-row"><div class="' + cls + '" role="button" tabindex="0" data-answer="' + item.id + '" data-choice="' + idx + '">' +
      '<span class="letter">' + String.fromCharCode(65 + idx) + '.</span>' +
      '<span class="txt fr">' + esc(opt) + '</span></div>' + side + '</div>' +
      (showKo ? '<div class="opt-trans"><b>해석 · </b>' + esc(ko[idx]) + '</div>' : '') +
      '</div>';
  }).join('');
  return '<div class="opt-wrap">' + rows + '</div>';
}
function sentencesHtml(item, pairs, kind) {
  const rows = pairs.map((p, idx) => {
    const fr = kind === 'stt' ? p.fr : p[0];
    const ko = kind === 'stt' ? p.ko : p[1];
    const key = item.id + ':' + kind + ':' + idx;
    const open = !!ui.sentOpen[key];
    const sentCls = kind === 'ce' ? 'sent-doc' : 'sent-script';
    const sentChunks = ((DATA.chunks || {})[item.id] || [])[idx];
    const dcKey = item.id + ':dc:' + idx;
    const dcOpen = !!ui.dcOpen[dcKey];
    let koHtml = '';
    if (open) {
      koHtml = '<p class="sent-ko"' + (sentChunks ? ' data-dchunk="' + esc(dcKey) + '" role="button"' : '') + '><b>해석 · </b>' + esc(ko) +
        (sentChunks ? ' <span class="dc-hint">' + (dcOpen ? '직독직해 숨기기 ▴' : '눌러서 직독직해 ▾') + '</span>' : '') + '</p>' +
        (sentChunks && dcOpen ? '<div class="chunk-wrap dc-wrap"><p class="chunk-sent">' + sentChunks.map((pair) => '<span class="chunk-unit"><span class="chunk-fr">' + esc(pair[0]) + '</span><span class="chunk-ko">' + esc(pair[1]) + '</span>' + (pair[2] ? '<span class="chunk-why">왜 · ' + esc(pair[2]) + '</span>' : '') + '</span>').join('') + '</p></div>' : '');
    }
    return '<div><div class="sent-row"><div class="sent-btn' + (open ? ' open' : '') + '" role="button" tabindex="0" data-sent="' + esc(key) + '">' +
      '<span class="fr ' + sentCls + '">' + esc(fr) + '</span></div>' + speakBtn(fr) + '</div>' + koHtml + '</div>';
  }).join('');
  return '<div class="sent-list">' + rows + '</div>';
}
function answerItem(item, choice) {
  state.lastItem = { id: item.id, set: item.set, mod: DATA.ce.items.indexOf(item) >= 0 ? '읽기' : '듣기', ts: Date.now() };
  if (item.scored === false || item.answer == null) {
    state.answers[item.id] = { choice, correct: null, ts: Date.now() };
    save(); return;
  }
  const correct = choice === item.answer;
  const wasDone = isDone(item.id);
  state.answers[item.id] = { choice, correct, ts: Date.now() };
  if (!wasDone) logActivity('items');
  save();
}
function addMyWord(fr, kr) {
  if (!state.myWords.some((m) => m.fr === fr)) { state.myWords.push({ fr, kr: kr || '' }); logActivity('words'); }
  save();
}

/* ================= views: 오늘 ================= */
function viewHome() {
  const seq = globalOrder();
  const next = seq.find((e) => !isDone(e.it.id));
  const doneCount = seq.filter((e) => isDone(e.it.id)).length;
  const now = new Date();
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  let h = '<div class="stack">';
  if (state.pin && (state.pin.mod === '읽기' || state.pin.mod === '듣기')) {
    const pinItems = state.pin.mod === '읽기' ? ceBySet(state.pin.set) : coBySet(state.pin.set);
    if (pinItems.length) {
      const p = setProgress(pinItems);
      const complete = p.total > 0 && p.done >= p.total;
      h += '<section class="pin-card" aria-label="오늘 할 공부">' +
        '<p class="kicker" style="font-weight:600">오늘 할 공부</p>' +
        '<h2>' + esc(state.pin.mod) + ' · ' + esc(state.pin.set) + '</h2>' +
        '<p class="desc">' + p.done + '/' + p.total + ' 문항 완료' + (complete ? ' — 다 풀었어요.' : '') + '</p>' +
        '<div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap"><button class="cta" data-goset="' + esc(state.pin.mod) + '|' + esc(state.pin.set) + '">' + (complete ? '세트 다시 보기' : '이어서 풀기') + '</button>' +
        '<button class="btn ghost" data-unpin="1">고정 해제</button></div></section>';
    }
  }
  let hero = '<section class="hero">' +
    '<p class="kicker">' + (now.getMonth() + 1) + '월 ' + now.getDate() + '일 (' + dayNames[now.getDay()] + '요일)</p>' +
    '<p class="kicker" style="margin-top:20px;font-weight:600;letter-spacing:.02em;">이어서 공부하기</p>';
  if (next) {
    hero += '<h2>' + esc(next.mod) + ' · ' + esc(next.set) + '</h2>';
    if (next.it.stem) hero += '<p class="fr preview" lang="fr">' + esc(next.it.stem) + ' …</p>';
    hero += '<p class="desc">' + esc(next.it.id) + '부터 이어서 풀어요. 전체 ' + seq.length + '문항 중 ' + doneCount + '문항을 마쳤어요.</p>';
    const pct = seq.length ? Math.round((doneCount / seq.length) * 100) : 0;
    hero += '<div class="bar"><div style="width:' + pct + '%"></div></div>' +
      '<p class="bar-label">' + doneCount + ' / ' + seq.length + ' 문항</p>' +
      '<button class="cta" data-openitem="' + esc(next.it.id) + '" data-mod="' + esc(next.mod) + '">이어서 공부하기</button>';
  } else {
    hero += '<h2>오늘 이어서</h2><p class="desc">모든 문항을 마쳤어요. 복습으로 다시 풀어 보세요.</p>';
  }
  hero += '</section>';
  h += hero;
  h += '<section aria-label="모의고사 CO-B 바로 가기"><h3 class="sec-label">지금 공부할 것</h3>' +
    '<p class="small dim" style="line-height:1.65;margin-bottom:12px">모의고사 CO-B 세트 1~5예요. 세트를 누르면 그 세트의 아직 안 푼 첫 문항으로 바로 가요.</p><div class="stack-sm">';
  COB_SETS.forEach((s) => {
    const p = setProgress(coBySet(s));
    const complete = p.total > 0 && p.done >= p.total;
    h += '<button class="listrow" data-goset="듣기|' + esc(s) + '">' +
      '<span class="dot' + (complete ? ' done' : '') + '">' + (complete ? '✓' : '·') + '</span>' +
      '<span class="main"><span class="t" style="font-weight:600">' + esc(s) + '</span>' +
      '<span class="s">' + p.done + '/' + p.total + ' 완료 · 채점</span></span>' +
      '<span class="chev" aria-hidden="true">›</span></button>';
  });
  h += '</div></section>';
  h += '<section aria-label="모의고사 CO-C 바로 가기"><h3 class="sec-label">새로 들어온 문제</h3>' +
    '<p class="small dim" style="line-height:1.65;margin-bottom:12px">모의고사 CO-C 세트 1·3·4·5예요. 세트 2는 \'모의고사 CO 2-A\'의 9~14번이라 바로가기 행으로 따로 넣어 뒀어요. 세트를 누르면 그 세트의 아직 안 푼 첫 문항으로 바로 가요.</p><div class="stack-sm">';
  COC_SETS.forEach((s, idx) => {
    const p = setProgress(coBySet(s));
    const complete = p.total > 0 && p.done >= p.total;
    h += '<button class="listrow" data-goset="듣기|' + esc(s) + '">' +
      '<span class="dot' + (complete ? ' done' : '') + '">' + (complete ? '✓' : '·') + '</span>' +
      '<span class="main"><span class="t" style="font-weight:600">' + esc(s) + '</span>' +
      '<span class="s">' + p.done + '/' + p.total + ' 완료 · 채점</span></span>' +
      '<span class="chev" aria-hidden="true">›</span></button>';
    if (idx === 0) {
      const c2ids = ['CO-M2A-09', 'CO-M2A-10', 'CO-M2A-11', 'CO-M2A-12', 'CO-M2A-13', 'CO-M2A-14'];
      const c2done = c2ids.filter((id) => isDone(id)).length;
      const c2complete = c2done >= c2ids.length;
      const c2target = c2ids.find((id) => !isDone(id)) || c2ids[0];
      h += '<button class="listrow" data-openitem="' + esc(c2target) + '" data-mod="듣기">' +
        '<span class="dot' + (c2complete ? ' done' : '') + '">' + (c2complete ? '✓' : '·') + '</span>' +
        '<span class="main"><span class="t" style="font-weight:600">모의고사 CO-C 세트 2</span>' +
        '<span class="s">' + c2done + '/6 완료 · 모의고사 CO 2-A의 9~14번이에요</span></span>' +
        '<span class="chev" aria-hidden="true">›</span></button>';
    }
  });
  h += '</div></section>';
  h += '<section class="card"><h3 class="sec-title" style="font-size:16px;font-weight:600;margin:0 0 8px">공부 달력</h3>' +
    '<p class="small dim" style="line-height:1.65;margin-bottom:12px">날마다 실제로 공부한 기록(문항 수 · 단어 수)을 확인해요.</p>' +
    '<button class="btn" data-go="home|calendar">공부 달력 열기</button></section>';
  h += '<p class="fineprint">진도는 이 브라우저 · 이 기기에만 저장돼요. 다른 기기와는 이어지지 않아요. (버전 27)</p>';
  h += '</div>';
  return h;
}
function viewCalendar() {
  const now = ui.calCursor ? new Date(ui.calCursor) : new Date();
  const y = now.getFullYear(), mo = now.getMonth();
  const first = new Date(y, mo, 1);
  const startDay = first.getDay();
  const days = new Date(y, mo + 1, 0).getDate();
  const dows = ['일', '월', '화', '수', '목', '금', '토'];
  let h = '<div class="card"><div class="row spread"><button class="btn ghost small" data-calnav="-1">← 지난달</button>' +
    '<h3 style="margin:0">' + y + '년 ' + (mo + 1) + '월</h3><button class="btn ghost small" data-calnav="1">다음달 →</button></div>' +
    '<div class="cal-grid" style="margin-top:12px">' + dows.map((d) => '<div class="cal-dow">' + d + '</div>').join('');
  for (let i = 0; i < startDay; i++) h += '<div class="cal-day dim"></div>';
  for (let d = 1; d <= days; d++) {
    const key = y + '-' + String(mo + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    const rec = state.activity[key];
    const isToday = key === todayKey();
    const isSel = ui.calSel === key;
    h += '<button class="cal-day' + (isToday ? ' today' : '') + (isSel ? ' selected' : '') + '" data-calday="' + key + '"><span>' + d + '</span>' + (rec ? '<span class="dot"></span>' : '') + '</button>';
  }
  h += '</div></div>';
  const sel = ui.calSel;
  if (sel) {
    const rec = state.activity[sel];
    h += '<div class="card"><h3>' + esc(sel) + ' 기록</h3>';
    if (rec) h += '<p>읽기 · 듣기 문항: <b>' + (rec.items || 0) + '</b>개</p><p>단어: <b>' + (rec.words || 0) + '</b>개</p>';
    else h += '<p class="muted">이 날은 기록이 없어요.</p>';
    h += '</div>';
  } else h += '<p class="muted">날짜를 누르면 그날의 기록만 보여요.</p>';
  return h;
}

/* ================= views: 읽기 (CE) ================= */
function setRowHtml(mod, set) {
  const items = mod === '읽기' ? ceBySet(set) : coBySet(set);
  const p = setProgress(items);
  const complete = p.total > 0 && p.done >= p.total;
  return '<button class="listrow" data-setlist="' + esc(mod) + '|' + esc(set) + '">' +
    '<span class="dot' + (complete ? ' done' : '') + '">' + (complete ? '✓' : '·') + '</span>' +
    '<span class="main"><span class="t">' + esc(set) + '</span>' +
    '<span class="s">' + p.done + '/' + p.total + ' 문항</span></span>' +
    '<span class="chev" aria-hidden="true">›</span></button>';
}
function viewCeList() {
  let h = '<div class="stack"><div><h2 class="page-title">읽기 — CE ' + DATA.ce.items.length + '문항</h2></div>';
  h += '<section><h3 class="sec-title" style="font-size:16px;font-weight:600;margin:0 0 8px">연습 세트</h3><div class="stack-sm">';
  CE_PRACTICE.forEach((s) => { h += setRowHtml('읽기', s); });
  h += '</div></section><section><h3 class="sec-title" style="font-size:16px;font-weight:600;margin:0 0 8px">모의고사</h3><div class="stack-sm">';
  CE_MOCK.forEach((s) => { h += setRowHtml('읽기', s); });
  h += '</div></section>';
  h += '<div class="card"><h3>읽기 전략</h3><p class="muted">섹션별 전략과 팁 ' + DATA.ce.strategies.length + '개</p><button class="btn" style="margin-top:10px" data-go="ce|ceStrategies">전략 보기</button></div>';
  h += '</div>';
  return h;
}
function viewSetItems(mod, set) {
  const items = mod === '읽기' ? ceBySet(set) : coBySet(set);
  const lastId = state.lastItem && state.lastItem.set === set ? state.lastItem.id : null;
  const finished = (it) => { const a = state.answers[it.id]; return it.scored === false ? !!a : isDone(it.id); };
  // next item to solve: first unfinished after the just-solved one (or overall)
  let nextId = null;
  const startIdx = lastId ? items.findIndex((i) => i.id === lastId) : -1;
  for (let k = startIdx + 1; k < items.length; k++) { if (!finished(items[k])) { nextId = items[k].id; break; } }
  if (!nextId && startIdx === -1) { const f = items.find((i) => !finished(i)); if (f) nextId = f.id; }
  let h = '<div class="stack"><div><h2 class="page-title">' + esc(set) + '</h2>' +
    ((state.pin && state.pin.mod === mod && state.pin.set === set)
      ? '<button class="btn ghost small" style="margin-top:8px" data-unpin="1">오늘 할 공부에서 빼기</button>'
      : '<button class="btn ghost small" style="margin-top:8px" data-pinset="' + esc(mod) + '|' + esc(set) + '">오늘 할 공부로 고정</button>') + '</div>';
  if (lastId) {
    const lastItem = items.find((i) => i.id === lastId);
    const nextItem = nextId ? items.find((i) => i.id === nextId) : null;
    if (lastItem) {
      h += '<section class="resume-banner" aria-label="방금 푼 문항 안내"><p class="rb-title">방금 푼 문항이에요</p>' +
        '<p class="fr rb-item">' + esc(lastItem.id) + ' · ' + esc(lastItem.stem || '대화를 듣고 알맞은 그림 고르기') + '</p>' +
        '<div class="rb-btns"><button class="btn ghost small" data-openitem="' + esc(lastItem.id) + '" data-mod="' + esc(mod) + '">그 문항 다시 보기</button>' +
        (nextItem ? '<button class="btn small" data-openitem="' + esc(nextItem.id) + '" data-mod="' + esc(mod) + '">다음 문항 이어서 풀기 (' + esc(nextItem.id) + ') ›</button>' : '') +
        '</div></section>';
    }
  }
  h += '<div class="stack-sm">';
  items.forEach((it) => {
    const a = state.answers[it.id];
    // one signal per fact: the dot carries the result, the row outline carries
    // just-solved / next-up, and a badge remains only for the uncertain caveat.
    let dotCls = '', dotChar = '·';
    if (a && a.correct === true) { dotCls = ' done'; dotChar = '✓'; }
    else if (a && a.correct === false) { dotCls = ' bad'; dotChar = '✗'; }
    else if (a) { dotCls = ' mid'; dotChar = '✓'; }
    const badge = it.uncertain ? '<span class="badges"><span class="badge warn">확인 필요</span></span>' : '';
    const cls = 'set-row' + (it.id === lastId ? ' just-done' : '') + (it.id === nextId ? ' next-up' : '');
    h += '<button class="' + cls + '" data-rowitem="' + esc(it.id) + '" data-openitem="' + esc(it.id) + '" data-mod="' + esc(mod) + '">' +
      '<span class="dot' + dotCls + '">' + dotChar + '</span>' +
      '<span class="main"><span class="t fr">' + esc(it.stem || '대화를 듣고 알맞은 그림 고르기') + '</span>' +
      '<span class="s">' + esc(it.id) + '</span></span>' + badge + '</button>';
  });
  h += '</div></div>';
  return h;
}
function viewCeStrategies() {
  return DATA.ce.strategies.map((s) =>
    '<div class="card"><h3>' + esc(s.section) + '</h3><p>' + esc(s.summary) + '</p>' +
    (s.tips && s.tips.length ? '<ul>' + s.tips.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>' : '') + '</div>'
  ).join('');
}
function studyHeadHtml(item) {
  return '<div class="head-row"><span class="small" style="font-weight:600">' + esc(item.set) + ' · ' + esc(item.id) + '</span>' +
    (item.uncertain ? '<span class="badge warn">정답 확신 낮음</span>' : '') + '</div>';
}
function viewCeItem(item) {
  const a = state.answers[item.id];
  const answered = isDone(item.id);
  const pairs = (DATA.sentKo || {})[item.id] || (item.doc ? [[item.doc, item.trans || '']] : []);
  let h = '<div class="stack-md">' + studyHeadHtml(item);
  if (item.image) h += '<div class="card img-card"><img class="doc-img" src="' + esc(item.image) + '" alt=""></div>';
  h += '<div class="card card-pad-lg">' + sentencesHtml(item, pairs, 'ce') + '</div>';
  if (item.stem) h += '<div class="stem"><span style="flex:1;min-width:0" class="fr">' + esc(item.stem) + '</span>' + speakBtn(item.stem) + '</div>';
  h += optionsHtml(item, answered);
  if (answered) {
    h += feedbackHtml(item, a);
    if (item.words && item.words.length) h += '<div><h4 class="sub-title">이 문항의 단어</h4>' + wordRows(item.words) + '</div>';
    h += sentTypeHtml(item);
    h += navItemHtml('읽기', item);
  }
  h += '</div>';
  return h;
}
/* ----- CE extras: sentence typing (answered state) -----
   직독직해 chunks render ONLY inline in the document card (sentencesHtml):
   tap a sentence → its translation → tap the translation for its chunks.
   Chunk data: data/chunks.json, keyed by item id → sentences → [frChunk, koChunk, whyNote?] pairs.
   Sentence typing shows the Korean meaning (from sent_ko) and has the user type
   the whole French sentence; cloze sentences are typed with the answer filled in. */
function stripFrAccents(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function frLemma(fr) {
  // "l'immigration (f)" → "immigration"; "le renouvellement" → "renouvellement"
  return String(fr || '').split('(')[0].trim().replace(/^(une?|le|la|les|des)\s+/i, '').replace(/^l'/i, '');
}
function blankHint(item) {
  // Korean meaning of the answer word, matched from item.words by lemma/stem.
  // Falls back to a first-letters hint — never returns the full answer word.
  const ans = item.options[item.answer] || '';
  const core = stripFrAccents(frLemma(ans)).replace(/['’]/g, '');
  for (const w of (item.words || [])) {
    const lem = stripFrAccents(frLemma(w[0])).replace(/['’]/g, '');
    if (!lem) continue;
    if (core === lem || core.startsWith(lem) || lem.startsWith(core)) return { type: '뜻', text: w[1] };
    const toks = lem.split(/[\s-]+/).filter((t) => t.length >= 4);
    if (toks.some((t) => t === core || t.slice(0, 4) === core.slice(0, 4))) return { type: '뜻', text: w[1] };
  }
  const letters = ans.replace(/^l'/i, '');
  return { type: '첫 글자', text: letters.slice(0, 2) + '… (' + letters.length + '글자)' };
}
/* ----- sentence typing: loose word diff (accents/case/punctuation-insensitive) -----
   Same LCS alignment shape as the CO dictation wordDiff, but the comparison
   tokens also strip accents, so a missing accent never marks a word wrong here
   (the learner is practising recall of the sentence, not spelling drills). */
function looseNormWord(w) {
  return stripFrAccents(w).replace(/[.,;:!?…·«»"'’‘“”\-—()]/g, '');
}
function looseNormTokens(s) {
  return tokenize(s)
    .map((w) => ({ orig: w, norm: looseNormWord(w) }))
    .filter((p) => p.norm.length > 0);
}
function wordDiffLoose(target, attempt) {
  const Tp = looseNormTokens(target), Ap = looseNormTokens(attempt);
  const T = Tp.map((p) => p.orig), A = Ap.map((p) => p.orig);
  const t = Tp.map((p) => p.norm), a = Ap.map((p) => p.norm);
  const n = t.length, m = a.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = t[i] === a[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (t[i] === a[j]) { out.push({ type: 'ok', w: T[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'miss', w: T[i] }); i++; }
    else { out.push({ type: 'extra', w: A[j] }); j++; }
  }
  while (i < n) { out.push({ type: 'miss', w: T[i] }); i++; }
  while (j < m) { out.push({ type: 'extra', w: A[j] }); j++; }
  const correct = out.filter((o) => o.type === 'ok').length;
  return { out, score: n ? correct / n : 0 };
}
function judgeSentence(target, input) {
  const t = String(input || '').trim();
  if (!t) return null;
  const diff = wordDiffLoose(target, t);
  const diffCount = diff.out.filter((o) => o.type !== 'ok').length;
  let level = 'no';
  if (diffCount === 0) level = 'ok';
  else if (diff.score >= 0.7) level = 'almost';
  return { level, diffCount, diff };
}
/* Per-sentence typing targets for a CE item: French target + Korean prompt.
   Cloze sentences (with ______) are typed with the answer word filled in, and
   the Korean prompt — which leaves the blank untranslated — gets the answer
   word's meaning appended in parentheses. The French answer never appears in
   the prompt. */
function sentenceTargets(item) {
  const pairs = (DATA.sentKo || {})[item.id] || (item.doc ? [[item.doc, item.trans || '']] : []);
  const ans = item.options ? (item.options[item.answer] || '') : '';
  return pairs.map((p) => {
    let fr = normWs(p[0]);
    let ko = p[1] || '';
    let cloze = false;
    if (fr.includes('______')) {
      cloze = true;
      fr = fr.replace(/______/g, ans);
      const hint = blankHint(item);
      ko += hint.type === '뜻' ? ' (빈칸 뜻: ' + hint.text + ')' : ' (빈칸 힌트: ' + hint.text + ')';
    }
    return { fr, ko, cloze };
  });
}
function sentResultHtml(res) {
  if (!res) return '';
  let h = '<p class="fr16" style="margin-top:8px">' + renderDiff(res.diff) + '</p>';
  if (res.level === 'ok') h += '<p class="banner ok" style="margin-top:8px">전부 맞음 ✓</p>';
  else if (res.level === 'almost') h += '<p class="note-box" style="margin-top:8px">거의 맞음 — ' + res.diffCount + '개 단어 차이가 있어요. 표시된 부분을 고쳐 보세요.</p>';
  else h += '<p class="banner no" style="margin-top:8px">다시 보기 — 표시된 단어를 확인하고 한 번 더 써 보세요.</p>';
  return h;
}
function sentTypeHtml(item) {
  if (!(DATA.chunks || {})[item.id]) return '';
  const targets = sentenceTargets(item);
  if (!targets.length) return '';
  let h = '<details><summary>문장 타이핑</summary>';
  targets.forEach((t, idx) => {
    const key = item.id + ':stype:' + idx;
    const res = ui.sentResult[key];
    h += '<div class="dict-box" style="margin:12px 0"><div class="row"><b>문장 ' + (idx + 1) + '</b></div>' +
      '<p class="small" style="line-height:1.7;margin:6px 0 8px">' + esc(t.ko) + '</p>' +
      '<textarea rows="2" data-stype-input="' + esc(key) + '" placeholder="프랑스어로 써 보세요">' + esc(ui.sentInput[key] || '') + '</textarea>' +
      '<button class="btn small" data-stype-check="' + esc(key) + '" data-target="' + esc(t.fr) + '">확인</button>' +
      '<div data-stype-result="' + esc(key) + '">' + sentResultHtml(res) + '</div>';
    h += '</div>';
  });
  return h + '</details>';
}
function feedbackHtml(item, a) {
  if (!a) return '';
  if (a.correct === true || a.correct === false) {
    const ok = a.correct === true;
    return '<div class="stack-md"><p class="banner ' + (ok ? 'ok' : 'no') + '">' + (ok ? '맞았어요' : '여기서 갈렸어요 — 해설을 확인해 보세요') + '</p>' +
      '<div class="card"><h4 class="sub-title">해설</h4><p class="small" style="line-height:1.7;margin-top:4px;font-size:15px">' + esc(item.expl || '') + '</p></div></div>';
  }
  return '<div class="note-box"><b>선택을 저장했어요.</b></div>';
}
function navItemHtml(mod, item) {
  const items = mod === '읽기' ? ceBySet(item.set) : coBySet(item.set);
  const idx = items.findIndex((i) => i.id === item.id);
  const prev = items[idx - 1], next = items[idx + 1];
  let h = '<div class="row nav-row" style="margin-top:16px;gap:8px">';
  if (prev) h += '<button class="btn ghost" data-openitem="' + esc(prev.id) + '" data-mod="' + esc(mod) + '" data-nopush="1">← 이전 문항</button>';
  if (next) h += '<button class="btn" data-openitem="' + esc(next.id) + '" data-mod="' + esc(mod) + '" data-nopush="1">다음 문항 →</button>';
  h += '<button class="btn ghost" data-setlist="' + esc(mod) + '|' + esc(item.set) + '" data-nopush="1">목록</button></div>';
  return h;
}

/* ================= views: 듣기 (CO) ================= */
function viewCoHome() {
  let h = '<div class="stack"><div><h2 class="page-title">듣기 — CO ' + DATA.co.items.length + '문항</h2>' +
    '<p class="lead">바로 듣고 답을 고르는 흐름이에요 — 대본은 답한 뒤에만 열리고, 낯선 단어는 문항 안에서 눌러 두면 단어 탭에 모입니다. 기본은 시험처럼 1회 재생이에요.</p></div>';
  h += '<section><h3 class="sec-title" style="font-size:16px;font-weight:600;margin:0 0 8px">CO-A</h3><div class="stack-sm">';
  CO_A1.forEach((s) => { h += setRowHtml('듣기', s); });
  h += '</div></section><section><h3 class="sec-title" style="font-size:16px;font-weight:600;margin:0 0 8px">CO B · C · D · F 연습</h3><div class="stack-sm">';
  CO_PRACTICE.forEach((s) => { h += setRowHtml('듣기', s); });
  h += '</div></section><section><h3 class="sec-title" style="font-size:16px;font-weight:600;margin:0 0 8px">모의고사</h3><div class="stack-sm">';
  CO_MOCK.forEach((s) => { h += setRowHtml('듣기', s); });
  h += '</div></section><section><h3 class="sec-title" style="font-size:16px;font-weight:600;margin:0 0 8px">CO-A 세트 2 (미채점 연습)</h3><div class="stack-sm">';
  CO_A2.forEach((s) => { h += setRowHtml('듣기', s); });
  h += '</div></section></div>';
  return h;
}
function playerHtml(item) {
  if (!item.audio) return '';
  const answered = isDone(item.id);
  const scoredLimited = item.scored !== false && item.answer != null;
  const plays = attemptPlays[item.id] || 0;
  const blocked = scoredLimited && !answered && plays >= 1;
  let h = '<div class="card player-card"><div class="player-row">' +
    '<button class="play-big" data-play="' + esc(item.id) + '"' + (blocked ? ' disabled' : '') + ' aria-label="오디오 재생">▶</button>' +
    '<div class="player-status"><p class="p-main">🎧 듣기</p>' +
    '<p class="xs dim" data-play-count="' + esc(item.id) + '">재생 횟수 ' + (state.plays[item.id] || 0) + '회</p>';
  if (scoredLimited && !answered) h += '<p class="xs dim">시험 모드: 1회 재생 — 답을 고르기 전에는 한 번만 들을 수 있어요.</p>';
  if (blocked) h += '<p class="xs dim"><b>시험 모드: 1회 재생</b>을 마쳤어요. 답을 고른 뒤에는 복습으로 다시 들을 수 있어요.</p>';
  const repOn = !!(ui.repeat && ui.repeat[item.id]);
  h += '</div></div>' +
    '<div class="player-tools"><button class="repeat-btn' + (repOn ? ' on' : '') + '" data-repeat="' + esc(item.id) + '" aria-pressed="' + (repOn ? 'true' : 'false') + '">🔁 반복 듣기 ' + (repOn ? '켜짐' : '꺼짐') + '</button></div>' +
    '<span data-player-msg="' + esc(item.id) + '" class="ok-text"></span>' +
    '<div data-native-slot="' + esc(item.id) + '"></div></div>';
  return h;
}
const blobPending = new Set();
function warmBlob(item) {
  // Pre-download the listening file so later plays can start instantly.
  // Playback itself never waits for this: playItemAudio streams the file URL.
  if (!item || !item.audio || blobCache.has(item.audio) || blobPending.has(item.audio)) return;
  blobPending.add(item.audio);
  fetch(item.audio).then((res) => (res.ok ? res.blob() : null)).then((blob) => {
    if (blob) blobCache.set(item.audio, URL.createObjectURL(blob));
  }).catch(() => {}).finally(() => { blobPending.delete(item.audio); });
}
function ensureAudio(item, slot, msg) {
  let audio = slot ? slot.querySelector('audio') : null;
  if (audio) return audio;
  if (!slot) return null;
  audio = document.createElement('audio');
  audio.controls = true; audio.preload = 'auto';
  // Start inside the tap gesture: a cached Blob URL when ready, otherwise the
  // file URL streams. Never await a download before play() — mobile browsers
  // drop the gesture and the first tap goes silent.
  audio.src = blobCache.get(item.audio) || item.audio;
  audio.dataset.itemId = item.id;
  audio.addEventListener('play', () => {
    if (audio._repeatStart) { // repeat-mode starts are drilling, not exam plays
      audio._repeatStart = false;
      audio.dataset.counted = '1';
      return;
    }
    if (audio.dataset.counted === '1') return; // resuming a pause is not a new play
    audio.dataset.counted = '1';
    state.plays[item.id] = (state.plays[item.id] || 0) + 1;
    attemptPlays[item.id] = (attemptPlays[item.id] || 0) + 1;
    save();
    // Update only the counter text. Rebuilding the screen here (render) would
    // remove this audio element and kill the playback that just started.
    const cnt = document.querySelector('[data-play-count="' + CSS.escape(item.id) + '"]');
    if (cnt) cnt.textContent = '재생 횟수 ' + state.plays[item.id] + '회';
    const ans = isDone(item.id);
    const lim = item.scored !== false && item.answer != null;
    if (lim && !ans && attemptPlays[item.id] > 1) { audio.pause(); render(); }
  });
  audio.addEventListener('ended', () => {
    audio.dataset.counted = '';
    if (ui.repeat && ui.repeat[item.id]) { // loop while repeat listening is on
      audio._repeatStart = true;
      try { audio.currentTime = 0; } catch (e) {}
      const rp = audio.play();
      if (rp && rp.catch) rp.catch(() => {});
      return;
    }
    const ans = isDone(item.id);
    const lim = item.scored !== false && item.answer != null;
    if (lim && !ans) render(); // playback is over: swap in the exam-mode lock UI
  });
  audio.addEventListener('error', () => {
    if (msg) msg.textContent = ' 소리를 불러오지 못했어요.';
    if (slot && !slot.querySelector('[data-retry]')) {
      const rb = document.createElement('div');
      rb.innerHTML = '<button class="btn ghost" data-retry="' + esc(item.id) + '">다시 불러오기</button>';
      slot.appendChild(rb);
    }
  });
  slot.appendChild(audio);
  return audio;
}
function playItemAudio(item, btn) {
  const msg = document.querySelector('[data-player-msg="' + CSS.escape(item.id) + '"]');
  const slot = document.querySelector('[data-native-slot="' + CSS.escape(item.id) + '"]');
  const answered = isDone(item.id);
  const scoredLimited = item.scored !== false && item.answer != null;
  if (scoredLimited && !answered && (attemptPlays[item.id] || 0) >= 1) { if (msg) msg.textContent = '시험 모드: 1회 재생을 이미 썼어요.'; return; }
  warmBlob(item);
  const audio = ensureAudio(item, slot, msg);
  if (!audio) return;
  if (msg) msg.textContent = '';
  const p = audio.play();
  if (p && p.catch) p.catch(() => { if (msg) msg.textContent = ' 재생이 막혔어요. 아래 재생 바의 ▶를 눌러 주세요.'; });
}
function toggleRepeat(item) {
  ui.repeat = ui.repeat || {};
  const on = !ui.repeat[item.id];
  ui.repeat[item.id] = on;
  // Update the toggle in place — never render() while audio may be playing.
  document.querySelectorAll('[data-repeat="' + CSS.escape(item.id) + '"]').forEach((b) => {
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.textContent = '🔁 반복 듣기 ' + (on ? '켜짐' : '꺼짐');
  });
  const slot = document.querySelector('[data-native-slot="' + CSS.escape(item.id) + '"]');
  const msg = document.querySelector('[data-player-msg="' + CSS.escape(item.id) + '"]');
  if (!on) {
    // Turning off after the exam play was used: show the lock UI if nothing is playing.
    const audio = slot ? slot.querySelector('audio') : null;
    const ans = isDone(item.id);
    const lim = item.scored !== false && item.answer != null;
    if (lim && !ans && (attemptPlays[item.id] || 0) >= 1 && (!audio || audio.paused || audio.ended)) render();
    return;
  }
  // Turning on restarts the audio from the beginning right away, inside this tap
  // (same behaviour as the Muse version's repeat button), then loops on 'ended'.
  warmBlob(item);
  const audio = ensureAudio(item, slot, msg);
  if (!audio) return;
  audio._repeatStart = true;
  try { audio.currentTime = 0; } catch (e) {}
  if (msg) msg.textContent = '';
  const p = audio.play();
  if (p && p.catch) p.catch(() => { if (msg) msg.textContent = ' 재생이 막혔어요. 아래 재생 바의 ▶를 눌러 주세요.'; });
}
function transcriptPairs(item) {
  if (item.stt && item.sentences && item.sentences.length) return item.sentences;
  return (DATA.sentKo || {})[item.id] || null;
}
function viewCoItem(item) {
  const a = state.answers[item.id];
  const answered = isDone(item.id);
  const unscored = item.scored === false || item.answer == null;
  let h = '<div class="stack-md">' + studyHeadHtml(item);
  if (unscored) {
    h += '<div class="note-box"><span class="badge warn">근거 자료 없음 · 확인 필요</span><p style="margin:8px 0 0">' + esc(item.note || '') + '</p></div>';
  }
  if (item.stt) h += '<p><span class="badge">음성인식 대본</span>' + (item.note ? '<span class="small muted">' + esc(item.note) + '</span>' : '') + '</p>';
  if (!item.audio && item.transcript) {
    h += '<p class="muted small">소리 파일이 없는 문항이에요. 아래 글을 읽고 답해 보세요.</p><div class="card"><p class="fr">' + esc(item.transcript) + '</p></div><div>' + speakBtn(item.transcript) + '</div>';
  } else {
    h += playerHtml(item);
  }
  if (item.image) h += '<div class="card img-card"><img class="doc-img" src="' + esc(item.image) + '" alt=""></div>';
  if (item.stem) h += '<div class="stem"><span style="flex:1;min-width:0" class="fr">' + esc(item.stem) + '</span>' + speakBtn(item.stem) + '</div>';
  h += optionsHtml(item, answered);
  if (!unscored && answered) {
    h += feedbackHtml(item, a);
    h += transcriptReviewHtml(item);
    if (item.words && item.words.length) h += '<div><h4 class="sub-title">이 문항의 단어</h4>' + wordRows(item.words) + '</div>';
    h += navItemHtml('듣기', item);
  } else if (unscored) {
    if (a) h += '<div class="note-box"><b>선택을 저장했어요.</b> 채점하지 않는 연습 문항이에요.</div>';
    h += navItemHtml('듣기', item);
  } else if (!item.audio && answered) {
    h += navItemHtml('듣기', item);
  }
  h += '</div>';
  return h;
}
function transcriptReviewHtml(item) {
  const pairs = transcriptPairs(item);
  if (!pairs && !item.transcript) return '';
  let h = '<div><h3 class="sec-title" style="font-size:16px;font-weight:600;margin:0 0 8px">대본 복습</h3>';
  if (item.stt) h += '<p><span class="badge">음성인식 대본</span></p>';
  if (pairs) {
    h += '<p class="xs dim" style="margin-bottom:8px">문장을 누르면 그 문장의 해석이 펼쳐져요.</p>' + sentencesHtml(item, pairs, item.stt ? 'stt' : 'co');
    // dictation
    h += '<details><summary>딕테이션 — 듣고 받아쓰기</summary>';
    pairs.forEach((p, idx) => {
      const fr = item.stt ? p.fr : p[0];
      const key = item.id + ':dict:' + idx;
      const res = ui.dictResult[key];
      h += '<div class="dict-box" style="margin:12px 0"><div class="row"><b>문장 ' + (idx + 1) + '</b>' + speakBtn(fr) + '</div>' +
        '<textarea rows="2" data-dict-input="' + esc(key) + '" placeholder="들은 대로 적어 보세요">' + esc(ui.dictInput[key] || '') + '</textarea>' +
        '<button class="btn small" data-dict-check="' + esc(key) + '" data-target="' + esc(fr) + '">확인</button>' +
        (res ? '<p class="fr16" style="margin-top:8px">' + renderDiff(res) + '</p><p class="muted small">맞힌 비율 ' + Math.round(res.score * 100) + '%</p>' : '') + '</div>';
    });
    h += '</details>';
    // shadowing
    h += '<details><summary>쉐도잉 — 따라 말하기</summary>';
    pairs.forEach((p, idx) => {
      const fr = item.stt ? p.fr : p[0];
      const key = item.id + ':shadow:' + idx;
      const mode = ui.shadowMode[key] || 'full';
      const words = tokenize(fr);
      let shown = esc(fr);
      if (mode === 'head') { const cut = Math.max(1, Math.ceil(words.length * 0.4)); shown = esc(words.slice(0, cut).join(' ')) + ' •••'; }
      if (mode === 'hide') shown = '(눌러서 보기)';
      h += '<div class="masked" style="margin:12px 0"><div class="row"><b>문장 ' + (idx + 1) + '</b>' + speakBtn(fr) + '</div>' +
        '<p class="fr txt' + (mode === 'hide' ? ' hidden-mode' : '') + '" data-shadow-text="' + esc(key) + '">' + shown + '</p>' +
        '<div class="modes"><button data-shadow="' + esc(key) + '|full" class="mbtn' + (mode === 'full' ? ' active' : '') + '">전체 보기</button>' +
        '<button data-shadow="' + esc(key) + '|head" class="mbtn' + (mode === 'head' ? ' active' : '') + '">앞부분만</button>' +
        '<button data-shadow="' + esc(key) + '|hide" class="mbtn' + (mode === 'hide' ? ' active' : '') + '">가리기</button></div></div>';
    });
    h += '</details>';
  } else {
    h += '<p class="fr">' + esc(item.transcript) + '</p>' + speakBtn(item.transcript);
  }
  if (item.trans) h += '<details><summary>대본 전체 해석</summary><p>' + esc(item.trans) + '</p></details>';
  return h + '</div>';
}

/* ================= views: 표현 (EE / EO) ================= */
function viewExprHome() {
  let h = '<div class="stack"><div><h2 class="page-title">표현 — EE · EO</h2>' +
    '<p class="lead">쓰기 모델과 패턴 드릴, 말하기 스크립트와 포스터 연습이에요.</p></div>';
  h += '<section><h3 class="sec-title" style="font-size:16px;font-weight:600;margin:0 0 8px">쓰기 (EE) — 모델</h3><div class="card"><h3>편지 모델 틀</h3><p class="muted">틀 ' + DATA.ee.model.template.length + '부분 + 완성 예시 1편</p>' +
    '<button class="btn" style="margin-top:10px" data-go="expr|eeModel">모델 보기</button> <button class="btn ghost" style="margin-top:10px" data-go="expr|eeStrategies">전략 보기</button></div></section>';
  h += '<section><h3 class="sec-title" style="font-size:16px;font-weight:600;margin:0 0 8px">쓰기 패턴 드릴 10</h3><div class="stack-sm">';
  DATA.ee.prep.forEach((p) => {
    const d = state.drill['ee' + p.no] || {};
    const steps = [1, 2, 3, 4].filter((s) => d['step' + s]).length;
    const complete = steps >= 4;
    h += '<button class="listrow" data-drill="' + p.no + '">' +
      '<span class="dot' + (complete ? ' done' : '') + '">' + (complete ? '✓' : '·') + '</span>' +
      '<span class="main"><span class="t">' + p.no + '. ' + esc(p.title) + '</span>' +
      '<span class="s">' + steps + '/4 단계</span></span>' +
      '<span class="chev" aria-hidden="true">›</span></button>';
  });
  h += '</div></section>';
  h += '<section><h3 class="sec-title" style="font-size:16px;font-weight:600;margin:0 0 8px">말하기 (EO) — 스크립트</h3><div class="card"><h3>전화 문의 스크립트 트레이너</h3><p class="muted">도입 만들기 · 카테고리 질문 ' + DATA.eo.script.categories.length + '개 · 반응 문장 · 결론</p>' +
    '<button class="btn" style="margin-top:10px" data-go="expr|eoScript">스크립트 연습</button></div>' +
    '<div class="card" style="margin-top:8px"><h3>포스터 연습 40</h3><p class="muted">제목을 가리고 키워드로 말해 본 뒤 확인해요. 마친 포스터 ' + Object.keys(state.posterDone).length + '/40</p>' +
    '<button class="btn" style="margin-top:10px" data-go="expr|eoPosters">포스터 보기</button></div></section>';
  h += '</div>';
  return h;
}
function viewEeModel() {
  let h = '<div class="card"><h3>모델 틀</h3>';
  DATA.ee.model.template.forEach((t) => {
    h += '<p class="muted small" style="margin:14px 0 2px"><b>' + esc(t.part) + '</b></p>' + speakableLine(t.text);
  });
  h += '</div><div class="card"><h3>완성 예시 — ' + esc(DATA.ee.model.exemple.title) + '</h3><p><span class="badge teal">' + esc(DATA.ee.model.exemple.stance) + '</span></p>';
  DATA.ee.model.exemple.paras.forEach((p, i) => {
    h += speakableLine(p);
    const kr = (DATA.ee.model.exemple.parasKr || [])[i];
    if (kr) h += '<p class="muted" style="margin:2px 0 12px">' + esc(kr) + '</p>';
  });
  h += '</div>';
  return h;
}
function viewEeStrategies() {
  return DATA.ee.strategies.map((s) =>
    '<div class="card"><h3>' + esc(s.title) + '</h3><p>' + esc(s.summary) + '</p>' +
    (s.points && s.points.length ? '<ul>' + s.points.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>' : '') + '</div>'
  ).join('');
}
function drillTarget(prep) {
  // Use the first example sentence as the clean single-sentence target for steps 2-4.
  return (prep.examples && prep.examples[0]) || '';
}
function splitChunks(sentence) {
  const words = tokenize(sentence);
  const chunks = [];
  for (let i = 0; i < words.length; i += 3) chunks.push(words.slice(i, i + 3).join(' '));
  return chunks;
}
function viewEeDrill(no) {
  const prep = DATA.ee.prep.find((p) => p.no === Number(no));
  if (!prep) return '<p>드릴을 찾을 수 없어요.</p>';
  const d = state.drill['ee' + prep.no] || {};
  const target = drillTarget(prep);
  let h = '<div class="card"><span class="badge teal">' + esc(prep.type) + '</span><h3 style="margin-top:8px">' + esc(prep.title) + '</h3>';
  h += '<h3>1단계 · 모델 보기</h3>';
  if (prep.model) h += '<p class="fr16" style="white-space:pre-wrap">' + esc(prep.model) + '</p>' + speakBtn(prep.model);
  if (prep.modelKr) h += '<p class="muted">' + esc(prep.modelKr) + '</p>';
  if (prep.taskText) h += '<details><summary>연습 과제 원문</summary><p style="white-space:pre-wrap">' + esc(prep.taskText) + '</p></details>';
  h += '<p class="muted small">예문 (각 문장에 🔊)</p>';
  (prep.examples || []).forEach((ex) => { h += speakableLine(ex, 'fr16'); });
  h += stepDoneBtn('ee', prep.no, 1, d.step1);
  // step 2 assembly
  const chunks = splitChunks(target);
  const orderKey = 'ee' + prep.no;
  const picked = (ui.drillSel[orderKey] || []);
  const shuffled = chunks.map((c, i) => i).sort((a, b) => ((a * 7 + prep.no * 3) % 11) - ((b * 7 + prep.no * 3) % 11));
  h += '<h3 style="margin-top:22px">2단계 · 조립</h3><p class="muted small">예문 첫 문장을 조각 순서대로 눌러 완성해 보세요.</p>';
  h += '<p class="fr" style="min-height:30px">' + esc(picked.map((i) => chunks[i]).join(' ')) + '</p>';
  shuffled.forEach((ci) => {
    h += '<button class="chunk' + (picked.includes(ci) ? ' used' : '') + '" data-chunk="' + esc(orderKey) + '|' + ci + '">' + esc(chunks[ci]) + '</button>';
  });
  h += '<div class="row" style="margin-top:8px"><button class="btn ghost small" data-chunk-reset="' + esc(orderKey) + '">처음부터</button>' +
    '<button class="btn small" data-chunk-check="' + esc(orderKey) + '">확인</button><span data-chunk-msg="' + esc(orderKey) + '" class="small"></span></div>';
  h += stepDoneBtn('ee', prep.no, 2, d.step2);
  // step 3 replace one chunk
  if (chunks.length >= 3) {
    const blankIdx = 1;
    const correctChunk = chunks[blankIdx];
    const alts = [];
    (prep.examples || []).slice(1, 6).forEach((ex) => { const c = splitChunks(ex); if (c[blankIdx] && c[blankIdx] !== correctChunk && !alts.includes(c[blankIdx])) alts.push(c[blankIdx]); });
    while (alts.length > 2) alts.pop();
    const opts = [correctChunk].concat(alts).sort();
    const shown = chunks.map((c, i) => (i === blankIdx ? '＿＿＿' : c)).join(' ');
    h += '<h3 style="margin-top:22px">3단계 · 한 칸 바꾸기</h3><p class="fr">' + esc(shown) + '</p>';
    opts.forEach((o) => { h += '<button class="opt" data-swap="' + esc(orderKey) + '|' + blankIdx + '" data-val="' + esc(o) + '" data-correct="' + esc(correctChunk) + '">' + esc(o) + '</button>'; });
    h += '<span data-swap-msg="' + esc(orderKey) + '" class="small"></span>';
    h += stepDoneBtn('ee', prep.no, 3, d.step3);
  }
  // step 4 retype
  const rk = 'ee-retype-' + prep.no;
  h += '<h3 style="margin-top:22px">4단계 · 가리고 다시 쓰기</h3><p class="muted small">예문 첫 문장을 보지 않고 다시 적어 보세요.</p>' +
    speakableLine(target, 'fr16') +
    '<textarea rows="3" data-retype="' + esc(rk) + '" placeholder="여기에 다시 적어 보세요">' + esc(ui.dictInput[rk] || '') + '</textarea>' +
    '<button class="btn small" data-retype-check="' + esc(rk) + '" data-target="' + esc(target) + '" data-drillno="' + prep.no + '">비교하기</button>' +
    '<div data-retype-out="' + esc(rk) + '"></div>';
  h += stepDoneBtn('ee', prep.no, 4, d.step4);
  h += '</div>';
  return h;
}
function stepDoneBtn(kind, no, step, done) {
  return '<div style="margin-top:10px"><button class="btn ' + (done ? 'ghost' : '') + ' small" data-stepdone="' + kind + '|' + no + '|' + step + '">' + (done ? '이 단계 마침 ✓ (다시 누르면 해제)' : '이 단계 마쳤어요') + '</button></div>';
}
function viewEoScript() {
  const s = DATA.eo.script;
  let h = '<div class="card"><h3>도입 만들기</h3><p class="muted small">칸마다 하나씩 골라 도입 문장을 조립해 보세요.</p>';
  s.introParts.forEach((part, pi) => {
    const sel = (ui.eoIntroSel || {})[pi];
    h += '<p class="muted small" style="margin:12px 0 4px"><b>' + esc(part.slot) + '</b></p>';
    part.options.forEach((o, oi) => {
      h += '<button class="chip' + (sel === oi ? ' on' : '') + '" data-eointro="' + pi + '|' + oi + '">' + esc(o) + '</button>';
    });
  });
  const assembled = s.introParts.map((p, pi) => { const sel = (ui.eoIntroSel || {})[pi]; return sel != null ? p.options[sel] : ''; }).filter(Boolean).join(' ');
  h += '<p class="muted small" style="margin-top:14px">모델 도입문</p>' + speakableLine(s.introModel);
  if (assembled) h += '<p class="muted small" style="margin-top:10px">내가 조립한 도입문</p>' + speakableLine(assembled);
  h += '</div>';
  h += '<div class="card"><h3>카테고리 질문 연습</h3>';
  s.categories.forEach((c, ci) => {
    const checked = !!state.eoCheck['cat' + ci];
    h += '<details><summary>' + esc(c.name) + ' · ' + esc(c.fr || '') + (checked ? ' ✓' : '') + '</summary>';
    if (c.transition) h += speakableLine(c.transition, 'fr16');
    (c.questions || []).forEach((q) => { h += speakableLine(q, 'fr16'); });
    h += '<button class="btn ' + (checked ? 'ghost' : '') + ' small" data-eocheck="cat' + ci + '">' + (checked ? '연습 마침 ✓' : '이 카테고리 연습 마쳤어요') + '</button></details>';
  });
  h += '</div>';
  h += '<div class="card"><h3>반응 문장</h3>';
  (s.reactions || []).forEach((r) => {
    h += '<p class="muted small" style="margin:12px 0 4px"><b>' + esc(r.name) + '</b></p>';
    (r.phrases || []).forEach((p) => { h += speakableLine(p, 'fr16'); });
  });
  h += '<h3 style="margin-top:18px">잘 못 들었을 때</h3>';
  (s.clarify || []).forEach((p) => { h += speakableLine(p, 'fr16'); });
  h += '</div>';
  h += '<div class="card"><h3>결론</h3>' + speakableLine(s.conclusionModel);
  (s.conclusionParts || []).forEach((p) => { h += speakableLine(p, 'fr16'); });
  h += '</div>';
  return h;
}
function viewEoPosters() {
  let h = '<p class="muted">제목은 가려 두었어요. 키워드를 보고 말해 본 뒤 “제목 보기”를 눌러 확인하세요.</p>';
  DATA.eo.posters.forEach((p) => {
    const reveal = !!ui.posterReveal[p.no];
    const done = !!state.posterDone[p.no];
    h += '<div class="card"><div class="row spread"><span class="badge teal">' + esc(p.theme) + ' · ' + p.no + '/40</span>' + (done ? '<span class="small">마침 ✓</span>' : '') + '</div>' +
      '<img class="poster" src="' + esc(p.image) + '" alt="포스터 ' + p.no + '">' +
      '<p style="margin:10px 0 4px">' + (p.keywords || []).map((k) => '<span class="chip kw">' + esc(k) + '</span>').join('') + '</p>';
    if (reveal) h += speakableLine(p.titleFr);
    else h += '<button class="btn ghost" data-poster-reveal="' + p.no + '">제목 보기</button>';
    h += ' <button class="btn ' + (done ? 'ghost' : '') + ' small" data-poster-done="' + p.no + '">' + (done ? '연습 마침 ✓' : '연습 마쳤어요') + '</button></div>';
  });
  return h;
}

/* ================= views: 단어 ================= */
function stateBtns(fr) {
  const cur = state.wordStates[fr];
  return '<div class="state-btns">' + WORD_STATES.map((label, i) =>
    '<button class="state-btn' + (cur === i ? ' on' + i : '') + '" data-wordstate="' + esc(fr) + '|' + i + '">' + label + '</button>'
  ).join('') + '</div>';
}
function viewWordsHome() {
  const sub = ui.wordSub;
  let h = '<div><h2 class="page-title">단어</h2>' +
    '<p class="lead" style="margin-bottom:16px">프랑스어를 보고 뜻을 떠올린 뒤 눌러서 확인하고, 지금 느낌대로 상태를 남겨 두세요.</p></div>' +
    '<div class="seg">' +
    [['core', '핵심 단어 24'], ['covocab', 'CO 어휘 184'], ['mine', '내 단어'], ['idioms', '관용표현 305'], ['sujet', 'Sujet 137']].map(([k, label]) =>
      '<button data-wordsub="' + k + '" class="' + (sub === k ? 'on' : '') + '">' + label + '</button>').join('') + '</div>';
  if (sub === 'core') h += wordsFlash(DATA.refs.vocabCore, 'core');
  else if (sub === 'covocab') h += coVocabView();
  else if (sub === 'mine') h += myWordsView();
  else if (sub === 'idioms') h += idiomsView();
  else if (sub === 'sujet') h += sujetView();
  return h;
}
function wordsFlash(list, prefix) {
  const key = 'flash' + prefix;
  const idx = Math.min(ui[key] || 0, list.length - 1);
  const w = list[idx];
  if (!w) return '<p class="muted">단어가 없어요.</p>';
  const fr = Array.isArray(w) ? w[0] : w.fr;
  const kr = Array.isArray(w) ? w[1] : w.kr;
  const face = ui.flashFace[prefix + idx] ? 'back' : 'front';
  let h = '<div class="card flip-card"><div class="row spread"><span class="muted small">' + (idx + 1) + ' / ' + list.length + '</span>' + speakBtn(fr) + '</div>' +
    '<div class="fr-big fr" style="margin-top:10px">' + esc(fr) + '</div>';
  if (face === 'front') {
    h += '<div style="margin-top:12px"><button class="btn ghost" data-flip="' + esc(prefix + idx) + '">뜻 보기</button></div>';
  } else {
    h += '<p style="font-size:19px;margin:8px 0 0">' + esc(kr) + '</p>';
    if (w.ex) { h += '<div class="row" style="align-items:flex-start;margin-top:10px"><span class="fr16" style="flex:1">' + esc(w.ex) + '</span>' + speakBtn(w.ex) + '</div>'; if (w.exKr) h += '<p class="muted" style="margin:2px 0 0">' + esc(w.exKr) + '</p>'; }
    h += stateBtns(fr);
  }
  h += '<div class="row" style="margin-top:14px"><button class="btn ghost small" data-flashnav="' + esc(prefix) + '|' + key + '|-1|' + list.length + '">← 이전</button>' +
    '<button class="btn ghost small" data-flashnav="' + esc(prefix) + '|' + key + '|1|' + list.length + '">다음 →</button></div></div>';
  return h;
}
function coVocabView() {
  const secs = DATA.co.vocab;
  const si = Math.min(ui.coVocabSection || 0, secs.length - 1);
  let h = '<div class="seg">' + secs.map((s, i) => '<button data-covocabsec="' + i + '" class="' + (si === i ? 'on' : '') + '">' + esc(s.section) + ' (' + s.words.length + ')</button>').join('') + '</div>';
  h += wordsFlash(secs[si].words, 'co' + si);
  return h;
}
function myWordsView() {
  if (!state.myWords.length) return '<div class="card"><p class="muted">아직 저장한 단어가 없어요. 문항을 풀고 단어 옆의 “+ 추가”를 눌러 보세요. 낯선 단어를 표시하면 여기에 함께 모여요.</p></div>';
  let h = '<div class="card">';
  state.myWords.forEach((w) => {
    h += '<div class="wordrow"><span class="frw">' + esc(w.fr) + '</span>' + speakBtn(w.fr) + '<span class="muted krw">' + esc(w.kr || '') + '</span></div>' + stateBtns(w.fr);
  });
  h += '</div>';
  // also surface words marked with the first state anywhere
  return h;
}
function idiomsView() {
  const q = (ui.idiomQuery || '').toLowerCase();
  const list = DATA.refs.idioms.filter((it) => !q || it.fr.toLowerCase().includes(q) || (it.kr || '').includes(q));
  let h = '<input type="text" id="idiomSearch" placeholder="관용표현 검색 (프랑스어 · 뜻)" value="' + esc(ui.idiomQuery || '') + '">' +
    '<p class="muted small">' + list.length + '개 표시 중 (전체 ' + DATA.refs.idioms.length + '개)</p><div class="card">';
  list.slice(0, 400).forEach((it, i) => {
    const key = 'idiom' + i + it.fr;
    const open = !!ui.idiomOpen[key];
    h += '<div class="list-row"><div class="row"><span class="fr16" style="flex:1"><b>' + esc(it.fr) + '</b> — ' + esc(it.kr || '') + '</span>' + speakBtn(it.fr) + '</div>' +
      (it.ex ? '<button class="linkish" data-idiom="' + esc(key) + '">' + (open ? '예문 숨기기' : '예문 보기') + '</button>' + (open ? '<p class="fr16" style="margin:4px 0">' + esc(it.ex) + '</p>' + speakBtn(it.ex) + (it.exKr ? '<p class="muted" style="margin:2px 0">' + esc(it.exKr) + '</p>' : '') : '') : '') +
      '</div>';
  });
  h += '</div>';
  return h;
}
function sujetView() {
  const f = ui.sujetFilter || '전체';
  const list = DATA.refs.sujet.filter((s) => f === '전체' || s.type === f);
  let h = '<div class="seg">' + ['전체', 'EE', 'EO'].map((t) => '<button data-sujetfilter="' + t + '" class="' + (f === t ? 'on' : '') + '">' + t + '</button>').join('') + '</div>' +
    '<p class="muted small">' + list.length + '개</p><div class="card">';
  list.forEach((s) => {
    h += '<div class="list-row"><span class="badge teal">' + esc(s.type) + '</span> <b>' + esc(s.subject || '') + '</b> <span class="muted small">' + esc(s.topic || '') + '</span>' +
      '<div class="row" style="align-items:flex-start;margin-top:4px"><span class="fr16" style="flex:1">' + esc(s.promptFr || '') + '</span>' + (s.promptFr ? speakBtn(s.promptFr) : '') + '</div></div>';
  });
  h += '</div>';
  return h;
}

/* ================= render + events ================= */
function render() {
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === route.tab));
  document.getElementById('backBtn').classList.toggle('hidden', navStack.length === 0 && route.view !== 'calendar');
  let html = '';
  try {
    if (route.view === 'home') html = viewHome();
    else if (route.view === 'calendar') html = viewCalendar();
    else if (route.view === 'ceList') html = viewCeList();
    else if (route.view === 'ceStrategies') html = viewCeStrategies();
    else if (route.view === 'setItems') html = viewSetItems(route.param.mod, route.param.set);
    else if (route.view === 'ceItem') html = viewCeItem(route.param);
    else if (route.view === 'coHome') html = viewCoHome();
    else if (route.view === 'coItem') html = viewCoItem(route.param);
    else if (route.view === 'exprHome') html = viewExprHome();
    else if (route.view === 'eeModel') html = viewEeModel();
    else if (route.view === 'eeStrategies') html = viewEeStrategies();
    else if (route.view === 'eeDrill') html = viewEeDrill(route.param);
    else if (route.view === 'eoScript') html = viewEoScript();
    else if (route.view === 'eoPosters') html = viewEoPosters();
    else if (route.view === 'wordsHome') html = viewWordsHome();
    else html = viewHome();
  } catch (e) {
    html = '<div class="card"><p>화면을 그리는 중 문제가 생겼어요: ' + esc(e.message) + '</p></div>';
  }
  appEl().innerHTML = html;
  // returning to a set list: bring the just-solved item into view
  if (route.view === 'setItems' && state.lastItem && route.param && state.lastItem.set === route.param.set) {
    const rowEl = appEl().querySelector('[data-rowitem="' + state.lastItem.id + '"]');
    if (rowEl) requestAnimationFrame(() => { rowEl.scrollIntoView({ block: 'center', behavior: 'smooth' }); });
  }
  const search = document.getElementById('idiomSearch');
  if (search) search.addEventListener('input', (ev) => { ui.idiomQuery = ev.target.value; const pos = ev.target.selectionStart; render(); const s2 = document.getElementById('idiomSearch'); if (s2) { s2.focus(); s2.setSelectionRange(pos, pos); } });
}
function openItem(id, mod, nopush) {
  const item = findItem(id);
  if (!item) return;
  if (attemptPlays[id] == null) attemptPlays[id] = 0;
  if (mod === '읽기') go('ce', 'ceItem', item, !nopush);
  else go('co', 'coItem', item, !nopush);
}
document.addEventListener('pointerdown', (ev) => {
  const b = ev.target.closest('[data-play]');
  if (b) { const item = findItem(b.dataset.play); if (item) warmBlob(item); }
});
document.addEventListener('click', (ev) => {
  // A drag that ends in a text selection is not a tap: acting on it would
  // rebuild the screen (render) and wipe the selection — and on an answer
  // row it would even record an answer the learner never meant to pick.
  const sel = window.getSelection ? window.getSelection() : null;
  if (sel && !sel.isCollapsed && sel.toString().trim() !== '') return;
  const t = ev.target.closest('[data-speak],[data-answer],[data-openitem],[data-go],[data-setlist],[data-goset],[data-pinset],[data-unpin],[data-optko],[data-sent],[data-dchunk],[data-addword],[data-play],[data-repeat],[data-retry],[data-dict-check],[data-stype-check],[data-shadow],[data-drill],[data-chunk],[data-chunk-reset],[data-chunk-check],[data-swap],[data-retype-check],[data-stepdone],[data-eointro],[data-eocheck],[data-poster-reveal],[data-poster-done],[data-wordsub],[data-wordstate],[data-flip],[data-flashnav],[data-covocabsec],[data-idiom],[data-sujetfilter],[data-calnav],[data-calday]');
  // bottom nav + back handled separately below
  if (ev.target.closest('.nav-btn')) { setTab(ev.target.closest('.nav-btn').dataset.tab); return; }
  if (ev.target.closest('#backBtn')) { if (navStack.length) history.back(); else back(); return; }
  if (!t) {
    const st = ev.target.closest('[data-shadow-text]');
    if (st) { const key = st.dataset.shadowText; if ((ui.shadowMode[key] || '') === 'hide') { ui.shadowMode[key] = 'full'; render(); } }
    return;
  }
  if (t.dataset.speak != null && t.hasAttribute('data-speak')) { speak(t.dataset.speak); return; }
  if (t.dataset.go) { const [tab, view] = t.dataset.go.split('|'); go(tab, view, null); return; }
  if (t.dataset.goset) { const [mod, set] = t.dataset.goset.split('|'); const items = mod === '읽기' ? ceBySet(set) : coBySet(set); const it = items.find((i) => !isDone(i.id)); if (it) openItem(it.id, mod); else go(mod === '읽기' ? 'ce' : 'co', 'setItems', { mod, set }); return; }
  if (t.dataset.pinset) { const [mod, set] = t.dataset.pinset.split('|'); state.pin = { mod, set }; save(); render(); return; }
  if (t.dataset.unpin) { state.pin = null; save(); render(); return; }
  if (t.dataset.setlist) { const [mod, set] = t.dataset.setlist.split('|'); go(mod === '읽기' ? 'ce' : 'co', 'setItems', { mod, set }, !t.dataset.nopush); return; }
  if (t.dataset.openitem) { openItem(t.dataset.openitem, t.dataset.mod, !!t.dataset.nopush); return; }
  if (t.dataset.answer) {
    const item = findItem(t.dataset.answer);
    if (!item) return;
    answerItem(item, Number(t.dataset.choice));
    render(); return;
  }
  if (t.dataset.optko) { ui.optKoOpen[t.dataset.optko] = !ui.optKoOpen[t.dataset.optko]; render(); return; }
  if (t.dataset.sent) { ui.sentOpen[t.dataset.sent] = !ui.sentOpen[t.dataset.sent]; render(); return; }
  if (t.dataset.dchunk) { ui.dcOpen[t.dataset.dchunk] = !ui.dcOpen[t.dataset.dchunk]; render(); return; }
  if (t.dataset.addword) { addMyWord(t.dataset.addword, t.dataset.addwordkr || ''); render(); return; }
  if (t.dataset.play) { const item = findItem(t.dataset.play); if (item) playItemAudio(item, t); return; }
  if (t.dataset.repeat) { const item = findItem(t.dataset.repeat); if (item) toggleRepeat(item); return; }
  if (t.dataset.retry) { const item = findItem(t.dataset.retry); if (item) { blobCache.delete(item.audio); render(); const b = document.querySelector('[data-play="' + CSS.escape(item.id) + '"]'); if (b) playItemAudio(item, b); } return; }
  if (t.dataset.dictCheck) {
    const key = t.dataset.dictCheck;
    const input = document.querySelector('[data-dict-input="' + CSS.escape(key) + '"]');
    ui.dictInput[key] = input ? input.value : '';
    ui.dictResult[key] = wordDiff(t.dataset.target, ui.dictInput[key]);
    render(); return;
  }
  if (t.dataset.stypeCheck) {
    const key = t.dataset.stypeCheck;
    const input = document.querySelector('[data-stype-input="' + CSS.escape(key) + '"]');
    ui.sentInput[key] = input ? input.value : '';
    ui.sentResult[key] = judgeSentence(t.dataset.target, ui.sentInput[key]);
    // Update in place: a full render() would collapse the 문장 타이핑 <details>
    // and jump the page back to the top while the user is mid-practice.
    const out = document.querySelector('[data-stype-result="' + CSS.escape(key) + '"]');
    if (out) out.innerHTML = sentResultHtml(ui.sentResult[key]);
    return;
  }
  if (t.dataset.shadow) { const [key, mode] = t.dataset.shadow.split('|'); ui.shadowMode[key] = mode; render(); return; }
  if (t.dataset.drill) { go('expr', 'eeDrill', Number(t.dataset.drill)); return; }
  if (t.dataset.chunk) { const [key, ci] = t.dataset.chunk.split('|'); ui.drillSel[key] = ui.drillSel[key] || []; if (!ui.drillSel[key].includes(Number(ci))) ui.drillSel[key].push(Number(ci)); render(); return; }
  if (t.dataset.chunkReset) { ui.drillSel[t.dataset.chunkReset] = []; render(); return; }
  if (t.dataset.chunkCheck) {
    const key = t.dataset.chunkCheck;
    const no = Number(key.replace('ee', ''));
    const prep = DATA.ee.prep.find((p) => p.no === no);
    const chunks = splitChunks(drillTarget(prep));
    const picked = (ui.drillSel[key] || []).map((i) => chunks[i]).join(' ');
    const msg = document.querySelector('[data-chunk-msg="' + CSS.escape(key) + '"]');
    const good = normWs(picked) === normWs(drillTarget(prep)) && (ui.drillSel[key] || []).length === chunks.length;
    if (msg) msg.textContent = good ? ' 맞았어요 ✓' : ' 여기서 갈렸어요 — 순서를 다시 확인해 보세요.';
    if (good) { if (!state.drill['ee' + no]) state.drill['ee' + no] = {}; state.drill['ee' + no].step2 = true; save(); }
    return;
  }
  if (t.dataset.swap) {
    const [key] = t.dataset.swap.split('|');
    const msg = document.querySelector('[data-swap-msg="' + CSS.escape(key) + '"]');
    const good = t.dataset.val === t.dataset.correct;
    if (msg) msg.textContent = good ? ' 맞았어요 ✓' : ' 여기서 갈렸어요 — 정답 조각: ' + t.dataset.correct;
    if (good) { const no = Number(key.replace('ee', '')); if (!state.drill['ee' + no]) state.drill['ee' + no] = {}; state.drill['ee' + no].step3 = true; save(); }
    return;
  }
  if (t.dataset.retypeCheck) {
    const key = t.dataset.retypeCheck;
    const input = document.querySelector('[data-retype="' + CSS.escape(key) + '"]');
    ui.dictInput[key] = input ? input.value : '';
    const d = wordDiff(t.dataset.target, ui.dictInput[key]);
    const out = document.querySelector('[data-retype-out="' + CSS.escape(key) + '"]');
    const hints = d.firstBad.slice(0, 2);
    if (out) out.innerHTML = '<p class="fr16" style="margin-top:8px">' + renderDiff(d) + '</p>' +
      (hints.length ? '<p class="muted small">힌트: 먼저 이 부분을 확인해 보세요 — ' + hints.map(esc).join(' · ') + '</p>' : '<p class="small">맞았어요 ✓</p>');
    if (d.score >= 0.9) { const no = Number(t.dataset.drillno); if (!state.drill['ee' + no]) state.drill['ee' + no] = {}; state.drill['ee' + no].step4 = true; save(); }
    return;
  }
  if (t.dataset.stepdone) {
    const [kind, no, step] = t.dataset.stepdone.split('|');
    const k = kind + no;
    if (!state.drill[k]) state.drill[k] = {};
    state.drill[k]['step' + step] = !state.drill[k]['step' + step];
    save(); render(); return;
  }
  if (t.dataset.eointro) { const [pi, oi] = t.dataset.eointro.split('|'); ui.eoIntroSel[Number(pi)] = Number(oi); render(); return; }
  if (t.dataset.eocheck) { const k = t.dataset.eocheck; state.eoCheck[k] = !state.eoCheck[k]; save(); render(); return; }
  if (t.dataset.posterReveal) { ui.posterReveal[Number(t.dataset.posterReveal)] = true; render(); return; }
  if (t.dataset.posterDone) { const n = Number(t.dataset.posterDone); if (state.posterDone[n]) delete state.posterDone[n]; else state.posterDone[n] = true; save(); render(); return; }
  if (t.dataset.wordsub) { ui.wordSub = t.dataset.wordsub; render(); return; }
  if (t.dataset.wordstate) {
    const [fr, v] = t.dataset.wordstate.split('|');
    state.wordStates[fr] = Number(v);
    if (Number(v) === 0) { /* first state keeps the word in the personal list */
      const src = findWordKr(fr);
      if (src != null && !state.myWords.some((m) => m.fr === fr)) state.myWords.push({ fr, kr: src });
    }
    save(); render(); return;
  }
  if (t.dataset.flip != null && t.hasAttribute('data-flip')) { ui.flashFace[t.dataset.flip] = !ui.flashFace[t.dataset.flip]; render(); return; }
  if (t.dataset.flashnav) {
    const [prefix, key, delta, total] = t.dataset.flashnav.split('|');
    ui[key] = ((ui[key] || 0) + Number(delta) + Number(total)) % Number(total);
    render(); return;
  }
  if (t.dataset.covocabsec) { ui.coVocabSection = Number(t.dataset.covocabsec); render(); return; }
  if (t.dataset.idiom) { ui.idiomOpen[t.dataset.idiom] = !ui.idiomOpen[t.dataset.idiom]; render(); return; }
  if (t.dataset.sujetfilter) { ui.sujetFilter = t.dataset.sujetfilter; render(); return; }
  if (t.dataset.calnav) {
    const base = ui.calCursor ? new Date(ui.calCursor) : new Date();
    base.setMonth(base.getMonth() + Number(t.dataset.calnav));
    ui.calCursor = base.getFullYear() + '-' + (base.getMonth() + 1) + '-1';
    render(); return;
  }
  if (t.dataset.calday) { ui.calSel = t.dataset.calday; render(); return; }
});
function findWordKr(fr) {
  for (const s of DATA.co.vocab) for (const w of s.words) if (w[0] === fr) return w[1];
  for (const w of DATA.refs.vocabCore) if (w.fr === fr) return w.kr;
  const m = state.myWords.find((x) => x.fr === fr); return m ? m.kr : null;
}

/* ================= boot ================= */
async function boot() {
  const files = { ce: 'data/ce.json', co: 'data/co.json', ee: 'data/ee.json', eo: 'data/eo.json', refs: 'data/refs.json', optionKo: 'data/option_ko.json', sentKo: 'data/sent_ko.json', chunks: 'data/chunks.json', tts: 'data/tts.json' };
  const entries = await Promise.all(Object.entries(files).map(async ([k, path]) => {
    const r = await fetch(path);
    if (!r.ok) throw new Error(path + ' ' + r.status);
    return [k, await r.json()];
  }));
  DATA = Object.fromEntries(entries);
  try {
    if (location.hash.startsWith('#pin=')) {
      const [mod, set] = decodeURIComponent(location.hash.slice(5)).split('|');
      const items = mod === '읽기' ? ceBySet(set) : coBySet(set);
      if ((mod === '읽기' || mod === '듣기') && items.length) { state.pin = { mod, set }; save(); }
      history.replaceState({ tef: 1 }, '', location.pathname + location.search);
    }
  } catch (e) {}
  try { history.replaceState({ tef: 1 }, ''); } catch (e) {}
  pushHist();
  render();
}
boot().catch((e) => { appEl().innerHTML = '<div class="card"><p>자료를 불러오지 못했어요: ' + esc(e.message) + '</p><button class="btn" onclick="location.reload()">다시 불러오기</button></div>'; });
