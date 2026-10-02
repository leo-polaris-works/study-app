// 学習計画の逆算（plan.js）のテスト。実行：node app/tests/plan.test.js
// 通信はしない。日付は固定し、個人情報は入れない。

const assert = require('assert');
const { FakeGitHub, makeDevice, sampleRecord } = require('./harness');

const tests = [];
const plain = (x) => JSON.parse(JSON.stringify(x));
function test(name, fn) {
  tests.push({ name, fn });
}
function near(actual, expected, msg) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${msg || ''} ${actual} ≠ ${expected}`);
}

const dev = makeDevice(new FakeGitHub(), 'iPad');
const ctx = dev.ctx;

function plan(o) {
  const base = { id: 'plan-test', name: 't', startDate: '2026-09-10', testDate: '2026-12-10', items: [], firstAccuracy: 0.6 };
  const p = Object.assign(base, o);
  if (!p.months) p.months = ctx.defaultPlanMonths(p.startDate, p.testDate);
  return p;
}

function item(subject, materialId, label, unit, amount, laps, lapMarks) {
  return { materialId, subject, label, unit, amount, laps, lapMarks: lapMarks || [] };
}

function rec(o) {
  const r = sampleRecord({ id: o.id, date: o.date, subject: o.subject, totalMinutes: o.minutes });
  r.materials = o.materials.map(([id, value, unit]) => ({ id, label: 'x', amount: { value, unit } }));
  r.accuracy = o.level ? { level: o.level, label: 'x' } : null;
  return r;
}

function monthSum(r, itemIndex, month) {
  return r.schedule.filter((d) => d.month === month).reduce((a, d) => a + d.entries.filter((e) => e.item === itemIndex).reduce((x, e) => x + e.amount, 0), 0);
}

test('対象の月：9/10〜12/10 なら 9月（21日）・10月・11月・12月（9日。テスト前日まで）', () => {
  const months = plain(ctx.planMonths('2026-09-10', '2026-12-10'));
  assert.deepStrictEqual(months.map((m) => [m.month, m.days]), [['2026-09', 21], ['2026-10', 31], ['2026-11', 30], ['2026-12', 9]]);
  assert.strictEqual(months[3].to, '2026-12-09');
});

test('割合の初期値：合計100で、テストに近い月ほど1日あたりが多い', () => {
  const months = ctx.planMonths('2026-09-10', '2026-12-10');
  const pct = plain(ctx.defaultMonthPercents(months));
  assert.deepStrictEqual(pct, [10, 30, 43, 17]);
  const perDay = pct.map((x, i) => x / months[i].days);
  perDay.slice(1).forEach((v, i) => assert.ok(v > perDay[i], '1日あたりは増えていく'));
});

test('必要な量：ワーク40ページ・3周・正答率60%なら 40→16→6.4。単語は毎周全部で時間が半分', () => {
  const laps = ctx.buildLaps(item('理科', 'm-sc-work', 'ワーク', 'ページ', 40, 3), 6, 0.6);
  assert.deepStrictEqual(plain(laps.map((l) => Math.round(l.amount * 10) / 10)), [40, 16, 6.4]);
  near(laps[1].perUnit, 7.2);
  const words = ctx.buildLaps(item('英語', 'm-en-word', '単語', '語', 100, 3), 0.5, 0.6);
  assert.deepStrictEqual(plain(words.map((l) => [l.amount, l.perUnit])), [[100, 0.5], [100, 0.25], [100, 0.125]]);
});

test('周回のチェック：1周目を終わったにして×の数（10）を入れると、2周目は10・3周目は4になる', () => {
  const laps = ctx.buildLaps(item('理科', 'm-sc-work', 'ワーク', 'ページ', 40, 3, [{ lap: 1, date: '2026-10-05', nextAmount: 10 }]), 6, 0.6);
  assert.deepStrictEqual(plain(laps.map((l) => Math.round(l.amount * 10) / 10)), [40, 10, 4]);
  assert.strictEqual(laps[0].marked, true);
});

test('按分：月ごとの割合どおりに日に分ける（10・30・43・17%）', () => {
  const p = plan({ items: [item('理科', 'm-sc-work', 'ワーク', 'ページ', 100, 1)] });
  const r = ctx.computePlan(p, [], '2026-09-01');
  near(monthSum(r, 0, '2026-09'), 10);
  near(monthSum(r, 0, '2026-10'), 30);
  near(monthSum(r, 0, '2026-11'), 43);
  near(monthSum(r, 0, '2026-12'), 17);
  const week = ctx.weekTargets(r, '2026-10-05');
  near(week[0].amount, (30 / 31) * 7);
});

test('周回の順：全体の前から1周目、2周目…の順に予定が入る', () => {
  const p = plan({ items: [item('理科', 'm-sc-work', 'ワーク', 'ページ', 40, 3)] });
  const r = ctx.computePlan(p, [], '2026-09-01');
  const lapOn = (date) => r.schedule.find((d) => d.date === date).entries.map((e) => e.lap);
  assert.deepStrictEqual(plain(lapOn('2026-09-15')), [1]);
  assert.deepStrictEqual(plain(lapOn('2026-12-08')), [3]);
});

test('遅れ：昨日までの予定に届いていなければ「遅れ」。遅れはその月の残りの日に均等に分け、次の月は割合どおり', () => {
  const p = plan({ items: [item('理科', 'm-sc-work', 'ワーク', 'ページ', 100, 1)] });
  const r = ctx.computePlan(p, [], '2026-10-11');
  assert.strictEqual(r.behind.length, 1);
  near(r.behind[0].deficit, 10 + (30 * 10) / 31);
  const rest = r.schedule.filter((d) => d.date >= '2026-10-11' && d.month === '2026-10');
  near(rest.reduce((a, d) => a + d.entries[0].amount, 0), 40, '9・10月の予定40ページを今月中に');
  near(rest[0].entries[0].amount, rest[20].entries[0].amount, '均等');
  near(monthSum(r, 0, '2026-11'), 43);
});

test('進んでいれば遅れにならず、今月の残りは減る（0未満にはしない）', () => {
  const p = plan({ items: [item('理科', 'm-sc-work', 'ワーク', 'ページ', 100, 1)] });
  const recs = [rec({ id: 'a', date: '2026-10-01', subject: '理科', minutes: 60, materials: [['m-sc-work', 50, 'ページ']] })];
  const r = ctx.computePlan(p, recs, '2026-10-11');
  assert.strictEqual(r.behind.length, 0);
  near(r.schedule.filter((d) => d.date >= '2026-10-11' && d.month === '2026-10').reduce((a, d) => a + d.minutes, 0), 0);
});

test('進み具合：チェックしていない周は量を順に埋める。チェックした周は済みにし、その後の記録を次の周に入れる', () => {
  const recs = [
    rec({ id: 'a', date: '2026-10-03', subject: '理科', minutes: 60, materials: [['m-sc-work', 30, 'ページ']] }),
    rec({ id: 'b', date: '2026-10-06', subject: '理科', minutes: 30, materials: [['m-sc-work', 15, 'ページ']] }),
  ];
  const free = ctx.computePlan(plan({ items: [item('理科', 'm-sc-work', 'ワーク', 'ページ', 40, 3)] }), recs, '2026-10-10');
  assert.deepStrictEqual(plain(free.items[0].lapsNow.map((l) => Math.round(l.done))), [40, 5, 0]);
  const marked = ctx.computePlan(plan({ items: [item('理科', 'm-sc-work', 'ワーク', 'ページ', 40, 3, [{ lap: 1, date: '2026-10-04', nextAmount: 12 }])] }), recs, '2026-10-10');
  assert.deepStrictEqual(plain(marked.items[0].lapsNow.map((l) => Math.round(l.done))), [40, 12, 3]);
});

test('目安の日：割合が後ろに寄りすぎて1周目がテスト7日前に終わらないときは知らせる', () => {
  const p = plan({ startDate: '2026-10-01', testDate: '2026-11-24', firstAccuracy: 0.9, months: [{ month: '2026-10', percent: 0 }, { month: '2026-11', percent: 100 }], items: [item('理科', 'm-sc-work', 'ワーク', 'ページ', 40, 2)] });
  const r = ctx.computePlan(p, [], '2026-10-01');
  assert.strictEqual(r.warnings.length, 1);
  assert.strictEqual(r.warnings[0].lap, 1);
  assert.ok(r.warnings[0].finish > r.warnings[0].deadline);
  const ok = ctx.computePlan(plan({ items: [item('理科', 'm-sc-work', 'ワーク', 'ページ', 40, 3)] }), [], '2026-09-10');
  assert.strictEqual(ok.warnings.length, 0, '初期値の割合なら間に合う');
});

test('ペース：量の項目が1つの記録の中央値。3件未満・量が2つの記録は使わず既定値', () => {
  const recs = [
    rec({ id: 'a', date: '2026-10-20', subject: '理科', minutes: 50, materials: [['m-sc-work', 5, 'ページ']] }),
    rec({ id: 'b', date: '2026-10-21', subject: '理科', minutes: 30, materials: [['m-sc-work', 5, 'ページ']] }),
    rec({ id: 'c', date: '2026-10-22', subject: '理科', minutes: 90, materials: [['m-sc-work', 5, 'ページ'], ['m-sc-redo', 5, '問題']] }),
  ];
  assert.deepStrictEqual(plain(ctx.estimatePace(recs, 'm-sc-work', 'ページ')), { pace: 6, samples: 2, estimated: false });
  recs.push(rec({ id: 'd', date: '2026-10-23', subject: '理科', minutes: 70, materials: [['m-sc-work', 5, 'ページ']] }));
  assert.deepStrictEqual(plain(ctx.estimatePace(recs, 'm-sc-work', 'ページ')), { pace: 10, samples: 3, estimated: true });
});

test('正答率：開始日以降の記録が3件以上あればその平均、少なければ見込みの値', () => {
  const p = plan({});
  const recs = [3, 4, 5].map((level, i) => rec({ id: 'r' + i, date: '2026-10-27', subject: '理科', minutes: 30, level, materials: [['m-sc-work', 1, 'ページ']] }));
  near(ctx.estimateAccuracy(p, recs.slice(0, 2), '理科'), 0.6);
  near(ctx.estimateAccuracy(p, recs, '理科'), (0.6 + 0.75 + 0.9) / 3);
});

test('週ごとの目安時間：予定の量×1単位の時間の合計', () => {
  const r = ctx.computePlan(plan({ items: [item('理科', 'm-sc-work', 'ワーク', 'ページ', 100, 1)] }), [], '2026-09-01');
  const weeks = ctx.weeklyMinutes(r);
  near(weeks.reduce((a, w) => a + w.minutes, 0), 100 * 6);
  assert.strictEqual(weeks[0].start, '2026-09-07');
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
