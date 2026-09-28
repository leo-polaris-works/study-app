// 登録結果のメッセージ。評価ではなく労いと事実ベース。条件に合うプールからランダムに1つ選ぶ。

const MESSAGES = {
  generic: [
    '今日もお疲れさま。記録できたよ。',
    '記録おつかれさま。続けていこう。',
    '今日の勉強、しっかり残せたね。',
  ],
  byBand: {
    'tb-morning': ['朝の時間を使えたね。いいスタート。', '朝からお疲れさま。'],
    'tb-am': ['午前中の勉強、おつかれさま。'],
    'tb-pm': ['午後の時間に机に向かえたね。'],
    'tb-evening': ['夕方の勉強、おつかれさま。', '一日の途中でも、ちゃんと積み上がってるよ。'],
    'tb-night': ['夜の勉強、おつかれさま。ゆっくり休んでね。', '今日の締めくくり、おつかれさま。'],
  },
  byTotal: {
    small: ['少しでも机に向かえた日。それで十分。'],
    middle: ['今日はしっかり時間を使えたね。'],
    large: ['今日はたっぷり勉強したね。ちゃんと休んでね。'],
  },
  byWeekDays: {
    first: ['今週のはじめの一歩、記録できたよ。'],
    many: ['今週はもう{n}日記録できてるよ。続いてるね。'],
  },
  withIssue: ['引っかかったところが見えたのは前進。次に活かせるよ。'],
  noIssue: ['今日はすらすら進んだ回だったんだね。'],
};

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// ctx: { timeBandId, dayMinutes, weekDays, hasIssue }
function buildDoneMessage(ctx) {
  const pool = [...MESSAGES.generic];
  if (MESSAGES.byBand[ctx.timeBandId]) pool.push(...MESSAGES.byBand[ctx.timeBandId]);

  const totalKey = ctx.dayMinutes < 30 ? 'small' : ctx.dayMinutes < 90 ? 'middle' : 'large';
  pool.push(...MESSAGES.byTotal[totalKey]);

  if (ctx.weekDays <= 1) pool.push(...MESSAGES.byWeekDays.first);
  else if (ctx.weekDays >= 3) {
    pool.push(...MESSAGES.byWeekDays.many.map((m) => m.replace('{n}', ctx.weekDays)));
  }

  pool.push(...(ctx.hasIssue ? MESSAGES.withIssue : MESSAGES.noIssue));
  return pickRandom(pool);
}
