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

// 塾の枠つきの週（日〜土）：月水金60、火＝朝30＋英語90、木＝朝30＋国語・数学90、土日180
function juku() {
  return [
    [{ minutes: 180, subjects: [] }],
    [{ minutes: 60, subjects: [] }],
    [{ minutes: 30, subjects: [] }, { minutes: 90, subjects: ['英語'] }],
    [{ minutes: 60, subjects: [] }],
    [{ minutes: 30, subjects: [] }, { minutes: 90, subjects: ['国語', '数学'] }],
    [{ minutes: 60, subjects: [] }],
    [{ minutes: 180, subjects: [] }],
  ];
}

function plan(o) {
  return Object.assign(
    {
      id: 'plan-test',
      name: 't',
      startDate: '2026-10-26',
      testDate: '2026-11-24',
      items: [],
      focus: [],
      week: juku(),
      restDay: null,
      exceptions: [],
      margin: 0.8,
      firstAccuracy: 0.6,
    },
    o
  );
}

function item(subject, materialId, label, unit, amount, laps) {
  return { materialId, subject, label, unit, amount, laps };
}

function sumCap(days) {
  return days.reduce((a, d) => a + d.capacity, 0);
}

function rec(o) {
  const r = sampleRecord({ id: o.id, date: o.date, subject: o.subject, totalMinutes: o.minutes });
  r.materials = o.materials.map(([id, value, unit]) => ({ id, label: 'x', amount: { value, unit } }));
  r.accuracy = o.level ? { level: o.level, label: 'x' } : null;
  return r;
}

test('使える時間：塾を含み780分の週は、余裕2割で624分、日曜を予備日にすると480分', () => {
  const week = { startDate: '2026-10-26', testDate: '2026-11-02' }; // 月〜日の7日
  near(sumCap(ctx.planDays(plan(week))), 624);
  near(sumCap(ctx.planDays(plan(Object.assign({ restDay: 0 }, week)))), 480);
});

test('使えない日・少ない日：0分の日は容量0、45分の日は36分（余裕2割）', () => {
  const days = ctx.planDays(plan({ exceptions: [{ date: '2026-10-27', minutes: 0 }, { date: '2026-10-28', minutes: 45 }] }));
  near(days.find((d) => d.date === '2026-10-27').capacity, 0);
  near(days.find((d) => d.date === '2026-10-28').capacity, 36);
});

test('必要な量：ワーク170ページ・3周・正答率60%・6分/ページ。単語は周ごとに時間が半分', () => {
  const laps = ctx.buildLaps(item('理科', 'm-sc-work', 'ワーク', 'ページ', 170, 3), 6, 0.6);
  near(laps[0].amount, 170);
  near(laps[0].minutes, 1020);
  near(laps[1].amount, 68);
  near(laps[1].minutes, 68 * 6 * 1.2);
  near(laps[2].amount, 27.2);
  assert.deepStrictEqual(plain(laps.map((l) => l.phase)), [1, 2, 3]);
  const words = ctx.buildLaps(item('英語', 'm-en-word', '単語', '語', 100, 3), 0.5, 0.6);
  assert.deepStrictEqual(plain(words.map((l) => [l.amount, l.minutes])), [[100, 50], [100, 25], [100, 12.5]]);
  const terms = ctx.buildLaps(item('社会', 'm-so-term', '用語暗記', '語', 100, 5), 0.5, 0.6);
  assert.deepStrictEqual(plain(terms.map((l) => l.phase)), [1, 2, 2, 2, 3]);
});

test('期の区切り：1周目はテスト7日前まで、解き直しは3日前まで、仕上げは前日まで。開始が遅ければ次の期に回す', () => {
  const r = ctx.phaseRanges(plan({}));
  assert.deepStrictEqual(plain([r.ranges[1].to, r.ranges[2].from, r.ranges[2].to, r.ranges[3].from, r.ranges[3].to]), ['2026-11-17', '2026-11-18', '2026-11-21', '2026-11-22', '2026-11-23']);
  const late = ctx.phaseRanges(plan({ startDate: '2026-11-19' }));
  assert.ok(late.ranges[1].empty);
  assert.strictEqual(late.target[1], 2);
});

test('割り振り：塾の枠には指定の教科しか入らない。量は予定の合計と一致する', () => {
  const p = plan({ items: [item('理科', 'm-sc-work', 'ワーク', 'ページ', 60, 1), item('英語', 'm-en-work', 'ワーク', 'ページ', 30, 1)] });
  const r = ctx.computePlan(p, [], '2026-10-26');
  assert.ok(r.feasible);
  r.schedule
    .filter((d) => d.weekday === 2)
    .forEach((d) => {
      const sci = d.entries.filter((e) => e.item === 0).reduce((a, e) => a + e.minutes, 0);
      assert.ok(sci <= 30 * 0.8 + 1e-6, `火曜の理科は朝の枠（24分）まで：${sci}`);
    });
  const sciAmount = r.schedule.reduce((a, d) => a + d.entries.filter((e) => e.item === 0).reduce((x, e) => x + e.amount, 0), 0);
  near(sciAmount, 60);
  r.schedule.forEach((d) => assert.ok(d.minutes <= d.capacity + 1e-6, `${d.date} は容量を超えない`));
});

test('実行できるか：時間が足りないと feasible=false になり、周回を減らす・土日を増やす・予備日を使う候補が出る（重点教科は削る候補にしない）', () => {
  const p = plan({
    startDate: '2026-11-02',
    restDay: 0,
    focus: ['理科'],
    items: [item('理科', 'm-sc-work', 'ワーク', 'ページ', 300, 3), item('社会', 'm-so-work', 'ワーク', 'ページ', 300, 3)],
  });
  const r = ctx.computePlan(p, [], '2026-11-02');
  assert.strictEqual(r.feasible, false);
  const types = r.suggestions.map((s) => s.type);
  assert.ok(types.includes('laps') && types.includes('weekend') && types.includes('rest'), types.join(','));
  r.suggestions.filter((s) => s.type === 'laps').forEach((s) => assert.strictEqual(r.items[s.item].subject, '社会'));
});

test('重点教科：足りないときは重点の教科に多く配る', () => {
  const base = { startDate: '2026-11-18', items: [item('理科', 'm-sc-work', 'ワーク', 'ページ', 200, 1), item('社会', 'm-so-work', 'ワーク', 'ページ', 200, 1)] };
  const share = (r, i) => r.schedule.reduce((a, d) => a + d.entries.filter((e) => e.item === i).reduce((x, e) => x + e.minutes, 0), 0);
  const even = ctx.computePlan(plan(base), [], '2026-11-18');
  near(share(even, 0), share(even, 1), '重点なしは同じ');
  const focus = ctx.computePlan(plan(Object.assign({ focus: ['理科'] }, base)), [], '2026-11-18');
  assert.ok(share(focus, 0) > share(focus, 1) * 1.4);
});

test('ペース：量の項目が1つの記録の中央値。3件未満・量が2つの記録は使わず既定値', () => {
  const recs = [
    rec({ id: 'a', date: '2026-10-20', subject: '理科', minutes: 50, materials: [['m-sc-work', 5, 'ページ']] }),
    rec({ id: 'b', date: '2026-10-21', subject: '理科', minutes: 30, materials: [['m-sc-work', 5, 'ページ']] }),
    rec({ id: 'c', date: '2026-10-22', subject: '理科', minutes: 90, materials: [['m-sc-work', 5, 'ページ'], ['m-sc-redo', 5, '問題']] }),
  ];
  const two = ctx.estimatePace(recs, 'm-sc-work', 'ページ');
  assert.deepStrictEqual(plain(two), { pace: 6, samples: 2, estimated: false });
  recs.push(rec({ id: 'd', date: '2026-10-23', subject: '理科', minutes: 70, materials: [['m-sc-work', 5, 'ページ']] }));
  assert.deepStrictEqual(plain(ctx.estimatePace(recs, 'm-sc-work', 'ページ')), { pace: 10, samples: 3, estimated: true });
});

test('正答率：開始日以降の記録が3件以上あればその平均、少なければ見込みの値', () => {
  const p = plan({});
  const recs = [3, 4, 5].map((level, i) => rec({ id: 'r' + i, date: '2026-10-27', subject: '理科', minutes: 30, level, materials: [['m-sc-work', 1, 'ページ']] }));
  near(ctx.estimateAccuracy(p, recs.slice(0, 2), '理科'), 0.6);
  near(ctx.estimateAccuracy(p, recs, '理科'), (0.6 + 0.75 + 0.9) / 3);
});

test('進捗：同じ教材の量を1周目→2周目の順に埋める。今週の目標とやった量が出る', () => {
  const p = plan({ items: [item('理科', 'm-sc-work', 'ワーク', 'ページ', 50, 3)] });
  const recs = [
    rec({ id: 'x', date: '2026-10-26', subject: '理科', minutes: 60, materials: [['m-sc-work', 40, 'ページ']] }),
    rec({ id: 'y', date: '2026-10-28', subject: '理科', minutes: 30, materials: [['m-sc-work', 15, 'ページ']] }),
  ];
  const r = ctx.computePlan(p, recs, '2026-10-28');
  const laps = r.progress.perItem[0].laps;
  near(laps[0].done, 50);
  near(laps[1].done, 5);
  const week = ctx.weekTargets(r, '2026-10-26');
  near(week[0].done, 55);
  assert.ok(week[0].amount > 0);
});

test('遅れ：実績÷計画が0.85未満の日が2日続いたときだけ「遅れ」', () => {
  const mk = (a1, a2) => ({ today: '2026-10-30', progress: { cumulative: [{ date: '2026-10-28', planned: 100, actual: a2 }, { date: '2026-10-29', planned: 100, actual: a1 }] } });
  assert.strictEqual(ctx.detectLag(mk(80, 80)).behind, true);
  assert.strictEqual(ctx.detectLag(mk(80, 90)).behind, false);
  assert.strictEqual(ctx.detectLag(mk(90, 80)).behind, false);
});

test('締切：1周目を早く終えれば、解き直しを前倒しで進める（解き直しを4日間に詰め込まない）', () => {
  const p = plan({ startDate: '2026-10-06', restDay: 0, items: [item('理科', 'm-sc-work', 'ワーク', 'ページ', 60, 3), item('社会', 'm-so-term', '用語暗記', '語', 100, 5)] });
  const r = ctx.computePlan(p, [], '2026-10-06');
  assert.ok(r.feasible);
  const lap2Early = r.schedule.filter((d) => d.date <= r.deadlines[1]).some((d) => d.entries.some((e) => e.lap === 2));
  assert.ok(lap2Early, '1周目の締切より前に2周目が入る');
  // 塾の枠（英語・国数だけ）がない曜日で比べる
  const ratios = r.schedule.filter((d) => [1, 3, 5, 6].includes(d.weekday)).map((d) => d.minutes / d.capacity);
  assert.ok(Math.max(...ratios) - Math.min(...ratios) < 0.05, '毎日の負荷の割合がそろう');
});

test('再配分：遅れたら今日から組み直す。1日の量は元の予定の2割増しまで、複数の日に分ける。入らない分は「入りきらない」', () => {
  const p = plan({ restDay: 0, items: [item('理科', 'm-sc-work', 'ワーク', 'ページ', 60, 3)] });
  const r = ctx.computePlan(p, [], '2026-11-04'); // 記録なし＝遅れ
  assert.strictEqual(r.lag.behind, true);
  const future = r.schedule.filter((d) => d.date >= '2026-11-04' && d.minutes > 0);
  assert.ok(future.length >= 5, '複数の日に分ける');
  future.filter((d) => !d.rest).forEach((d) => assert.ok(d.minutes <= d.base * 1.2 + 1e-6, `${d.date}：${d.minutes} ≤ ${d.base * 1.2}`));
  const remaining = r.tasks.reduce((a, t) => a + t.minutes, 0);
  near(r.lag.placed + r.lag.unplaced, remaining, '残りの作業');
  assert.ok(r.lag.usedRest && r.lag.unplaced < 0.5, '2割増しで足りない分は予備日に入る');
  future.filter((d) => !d.rest && d.date < '2026-11-23').forEach((d) => near(d.minutes, d.base * 1.2, `${d.date} は2割増しまで使ってから予備日へ`));

  const late = ctx.computePlan(p, [], '2026-11-16');
  assert.ok(late.lag.unplaced > 0, '予備日を使っても入らない分は「入りきらない」');

  const recs = [rec({ id: 'z', date: '2026-10-26', subject: '理科', minutes: 30, materials: [['m-sc-work', 60, 'ページ']] })];
  const ok = ctx.computePlan(p, recs, '2026-11-04');
  assert.strictEqual(ok.lag.behind, false, '進んでいれば組み直さない');
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
