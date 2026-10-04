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
