// 選択肢の初期値。端末内のマスタ変更（学習記録設定）がこれを上書きする。個人情報は書かない。

const SUBJECTS = ['国語', '数学', '英語', '理科', '社会'];

// 記録の保存先（非公開リポジトリ）。名前は秘密ではない。鍵（トークン）はここに書かない
const SYNC_DEFAULTS = { owner: 'leo-polaris-works', repo: 'study-records' };

const UNITS = ['問題', '語', '字', 'ページ', '回', '個', 'なし'];

const UNIT_PRESETS = {
  問題: [5, 10, 20, 30, 40, 50],
  語: [10, 20, 30, 50, 100, 200],
  字: [5, 10, 20, 30, 50, 100],
  ページ: [1, 3, 5, 8, 10, 20],
  回: [1, 2, 3, 4, 5, 6],
  個: [5, 10, 20, 30, 40, 50],
  なし: [],
};

const ISSUE_GROUPS = ['わからなかった', 'やり方・復習', '体調・気持ち・時間'];
const ISSUE_MAX = 3;
const UNCLEAR_GROUP = 'わからなかった'; // この群の課題を選んだら「わからなかったところ」を書ける
const UNCLEAR_MAX = 100;

const ACCURACY_LEVELS = [
  { level: 1, label: '〜30%' },
  { level: 2, label: '〜50%' },
  { level: 3, label: '〜70%' },
  { level: 4, label: '〜90%' },
  { level: 5, label: 'ほぼ全問' },
];

function fieldItem(id, subject, label) {
  return { id: 'f-' + id, subject, label, active: true };
}

function materialItem(id, subject, label, unit) {
  return { id: 'm-' + id, subject, label, unit, active: true };
}

const DEFAULT_MASTERS = {
  timeband: [
    { id: 'tb-morning', label: '朝', hint: '〜8時', startHour: 0, active: true },
    { id: 'tb-am', label: '午前', hint: '8〜12時', startHour: 8, active: true },
    { id: 'tb-pm', label: '午後', hint: '12〜17時', startHour: 12, active: true },
    { id: 'tb-evening', label: '夕方', hint: '17〜19時', startHour: 17, active: true },
    { id: 'tb-night', label: '夜', hint: '19時〜', startHour: 19, active: true },
  ],

  // やったこと（何のためにやったか）
  activity: [
    { id: 'a-pre', label: '予習', active: true },
    { id: 'a-review-week', label: '復習（今週の授業）', active: true },
    { id: 'a-review-past', label: '復習（先週以前）', active: true },
    { id: 'a-test', label: 'テスト対策', active: true },
    { id: 'a-hw', label: '宿題・提出物', active: true },
    { id: 'a-other', label: 'その他', active: true },
  ],

  // 学習内容（何に時間をかけたか。教科ごとの項目。項目ごとに時間を選ぶ）
  field: [
    fieldItem('jp-kanji', '国語', '漢字'),
    fieldItem('jp-grammar', '国語', '文法'),
    fieldItem('jp-classic', '国語', '古文・古文単語'),
    fieldItem('jp-reading', '国語', '読解'),
    fieldItem('jp-writing', '国語', '作文・記述'),
    fieldItem('jp-other', '国語', 'その他'),

    fieldItem('ma-calc', '数学', '計算'),
    fieldItem('ma-word', '数学', '文章題'),
    fieldItem('ma-figure', '数学', '図形'),
    fieldItem('ma-func', '数学', '関数・グラフ'),
    fieldItem('ma-other', '数学', 'その他'),

    fieldItem('en-word', '英語', '単語・熟語'),
    fieldItem('en-grammar', '英語', '文法'),
    fieldItem('en-text', '英語', '教科書本文'),
    fieldItem('en-reading', '英語', '長文読解'),
    fieldItem('en-listening', '英語', 'リスニング'),
    fieldItem('en-writing', '英語', '英作文'),
    fieldItem('en-other', '英語', 'その他'),

    fieldItem('sc-physics', '理科', '物理'),
    fieldItem('sc-chem', '理科', '化学'),
    fieldItem('sc-bio', '理科', '生物'),
    fieldItem('sc-earth', '理科', '地学'),
    fieldItem('sc-other', '理科', 'その他'),

    fieldItem('so-geo', '社会', '地理'),
    fieldItem('so-history', '社会', '歴史'),
    fieldItem('so-civics', '社会', '公民'),
    fieldItem('so-other', '社会', 'その他'),
  ],

  // 量の項目（何をどれくらいやったか。教科ごとの教材・作業。単位を持つ）
  material: [
    materialItem('jp-hw', '国語', '宿題', 'ページ'),
    materialItem('jp-work', '国語', 'ワーク', 'ページ'),
    materialItem('jp-kanji', '国語', '漢字', '字'),
    materialItem('jp-classic', '国語', '古文単語', '語'),
    materialItem('jp-text', '国語', '教科書', 'ページ'),
    materialItem('jp-exam', '国語', '過去問・模試', '回'),
    materialItem('jp-redo', '国語', '解き直し', '問題'),
    materialItem('jp-other', '国語', 'その他', 'なし'),

    materialItem('ma-hw', '数学', '宿題', 'ページ'),
    materialItem('ma-work', '数学', 'ワーク', 'ページ'),
    materialItem('ma-calc', '数学', '計算', '問題'),
    materialItem('ma-text', '数学', '教科書', 'ページ'),
    materialItem('ma-exam', '数学', '過去問・模試', '回'),
    materialItem('ma-redo', '数学', '解き直し', '問題'),
    materialItem('ma-other', '数学', 'その他', 'なし'),

    materialItem('en-hw', '英語', '宿題', 'ページ'),
    materialItem('en-work', '英語', 'ワーク', 'ページ'),
    materialItem('en-word', '英語', '単語', '語'),
    materialItem('en-text', '英語', '教科書', 'ページ'),
    materialItem('en-listening', '英語', 'リスニング', '回'),
    materialItem('en-long', '英語', '長文', '問題'),
    materialItem('en-exam', '英語', '過去問・模試', '回'),
    materialItem('en-redo', '英語', '解き直し', '問題'),
    materialItem('en-other', '英語', 'その他', 'なし'),

    materialItem('sc-hw', '理科', '宿題', 'ページ'),
    materialItem('sc-work', '理科', 'ワーク', 'ページ'),
    materialItem('sc-text', '理科', '教科書', 'ページ'),
    materialItem('sc-term', '理科', '用語暗記', '語'),
    materialItem('sc-exam', '理科', '過去問・模試', '回'),
    materialItem('sc-redo', '理科', '解き直し', '問題'),
    materialItem('sc-other', '理科', 'その他', 'なし'),

    materialItem('so-hw', '社会', '宿題', 'ページ'),
    materialItem('so-work', '社会', 'ワーク', 'ページ'),
    materialItem('so-text', '社会', '教科書', 'ページ'),
    materialItem('so-term', '社会', '用語暗記', '語'),
    materialItem('so-exam', '社会', '過去問・模試', '回'),
    materialItem('so-redo', '社会', '解き直し', '問題'),
    materialItem('so-other', '社会', 'その他', 'なし'),
  ],

  duration: [
    { id: 'd-10', label: '10分', minutes: 10, active: true },
    { id: 'd-15', label: '15分', minutes: 15, active: true },
    { id: 'd-20', label: '20分', minutes: 20, active: true },
    { id: 'd-25', label: '25分', minutes: 25, active: true },
    { id: 'd-30', label: '30分', minutes: 30, active: true },
    { id: 'd-35', label: '35分', minutes: 35, active: true },
    { id: 'd-40', label: '40分', minutes: 40, active: true },
    { id: 'd-45', label: '45分', minutes: 45, active: true },
    { id: 'd-50', label: '50分', minutes: 50, active: true },
    { id: 'd-55', label: '55分', minutes: 55, active: true },
    { id: 'd-60', label: '60分', minutes: 60, active: true },
    { id: 'd-90', label: '90分', minutes: 90, active: true },
  ],

  issue: [
    { id: 'i-nounder', label: 'そもそも分からない', group: 'わからなかった', active: true },
    { id: 'i-before', label: '前の内容があやしい', group: 'わからなかった', active: true },
    { id: 'i-memo', label: '覚えきれない', group: 'わからなかった', active: true },
    { id: 'i-word', label: '文章題・記述', group: 'わからなかった', active: true },
    { id: 'i-grammar', label: '文法・長文', group: 'わからなかった', active: true },
    { id: 'i-seeans', label: '見れば分かる', group: 'やり方・復習', active: true },
    { id: 'i-again', label: 'また間違えた', group: 'やり方・復習', active: true },
    { id: 'i-forgot', label: '前のを忘れた', group: 'やり方・復習', active: true },
    { id: 'i-sleepy', label: '眠い・疲れた', group: '体調・気持ち・時間', active: true },
    { id: 'i-phone', label: 'スマホが気になる', group: '体調・気持ち・時間', active: true },
    { id: 'i-mood', label: '気が乗らない', group: '体調・気持ち・時間', active: true },
    { id: 'i-time', label: '時間が足りない', group: '体調・気持ち・時間', active: true },
  ],
};

const MASTER_TITLES = {
  activity: 'やったこと',
  field: '学習内容（時間）',
  material: '量の項目',
  duration: '合計時間',
  issue: '課題',
  timeband: '時間帯',
};

// 学習計画（逆算）の既定値。考え方は非公開側の設計文書にある
const PLAN_DEFAULTS = {
  firstAccuracy: 0.6, // 1周目の正答率の見込み（記録が少ない間）
  laps: { ページ: 3, 問題: 3, 語: 3, 字: 3, 個: 3, 回: 1 },
  lapsByMaterial: { 'm-sc-term': 5, 'm-so-term': 5 },
  pace: { ページ: 6, 問題: 2, 語: 0.5, 字: 0.5, 個: 1, 回: 20 }, // 1単位あたりの分（記録が少ない間）
  minPaceSamples: 3,
  redoFactor: 1.2, // 解き直しは1単位に時間がかかる
  memoDecay: 0.5, // 暗記は周ごとに時間が半分になる
  phase1Days: 7, // テストの何日前までに1周目を終えるか
  phase2Days: 3, // テストの何日前までに解き直しを終えるか
  lagRatio: 0.85, // 実績÷計画がこれ未満なら「遅れ」と表示する
  accuracyRates: { 1: 0.2, 2: 0.4, 3: 0.6, 4: 0.75, 5: 0.9 },
};

const PHASE_LABELS = { 1: '1周目', 2: '解き直し', 3: '仕上げ' };

// 振り返りの気づきの判定。考え方は非公開側の設計文書にある
const REVIEW_RULES = {
  windowDays: 14, // つまずき・抜けを見る期間
  minRecords: 3, // これより記録が少なければ、計画の遅れだけを見る
  bigLagRatio: 0.6, // やった量÷予定がこれ未満なら、大きな遅れ
  aheadRatio: 1.2, // これ以上なら、予定より進んでいる
  lowLevel: 2, // 正答率の段階がこれ以下を「低い」とする（〜50%）
  spinMinutes: 60, // 同じ分野にこれ以上かけても正答率が低いままなら、空回り
  spinRecords: 2,
  repeatIssue: 3, // 同じ課題がこの回数以上
  gapRecords: 5, // 期間の記録がこれ以上あるのに0件の教科を「抜け」とする
  dropRatio: 0.5, // 今週の合計が先週のこの割合未満なら、量の減少
  dropMinMinutes: 120, // 先週がこれ以上のときだけ、量の減少を見る
  increaseMinutes: 15, // 先週よりこれ以上ふえた教科を、できたことに出す
  maxInsights: 3,
  maxPraise: 3,
};

// 今週がんばること（決まった候補）
const CHANGE_CANDIDATES = [
  { id: 'c-word-5', label: '単語1日5語' },
  { id: 'c-bedtime-memo', label: '寝る前10分暗記' },
  { id: 'c-daily', label: '毎日、ワークを少しでも進める' },
  { id: 'c-behind-first', label: '遅れている教材から先にやる' },
  { id: 'c-on-time', label: '毎日計画の時間通り勉強する' },
];
const CHANGE_FREE_ID = 'c-free'; // 自分で書いたもの
const CHANGE_TEXT_MAX = 30;
