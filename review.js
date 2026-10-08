// 振り返りの集計：週のまとめ・できたこと・計画の進み・気づき・がんばること。画面から独立した計算だけを置く。
// 比べるのは先週の自分と計画だけ。

const RR = REVIEW_RULES;

function recordsBetween(records, from, to) {
  return records.filter((r) => !r.deleted && r.date >= from && r.date <= to);
}

function totalMinutesOf(list) {
  return list.reduce((a, r) => a + (r.totalMinutes || 0), 0);
}

function minutesBySubject(list) {
  const out = {};
  SUBJECTS.forEach((s) => (out[s] = 0));
  list.forEach((r) => {
    if (out[r.subject] !== undefined) out[r.subject] += r.totalMinutes || 0;
  });
  return out;
}

function issueGroupOf(id) {
  const found = getMaster('issue').find((i) => i.id === id) || DEFAULT_MASTERS.issue.find((i) => i.id === id);
  return found ? found.group : null;
}

function bandIdOf(r) {
  return r.timeBand ? r.timeBand.id : null;
}

// 時間帯の行（マスタの順）。使っていない時間帯のうち、選択肢から外したものは出さない。記録にだけある時間帯は後ろに足す
function weekBands(list) {
  const bands = getMaster('timeband')
    .sort((a, b) => (a.startHour || 0) - (b.startHour || 0))
    .map((b) => ({ id: b.id, label: b.label, active: b.active }));
  list.forEach((r) => {
    if (!bands.some((b) => b.id === bandIdOf(r))) bands.push({ id: bandIdOf(r), label: r.timeBand ? r.timeBand.label : 'なし', active: false });
  });
  return bands.filter((b) => b.active || list.some((r) => bandIdOf(r) === b.id));
}

// 課題のまとめ：課題ごとの回数と教科。課題なしの記録の数
function issueSummary(list) {
  const map = {};
  let none = 0;
  list.forEach((r) => {
    if (!(r.issues || []).length) none++;
    (r.issues || []).forEach((i) => {
      const x = (map[i.id] = map[i.id] || { id: i.id, label: i.label, n: 0, subjects: [] });
      x.n++;
      if (!x.subjects.includes(r.subject)) x.subjects.push(r.subject);
    });
  });
  const items = Object.values(map)
    .map((x) => Object.assign(x, { subjects: SUBJECTS.filter((sub) => x.subjects.includes(sub)) }))
    .sort((a, b) => b.n - a.n);
  return { items, none };
}

// 教材ごとの量（単位が違うものは足さない）
function materialTotals(list) {
  const out = {};
  list.forEach((r) =>
    (r.materials || []).forEach((m) => {
      if (!m.amount || !(m.amount.value > 0)) return;
      const key = `${r.subject}|${m.id}|${m.amount.unit}`;
      const x = (out[key] = out[key] || { id: m.id, subject: r.subject, label: m.label, unit: m.amount.unit, value: 0 });
      x.value += m.amount.value;
    })
  );
  return Object.values(out);
}

// --- 週のまとめ ---
function summarizeWeek(records, weekStart, today) {
  const weekEnd = shiftDate(weekStart, 6);
  const list = recordsBetween(records, weekStart, weekEnd);
  const prev = recordsBetween(records, shiftDate(weekStart, -7), shiftDate(weekStart, -1));
  const dates = new Set(list.map((r) => r.date));
  const bands = weekBands(list);
  const bandIndex = (r) => bands.findIndex((b) => b.id === bandIdOf(r));
  const days = [];
  for (let i = 0; i < 7; i++) {
    const date = shiftDate(weekStart, i);
    // その日の記録（時間帯の順）と合計
    const mine = list.filter((r) => r.date === date).sort((a, b) => bandIndex(a) - bandIndex(b) || (a.createdAt < b.createdAt ? -1 : 1));
    days.push({ date, studied: dates.has(date), future: date > today, records: mine, minutes: totalMinutesOf(mine) });
  }
  const morning = new Set(list.filter((r) => r.timeBand && r.timeBand.id === 'tb-morning').map((r) => r.date));
  const resolved = records.filter((r) => !r.deleted && r.unclear && r.unclear.resolvedAt && r.unclear.resolvedAt >= weekStart && r.unclear.resolvedAt <= weekEnd).length;
  return {
    weekStart,
    weekEnd,
    records: list,
    bands,
    issues: issueSummary(list),
    recordCount: list.length,
    dayCount: dates.size,
    days,
    totalMinutes: totalMinutesOf(list),
    prevTotalMinutes: totalMinutesOf(prev),
    bySubject: minutesBySubject(list),
    prevBySubject: minutesBySubject(prev),
    morningDays: morning.size,
    materials: materialTotals(list),
    resolved,
  };
}

// できたこと：事実と行動から作る具体的な文（最大 maxPraise）
function praiseLines(summary, progress) {
  const lines = [];
  if (progress) {
    progress.targets
      .filter((t) => t.goal > 0 && t.done >= t.goal)
      .forEach((t) => lines.push(`${t.subject} ${t.label}、今週の目標${t.goal}${t.unit}に届いた`));
  }
  const ups = SUBJECTS.map((s) => ({ s, diff: summary.bySubject[s] - summary.prevBySubject[s] }))
    .filter((x) => summary.prevBySubject[x.s] > 0 && x.diff >= RR.increaseMinutes)
    .sort((a, b) => b.diff - a.diff);
  if (ups.length) lines.push(`先週より${ups[0].s}が${formatMinutes(ups[0].diff)}ふえた`);
  const redo = summary.materials.filter((m) => /-redo$/.test(m.id));
  if (redo.length) {
    const byUnit = {};
    redo.forEach((m) => (byUnit[m.unit] = (byUnit[m.unit] || 0) + m.value));
    lines.push(`解き直しを${Object.keys(byUnit).map((u) => `${byUnit[u]}${u === '問題' ? '問' : u}`).join('・')}やった`);
  }
  if (summary.resolved) lines.push(`わからなかったところを${summary.resolved}つ「わかった」にした`);
  if (summary.morningDays) lines.push(`朝に${summary.morningDays}日勉強した`);
  const top = summary.materials.filter((m) => !/-redo$/.test(m.id)).sort((a, b) => b.value - a.value)[0];
  if (top) lines.push(`${top.subject}の${top.label}を${top.value}${top.unit}やった`);
  if (!lines.length && summary.dayCount) lines.push(`${summary.dayCount}日、記録した`);
  return lines.slice(0, RR.maxPraise);
}

// --- 計画の進み ---
// その期間にかかる計画（テストが近いもの）
function planForRange(plans, from, to) {
  return (
    plans
      .filter((p) => !p.deleted && p.startDate <= to && p.testDate > from)
      .sort((a, b) => (a.testDate < b.testDate ? -1 : a.testDate > b.testDate ? 1 : 0))[0] || null
  );
}

function planForWeek(plans, weekStart) {
  return planForRange(plans, weekStart, shiftDate(weekStart, 6));
}

// ある時点の、教材ごとの「やった量÷昨日までの予定」
function lagStatus(result) {
  const yDay = result.days.find((d) => d.date === shiftDate(result.today, -1));
  if (!yDay) return [];
  return result.items.map((it) => {
    const planned = it.total * yDay.cum;
    return { item: it.index, planned, done: it.doneBefore, ratio: planned >= 1 ? it.doneBefore / planned : null };
  });
}

// 今週の目標と進み。過去の週は、その週の終わりの時点で見る
function planProgress(plan, records, weekStart, today) {
  const weekEnd = shiftDate(weekStart, 6);
  const asOf = today <= weekEnd ? today : shiftDate(weekEnd, 1);
  const result = computePlan(plan, records, asOf);
  const name = (i) => ({ subject: result.items[i].subject, label: result.items[i].label, unit: result.items[i].unit, materialId: result.items[i].materialId });
  const targets = weekTargets(result, weekStart)
    .filter((x) => x.amount > 0.05)
    .map((x) => Object.assign(name(x.item), { item: x.item, goal: roundAmount(x.amount), done: Math.round(x.done), laps: x.laps, minutes: x.minutes }));
  const perDay = {};
  dayTargets(result, asOf).forEach((x) => (perDay[x.item] = roundAmount(x.amount)));
  const status = lagStatus(result);
  const behind = status
    .filter((s) => s.ratio !== null && s.ratio < PLAN_DEFAULTS.lagRatio)
    .map((s) => Object.assign(name(s.item), { item: s.item, ratio: s.ratio, deficit: roundAmount(s.planned - s.done), perDay: perDay[s.item] || 0 }));
  const ahead = status.filter((s) => s.ratio !== null && s.ratio >= RR.aheadRatio).map((s) => Object.assign(name(s.item), { item: s.item }));

  // 計画の見直しの目安：先週末の時点と今の両方で大きな遅れ／目安の日に間に合わない周がある／予定よりかなり進んでいる
  const before = weekStart > plan.startDate ? lagStatus(computePlan(plan, records, weekStart)) : [];
  const stuck = behind.filter((b) => b.ratio < RR.bigLagRatio && before.some((s) => s.item === b.item && s.ratio !== null && s.ratio < RR.bigLagRatio));
  const adjust = [];
  if (stuck.length) adjust.push(`${stuck.map((b) => `${b.subject} ${b.label}`).join('、')}は、予定との差が2週続けて大きくなっています`);
  if (result.warnings.length) adjust.push('この割合のままだと、目安の日に間に合わない周があります');
  if (ahead.length) adjust.push(`${ahead.map((a) => `${a.subject} ${a.label}`).join('、')}は、予定よりかなり進んでいます`);

  return { plan, result, asOf, targets, behind, ahead, adjust, daysLeft: daysUntil(today, plan.testDate) };
}

// 進捗率（%）。単位が違う教材をまとめるため、目安の時間に直して足す。
// week＝今週の目標に対してやった割合（教材ごとに100%まで）。total＝テストまでの全体のうちやった割合。planned＝昨日までの予定の位置
function progressRates(progress) {
  const pct = (x) => (x >= 1 ? 100 : Math.min(99, Math.round(Math.max(0, x) * 100)));
  const goal = progress.targets.reduce((a, t) => a + t.minutes, 0);
  const done = progress.targets.reduce((a, t) => a + Math.min(1, t.done / t.goal) * t.minutes, 0);
  const cum = progress.result.cumulative;
  const all = cum.length ? cum[cum.length - 1].planned : 0;
  const at = (date) => cum.filter((d) => d.date <= date).pop();
  const now = at(progress.asOf);
  const before = at(shiftDate(progress.asOf, -1));
  return {
    week: goal > 0 ? pct(done / goal) : null,
    total: all > 0 && now ? pct(now.actual / all) : 0,
    planned: all > 0 && before ? pct(before.planned / all) : 0,
  };
}

// --- 気づき（最大 maxInsights。優先の小さい順） ---
function lagInsight(b, current) {
  const name = `${b.subject} ${b.label}`;
  let text = `${name}：予定まであと${b.deficit}${b.unit}`;
  if (current && b.perDay > 0) text += `。1日${b.perDay}${b.unit}で今月中に追いつけます`;
  return { kind: 'lag', priority: b.ratio < RR.bigLagRatio ? 1 : 4, subject: b.subject, text };
}

// 教科のつまずき（①正答率が低い ②空回り ③同じ課題がくり返す）。教科ごとに最も強いもの1つ
function stumbleInsight(subject, list) {
  const mine = list.filter((r) => r.subject === subject);
  const acc = mine.filter((r) => r.accuracy && typeof r.accuracy.level === 'number');
  const low = acc.filter((r) => r.accuracy.level <= RR.lowLevel).length;
  if (acc.length >= RR.minRecords && low * 2 >= acc.length) {
    return {
      kind: 'accuracy',
      subject,
      text: `${subject}：正答率50%以下の回が${low}回（${acc.length}回中）。×を次の日に解き直すと定着しやすい`,
    };
  }

  const fields = {};
  mine.forEach((r) =>
    (r.fields || []).forEach((f) => {
      const x = (fields[f.id] = fields[f.id] || { label: f.label, minutes: 0, levels: [] });
      x.minutes += f.minutes || 0;
      if (r.accuracy && typeof r.accuracy.level === 'number') x.levels.push(r.accuracy.level);
    })
  );
  const spin = Object.values(fields)
    .filter((f) => f.minutes >= RR.spinMinutes && f.levels.length >= RR.spinRecords && f.levels.reduce((a, b) => a + b, 0) / f.levels.length <= RR.lowLevel)
    .sort((a, b) => b.minutes - a.minutes)[0];
  if (spin) {
    return {
      kind: 'spin',
      subject,
      text: `${subject} ${spin.label}に${formatMinutes(spin.minutes)}。正答率が上がらないときは、やり方を変えるサイン`,
    };
  }

  const counts = {};
  mine.forEach((r) =>
    (r.issues || []).forEach((i) => {
      const group = issueGroupOf(i.id);
      if (i.id === 'i-free' || !group || group === ISSUE_GROUPS[2]) return; // 体調・気持ち・時間は教科をまたいで見る
      const x = (counts[i.id] = counts[i.id] || { label: i.label, group, n: 0 });
      x.n++;
    })
  );
  const rep = Object.values(counts)
    .filter((x) => x.n >= RR.repeatIssue)
    .sort((a, b) => b.n - a.n)[0];
  if (!rep) return null;
  if (rep.group === UNCLEAR_GROUP) {
    return {
      kind: 'unclear',
      subject,
      link: 'note',
      text: `${subject}：「${rep.label}」が${rep.n}回。ノートを見ながら、親か先生に聞いてみよう`,
    };
  }
  return {
    kind: 'review',
    subject,
    text: `${subject}：「${rep.label}」が${rep.n}回。前の内容を思い出してから始めると効きます`,
  };
}

// 体調・気持ち・時間の課題（教科をまたいで数える）
function conditionInsight(list) {
  const counts = {};
  list.forEach((r) =>
    (r.issues || []).forEach((i) => {
      if (issueGroupOf(i.id) !== ISSUE_GROUPS[2]) return;
      const x = (counts[i.id] = counts[i.id] || { label: i.label, n: 0 });
      x.n++;
    })
  );
  const rep = Object.values(counts)
    .filter((x) => x.n >= RR.repeatIssue)
    .sort((a, b) => b.n - a.n)[0];
  if (!rep) return null;
  return {
    kind: 'condition',
    priority: 2,
    subject: null,
    text: `「${rep.label}」が${rep.n}回。時間帯や場所を変えてみる？`,
  };
}

function detectInsights(records, weekStart, today, progress) {
  const weekEnd = shiftDate(weekStart, 6);
  const current = today >= weekStart && today <= weekEnd;
  const windowEnd = today < weekEnd ? today : weekEnd;
  const list = recordsBetween(records, shiftDate(windowEnd, -(RR.windowDays - 1)), windowEnd);
  const out = [];
  if (progress) progress.behind.forEach((b) => out.push(lagInsight(b, current)));

  if (list.length >= RR.minRecords) {
    SUBJECTS.forEach((s) => {
      const x = stumbleInsight(s, list);
      if (x) out.push(Object.assign(x, { priority: 2 }));
    });
    const c = conditionInsight(list);
    if (c) out.push(c);
    if (list.length >= RR.gapRecords) {
      SUBJECTS.filter((s) => !list.some((r) => r.subject === s)).forEach((s) =>
        out.push({
          kind: 'gap',
          priority: 3,
          subject: s,
          text: `${s}：この${RR.windowDays === 14 ? '2週間' : RR.windowDays + '日'}、記録がありません`,
        })
      );
    }
    // 量の減少は、週が終わってから（日曜を含む）
    const week = recordsBetween(records, weekStart, weekEnd);
    const prev = recordsBetween(records, shiftDate(weekStart, -7), shiftDate(weekStart, -1));
    const total = totalMinutesOf(week);
    const prevTotal = totalMinutesOf(prev);
    if (today >= weekEnd && prevTotal >= RR.dropMinMinutes && total < prevTotal * RR.dropRatio) {
      out.push({
        kind: 'drop',
        priority: 5,
        subject: null,
        text: `今週は${formatMinutes(total)}（先週は${formatMinutes(prevTotal)}）。忙しかった週？`,
      });
    }
  }
  return out
    .map((x, i) => Object.assign(x, { order: i }))
    .sort((a, b) => a.priority - b.priority || a.order - b.order)
    .slice(0, RR.maxInsights);
}

// その週にがんばること：その週までに決めたうち、いちばん新しいもの（変えるまで続く）。決めていない・取り消したときは null
function changeInEffect(reviews, weekStart) {
  const latest = reviews.filter((r) => !r.deleted && r.weekStart <= weekStart).sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1))[0];
  return latest ? latest.change : null;
}

// --- くわしく見る：期間（日／週／月／テストまで）×観点（教科／学習内容／量） ---
// 期間の範囲。anchor はその期間に含まれる日。prev は比べる前の期間（週・月だけ）。「テストまで」は計画の開始日〜テスト日
function detailRange(kind, anchor, plan) {
  if (kind === 'test' && plan) return { kind, from: plan.startDate, to: plan.testDate, prev: null };
  if (kind === 'month') {
    const d = parseDate(anchor);
    const edge = (month, day) => formatDate(new Date(d.getFullYear(), d.getMonth() + month, day));
    return { kind, from: edge(0, 1), to: edge(1, 0), prev: { from: edge(-1, 1), to: edge(0, 0) } };
  }
  if (kind === 'week') {
    const from = startOfWeekStr(parseDate(anchor));
    return { kind, from, to: shiftDate(from, 6), prev: { from: shiftDate(from, -7), to: shiftDate(from, -1) } };
  }
  return { kind: 'day', from: anchor, to: anchor, prev: null };
}

// 前・次の期間に含まれる日（dir＝-1／1）
function shiftDetailAnchor(range, dir) {
  if (range.kind === 'month') return dir < 0 ? range.prev.from : shiftDate(range.to, 1);
  return shiftDate(range.from, dir * (range.kind === 'week' ? 7 : 1));
}

// 推移グラフの棒：週は日ごと、月・テストまでは週ごと（月曜はじまり。期間の端で切る）
function trendBuckets(records, range, today) {
  const out = [];
  let from = range.from;
  while (from <= range.to) {
    const weekEnd = shiftDate(startOfWeekStr(parseDate(from)), 6);
    const to = range.kind === 'week' ? from : weekEnd < range.to ? weekEnd : range.to;
    const list = recordsBetween(records, from, to);
    out.push({ from, to, bySubject: minutesBySubject(list), minutes: totalMinutesOf(list), future: from > today, current: from <= today && today <= to });
    from = shiftDate(to, 1);
  }
  return out;
}

// 観点「教科」：教科ごとの時間・記録数・正答率の目安（記録した回のまん中の段階）
function detailBySubject(list) {
  return SUBJECTS.map((subject) => {
    const mine = list.filter((r) => r.subject === subject);
    const levels = mine
      .filter((r) => r.accuracy && typeof r.accuracy.level === 'number')
      .map((r) => r.accuracy.level)
      .sort((a, b) => a - b);
    const level = levels.length ? levels[Math.floor((levels.length - 1) / 2)] : null;
    return { subject, minutes: totalMinutesOf(mine), count: mine.length, accuracy: ACCURACY_LEVELS.find((a) => a.level === level) || null };
  });
}

// やったことの内訳（時間の多い順）
function activityBreakdown(list) {
  const map = {};
  list.forEach((r) => {
    const x = (map[r.activity.id] = map[r.activity.id] || { id: r.activity.id, label: r.activity.label, minutes: 0 });
    x.minutes += r.totalMinutes || 0;
  });
  return Object.values(map).sort((a, b) => b.minutes - a.minutes);
}

// 観点「学習内容」：教科ごとに、分野ごとの時間（多い順）
function detailByField(list) {
  return SUBJECTS.map((subject) => {
    const map = {};
    list
      .filter((r) => r.subject === subject)
      .forEach((r) =>
        (r.fields || []).forEach((f) => {
          const x = (map[f.id] = map[f.id] || { id: f.id, label: f.label, minutes: 0 });
          x.minutes += f.minutes || 0;
        })
      );
    const fields = Object.values(map).sort((a, b) => b.minutes - a.minutes);
    return { subject, minutes: fields.reduce((a, f) => a + f.minutes, 0), fields };
  }).filter((g) => g.fields.length);
}

// 観点「量」：教科ごとに、教材ごとの量（単位が違うものは足さない）。
// 計画にある教材は、その期間の予定（goal）とやった量を並べる。テストまでは周ごと（laps）。
// 週の予定は、今週のまとめと同じ（日ごとの予定の合計）。月の予定は、月末までの予定から、その月の前までにやった量を引く
// （遅れを残りの日に分けた予定を足すと、遅れの分が重なるため）。
// 計画にない教材は、やった量だけ。前の期間の量（prev）を添える
function detailAmounts(records, range, plan, today) {
  const rows = [];
  const planned = new Set();
  if (plan) {
    // 過ぎた期間は、その期間の終わりの時点で見る
    const asOf = today <= range.to ? today : range.kind === 'test' ? range.to : shiftDate(range.to, 1);
    const result = computePlan(plan, records, asOf);
    const base = (it) => ({ subject: it.subject, id: it.materialId, label: it.label, unit: it.unit });
    if (range.kind === 'test') {
      result.items.forEach((it) => {
        const laps = it.lapsNow.map((l) => ({ lap: l.lap, amount: roundAmount(l.amount), done: Math.round(l.done), marked: l.marked }));
        rows.push(Object.assign(base(it), { value: Math.round(it.doneNow), total: Math.round(it.total), laps }));
      });
    } else if (range.kind === 'month') {
      const end = result.days.filter((d) => d.date <= range.to).pop();
      const doneUntil = (it, date) => sumDone(doneLaps(it.lapList, it.byDate, date));
      result.items.forEach((it) => {
        if (!end || end.date < range.from) return;
        const start = doneUntil(it, shiftDate(range.from, -1));
        const goal = it.total * end.cum - start;
        if (goal > 0.05) rows.push(Object.assign(base(it), { value: Math.round(doneUntil(it, range.to) - start), goal: roundAmount(goal) }));
      });
    } else {
      sumEntries(result, range.from, range.to)
        .filter((x) => x.amount > 0.05)
        .forEach((x) => {
          const it = result.items[x.item];
          const done = Object.keys(it.byDate)
            .filter((d) => d >= range.from && d <= range.to)
            .reduce((a, d) => a + it.byDate[d], 0);
          rows.push(Object.assign(base(it), { value: Math.round(done), goal: roundAmount(x.amount) }));
        });
    }
    rows.forEach((x) => planned.add(x.id));
  }
  const before = range.prev ? materialTotals(recordsBetween(records, range.prev.from, range.prev.to)) : null;
  const order = getMaster('material').map((m) => m.id);
  const rank = (id) => (order.includes(id) ? order.indexOf(id) : order.length);
  materialTotals(recordsBetween(records, range.from, range.to))
    .filter((m) => !planned.has(m.id))
    .sort((a, b) => rank(a.id) - rank(b.id))
    .forEach((m) => {
      const same = before && before.find((p) => p.subject === m.subject && p.id === m.id && p.unit === m.unit);
      rows.push(Object.assign(m, { prev: before ? (same ? same.value : 0) : null }));
    });
  const groups = SUBJECTS.map((subject) => ({ subject, items: rows.filter((x) => x.subject === subject) })).filter((g) => g.items.length);
  return { plan: plan || null, groups };
}
