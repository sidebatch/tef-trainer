#!/usr/bin/env node
/* Sanity tests for TEF Trainer static site. Run: node tests/run-tests.js */
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra = '') {
  if (cond) { pass++; }
  else { fail++; failures.push(name + (extra ? ' — ' + extra : '')); }
}
function loadData(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', name), 'utf8'));
}
const norm = s => (s || '').replace(/\s+/g, ' ').trim();

// ---------- content counts ----------
const ce = loadData('ce.json'), co = loadData('co.json'), ee = loadData('ee.json'),
      eo = loadData('eo.json'), refs = loadData('refs.json'),
      optKo = loadData('option_ko.json'), sentKo = loadData('sent_ko.json'),
      ttsMap = loadData('tts.json');

ok(ce.items.length === 187, 'CE items = 187', String(ce.items.length));
ok(ce.strategies.length === 8, 'CE strategies = 8');
ok(co.items.length === 163, 'CO items = 163', String(co.items.length));
const scored = co.items.filter(i => i.scored), unscored = co.items.filter(i => !i.scored);
ok(scored.length === 156, 'CO scored = 156', String(scored.length));
ok(unscored.length === 7, 'CO unscored = 7', String(unscored.length));
ok(unscored.every(i => i.set.includes('CO-A 세트 2')), 'unscored are all CO-A 세트 2');
ok(co.items.filter(i => i.stt).length === 40, 'STT mock-B/C items = 40');
const covocabCount = co.vocab.reduce((a, s) => a + s.words.length, 0);
ok(covocabCount === 184, 'CO vocab = 184', String(covocabCount));
ok(ee.prep.length === 10, 'EE drills = 10');
ok(eo.posters.length === 40, 'EO posters = 40');
ok(refs.idioms.length === 305, 'idioms = 305');
ok(refs.sujet.length === 137, 'sujet = 137');
ok(refs.sujet.filter(s => s.type === 'EE').length === 109, 'sujet EE = 109');
ok(refs.sujet.filter(s => s.type === 'EO').length === 28, 'sujet EO = 28');
ok(refs.vocabCore.length === 24, 'vocab core = 24');

// ---------- asset references exist ----------
let missingAssets = [];
function checkAsset(p) { if (p && !fs.existsSync(path.join(ROOT, p))) missingAssets.push(p); }
for (const it of co.items) { checkAsset(it.audio); checkAsset(it.image); }
for (const p of eo.posters) checkAsset(p.image);
ok(missingAssets.length === 0, 'all referenced audio/image assets exist', missingAssets.slice(0, 5).join(', '));
const coAudioFiles = new Set();
for (const it of co.items) if (it.audio) coAudioFiles.add(it.audio);
ok(coAudioFiles.size === 121, 'distinct CO audio files = 121', String(coAudioFiles.size));

// ---------- answer validity ----------
let badAnswers = [];
for (const it of [...ce.items, ...co.items]) {
  if (it.scored === false) { if (it.answer !== null) badAnswers.push(it.id + ':unscored-with-answer'); continue; }
  if (!Number.isInteger(it.answer) || it.answer < 0 || it.answer >= it.options.length) badAnswers.push(it.id);
}
ok(badAnswers.length === 0, 'every scored item has a valid answer index', badAnswers.slice(0, 5).join(', '));

// ---------- sentence pairs ----------
let sentProblems = [];
for (const it of ce.items) {
  const pairs = sentKo[it.id];
  if (!pairs || !pairs.length) { sentProblems.push(it.id + ':no-pairs'); continue; }
  const txt = norm(it.doc);
  for (const [fr] of pairs) if (!txt.includes(norm(fr).slice(0, 25))) { sentProblems.push(it.id + ':misaligned'); break; }
}
for (const it of scored) {
  if (it.stt) {
    if (!it.sentences || !it.sentences.length) sentProblems.push(it.id + ':stt-no-sentences');
    continue;
  }
  const pairs = sentKo[it.id];
  if (!pairs || !pairs.length) { sentProblems.push(it.id + ':no-pairs'); continue; }
  const txt = norm(it.transcript);
  for (const [fr] of pairs) if (!txt.includes(norm(fr).slice(0, 25))) { sentProblems.push(it.id + ':misaligned'); break; }
}
ok(sentProblems.length === 0, 'every transcript item has aligned sentence pairs', sentProblems.slice(0, 5).join(', '));

// ---------- option translations ----------
let optProblems = [];
for (const it of [...ce.items, ...scored]) {
  if (it.options.some(o => o.includes('Dessin'))) continue;
  const e = optKo[it.id];
  if (!e) optProblems.push(it.id + ':missing');
  else if (e.length !== it.options.length) optProblems.push(it.id + ':length');
}
ok(optProblems.length === 0, 'option_ko covers all text-option items', optProblems.slice(0, 5).join(', '));

// ---------- TTS wiring ----------
const ttsEntries = Object.keys(ttsMap).length;
ok(ttsEntries >= 2600 && ttsEntries <= 3100, 'TTS manifest entries ≈ 2,750', String(ttsEntries));
let ttsMissing = [];
for (const [t, f] of Object.entries(ttsMap)) {
  if (!fs.existsSync(path.join(ROOT, 'assets/tts', f))) ttsMissing.push(f);
}
ok(ttsMissing.length === 0, 'every TTS file in manifest exists', ttsMissing.slice(0, 5).join(', '));
const ttsDirCount = fs.readdirSync(path.join(ROOT, 'assets/tts')).filter(f => f.endsWith('.mp3')).length;
ok(ttsDirCount === ttsEntries, 'assets/tts file count matches manifest', `${ttsDirCount} vs ${ttsEntries}`);
// every mock-B (dictation) sentence resolves to a TTS file (exact or normalized)
const ttsNorm = {};
for (const k of Object.keys(ttsMap)) ttsNorm[norm(k)] = true;
let dictMiss = [];
for (const it of co.items.filter(i => i.stt)) for (const s of it.sentences) {
  if (!(s.fr in ttsMap) && !ttsNorm[norm(s.fr)]) dictMiss.push(it.id);
}
ok(dictMiss.length === 0, 'all mock-B dictation sentences have TTS audio', dictMiss.slice(0, 5).join(', '));

// ---------- UI rules ----------
const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
for (const [name, src] of [['app.js', appJs], ['index.html', indexHtml], ['styles.css', css]]) {
  ok(!src.includes('앎'), `${name} contains no '앎'`);
  ok(!src.includes('모름'), `${name} contains no '모름'`);
}
for (const label of ['아직 낯설어요', '헷갈려요', '이제 익숙해요']) {
  ok(appJs.includes(label), `word-state label present: ${label}`);
}
ok(appJs.includes('tef-trainer-v1'), 'localStorage key tef-trainer-v1 used');
ok(appJs.includes('맞았어요') && appJs.includes('여기서 갈렸어요'), 'grading feedback wording present');
ok(appJs.includes('근거 자료 없음'), 'unscored badge wording present');
ok(appJs.includes('다시 불러오기'), 'audio reload affordance present');
// set-list UX: dot carries the result, row outline carries just-solved / next-up, auto-scroll
for (const s of ['방금 푼 문항', '다음 문항', 'scrollIntoView', 'data-rowitem', 'lastItem']) {
  ok(appJs.includes(s), 'set-list UX marker present: ' + s);
}
ok(!appJs.includes('badge last') && !appJs.includes('badge next') && !appJs.includes('>안 풂<') && !appJs.includes('>맞음<') && !appJs.includes('>틀림<'), 'set-list status badges removed — the dot carries the result (v26)');
ok(css.includes('.dot.bad'), 'wrong-answer dot style present (v26)');
ok(appJs.includes('pin: null') && appJs.includes('pin-card') && appJs.includes('오늘 할 공부') && appJs.includes("location.hash.startsWith('#pin=')") && appJs.includes('dataset.pinset') && appJs.includes('dataset.unpin') && appJs.includes('오늘 할 공부로 고정'), '오늘 할 공부 pin: state, home card, #pin= link, set-list toggle all wired (v27)');
ok(!appJs.includes('opt-side') && appJs.includes('opt-under') && appJs.includes('opt-trans opt-under" data-optko'), 'option layout: speaker left of the option, 해석 toggle under it, translation card taps to close (v28)');
ok(appJs.includes('hasKo && !showKo'), '해석 보기 button and translation card alternate — only one shows at a time (v29)');
ok(appJs.includes('chip-add') && css.includes('.chip-add') && !appJs.includes('내 단어에 추가'), 'word add control is a small chip (v26)');
ok(css.includes('.set-row.just-done') && css.includes('.set-row.next-up'), 'set-list highlight styles present');
ok(indexHtml.includes('manifest.webmanifest'), 'index links manifest');
ok(indexHtml.includes('serviceWorker'), 'index registers service worker');

// ---------- PWA ----------
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
ok(!!manifest.name && !!manifest.icons && manifest.icons.length >= 3, 'webmanifest has name + icons');
for (const rel of ['icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png']) {
  ok(fs.existsSync(path.join(ROOT, rel)), 'icon exists: ' + rel);
}
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
ok(sw.includes('fetch'), 'sw has fetch handler');
ok(indexHtml.includes('app.js?v=32') && indexHtml.includes('styles.css?v=32'), 'shell assets are cache-busted (?v=32) so phones pick up fixes');
ok(sw.includes("tef-trainer-v32"), 'sw cache bumped to tef-trainer-v32');
ok(appJs.includes('isCollapsed'), 'click handler ignores clicks that end a text selection (selection survives mouse-up)');
ok(appJs.includes('data-stype-result') && appJs.includes('Update in place'), 'sentence-typing check updates in place (details stays open, no scroll jump)');
ok(appJs.includes("addEventListener('popstate'") && appJs.includes('history.pushState') && appJs.includes('history.back()'), 'system back button walks in-app history instead of closing the app (v16)');
ok(indexHtml.includes('controllerchange') && indexHtml.includes('reg.update()'), 'service worker auto-update: checks on resume and reloads when a new version takes over (v17)');
ok(appJs.includes('speechSynthesis.speaking || speechSynthesis.pending') && appJs.includes('setTimeout') && !appJs.includes("new Audio('assets"), 'pronunciation: no cancel+speak in same tick (one-tap-late synth bug), shared audio element reused (v18)');
ok(appJs.includes('(버전 32)') && indexHtml.includes('app.js?v=32') && sw.includes("tef-trainer-v32"), 'version markers in sync: home label, shell query, SW cache all say 20');
ok(readme.includes('현재 버전 32') && readme.includes('](https://sidebatch.github.io/tef-trainer/)') && readme.includes('](https://muse.ai/s/tef-2-xzxs5xxpkqxwxrin)'), 'README shows current version and both app links as clickable links');
ok(appJs.includes(':stype') && appJs.includes(':task') && appJs.includes('eo:cat'), 'QA: 문장 타이핑·EE 원문·EO 카테고리 details도 열림 상태를 유지한다');
ok(appJs.includes('ui.sentInput[ta.dataset.stypeInput]'), 'QA: 문장 타이핑 입력이 입력 즉시 저장돼 render에도 지워지지 않는다');
ok(appJs.includes('function go(tab, view, param, pushStack) {\n  stopSpeak();') && appJs.includes('function back() {\n  stopSpeak();'), 'QA: 화면을 이동하면 TTS·딕테이션 반복이 정지한다');
ok(appJs.includes("querySelectorAll('audio')"), 'QA: render 전에 문항 오디오를 정지해 유령 재생을 막는다');
ok(appJs.includes("replace(/_+/g, '…')"), 'device-voice fallback turns blanks into a pause instead of spelling them out (v21)');
ok((appJs.match(/chunk-why/g) || []).length >= 1 && css.includes('.chunk-why'), 'the inline chunk view renders the why-note line under a chunk (v22, unified v25)');
ok(!appJs.includes('문서 전체 해석') && !appJs.includes('rb-sub') && !appJs.includes('바로 지문을 읽고 답을 고르는 흐름') && (appJs.match(/문장을 누르면/g) || []).length === 1, 'CE cleanup: full-translation block, banner explanation, CE lead and CE hint removed (CO hint kept) (v24)');
ok(!/addAll\(\[[^\]]*assets\/(co|tts)/.test(sw), 'sw does not precache audio');

// ---------- CE-C pilot: chunk-aligned translation (직독직해) ----------
const chunks = loadData('chunks.json');
const cecItems = ce.items.filter(i => i.set.includes('CE-C'));
ok(cecItems.length === 43, 'CE-C items = 43', String(cecItems.length));
ok(JSON.stringify(Object.keys(chunks).sort()) === JSON.stringify(ce.items.filter(i => sentKo[i.id]).map(i => i.id).sort()),
  'chunks.json covers every CE item that has sentence translations (all 187)');
let chunkProblems = [];
for (const it of ce.items) {
  const sents = chunks[it.id], pairs = sentKo[it.id];
  if (!sents) { chunkProblems.push(it.id + ':missing'); continue; }
  if (sents.length !== pairs.length) { chunkProblems.push(it.id + ':sentence-count'); continue; }
  sents.forEach((sent, si) => {
    for (const [fr, ko] of sent) {
      if (!String(fr).trim() || !String(ko).trim()) chunkProblems.push(it.id + ':empty-pair');
    }
    const joined = norm(sent.map(c => c[0]).join(' '));
    if (joined !== norm(pairs[si][0])) chunkProblems.push(it.id + ':join-mismatch:S' + si);
    if (pairs[si][0].includes('______')) {
      const holders = sent.filter(c => c[0].includes('______'));
      if (holders.length !== 1) chunkProblems.push(it.id + ':cloze-chunks:S' + si);
    }
  });
  const chunkBlanks = sents.flat().filter(c => c[0].includes('______')).length;
  const docBlanks = (it.doc.match(/______/g) || []).length;
  if (chunkBlanks !== docBlanks) chunkProblems.push(it.id + ':blank-count');
}
const whyNotes = Object.values(chunks).flatMap(s => s.flatMap(p => p)).filter(p => p.length > 2);
ok(whyNotes.length === 82 && whyNotes.every(p => typeof p[2] === 'string' && p[2].length > 0), 'why-notes on 82 chunks explain glosses that do not add up (v22)');
const mc07why = chunks['MC-07'] && chunks['MC-07'][1] && chunks['MC-07'][1][2];
ok(!!mc07why && mc07why.length > 2 && mc07why[2].includes('mobilier는'), 'MC-07 mobilier urbain carries its why-note (v22)');
const mc09why = chunks['MC-09'] && chunks['MC-09'][0] && chunks['MC-09'][0][0];
ok(!!mc09why && mc09why.length > 2 && mc09why[2].includes('prime는'), 'MC-09 prime de réparation carries its why-note (v23)');
ok(chunkProblems.length === 0, 'chunks: non-empty pairs, joins reproduce sent_ko sentences, one ______ chunk per cloze sentence',
  chunkProblems.slice(0, 5).join(', '));

// ---------- CE-C pilot: sentence typing (replaces blank-word typing) ----------
ok(!appJs.includes('문장 뜯어보기') && !appJs.includes('chunksHtml'), 'chunk details section removed — chunks live only inline in the document (v25)');
ok(appJs.includes('문장 타이핑'), 'sentence typing section present');
ok(appJs.includes('data-stype-check'), 'sentence typing check handler wired');
ok(!appJs.includes('빈칸 타이핑') && !appJs.includes('data-blank-check') && !appJs.includes('judgeBlank'),
  'blank-word typing fully removed (card, handler, judge)');
ok(appJs.includes("chunks: 'data/chunks.json'"), 'chunks.json loaded at boot');
(function sentenceTypingTests() {
  const grab = (name) => {
    const m = appJs.match(new RegExp('function ' + name + '\\b[\\s\\S]*?\\n}'));
    return m ? m[0] : '';
  };
  const names = ['normWs', 'tokenize', 'stripFrAccents', 'frLemma', 'blankHint',
    'looseNormWord', 'looseNormTokens', 'wordDiffLoose', 'judgeSentence', 'sentenceTargets'];
  const code = names.map(grab).join('\n');
  ok(code.includes('function judgeSentence') && code.includes('function sentenceTargets'),
    'sentence typing helpers extractable from app.js');
  let blankHint, judgeSentence, sentenceTargets;
  try {
    ({ blankHint, judgeSentence, sentenceTargets } = new Function('DATA', code +
      '\nreturn { blankHint, judgeSentence, sentenceTargets };')({ sentKo }));
  } catch (e) {
    ok(false, 'sentence typing helpers evaluate', String(e).slice(0, 120));
    return;
  }
  const byId = id => ce.items.find(i => i.id === id);
  // hint derivation is still used for the cloze-sentence Korean prompt
  let meaningHints = 0, leaks = [];
  for (const it of cecItems) {
    const h = blankHint(it);
    if (h.type === '뜻') meaningHints++;
    if (!h.text || h.text === it.options[it.answer]) leaks.push(it.id);
  }
  ok(meaningHints >= 38, 'cloze prompt hint: Korean meaning derived for most CE-C items', String(meaningHints) + '/43');
  ok(leaks.length === 0, 'cloze prompt hint never prints the full answer word', leaks.join(','));
  ok(blankHint(byId('MC-06')).text === '감염된', 'cloze prompt hint: contaminées → 감염된');
  // target construction: every CE-C item yields one target per sent_ko sentence,
  // no target still contains a blank, and the cloze target is the filled sentence
  let targetProblems = [];
  for (const it of cecItems) {
    const targets = sentenceTargets(it);
    if (targets.length !== sentKo[it.id].length) { targetProblems.push(it.id + ':count'); continue; }
    const ans = it.options[it.answer];
    targets.forEach((t, si) => {
      if (t.fr.includes('______')) targetProblems.push(it.id + ':unfilled:S' + si);
      if (sentKo[it.id][si][0].includes('______')) {
        if (!t.cloze) targetProblems.push(it.id + ':not-cloze:S' + si);
        if (!t.fr.includes(ans)) targetProblems.push(it.id + ':answer-not-filled:S' + si);
        if (t.ko.includes(ans)) targetProblems.push(it.id + ':answer-leaks-in-prompt:S' + si);
        if (!t.ko.includes('빈칸')) targetProblems.push(it.id + ':no-hint:S' + si);
      }
    });
  }
  ok(targetProblems.length === 0, 'sentence targets: cloze filled with answer word, prompt never leaks it',
    targetProblems.slice(0, 5).join(', '));
  const mc06targets = sentenceTargets(byId('MC-06'));
  const mc06cloze = mc06targets.find(t => t.cloze);
  ok(!!mc06cloze && mc06cloze.fr === 'En France, 50 000 personnes sont contaminées chaque année.',
    'MC-06 cloze target = filled sentence', mc06cloze ? mc06cloze.fr : 'none');
  ok(!!mc06cloze && mc06cloze.ko.endsWith('(빈칸 뜻: 감염된)'),
    'MC-06 cloze prompt appends the meaning hint', mc06cloze ? mc06cloze.ko : 'none');
  // judging: loose normalization (accents/case/punctuation do not matter)
  const ref = 'En France, 50 000 personnes sont contaminées chaque année.';
  ok(judgeSentence(ref, ref).level === 'ok', 'sentence judge: exact = 전부 맞음');
  ok(judgeSentence(ref, 'en france 50 000 personnes sont contaminees chaque annee').level === 'ok',
    'sentence judge: accents + case + punctuation ignored = 전부 맞음');
  const oneOff = judgeSentence(ref, 'En France, 50 000 personnes sont infectées chaque année.');
  ok(oneOff.level === 'almost' && oneOff.diffCount === 2,
    'sentence judge: one wrong word = 거의 맞음 (2개 단어 차이)', oneOff ? oneOff.level + '/' + oneOff.diffCount : 'null');
  ok(oneOff.diff.out.some(o => o.type === 'miss' && o.w === 'contaminées') &&
     oneOff.diff.out.some(o => o.type === 'extra' && o.w === 'infectées'),
    'sentence judge: diff marks the target word as miss and the typed word as extra');
  ok(judgeSentence(ref, 'Je ne sais pas du tout.').level === 'no', 'sentence judge: mostly wrong = 다시 보기');
  ok(judgeSentence(ref, '') === null && judgeSentence(ref, '   ') === null, 'sentence judge: empty input = no verdict');
})();

// ---------- word gloss layout: no one-character vertical column ----------
ok(appJs.includes('class="muted krw"'), 'word gloss uses the .krw span (wordRows + my words)');
ok(!appJs.includes('<span class="muted" style="flex:1">'), 'no bare flex:1 gloss span remains');
ok(css.includes('.wordrow .krw') && css.includes('min-width:110px') && css.includes('flex:1 1 140px') &&
   css.includes('word-break:keep-all'), 'gloss CSS: min-width + wrap-forcing basis + keep-all');

// ---------- audio encoding: CO files (full check) ----------
function probe(file) {
  const out = execFileSync('ffprobe', ['-v', 'quiet', '-print_format', 'json',
    '-show_streams', '-show_format', file], { encoding: 'utf8' });
  return JSON.parse(out);
}
let encProblems = [];
for (const rel of coAudioFiles) {
  const abs = path.join(ROOT, rel);
  const head = fs.readFileSync(abs).subarray(0, 3);
  if (head[0] !== 0xff || (head[1] & 0xe0) !== 0xe0) { encProblems.push(rel + ':not-mpeg-start'); continue; }
  if (head.toString('latin1').startsWith('ID3')) { encProblems.push(rel + ':id3'); continue; }
  const p = probe(abs);
  const st = p.streams[0];
  if (st.codec_name !== 'mp3') encProblems.push(rel + ':codec=' + st.codec_name);
  else if (st.sample_rate !== '44100') encProblems.push(rel + ':sr=' + st.sample_rate);
  else if (st.channels !== 2) encProblems.push(rel + ':ch=' + st.channels);
  else if (Math.abs(parseInt(p.format.bit_rate) / 1000 - 128) > 8) encProblems.push(rel + ':br=' + p.format.bit_rate);
}
ok(encProblems.length === 0, 'all 97 CO MP3s are standard MP3 (CBR128/44.1k/stereo/no ID3)', encProblems.slice(0, 5).join(', '));

// ---------- audio loudness: TTS sample ----------
function loudness(abs) {
  const r = spawnSync('ffmpeg', ['-i', abs, '-af',
    'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'],
    { encoding: 'utf8' });
  const m = (r.stderr || '').match(/"input_i"\s*:\s*"(-?[\d.]+)"/);
  return m ? parseFloat(m[1]) : null;
}
try {
  const all = Object.values(ttsMap);
  const sample = [];
  for (let i = 0; i < all.length; i += Math.floor(all.length / 12)) sample.push(all[i]);
  let loudBad = [];
  for (const f of sample.slice(0, 12)) {
    const v = loudness(path.join(ROOT, 'assets/tts', f));
    if (v === null || v < -19.5 || v > -12.5) loudBad.push(`${f}:${v}`);
  }
  ok(loudBad.length === 0, 'TTS sample loudness ≈ -16 LUFS', loudBad.join(', '));
} catch (e) {
  ok(false, 'TTS loudness sampling ran', String(e).slice(0, 120));
}

// ---------- dictation grading: punctuation must not matter ----------
(function dictationTests() {
  const src = appJs;
  const grab = (name) => {
    const m = src.match(new RegExp('function ' + name + '\\b[\\s\\S]*?\\n}'));
    return m ? m[0] : '';
  };
  const code = ['normWs', 'tokenize', 'normWord', 'normTokens', 'wordDiff'].map(grab).join('\n');
  ok(code.includes('function wordDiff'), 'dictation helpers extractable from app.js');
  let wordDiff;
  try {
    wordDiff = new Function(code + '\nreturn wordDiff;')();
  } catch (e) {
    ok(false, 'dictation helpers evaluate', String(e).slice(0, 100));
    return;
  }
  const full = (ref, input) => {
    const d = wordDiff(ref, input);
    return d.score === 1 && !d.out.some(o => o.type !== 'ok');
  };
  ok(full('Merci de votre compréhension.', 'Merci de votre compréhension'),
    'dictation: trailing period ignored = full marks');
  ok(full('Nous vous remercions de votre compréhension et vous prions de bien vouloir consulter les horaires.',
          'Nous vous remercions de votre compréhension, et vous prions de bien vouloir consulter les horaires'),
    'dictation: comma difference ignored = full marks');
  ok(full('Faites vite avant la fin des soldes !', 'Faites vite avant la fin des soldes'),
    'dictation: spaced French exclamation ignored = full marks');
  ok(full('« Travailleurs qualifiés ? » Dans quelle province immigrer ?',
          'Travailleurs qualifiés Dans quelle province immigrer'),
    'dictation: guillemets + spaced question marks ignored = full marks');
  ok(full('Bonjour, Madame; merci… à bientôt!', 'bonjour madame merci à bientôt'),
    'dictation: mixed punctuation ; … ! ignored, case ignored = full marks');
  const accent = wordDiff("L'élève est arrivé.", 'Leleve est arrive');
  ok(accent.score < 1, 'dictation: accents still matter (élève ≠ eleve)');
  const hyph = wordDiff('Appelle-moi quand tu auras un moment.', 'appelle moi quand tu auras un moment');
  ok(hyph.score === 1, 'dictation: hyphen may be written as a space (appelle-moi = appelle moi)');
  const hyph2 = wordDiff('Appelle-moi.', 'appelle-moi');
  ok(hyph2.score === 1, 'dictation: hyphen written correctly still full marks');
  const apos = wordDiff("Je parle de l'immigration.", 'je parle de l immigration');
  ok(apos.score === 1, "dictation: apostrophe may be written as a space (l'immigration = l immigration)");
  const glued = wordDiff('Appelle-moi.', 'appellemoi');
  ok(glued.score < 1, 'dictation: glued clitic still wrong (appellemoi ≠ appelle-moi)');
  const wrong = wordDiff('Le train partira voie 5.', 'Le train partira voie 9');
  ok(wrong.score < 1 && wrong.out.some(o => o.type === 'miss'), 'dictation: wrong word still caught');
  const order = wordDiff('les enfants ne doivent pas approcher les animaux', 'les animaux ne doivent pas approcher les enfants');
  ok(order.score < 1, 'dictation: word order matters');
})();

// ---------- listening player regression guards (first-tap silence, 2026-10-13) ----------
{
  const start = appJs.indexOf('function playItemAudio');
  const end = appJs.indexOf('function transcriptPairs');
  const body = appJs.slice(start, end);
  ok(start >= 0 && end > start, 'player: playItemAudio extractable');
  ok(!body.includes('await fetch') && !body.includes('await audio.play'), 'player: play() is never awaited after a download (first tap must speak)');
  ok(!body.includes('if (lim && !ans) render();\n      });'), 'player: play handler does not rebuild the screen mid-playback');
  ok(appJs.includes("addEventListener('ended'"), 'player: exam-mode lock swaps in only after playback ends');
  ok(appJs.includes('function warmBlob'), 'player: background pre-download exists');
  ok(appJs.includes("addEventListener('pointerdown'"), 'player: pre-download starts on pointerdown');
  ok(appJs.includes('dataset.counted'), 'player: pause/resume does not consume the exam play');
}

// ---------- repeat listening + text selection (2026-10-13) ----------
{
  ok(appJs.includes('data-repeat="'), 'repeat: toggle button rendered in the player');
  ok(appJs.includes('function toggleRepeat'), 'repeat: toggle handler exists');
  ok(appJs.includes('ui.repeat'), 'repeat: loop state wired into the ended handler');
  ok(appJs.includes('_repeatStart'), 'repeat: repeat starts do not consume the exam play');
  ok(css.includes('user-select:text'), 'selection: study text is selectable (copy to look up)');
  const optSlice = appJs.slice(appJs.indexOf('function optionsHtml'), appJs.indexOf('function sentencesHtml'));
  ok(!optSlice.includes("<button class=\"' + cls"), 'selection: options are divs, not buttons (long-press select works)');
  ok(!appJs.includes('<button class="sent-btn'), 'selection: passage sentences are divs, not buttons');
  ok(appJs.includes('role="button"'), 'selection: tappable text rows keep button semantics');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) { console.log('FAILURES:'); for (const f of failures) console.log('  ✗ ' + f); process.exit(1); }
