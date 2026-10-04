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
  // 教材ごとの量（単位が違うものは足さない）
  const materials = {};
  list.forEach((r) =>
    (r.materials || []).forEach((m) => {
      if (!m.amount || !(m.amount.value > 0)) return;
      const key = `${r.subject}|${m.id}|${m.amount.unit}`;
      const x = (materials[key] = materials[key] || { id: m.id, subject: r.subject, label: m.label, unit: m.amount.unit, value: 0 });
      x.value += m.amount.value;
    })
  );
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
    materials: Object.values(materials),
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
// その週にかかる計画（テストが近いもの）
function planForWeek(plans, weekStart) {
  const weekEnd = shiftDate(weekStart, 6);
  return (
    plans
      .filter((p) => !p.deleted && p.startDate <= weekEnd && p.testDate > weekStart)
      .sort((a, b) => (a.testDate < b.testDate ? -1 : a.testDate > b.testDate ? 1 : 0))[0] || null
  );
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
    .map((x) => Object.assign(name(x.item), { item: x.item, goal: roundAmount(x.amount), done: Math.round(x.done), laps: x.laps }));
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
