import json, re, sys, collections

def norm(s):
    s = re.sub(r'\s+', ' ', str(s)).strip()
    s = re.sub(r'\s+([.,;:!?…%»)])', r'\1', s)
    s = re.sub(r'([«(])\s+', r'\1', s)
    return s

sk = json.load(open('data/sent_ko.json'))
chunks = json.load(open('data/chunks.json'))
ce = json.load(open('data/ce.json'))
errors, warns = [], []
total_sents = 0
for it in ce['items']:
    iid = it['id']
    if iid not in sk:
        continue
    pairs = sk[iid]
    total_sents += len(pairs)
    got = chunks.get(iid)
    if got is None:
        errors.append(f'{iid}: 청크 없음')
        continue
    if len(got) != len(pairs):
        errors.append(f'{iid}: 문장 수 불일치 chunks={len(got)} sentKo={len(pairs)}')
        continue
    for i, (pair, ch) in enumerate(zip(pairs, got)):
        if not ch:
            errors.append(f'{iid}[{i}]: 빈 청크 배열')
            continue
        joined = norm(' '.join(c[0] for c in ch))
        if joined != norm(pair[0]):
            errors.append(f'{iid}[{i}]: 결합 불일치\n  원문: {norm(pair[0])[:110]}\n  결합: {joined[:110]}')
        n = len(ch)
        if n > 14:
            warns.append(f'{iid}[{i}]: 청크 {n}개 (과다)')
        for fr, ko in ch:
            if not ko.strip():
                errors.append(f'{iid}[{i}]: 한국어 뜻 비어 있음 ({fr[:30]})')
print(f'CE 문항 중 sentKo 있는 문항 검사 완료 · 전체 문장 {total_sents}')
print(f'오류 {len(errors)}건')
for e in errors[:15]:
    print('  ✗', e)
for w in warns[:5]:
    print('  !', w)
sys.exit(1 if errors else 0)
