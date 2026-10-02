// 学習計画の逆算：範囲×周回の全体量を、月ごとの割合で日に按分し、週・日の目標量を出す。画面から独立した計算だけを置く。
// 目標は量（ページ・問題・語）。時間は量×ペースの目安として参考に出すだけ。

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

function lapMark(item, lap) {
  return (item.lapMarks || []).find((m) => m.lap === lap) || null;
}

// 教材1つの周回ごとの量と1単位の時間。前の周を「終わった」にして×の量を入れていれば、それを次の周の量にする
function buildLaps(item, pace, accuracy) {
  const kind = planItemKind(item.unit);
  const laps = [];
  for (let r = 1; r <= item.laps; r++) {
    let amount = item.amount;
    let perUnit = pace;
    if (kind === 'drill' && r >= 2) {
      const prev = lapMark(item, r - 1);
      amount = prev && typeof prev.nextAmount === 'number' ? prev.nextAmount : laps[r - 2].amount * (1 - accuracy);
      perUnit = pace * PD.redoFactor;
    } else if (kind === 'memo') {
      perUnit = pace * Math.pow(PD.memoDecay, r - 1);
    }
    const mark = lapMark(item, r);
    laps.push({ lap: r, amount, perUnit, marked: !!mark, markDate: mark ? mark.date : null });
  }
  return laps;
}

// --- 月ごとの割合 ---
// 開始日〜テスト前日にかかる月と、その月の対象日
function planMonths(startDate, testDate) {
  const out = [];
  if (!startDate || !testDate || startDate >= testDate) return out;
  const last = shiftDate(testDate, -1);
  for (let d = startDate; d <= last; d = shiftDate(d, 1)) {
    const month = d.slice(0, 7);
    const cur = out[out.length - 1];
    if (cur && cur.month === month) {
      cur.to = d;
      cur.days++;
    } else out.push({ month, from: d, to: d, days: 1 });
  }
  return out;
}

// 初期値：日数に比例させたうえで、テストに近い月ほど重くする（1・2・3…倍）。合計100の整数
function defaultMonthPercents(months) {
  const w = months.map((m, i) => m.days * (i + 1));
  const total = w.reduce((a, b) => a + b, 0);
  if (!total) return months.map(() => 0);
  const raw = w.map((x) => (x * 100) / total);
  const out = raw.map(Math.floor);
  let rest = 100 - out.reduce((a, b) => a + b, 0);
  raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac)
    .forEach(({ i }) => {
      if (rest > 0) {
        out[i]++;
        rest--;
      }
    });
  return out;
}

function defaultPlanMonths(startDate, testDate) {
  const months = planMonths(startDate, testDate);
  const pct = defaultMonthPercents(months);
  return months.map((m, i) => ({ month: m.month, percent: pct[i] }));
}

function monthLabel(month) {
  return `${Number(month.slice(5, 7))}月`;
}

// 日ごとの割合（その月の割合を、その月の対象日で均等に割る）。cum は開始日からその日までの累計
function planDays(plan) {
  const months = planMonths(plan.startDate, plan.testDate);
  const percent = {};
  (plan.months || []).forEach((m) => (percent[m.month] = m.percent || 0));
  const total = months.reduce((a, m) => a + (percent[m.month] || 0), 0) || 1;
  const days = [];
  let cum = 0;
  months.forEach((m) => {
    for (let d = m.from; d <= m.to; d = shiftDate(d, 1)) {
      const share = (percent[m.month] || 0) / total / m.days;
      cum += share;
      days.push({ date: d, month: m.month, share, cum });
    }
  });
  return days;
}

// --- 量と周回 ---
// 全体の中の位置 from から amount 分を、周回ごとの量に分ける
function splitByLaps(lapList, from, amount) {
  const out = [];
  let start = 0;
  lapList.forEach((l) => {
    const end = start + l.amount;
    const a = Math.max(from, start);
    const b = Math.min(from + amount, end);
    if (b - a > 1e-9) out.push({ lap: l.lap, amount: b - a, minutes: (b - a) * l.perUnit });
    start = end;
  });
  return out;
}

function unitsToMinutes(lapList, units) {
  return splitByLaps(lapList, 0, units).reduce((a, x) => a + x.minutes, 0);
}

// 計画の開始日以降に記録した量（日ごと）
function doneUnitsByDate(plan, records, materialId) {
  const byDate = {};
  records.forEach((r) => {
    if (r.deleted || r.date < plan.startDate || !Array.isArray(r.materials)) return;
    r.materials.forEach((m) => {
      if (m.id === materialId && m.amount && m.amount.value > 0) byDate[r.date] = (byDate[r.date] || 0) + m.amount.value;
    });
  });
  return byDate;
}

// until の時点の周回ごとのやった量。「終わった」の周はすべて済み。最後に終わった日より後の記録を、次の周から順に埋める
function doneLaps(lapList, byDate, until) {
  let k = 0;
  let after = '';
  while (k < lapList.length && lapList[k].marked && lapList[k].markDate <= until) {
    after = lapList[k].markDate;
    k++;
  }
  let units = Object.keys(byDate)
    .filter((d) => d > after && d <= until)
    .reduce((a, d) => a + byDate[d], 0);
  return lapList.map((l, i) => {
    if (i < k) return { lap: l.lap, amount: l.amount, done: l.amount, marked: true };
    const done = Math.min(units, l.amount);
    units -= done;
    return { lap: l.lap, amount: l.amount, done, marked: false };
  });
}

function sumDone(laps) {
  return laps.reduce((a, l) => a + l.done, 0);
}

// --- 計画全体 ---
// records は削除済みを除いた記録
function computePlan(plan, records, today) {
  const days = planDays(plan);
  const deadlines = { 1: shiftDate(plan.testDate, -PD.phase1Days), 2: shiftDate(plan.testDate, -PD.phase2Days), 3: shiftDate(plan.testDate, -1) };
  const yesterday = shiftDate(today, -1);

  const items = plan.items.map((item, index) => {
    const pace = estimatePace(records, item.materialId, item.unit);
    const accuracy = estimateAccuracy(plan, records, item.subject);
    const lapList = buildLaps(item, pace.pace, accuracy);
    const total = lapList.reduce((a, l) => a + l.amount, 0);
    const byDate = doneUnitsByDate(plan, records, item.materialId);
    const lapsNow = doneLaps(lapList, byDate, today);
    const doneBefore = sumDone(doneLaps(lapList, byDate, yesterday));
    return Object.assign({ index }, item, { pace, accuracy, lapList, total, byDate, lapsNow, doneNow: sumDone(lapsNow), doneBefore });
  });

  // 日ごとの予定の量。今月の今日以降は「月末までの予定−昨日までにやった量」を残りの日で均等に分ける（遅れ・進みを今月で吸収）。
  // それ以外の日は割合どおり
  const restOfMonth = days.filter((d) => d.month === today.slice(0, 7) && d.date >= today);
  const monthEnd = restOfMonth.length ? restOfMonth[restOfMonth.length - 1] : null;
  const schedule = days.map((d) => ({ date: d.date, month: d.month, entries: [], minutes: 0 }));
  items.forEach((it) => {
    const perDay = monthEnd ? Math.max(0, it.total * monthEnd.cum - it.doneBefore) / restOfMonth.length : 0;
    days.forEach((d, i) => {
      const k = monthEnd ? restOfMonth.indexOf(d) : -1;
      const from = k >= 0 ? it.doneBefore + perDay * k : it.total * (d.cum - d.share);
      const amount = k >= 0 ? perDay : it.total * d.share;
      splitByLaps(it.lapList, from, amount).forEach((x) => {
        schedule[i].entries.push({ item: it.index, lap: x.lap, amount: x.amount, minutes: x.minutes });
        schedule[i].minutes += x.minutes;
      });
    });
  });

  // 累積の計画（割合どおり）と実績。単位がそろわないので時間に換算して足す
  const cumulative = days.map((d) => {
    let planned = 0;
    let actual = 0;
    items.forEach((it) => {
      planned += unitsToMinutes(it.lapList, it.total * d.cum);
      if (d.date <= today) actual += doneLaps(it.lapList, it.byDate, d.date).reduce((a, l, k) => a + l.done * it.lapList[k].perUnit, 0);
    });
    return { date: d.date, planned, actual: d.date <= today ? actual : null };
  });

  // 遅れ：昨日までの予定に対して、やった量が基準未満の教材
  const yDay = days.find((d) => d.date === yesterday);
  const behind = [];
  if (yDay) {
    items.forEach((it) => {
      const planned = it.total * yDay.cum;
      if (planned >= 1 && it.doneBefore < planned * PD.lagRatio) behind.push({ item: it.index, deficit: planned - it.doneBefore });
    });
  }

  // 締切の目安（1周目はテスト7日前、ほかの周は3日前）に、この割合のままで間に合うか
  const warnings = [];
  items.forEach((it) => {
    let edge = 0;
    it.lapList.forEach((l, k) => {
      edge += l.amount;
      if (k === it.lapList.length - 1 || l.marked) return;
      const deadline = k === 0 ? deadlines[1] : deadlines[2];
      const day = days.find((d) => it.total * d.cum >= edge - 1e-6);
      if (day && day.date > deadline) warnings.push({ item: it.index, lap: l.lap, finish: day.date, deadline });
    });
  });

  const months = planMonths(plan.startDate, plan.testDate).map((m) => {
    const saved = (plan.months || []).find((x) => x.month === m.month);
    return Object.assign({}, m, { percent: saved ? saved.percent : 0 });
  });
  return { plan, today, days, deadlines, items, schedule, cumulative, behind, warnings, months };
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
    const byDate = result.items[x.item].byDate;
    const done = Object.keys(byDate)
      .filter((d) => d >= weekStart && d <= weekEnd)
      .reduce((a, d) => a + byDate[d], 0);
    return Object.assign(x, { done });
  });
}

function dayTargets(result, date) {
  return sumEntries(result, date, date);
}

// 週ごとの目安時間（月曜はじまり）
function weeklyMinutes(result) {
  const weeks = [];
  result.schedule.forEach((d) => {
    const start = startOfWeekStr(parseDate(d.date));
    let w = weeks[weeks.length - 1];
    if (!w || w.start !== start) {
      w = { start, minutes: 0 };
      weeks.push(w);
    }
    w.minutes += d.minutes;
  });
  return weeks;
}

function roundAmount(v) {
  if (v <= 0) return 0;
  return Math.max(1, Math.round(v));
}

function daysUntil(from, to) {
  return Math.round((parseDate(to) - parseDate(from)) / 86400000);
}
