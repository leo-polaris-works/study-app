// 学習計画の逆算：テスト日・範囲・使える時間から、週・日の目標量を出す。画面から独立した計算だけを置く。
// 量（ページ・問題・語）を目標にし、時間は「入るか」の判定と割り振りにだけ使う。

const PD = PLAN_DEFAULTS;

function planItemKind(unit) {
  if (unit === 'ページ' || unit === '問題') return 'drill'; // 2周目以降は×だけ
  if (unit === '語' || unit === '字' || unit === '個') return 'memo'; // 毎周全部、周ごとに速くなる
  return 'repeat'; // 毎周同じ量
}

function defaultLaps(materialId, unit) {
  return PD.lapsByMaterial[materialId] || PD.laps[unit] || 1;
}

function median(list) {
  const s = list.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// 1単位あたりの分。量の項目が1つだけの記録から「合計時間÷量」の中央値。少なければ既定値
function estimatePace(records, materialId, unit) {
  const samples = [];
  records.forEach((r) => {
    if (r.deleted || !Array.isArray(r.materials) || r.materials.length !== 1) return;
    const m = r.materials[0];
    if (m.id !== materialId || !m.amount || !(m.amount.value > 0) || !(r.totalMinutes > 0)) return;
    samples.push(r.totalMinutes / m.amount.value);
  });
  const fallback = PD.pace[unit] || 1;
  if (samples.length < PD.minPaceSamples) return { pace: fallback, samples: samples.length, estimated: false };
  return { pace: median(samples), samples: samples.length, estimated: true };
}

// 教科ごとの正答率（計画の開始日以降の記録）。少なければ計画の見込み
function estimateAccuracy(plan, records, subject) {
  const rates = records
    .filter((r) => !r.deleted && r.subject === subject && r.date >= plan.startDate && r.accuracy && PD.accuracyRates[r.accuracy.level])
    .map((r) => PD.accuracyRates[r.accuracy.level]);
  if (rates.length < PD.minPaceSamples) return plan.firstAccuracy;
  return rates.reduce((a, b) => a + b, 0) / rates.length;
}

// 周回がどの期に入るか：1周目＝第1期、最後の周（3周以上のとき）＝第3期、それ以外＝第2期
function lapPhase(lap, laps) {
  if (lap === 1) return 1;
  if (lap === laps && laps >= 3) return 3;
  return 2;
}

// 教材1つの周回ごとの量と時間
function buildLaps(item, pace, accuracy) {
  const kind = planItemKind(item.unit);
  const laps = [];
  for (let r = 1; r <= item.laps; r++) {
    let amount = item.amount;
    let perUnit = pace;
    if (kind === 'drill') {
      amount = item.amount * Math.pow(1 - accuracy, r - 1);
      if (r >= 2) perUnit = pace * PD.redoFactor;
    } else if (kind === 'memo') {
      perUnit = pace * Math.pow(PD.memoDecay, r - 1);
    }
    laps.push({ lap: r, amount, perUnit, minutes: amount * perUnit, phase: lapPhase(r, item.laps) });
  }
  return laps;
}

// 期の日付の範囲。日のない期の作業は、次の（なければ前の）期に回す
function phaseRanges(plan) {
  const last = shiftDate(plan.testDate, -1);
  const p1End = shiftDate(plan.testDate, -PD.phase1Days);
  const p2End = shiftDate(plan.testDate, -PD.phase2Days);
  const later = (a, b) => (a > b ? a : b);
  const earlier = (a, b) => (a < b ? a : b);
  const raw = {
    1: { from: plan.startDate, to: earlier(p1End, last) },
    2: { from: later(plan.startDate, shiftDate(p1End, 1)), to: earlier(p2End, last) },
    3: { from: later(plan.startDate, shiftDate(p2End, 1)), to: last },
  };
  const ranges = {};
  [1, 2, 3].forEach((p) => {
    const r = raw[p];
    ranges[p] = { phase: p, from: r.from, to: r.to, empty: r.from > r.to };
  });
  const target = {};
  [1, 2, 3].forEach((p) => {
    if (!ranges[p].empty) {
      target[p] = p;
      return;
    }
    const next = [1, 2, 3].find((q) => q > p && !ranges[q].empty);
    const prev = [3, 2, 1].find((q) => q < p && !ranges[q].empty);
    target[p] = next || prev || null;
  });
  return { ranges, target };
}

// 開始日〜テスト前日の各日：使える時間の枠と、計画に使える分（余裕を引いた値）
function planDays(plan) {
  const days = [];
  if (!plan.startDate || !plan.testDate || plan.startDate >= plan.testDate) return days;
  const last = shiftDate(plan.testDate, -1);
  for (let d = plan.startDate; d <= last; d = shiftDate(d, 1)) {
    const weekday = parseDate(d).getDay();
    const ex = (plan.exceptions || []).find((e) => e.date === d);
    let slots = (plan.week[weekday] || []).map((s) => ({ minutes: s.minutes || 0, subjects: s.subjects || [] }));
    if (ex) slots = ex.minutes > 0 ? [{ minutes: ex.minutes, subjects: [] }] : [];
    const rest = plan.restDay !== null && plan.restDay !== undefined && weekday === plan.restDay;
    const raw = slots.reduce((sum, s) => sum + s.minutes, 0);
    days.push({
      date: d,
      weekday,
      rest,
      exception: ex ? ex.minutes : null,
      slots: rest ? [] : slots.map((s) => ({ cap: s.minutes * plan.margin, subjects: s.subjects })),
      rawMinutes: raw,
      capacity: rest ? 0 : raw * plan.margin,
    });
  }
  return days;
}

// 限られた時間を、重みつきで配る（各教科は必要な分まで）
function waterFill(total, demand, weights) {
  const alloc = {};
  Object.keys(demand).forEach((s) => (alloc[s] = 0));
  let left = total;
  let open = Object.keys(demand).filter((s) => demand[s] > 1e-9);
  while (left > 1e-9 && open.length) {
    const wsum = open.reduce((a, s) => a + weights[s] * demand[s], 0);
    let spent = 0;
    const still = [];
    open.forEach((s) => {
      const give = (left * weights[s] * demand[s]) / wsum;
      const room = demand[s] - alloc[s];
      if (give >= room - 1e-9) {
        alloc[s] += room;
        spent += room;
      } else {
        alloc[s] += give;
        spent += give;
        still.push(s);
      }
    });
    left -= spent;
    if (still.length === open.length) break;
    open = still;
  }
  return alloc;
}

// 期の締切（その期の作業を終える日）
function phaseDeadlines(ranges, target) {
  const out = {};
  [1, 2, 3].forEach((p) => {
    const t = target[p];
    out[p] = t ? ranges[t].to : null;
  });
  return out;
}

// 作業を締切の早い順に、1日の負荷が一定の割合（rate）になるよう日に割り振る。
// 教科が限られた枠（塾など）を先に使う。同じ締切の作業は、残りの量×重点の重みで配る
function simulateSchedule(days, tasks, rate, weights, deadlines, opts) {
  const left = tasks.map((t) => t.minutes);
  const out = days.map((d) => ({ date: d.date, entries: {}, minutes: 0 }));
  const shortage = {};
  const useRest = opts && opts.useRest;
  days.forEach((d, di) => {
    const slots = useRest && d.rest ? [{ cap: d.rawMinutes * opts.margin, subjects: [] }] : d.slots;
    slots
      .slice()
      .sort((x, y) => y.subjects.length - x.subjects.length)
      .forEach((slot) => {
        // 予備日を使うときは、通常の日を fixedRate で埋め、予備日の割合（rate）だけを探す
        const fixed = opts && opts.fixedRate !== undefined ? opts.fixedRate : rate;
        let m = slot.cap * (useRest && d.rest ? rate : fixed);
        while (m > 1e-9) {
          const ok = tasks.map((t, i) => i).filter((i) => left[i] > 1e-9 && (!slot.subjects.length || slot.subjects.includes(tasks[i].subject)));
          if (!ok.length) break;
          const phase = Math.min(...ok.map((i) => tasks[i].phase));
          const group = ok.filter((i) => tasks[i].phase === phase);
          const demand = {};
          const w = {};
          group.forEach((i) => {
            demand[i] = left[i];
            w[i] = weights[tasks[i].subject] || 1;
          });
          const alloc = waterFill(m, demand, w);
          let used = 0;
          group.forEach((i) => {
            const x = alloc[i];
            if (x <= 1e-9) return;
            left[i] -= x;
            used += x;
            const e = (out[di].entries[i] = out[di].entries[i] || 0);
            out[di].entries[i] = e + x;
            out[di].minutes += x;
          });
          if (used <= 1e-9) break;
          m -= used;
        }
      });
    [1, 2, 3].forEach((p) => {
      if (deadlines[p] === d.date) shortage[p] = tasks.reduce((a, t, i) => a + (t.phase <= p ? left[i] : 0), 0);
    });
  });
  [1, 2, 3].forEach((p) => {
    if (shortage[p] === undefined) shortage[p] = tasks.reduce((a, t, i) => a + (t.phase <= p ? left[i] : 0), 0);
  });
  return { out, shortage, left: left.reduce((a, b) => a + b, 0) };
}

function shortageTotal(sim) {
  return Math.max(sim.shortage[1], sim.shortage[2], sim.shortage[3]);
}

// 締切をすべて守れる、いちばん低い負荷の割合を探す（maxRate でも足りなければ maxRate のまま）
function levelSchedule(days, tasks, weights, deadlines, maxRate, opts) {
  const at = (r) => simulateSchedule(days, tasks, r, weights, deadlines, opts);
  let sim = at(maxRate);
  if (shortageTotal(sim) >= 0.5) return { rate: maxRate, sim };
  let lo = 0;
  let hi = maxRate;
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2;
    if (shortageTotal(at(mid)) < 0.5) hi = mid;
    else lo = mid;
  }
  return { rate: hi, sim: at(hi) };
}

// 計画全体の計算。records は削除済みを除いた記録
function computePlan(plan, records, today) {
  const { ranges, target } = phaseRanges(plan);
  const deadlines = phaseDeadlines(ranges, target);
  const days = planDays(plan);
  const weights = {};
  SUBJECTS.forEach((s) => (weights[s] = (plan.focus || []).includes(s) ? PD.focusWeight : 1));

  const items = plan.items.map((item, index) => {
    const pace = estimatePace(records, item.materialId, item.unit);
    const accuracy = estimateAccuracy(plan, records, item.subject);
    const laps = buildLaps(item, pace.pace, accuracy).map((l) => Object.assign(l, { phase: target[l.phase] || l.phase }));
    return Object.assign({ index }, item, { pace, accuracy, lapList: laps });
  });

  const tasks = [];
  items.forEach((it) => it.lapList.forEach((l) => l.minutes > 0 && tasks.push({ item: it.index, lap: l.lap, phase: l.phase, subject: it.subject, minutes: l.minutes, perUnit: l.perUnit })));
  const leveled = levelSchedule(days, tasks, weights, deadlines, 1);
  const schedule = toSchedule(days, tasks, leveled.sim.out);

  // 締切ごとの必要な時間（累積）と使える時間（累積）
  const phases = [1, 2, 3].map((p) => {
    const deadline = deadlines[p];
    const need = tasks.reduce((a, t) => a + (t.phase <= p ? t.minutes : 0), 0);
    const capacity = days.filter((d) => deadline && d.date <= deadline).reduce((a, d) => a + d.capacity, 0);
    return Object.assign({ phase: p, deadline, need, capacity, shortage: leveled.sim.shortage[p] }, ranges[p]);
  });

  const result = { plan, today, ranges, deadlines, items, tasks, phases, schedule, weights, days, rate: leveled.rate };
  result.progress = computeProgress(result, records);
  result.lag = detectLag(result);
  if (result.lag.behind) applyCatchUp(result);
  result.feasible = phases.every((p) => p.shortage < 1);
  result.suggestions = result.feasible ? [] : buildSuggestions(result);
  return result;
}

function toSchedule(days, tasks, out) {
  return days.map((d, di) => {
    const entries = Object.keys(out[di].entries).map((i) => {
      const t = tasks[i];
      const minutes = out[di].entries[i];
      return { item: t.item, lap: t.lap, minutes, amount: minutes / t.perUnit };
    });
    return { date: d.date, weekday: d.weekday, rest: d.rest, exception: d.exception, capacity: d.capacity, rawMinutes: d.rawMinutes, entries, minutes: out[di].minutes };
  });
}

// --- 進捗 ---
// 計画の開始日以降の記録で、同じ教材の量を足し、1周目→2周目→…の順に埋める（記録からは何周目か分からないため）
function doneUnitsByDate(plan, records, materialId, until) {
  const byDate = {};
  records.forEach((r) => {
    if (r.deleted || r.date < plan.startDate || r.date > until || !Array.isArray(r.materials)) return;
    r.materials.forEach((m) => {
      if (m.id === materialId && m.amount && m.amount.value > 0) byDate[r.date] = (byDate[r.date] || 0) + m.amount.value;
    });
  });
  return byDate;
}

function fillLaps(lapList, units) {
  let left = units;
  return lapList.map((l) => {
    const done = Math.min(left, l.amount);
    left -= done;
    return { lap: l.lap, done, amount: l.amount, minutesEq: done * l.perUnit };
  });
}

function computeProgress(result, records) {
  const { plan, items, schedule, today } = result;
  const perItem = items.map((it) => {
    const byDate = doneUnitsByDate(plan, records, it.materialId, today);
    const total = Object.values(byDate).reduce((a, b) => a + b, 0);
    return { byDate, total, laps: fillLaps(it.lapList, total) };
  });
  // 日ごとの累積（計画と実績。教材の単位がそろわないので、時間に換算して足す）
  let planned = 0;
  const cumulative = schedule.map((day) => {
    planned += day.minutes;
    let actual = 0;
    items.forEach((it, i) => {
      const units = Object.keys(perItem[i].byDate)
        .filter((d) => d <= day.date)
        .reduce((a, d) => a + perItem[i].byDate[d], 0);
      actual += fillLaps(it.lapList, units).reduce((a, l) => a + l.minutesEq, 0);
    });
    return { date: day.date, planned, actual: day.date <= today ? actual : null };
  });
  return { perItem, cumulative };
}

// 昨日・一昨日とも、実績÷計画が基準未満なら「遅れ」
function detectLag(result) {
  const { cumulative } = result.progress;
  const ratios = [];
  for (let k = 1; k <= PD.lagDays; k++) {
    const d = shiftDate(result.today, -k);
    const c = cumulative.find((x) => x.date === d);
    if (!c || c.planned <= 0) return { behind: false, ratios };
    ratios.push(c.actual / c.planned);
  }
  return { behind: ratios.every((r) => r < PD.lagRatio), ratios };
}

// 遅れたら、今日からの残りの作業を締切に間に合うよう組み直す。
// 1日の負荷は元の予定の2割増しまで（翌日にまとめて載せない）。足りなければ予備日も使い、それでも残れば「入りきらない」
function applyCatchUp(result) {
  const { items, tasks, today, days, deadlines, weights, plan } = result;
  const remaining = tasks.map((t) => Object.assign({}, t));
  items.forEach((it, i) => {
    const done = fillLaps(it.lapList, result.progress.perItem[i].total);
    remaining.forEach((t) => {
      if (t.item !== i) return;
      const d = done.find((x) => x.lap === t.lap);
      t.minutes = Math.max(0, t.minutes - d.minutesEq);
    });
  });
  const future = days.filter((d) => d.date >= today);
  const due = {};
  [1, 2, 3].forEach((p) => (due[p] = deadlines[p] && deadlines[p] >= today ? deadlines[p] : future.length ? future[future.length - 1].date : null));
  // 締切を過ぎた作業は、次の締切に回す
  remaining.forEach((t) => {
    if (deadlines[t.phase] && deadlines[t.phase] < today) t.phase = [1, 2, 3].find((p) => deadlines[p] && deadlines[p] >= today) || 3;
  });
  const maxRate = Math.min(1, result.rate * (1 + PD.catchUpCap));
  let leveled = levelSchedule(future, remaining, weights, due, maxRate);
  let usedRest = false;
  if (leveled.sim.left >= 0.5) {
    leveled = levelSchedule(future, remaining, weights, due, 1, { useRest: true, margin: plan.margin, fixedRate: maxRate });
    usedRest = true;
  }
  const replanned = toSchedule(future, remaining, leveled.sim.out);
  result.schedule.forEach((day) => {
    day.base = day.minutes;
  });
  replanned.forEach((r) => {
    const day = result.schedule.find((d) => d.date === r.date);
    day.entries = r.entries;
    day.minutes = r.minutes;
  });
  const total = remaining.reduce((a, t) => a + t.minutes, 0);
  result.lag.unplaced = leveled.sim.left;
  result.lag.placed = total - leveled.sim.left;
  result.lag.usedRest = usedRest;
}

// 時間が足りないときの候補（黙って削らず、選んでもらう）。最初に足りなくなる締切について出す
function buildSuggestions(result) {
  const out = [];
  const { items, phases, plan, days } = result;
  const short = phases.filter((p) => p.shortage >= 1);
  if (!short.length) return out;
  const first = short[0];
  const lastShort = short[short.length - 1];
  items
    .filter((it) => !(plan.focus || []).includes(it.subject) && it.laps >= 2)
    .map((it) => ({ it, lap: it.lapList[it.lapList.length - 1] }))
    .filter((x) => x.lap.phase <= lastShort.phase)
    .sort((a, b) => b.lap.minutes - a.lap.minutes)
    .slice(0, 2)
    .forEach((x) => out.push({ type: 'laps', phase: lastShort.phase, item: x.it.index, minutes: x.lap.minutes }));
  const until = days.filter((d) => first.deadline && d.date <= first.deadline);
  const weekendDays = until.filter((d) => (d.weekday === 0 || d.weekday === 6) && !d.rest && d.exception === null).length;
  if (weekendDays) out.push({ type: 'weekend', phase: first.phase, minutes: weekendDays * 30 * plan.margin });
  const restMinutes = until.filter((d) => d.rest).reduce((a, d) => a + d.rawMinutes * plan.margin, 0);
  if (restMinutes > 0) out.push({ type: 'rest', phase: first.phase, minutes: restMinutes });
  return out;
}

// --- 画面向けのまとめ ---
function sumEntries(result, from, to) {
  const byItem = {};
  result.schedule.forEach((day) => {
    if (day.date < from || day.date > to) return;
    day.entries.forEach((e) => {
      const x = (byItem[e.item] = byItem[e.item] || { item: e.item, amount: 0, minutes: 0, laps: new Set() });
      x.amount += e.amount;
      x.minutes += e.minutes;
      x.laps.add(e.lap);
    });
  });
  return Object.values(byItem).map((x) => Object.assign(x, { laps: [...x.laps].sort() }));
}

// その週（月〜日）の目標と、その週にやった量
function weekTargets(result, weekStart) {
  const weekEnd = shiftDate(weekStart, 6);
  return sumEntries(result, weekStart, weekEnd).map((x) => {
    const done = Object.keys(result.progress.perItem[x.item].byDate)
      .filter((d) => d >= weekStart && d <= weekEnd)
      .reduce((a, d) => a + result.progress.perItem[x.item].byDate[d], 0);
    return Object.assign(x, { done });
  });
}

function dayTargets(result, date) {
  return sumEntries(result, date, date);
}

function roundAmount(v) {
  if (v <= 0) return 0;
  return Math.max(1, Math.round(v));
}

function daysUntil(from, to) {
  return Math.round((parseDate(to) - parseDate(from)) / 86400000);
}
