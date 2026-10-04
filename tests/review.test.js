// 振り返りの集計（review.js）のテスト。実行：node app/tests/review.test.js
// 通信はしない。日付は固定し、個人情報は入れない。

const assert = require('assert');
const { FakeGitHub, makeDevice, sampleRecord } = require('./harness');

const tests = [];
const plain = (x) => JSON.parse(JSON.stringify(x));
function test(name, fn) {
  tests.push({ name, fn });
}

const ctx = makeDevice(new FakeGitHub(), 'iPad').ctx;
const WEEK = '2026-10-05'; // 月曜
const SUN = '2026-10-11';

let seq = 0;
function rec(o) {
  const minutes = o.minutes || 30;
  const r = sampleRecord({ id: 'r' + seq++, date: o.date, subject: o.subject || '数学', totalMinutes: minutes, issues: (o.issues || []).map(([id, label]) => ({ id, label })) });
  r.fields = [{ id: o.field || 'f-ma-calc', label: o.fieldLabel || '計算', minutes }];
  r.materials = (o.materials || []).map(([id, label, value, unit]) => ({ id, label, amount: { value, unit } }));
  r.accuracy = o.level ? { level: o.level, label: 'x' } : null;
  if (o.morning) r.timeBand = { id: 'tb-morning', label: '朝' };
  if (o.resolvedAt) r.unclear = { text: 'x', resolvedAt: o.resolvedAt };
  return r;
}

// 1か月だけの計画（10/1〜10/30 に均等。1日10ページ）
function monthPlan(o) {
  return Object.assign(
    {
      id: 'plan-t',
      name: 't',
      startDate: '2026-10-01',
      testDate: '2026-10-31',
      items: [{ materialId: 'm-sc-work', subject: '理科', label: 'ワーク', unit: 'ページ', amount: 300, laps: 1, lapMarks: [] }],
      months: [{ month: '2026-10', percent: 100 }],
      firstAccuracy: 0.6,
      deleted: false,
    },
    o
  );
}

function workDone(pages) {
  return rec({ date: '2026-10-02', subject: '理科', materials: [['m-sc-work', 'ワーク', pages, 'ページ']] });
}

const kinds = (list) => plain(list.map((x) => x.kind));

test('週のまとめ：7マス（未来の日は別）・時間・朝の日数・教材の量（単位ごと）・「わかった」の数', () => {
  const recs = [
    rec({ date: '2026-10-05', minutes: 30, morning: true, materials: [['m-en-word', '単語', 20, '語']] }),
    rec({ date: '2026-10-05', minutes: 20, materials: [['m-en-word', '単語', 10, '語']] }),
    rec({ date: '2026-10-07', minutes: 40, materials: [['m-ma-redo', '解き直し', 6, '問題']] }),
    rec({ date: '2026-10-04', minutes: 90 }), // 先週
    rec({ date: '2026-09-20', resolvedAt: '2026-10-06' }), // 前の記録でも、今週「わかった」にしたら数える
  ];
  const s = ctx.summarizeWeek(recs, WEEK, '2026-10-08');
  assert.deepStrictEqual(plain(s.days.map((d) => d.studied)), [true, false, true, false, false, false, false]);
  assert.deepStrictEqual(plain(s.days.map((d) => d.future)), [false, false, false, false, true, true, true]);
  assert.strictEqual(s.totalMinutes, 90);
  assert.strictEqual(s.prevTotalMinutes, 90);
  assert.strictEqual(s.dayCount, 2);
  assert.strictEqual(s.morningDays, 1);
  assert.strictEqual(s.resolved, 1);
  assert.deepStrictEqual(plain(s.materials.find((m) => m.id === 'm-en-word')), { id: 'm-en-word', subject: '数学', label: '単語', unit: '語', value: 30 });
});

test('曜日ごと：その日の記録（時間帯の順）と合計。時間帯の行はマスタの順。課題は回数と教科でまとめる', () => {
  const night = rec({ date: '2026-10-05', subject: '数学', minutes: 40, issues: [['i-again', 'また間違えた']] });
  const morning = rec({ date: '2026-10-05', subject: '英語', minutes: 15, morning: true });
  const other = rec({ date: '2026-10-07', subject: '理科', minutes: 30, issues: [['i-again', 'また間違えた'], ['i-sleepy', '眠い・疲れた']] });
  other.timeBand = { id: 'tb-u1', label: '塾' }; // マスタにない時間帯
  const s = ctx.summarizeWeek([night, morning, other, rec({ date: '2026-10-08', subject: '数学', issues: [['i-again', 'また間違えた']] })], WEEK, SUN);
  assert.deepStrictEqual(plain(s.days[0].records.map((r) => r.subject)), ['英語', '数学'], '朝が先、夜が後');
  assert.deepStrictEqual(plain(s.days.map((d) => d.minutes)), [55, 0, 30, 30, 0, 0, 0]);
  assert.deepStrictEqual(plain(s.bands.map((b) => b.label)), ['朝', '午前', '午後', '夕方', '夜', '塾']);
  assert.deepStrictEqual(plain(s.issues), {
    items: [
      { id: 'i-again', label: 'また間違えた', n: 3, subjects: ['数学', '理科'] },
      { id: 'i-sleepy', label: '眠い・疲れた', n: 1, subjects: ['理科'] },
    ],
    none: 1,
  });
});

test('できたこと：優先順に最大3つ。ふえた時間は15分から。何もなければ日数', () => {
  const recs = [
    rec({ date: '2026-09-28', subject: '英語', minutes: 30 }),
    rec({ date: '2026-10-05', subject: '英語', minutes: 45, morning: true, materials: [['m-en-word', '単語', 60, '語']] }),
    rec({ date: '2026-10-06', subject: '英語', minutes: 10, materials: [['m-en-redo', '解き直し', 12, '問題']] }),
  ];
  const s = ctx.summarizeWeek(recs, WEEK, SUN);
  assert.deepStrictEqual(plain(ctx.praiseLines(s, null)), ['先週より英語が25分ふえた', '解き直しを12問やった', '朝に1日勉強した']);

  const progress = { targets: [{ subject: '理科', label: 'ワーク', unit: 'ページ', goal: 18, done: 18 }] };
  assert.strictEqual(ctx.praiseLines(s, progress)[0], '理科 ワーク、今週の目標18ページに届いた');

  const s2 = ctx.summarizeWeek([rec({ date: '2026-09-28', subject: '英語', minutes: 30 }), rec({ date: '2026-10-05', subject: '英語', minutes: 44 })], WEEK, SUN);
  assert.deepStrictEqual(plain(ctx.praiseLines(s2, null)), ['1日、記録した'], '14分の増えは出さない');
  assert.deepStrictEqual(plain(ctx.praiseLines(ctx.summarizeWeek([], WEEK, SUN), null)), []);
});

test('その週の計画：週にかかる計画のうち、テストが近いもの', () => {
  const plans = [
    monthPlan({ id: 'plan-a', testDate: '2026-11-20' }),
    monthPlan({ id: 'plan-b', testDate: '2026-10-20' }),
    monthPlan({ id: 'plan-c', startDate: '2026-10-12', testDate: '2026-10-15' }), // 週の後に始まる
    monthPlan({ id: 'plan-d', testDate: '2026-10-05' }), // 週の初日がテスト日＝終わっている
    monthPlan({ id: 'plan-e', testDate: '2026-10-08', deleted: true }),
  ];
  assert.strictEqual(ctx.planForWeek(plans, WEEK).id, 'plan-b');
  assert.strictEqual(ctx.planForWeek([], WEEK), null);
});

test('計画の遅れ：やった量÷予定が0.6未満は大きな遅れ（優先1）、0.6〜0.85は軽い遅れ（優先4）、0.85以上は出ない', () => {
  const plan = monthPlan();
  // 今日 10/11 → 昨日までの予定は 10日×10ページ＝100ページ
  const at = (pages) => ctx.planProgress(plan, [workDone(pages)], WEEK, SUN);
  const big = ctx.detectInsights([workDone(59)], WEEK, SUN, at(59));
  assert.deepStrictEqual(kinds(big), ['lag']);
  assert.strictEqual(big[0].priority, 1);
  assert.ok(/理科 ワーク：予定まであと41ページ。1日\d+ページで今月中に追いつけます/.test(big[0].text), big[0].text);
  assert.strictEqual(ctx.detectInsights([workDone(60)], WEEK, SUN, at(60))[0].priority, 4);
  assert.strictEqual(at(84).behind.length, 1);
  assert.strictEqual(at(85).behind.length, 0);
  assert.strictEqual(at(120).ahead.length, 1, '1.2倍以上は進んでいる');
  assert.ok(at(120).adjust.some((x) => /かなり進んで/.test(x)));
});

test('計画の進み：今週の目標とやった量。過去の週は「1日○で追いつける」を出さない', () => {
  const plan = monthPlan();
  const recs = [workDone(40), rec({ date: '2026-10-06', subject: '理科', materials: [['m-sc-work', 'ワーク', 12, 'ページ']] })];
  const p = ctx.planProgress(plan, recs, WEEK, SUN);
  assert.strictEqual(p.targets.length, 1);
  assert.strictEqual(p.targets[0].done, 12);
  assert.strictEqual(p.daysLeft, 20);
  const past = ctx.planProgress(plan, [workDone(10)], '2026-09-28', SUN);
  const lag = ctx.detectInsights([workDone(10)], '2026-09-28', SUN, past);
  assert.ok(lag.every((x) => !/追いつけます/.test(x.text)));
});

test('計画の見直しの目安：先週末と今の両方で大きな遅れなら出る', () => {
  const plan = monthPlan();
  const p = ctx.planProgress(plan, [workDone(10)], WEEK, SUN);
  assert.ok(p.adjust.some((x) => /2週続けて大きく/.test(x)), plain(p.adjust));
  const p2 = ctx.planProgress(plan, [workDone(40), rec({ date: '2026-10-05', subject: '理科', materials: [['m-sc-work', 'ワーク', 15, 'ページ']] })], WEEK, SUN);
  assert.ok(!p2.adjust.some((x) => /2週続けて/.test(x)), '先週末は遅れていない（40/40）');
});

test('つまずき①正答率：3回以上で、半分以上が〜50%以下', () => {
  const r = (level) => rec({ date: '2026-10-06', level, minutes: 20 }); // 空回り（60分）にはかからない
  assert.deepStrictEqual(kinds(ctx.detectInsights([r(2), r(1), r(4)], WEEK, SUN, null)), ['accuracy']);
  assert.ok(/数学：正答率50%以下の回が2回（3回中）/.test(ctx.detectInsights([r(2), r(1), r(4)], WEEK, SUN, null)[0].text));
  assert.deepStrictEqual(kinds(ctx.detectInsights([r(2), r(4), r(4)], WEEK, SUN, null)), []);
  assert.deepStrictEqual(kinds(ctx.detectInsights([r(2), r(2), rec({ date: '2026-10-06', minutes: 10 })], WEEK, SUN, null)), [], '正答率のある回が2回だけ');
});

test('つまずき②空回り：同じ分野に60分以上、正答率の平均が〜50%以下（2件以上）', () => {
  const r = (minutes, level) => rec({ date: '2026-10-06', subject: '理科', field: 'f-sc-chem', fieldLabel: '化学', minutes, level });
  const hit = ctx.detectInsights([r(30, 2), r(30, 2), rec({ date: '2026-10-07', subject: '国語' })], WEEK, SUN, null);
  assert.deepStrictEqual(kinds(hit), ['spin']);
  assert.ok(/理科 化学に1時間/.test(hit[0].text));
  assert.deepStrictEqual(kinds(ctx.detectInsights([r(30, 2), r(29, 2), rec({ date: '2026-10-07', subject: '国語' })], WEEK, SUN, null)), []);
});

test('つまずき③同じ課題が3回：わからなかった→ノートへ、やり方・復習→思い出す、体調→教科をまたいで', () => {
  const r = (subject, id, label) => rec({ date: '2026-10-06', subject, issues: [[id, label]] });
  const again = [1, 2, 3].map(() => r('数学', 'i-again', 'また間違えた'));
  const x = ctx.detectInsights(again, WEEK, SUN, null);
  assert.deepStrictEqual(kinds(x), ['review']);
  assert.ok(/数学：「また間違えた」が3回/.test(x[0].text));
  assert.deepStrictEqual(kinds(ctx.detectInsights(again.slice(0, 2).concat([rec({ date: '2026-10-06' })]), WEEK, SUN, null)), []);

  const unclear = ctx.detectInsights([1, 2, 3].map(() => r('理科', 'i-nounder', 'そもそも分からない')), WEEK, SUN, null);
  assert.strictEqual(unclear[0].kind, 'unclear');
  assert.strictEqual(unclear[0].link, 'note');

  const sleepy = ctx.detectInsights([r('数学', 'i-sleepy', '眠い・疲れた'), r('英語', 'i-sleepy', '眠い・疲れた'), r('理科', 'i-sleepy', '眠い・疲れた')], WEEK, SUN, null);
  assert.deepStrictEqual(kinds(sleepy), ['condition']);
});

test('教科の抜け：直近14日に5件以上あって0件の教科。14日より前の記録は数えない', () => {
  const days = ['2026-09-28', '2026-10-01', '2026-10-05', '2026-10-06', '2026-10-07'];
  const five = days.map((date, i) => rec({ date, subject: ['国語', '数学', '英語', '理科', '数学'][i] }));
  const x = ctx.detectInsights(five, WEEK, SUN, null);
  assert.deepStrictEqual(plain(x.map((i) => i.subject)), ['社会']);
  assert.ok(/社会：この2週間、記録がありません/.test(x[0].text));
  assert.deepStrictEqual(kinds(ctx.detectInsights(five.slice(1), WEEK, SUN, null)), [], '4件では出さない');
  const old = [rec({ date: '2026-09-27', subject: '国語' })].concat(five.slice(1));
  assert.deepStrictEqual(kinds(ctx.detectInsights(old, WEEK, SUN, null)), [], '9/27 は14日の外');
});

test('量の減少：週が終わってから、先週120分以上で今週がその半分未満', () => {
  const recs = [
    rec({ date: '2026-09-29', subject: '数学', minutes: 60 }),
    rec({ date: '2026-09-30', subject: '英語', minutes: 60 }),
    rec({ date: '2026-10-01', subject: '理科', minutes: 40 }),
    rec({ date: '2026-10-06', subject: '数学', minutes: 30 }),
    rec({ date: '2026-10-07', subject: '英語', minutes: 30 }),
  ];
  const sunday = ctx.detectInsights(recs, WEEK, SUN, null);
  assert.ok(sunday.some((x) => x.kind === 'drop' && /今週は1時間（先週は2時間40分）/.test(x.text)));
  assert.ok(!ctx.detectInsights(recs, WEEK, '2026-10-10', null).some((x) => x.kind === 'drop'), '土曜はまだ出さない');
  recs.push(rec({ date: '2026-10-08', subject: '理科', minutes: 20 }));
  assert.ok(!ctx.detectInsights(recs, WEEK, SUN, null).some((x) => x.kind === 'drop'), '半分（80分）以上なら出ない');
});

test('気づきは優先順に最大3つ。記録が3件未満なら計画の遅れだけ', () => {
  const plan = monthPlan();
  const r = (subject, level) => rec({ date: '2026-10-06', subject, level, issues: [['i-again', 'また間違えた']] });
  const recs = [workDone(10), r('数学', 1), r('数学', 1), r('数学', 1), r('英語', 1), r('英語', 1), r('英語', 1)];
  const x = ctx.detectInsights(recs, WEEK, SUN, ctx.planProgress(plan, recs, WEEK, SUN));
  assert.strictEqual(x.length, 3);
  assert.deepStrictEqual(kinds(x), ['lag', 'accuracy', 'accuracy']);

  const few = [workDone(10), rec({ date: '2026-10-06', level: 1 })];
  assert.deepStrictEqual(kinds(ctx.detectInsights(few, WEEK, SUN, ctx.planProgress(plan, few, WEEK, SUN))), ['lag']);
});

test('がんばること：決めた1つは、変えるまで次の週にも続く。取り消すと、その週から「決めていない」になる', () => {
  const review = (weekStart, change, deleted) => ({ id: ctx.reviewIdOf(weekStart), weekStart, change, deleted: !!deleted });
  const fixed = { id: 'c-daily', label: '毎日、ワークを少しでも進める' };
  const free = { id: 'c-free', label: '自分で書く', text: '塾の前に理科を1ページ' };
  const at = (list, week) => plain(ctx.changeInEffect(list, week));
  assert.strictEqual(at([], WEEK), null);
  // WEEK＝10/5 の週。9/21 の週に決めたものが、変えるまで続く
  const list = [review(WEEK, free), review('2026-09-21', fixed)];
  assert.strictEqual(at(list, '2026-09-14'), null, '決める前の週');
  assert.deepStrictEqual(at(list, '2026-09-21'), fixed);
  assert.deepStrictEqual(at(list, '2026-09-28'), fixed, '変えていない週にも続く');
  assert.deepStrictEqual(at(list, WEEK), free);
  assert.deepStrictEqual(at(list, '2026-11-02'), free);
  assert.strictEqual(ctx.changeText(fixed), fixed.label);
  assert.strictEqual(ctx.changeText(free), free.text);
  // 取り消した週（change＝null）からは出さない。前の週の表示は変わらない
  const cleared = [review('2026-09-21', fixed), review(WEEK, null)];
  assert.strictEqual(at(cleared, WEEK), null);
  assert.strictEqual(at(cleared, '2026-10-12'), null);
  assert.deepStrictEqual(at(cleared, '2026-09-28'), fixed);
  assert.deepStrictEqual(at([review('2026-09-21', fixed), review(WEEK, free, true)], WEEK), fixed, '削除の印がついたファイルは見ない');
});

test('くわしく見る：期間の切り方（週は月曜から・月・テストまで・日）と、前後への移動', () => {
  const range = (kind, anchor, plan) => plain(ctx.detailRange(kind, anchor, plan));
  assert.deepStrictEqual(range('week', '2026-10-08'), { kind: 'week', from: WEEK, to: SUN, prev: { from: '2026-09-28', to: '2026-10-04' } });
  assert.strictEqual(range('week', SUN).from, WEEK, '日曜は、その週の月曜から');
  assert.deepStrictEqual(range('month', '2026-10-08'), { kind: 'month', from: '2026-10-01', to: '2026-10-31', prev: { from: '2026-09-01', to: '2026-09-30' } });
  assert.deepStrictEqual(range('month', '2027-01-15').prev, { from: '2026-12-01', to: '2026-12-31' });
  assert.strictEqual(range('month', '2028-02-10').to, '2028-02-29');
  assert.deepStrictEqual(range('day', '2026-10-08'), { kind: 'day', from: '2026-10-08', to: '2026-10-08', prev: null });
  assert.deepStrictEqual(range('test', '2026-10-08', monthPlan()), { kind: 'test', from: '2026-10-01', to: '2026-10-31', prev: null }, '計画の開始日〜テスト日');

  const move = (kind, anchor, dir) => ctx.shiftDetailAnchor(ctx.detailRange(kind, anchor), dir);
  assert.strictEqual(move('day', '2026-10-01', -1), '2026-09-30');
  assert.strictEqual(move('week', '2026-10-08', 1), '2026-10-12');
  assert.strictEqual(move('week', '2026-10-08', -1), '2026-09-28');
  assert.strictEqual(move('month', '2026-10-31', 1), '2026-11-01');
  assert.strictEqual(move('month', '2026-03-31', -1), '2026-02-01');
});

test('くわしく見る：推移グラフの棒は、週＝日ごと7本、月・テストまで＝週ごと（月曜はじまり。期間の端で切る）', () => {
  const recs = [
    rec({ date: '2026-09-30', minutes: 99 }), // 前の月
    rec({ date: '2026-10-01', minutes: 30 }),
    rec({ date: '2026-10-04', minutes: 20, subject: '英語' }),
    rec({ date: '2026-10-05', minutes: 40 }),
    rec({ date: '2026-10-31', minutes: 10, subject: '理科' }),
  ];
  const week = ctx.trendBuckets(recs, ctx.detailRange('week', '2026-10-01'), '2026-10-02');
  assert.deepStrictEqual(plain(week.map((b) => b.minutes)), [0, 0, 99, 30, 0, 0, 20]);
  assert.deepStrictEqual(plain(week.map((b) => b.future)), [false, false, false, false, false, true, true]);
  assert.deepStrictEqual(plain(week.map((b) => b.current)), [false, false, false, false, true, false, false]);

  const month = ctx.trendBuckets(recs, ctx.detailRange('month', '2026-10-08'), '2026-10-08');
  assert.deepStrictEqual(
    plain(month.map((b) => [b.from, b.to])),
    [
      ['2026-10-01', '2026-10-04'],
      ['2026-10-05', '2026-10-11'],
      ['2026-10-12', '2026-10-18'],
      ['2026-10-19', '2026-10-25'],
      ['2026-10-26', '2026-10-31'],
    ]
  );
  assert.deepStrictEqual(plain(month.map((b) => b.minutes)), [50, 40, 0, 0, 10], '前の月の記録は入らない');
  assert.strictEqual(month[0].bySubject['数学'], 30);
  assert.strictEqual(month[0].bySubject['英語'], 20);
  assert.deepStrictEqual(plain(month.map((b) => b.current)), [false, true, false, false, false]);
  assert.deepStrictEqual(plain(month.map((b) => b.future)), [false, false, true, true, true]);

  const plan = monthPlan({ startDate: '2026-09-30', testDate: '2026-10-07' });
  const toTest = ctx.trendBuckets(recs, ctx.detailRange('test', null, plan), '2026-10-08');
  assert.deepStrictEqual(plain(toTest.map((b) => [b.from, b.to, b.minutes])), [
    ['2026-09-30', '2026-10-04', 149],
    ['2026-10-05', '2026-10-07', 40],
  ]);
});

test('くわしく見る（教科）：時間・記録数・正答率の目安（まん中の段階）と、やったことの内訳', () => {
  const recs = [
    rec({ date: '2026-10-05', minutes: 30, level: 2 }),
    rec({ date: '2026-10-06', minutes: 20, level: 4 }),
    rec({ date: '2026-10-07', minutes: 10, level: 3 }),
    rec({ date: '2026-10-07', minutes: 15 }), // 正答率を測っていない
    Object.assign(rec({ date: '2026-10-07', minutes: 40, subject: '英語', level: 5 }), { activity: { id: 'a-test', label: 'テスト対策' }, accuracy: { level: 5, label: 'ほぼ全問' } }),
  ];
  const rows = plain(ctx.detailBySubject(recs));
  assert.deepStrictEqual(rows.map((x) => x.subject), ['国語', '数学', '英語', '理科', '社会']);
  assert.deepStrictEqual(rows[1], { subject: '数学', minutes: 75, count: 4, accuracy: { level: 3, label: '〜70%' } });
  assert.deepStrictEqual(rows[2].accuracy, { level: 5, label: 'ほぼ全問' });
  assert.deepStrictEqual(rows[0], { subject: '国語', minutes: 0, count: 0, accuracy: null });
  assert.strictEqual(ctx.detailBySubject(recs.slice(0, 2))[1].accuracy.level, 2, '2回なら低いほう');
  assert.deepStrictEqual(plain(ctx.activityBreakdown(recs)), [
    { id: 'a-hw', label: '宿題・提出物', minutes: 75 },
    { id: 'a-test', label: 'テスト対策', minutes: 40 },
  ]);
});

test('くわしく見る（学習内容）：教科ごとに、分野ごとの時間を多い順に', () => {
  const recs = [
    rec({ date: '2026-10-05', minutes: 20 }),
    rec({ date: '2026-10-06', minutes: 50, field: 'f-ma-figure', fieldLabel: '図形' }),
    rec({ date: '2026-10-07', minutes: 15 }),
    rec({ date: '2026-10-07', minutes: 30, subject: '理科', field: 'f-sc-chem', fieldLabel: '化学' }),
  ];
  assert.deepStrictEqual(plain(ctx.detailByField(recs)), [
    {
      subject: '数学',
      minutes: 85,
      fields: [
        { id: 'f-ma-figure', label: '図形', minutes: 50 },
        { id: 'f-ma-calc', label: '計算', minutes: 35 },
      ],
    },
    { subject: '理科', minutes: 30, fields: [{ id: 'f-sc-chem', label: '化学', minutes: 30 }] },
  ]);
});

test('くわしく見る（量）：計画がなければ実績だけ（計画の欄は空）。単位が違うものは足さず、前の期間の量を添える', () => {
  const recs = [
    rec({ date: '2026-10-05', materials: [['m-ma-calc', '計算', 10, '問題'], ['m-ma-work', 'ワーク', 3, 'ページ']] }),
    rec({ date: '2026-10-06', materials: [['m-ma-calc', '計算', 5, '問題'], ['m-ma-calc', '計算', 2, 'ページ']] }),
    rec({ date: '2026-10-07', subject: '英語', materials: [['m-en-word', '単語', 30, '語'], ['m-en-other', 'その他', null, 'なし']] }),
    rec({ date: '2026-09-29', materials: [['m-ma-calc', '計算', 8, '問題']] }), // 前の週
  ];
  const a = plain(ctx.detailAmounts(recs, ctx.detailRange('week', '2026-10-08'), null, '2026-10-08'));
  assert.strictEqual(a.plan, null);
  assert.deepStrictEqual(a.groups.map((g) => g.subject), ['数学', '英語']);
  assert.deepStrictEqual(a.groups[0].items, [
    { id: 'm-ma-work', subject: '数学', label: 'ワーク', unit: 'ページ', value: 3, prev: 0 },
    { id: 'm-ma-calc', subject: '数学', label: '計算', unit: '問題', value: 15, prev: 8 },
    { id: 'm-ma-calc', subject: '数学', label: '計算', unit: 'ページ', value: 2, prev: 0 },
  ]);
  assert.deepStrictEqual(a.groups[1].items, [{ id: 'm-en-word', subject: '英語', label: '単語', unit: '語', value: 30, prev: 0 }], '量のない項目（その他）は出さない');
  assert.ok(a.groups.every((g) => g.items.every((x) => !('goal' in x) && !('laps' in x))));

  // 月は前の月と比べる。日は比べない
  const month = ctx.detailAmounts(recs, ctx.detailRange('month', '2026-10-08'), null, '2026-10-08');
  assert.strictEqual(month.groups[0].items.find((x) => x.unit === '問題').prev, 8);
  const day = ctx.detailAmounts(recs, ctx.detailRange('day', '2026-10-05'), null, '2026-10-08');
  assert.ok(day.groups[0].items.every((x) => x.prev === null));
});

test('くわしく見る（量）：計画があれば、予定とやった量を並べる（週は今週のまとめと同じ予定。月は月末までの予定）。計画にない教材は実績だけ', () => {
  const recs = [
    rec({ date: '2026-10-02', subject: '理科', materials: [['m-sc-work', 'ワーク', 10, 'ページ']] }),
    rec({ date: '2026-10-05', subject: '理科', materials: [['m-sc-work', 'ワーク', 25, 'ページ'], ['m-sc-redo', '解き直し', 6, '問題']] }),
  ];
  const plan = monthPlan();
  const week = ctx.detailRange('week', '2026-10-08');
  // 過ぎた週：1日10ページ×7日
  const past = plain(ctx.detailAmounts(recs, week, plan, '2026-10-12'));
  assert.strictEqual(past.plan.id, plan.id);
  assert.deepStrictEqual(past.groups, [
    {
      subject: '理科',
      items: [
        { subject: '理科', id: 'm-sc-work', label: 'ワーク', unit: 'ページ', value: 25, goal: 70 },
        { id: 'm-sc-redo', subject: '理科', label: '解き直し', unit: '問題', value: 6, prev: 0 },
      ],
    },
  ]);
  // 今週：今週のまとめの「今週の目標」と同じ
  const now = ctx.detailAmounts(recs, week, plan, '2026-10-07').groups[0].items[0];
  const target = ctx.planProgress(plan, recs, WEEK, '2026-10-07').targets[0];
  assert.deepStrictEqual([now.goal, now.value], [target.goal, target.done]);

  // 月：2か月の計画（9月50%・10月50%、300ページ）。9月に100ページ → 10月の予定は、月末までの300−100＝200
  const two = monthPlan({ startDate: '2026-09-01', months: [{ month: '2026-09', percent: 50 }, { month: '2026-10', percent: 50 }] });
  const recs2 = [
    rec({ date: '2026-09-10', subject: '理科', materials: [['m-sc-work', 'ワーク', 100, 'ページ']] }),
    rec({ date: '2026-10-05', subject: '理科', materials: [['m-sc-work', 'ワーク', 30, 'ページ']] }),
  ];
  const item = (anchor) => plain(ctx.detailAmounts(recs2, ctx.detailRange('month', anchor), two, '2026-10-12').groups[0].items[0]);
  assert.deepStrictEqual([item('2026-10-12').value, item('2026-10-12').goal], [30, 200]);
  assert.deepStrictEqual([item('2026-09-15').value, item('2026-09-15').goal], [100, 150]);
});

test('くわしく見る（量）：テストまでは、周ごとに予定とやった量を出す（「終わった」の周は済み）', () => {
  const recs = [
    rec({ date: '2026-10-02', subject: '理科', materials: [['m-sc-work', 'ワーク', 10, 'ページ']] }),
    rec({ date: '2026-10-05', subject: '理科', materials: [['m-sc-work', 'ワーク', 25, 'ページ']] }),
    rec({ date: '2026-10-08', subject: '理科', materials: [['m-sc-work', 'ワーク', 20, 'ページ']] }),
    rec({ date: '2026-10-08', subject: '数学', materials: [['m-ma-calc', '計算', 12, '問題']] }),
  ];
  const item = (lapMarks) => ({ materialId: 'm-sc-work', subject: '理科', label: 'ワーク', unit: 'ページ', amount: 300, laps: 2, lapMarks });
  const amounts = (plan) => plain(ctx.detailAmounts(recs, ctx.detailRange('test', null, plan), plan, '2026-10-12'));

  const a = amounts(monthPlan({ items: [item([])] }));
  assert.deepStrictEqual(a.groups.map((g) => g.subject), ['数学', '理科']);
  assert.deepStrictEqual(a.groups[1].items[0], {
    subject: '理科',
    id: 'm-sc-work',
    label: 'ワーク',
    unit: 'ページ',
    value: 55,
    total: 420,
    laps: [
      { lap: 1, amount: 300, done: 55, marked: false },
      { lap: 2, amount: 120, done: 0, marked: false },
    ],
  });
  assert.deepStrictEqual(a.groups[0].items, [{ id: 'm-ma-calc', subject: '数学', label: '計算', unit: '問題', value: 12, prev: null }], '計画にない教材は、やった量だけ');

  const marked = amounts(monthPlan({ items: [item([{ lap: 1, date: '2026-10-06', nextAmount: 50 }])] })).groups[1].items[0];
  assert.deepStrictEqual([marked.value, marked.total], [320, 350]);
  assert.deepStrictEqual(marked.laps, [
    { lap: 1, amount: 300, done: 300, marked: true },
    { lap: 2, amount: 50, done: 20, marked: false },
  ]);
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log('OK   ' + t.name);
    } catch (e) {
      failed++;
      console.log('NG   ' + t.name + '\n     ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join('\n     ') : e));
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} 件 OK`);
  process.exit(failed ? 1 : 0);
})();
