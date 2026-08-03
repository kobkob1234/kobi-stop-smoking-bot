// ==========================================================================
//  ה׳+ו׳ — בסיס הידע והתצוגה
//
//  kb.js הוא שכבת התשובות שעובדת **בלי AI בכלל** — כשהמכסה נגמרה,
//  כשהספקים למטה, וכשאין רשת. עד עכשיו לא נמדד עליה שום recall.
//  המדידה גילתה שרוב הניסוחים הטבעיים החזירו כלום, ושהמילה הנפוצה
//  ביותר בתחום — "דחף" — לא הייתה מילת מפתח באף כרטיס.
// ==========================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as KB from '../src/kb.js';
import * as M from '../src/messages.js';
import * as C from '../src/content.js';
import * as P from '../src/plan.js';
import { esc } from '../src/telegram.js';
import { day } from './helpers.mjs';

// ==========================================================================
//  E1 — recall על ניסוחים שאדם באמת כותב
// ==========================================================================

// לא מילות מפתח — משפטים. זה ההבדל בין בדיקה שמאשרת את עצמה לבדיקה
// שמודדת. כל שורה כאן היא ניסוח סביר בצ׳אט אמיתי.
const ASKS = [
  'יש לי דחף עכשיו מה לעשות',
  'כמה זמן לוקח שהדחף עובר',
  'מתי מורידים את המדבקה',
  'שכחתי לשים מדבקה הבוקר',
  'המדבקה מגרדת לי',
  'כמה מסטיקים ביום',
  'איך לועסים את המסטיק',
  'קניתי וויפ מה עכשיו',
  'נפלתי אתמול',
  'למה אני עולה במשקל',
  'אני לא ישן טוב',
  'אני עצבני כל הזמן',
  'מה זה RAIN',
  'אני משתעמם וזה מתחיל',
  'אלכוהול מותר',
  'אני בחוץ וקשה לי',
  'כמה כסף חסכתי',
  'יש קו תמיכה',
  'אני לחוץ נורא',
  'אני מרגיש שאני עומד ליפול',
];

test(`E1 · recall מלא על ${ASKS.length} ניסוחים אמיתיים`, () => {
  const miss = ASKS.filter(q => !KB.answer(q));
  assert.deepEqual(miss, [], `בלי תשובה: ${miss.join(' · ')}`);
});

test('E1 · ניסוחי משבר מוחזרים גם מה-KB, לא רק מהניתוב', () => {
  // fastRoute היא הרשת הראשונה. הכרטיס כאן הוא השנייה — אם ניסוח
  // יחמוק מהדפוס, ה-KB עדיין יחזיר מספרי סיוע ולא "שמרתי ביומן".
  for (const q of ['אני לא רוצה לחיות', 'בא לי למות', 'יש לי מחשבות אובדניות']) {
    const a = KB.answer(q);
    assert.ok(a, `אין תשובה: ${q}`);
    assert.ok(a.text.includes('1201'), `${q}: אין מספר ער"ן`);
  }
});

// ==========================================================================
//  E2 — precision: מה שמחוץ לתחום לא מקבל תשובה מצוטטת
// ==========================================================================

const OUT = [
  'מה אתה חושב על הכדורגל',
  'מה השעה',
  'ספר לי בדיחה',
  'מה מזג האוויר',
  'איך מכינים פסטה',
  'כמה זה 2+2',
  'מי ראש הממשלה',
  'המלץ לי על סרט',
  'מה קורה בחדשות',
];

test('E2 · שאילתה מחוץ לתחום לא מקבלת תשובה כסמכות', () => {
  // תשובה ישירה מוצגת עם ציטוט מקור, כלומר כסמכות. עדיף לשתוק
  // מאשר לצטט את הכרטיס הלא נכון בביטחון.
  const noise = OUT.filter(q => KB.answer(q));
  assert.deepEqual(noise.map(q => `${q} → ${KB.answer(q).t}`), []);
});

test('E2 · context מסמן התאמה חלשה במקום לחתוך', () => {
  // המודל מקבל גם התאמות חלשות, אבל עם תווית — כדי שישקול אותן
  // ולא יתייחס אליהן כסמכות.
  const weakish = KB.search('משהו כללי לגמרי על החיים', 3);
  for (const h of weakish) {
    if (h.score < KB.STRONG_SCORE) {
      assert.ok(KB.context('משהו כללי לגמרי על החיים').includes('התאמה חלשה'));
      return;
    }
  }
});

// ==========================================================================
//  שלמות ה-KB
// ==========================================================================

test('כל כרטיס שלם: id, מילות מפתח, כותרת, תשובה ומקור', () => {
  const ids = new Set();
  for (const c of KB.KB) {
    assert.ok(c.id && !ids.has(c.id), `id כפול או חסר: ${c.id}`);
    ids.add(c.id);
    assert.ok(Array.isArray(c.k) && c.k.length, `${c.id}: אין מילות מפתח`);
    assert.ok(c.t && c.a && c.src, `${c.id}: שדה ריק`);
    assert.ok(c.k.every(k => typeof k === 'string' && k.trim()), `${c.id}: מילת מפתח ריקה`);
  }
});

test('כל כרטיס נשלף על ידי לפחות אחת ממילות המפתח שלו', () => {
  // מילת מפתח שלא שולפת את הכרטיס שלה היא קוד מת שנראה כמו כיסוי.
  for (const c of KB.KB) {
    const found = c.k.some(k => KB.search(k, 5).some(h => h.id === c.id));
    assert.ok(found, `${c.id}: אף מילת מפתח לא שולפת אותו`);
  }
});

// ==========================================================================
//  ו׳ — F2: תקינות HTML בכל טקסט שנשלח לטלגרם
// ==========================================================================

const TAGS = ['b', 'i', 'code', 'u', 's'];
const checkHtml = (txt, where) => {
  for (const tag of TAGS) {
    const o = (txt.match(new RegExp(`<${tag}>`, 'g')) || []).length;
    const c = (txt.match(new RegExp(`</${tag}>`, 'g')) || []).length;
    assert.equal(o, c, `${where}: <${tag}> לא מאוזן`);
  }
  const stray = txt.match(/<(?!\/?(?:b|i|code|u|s)>)[^>]{0,20}>/g);
  assert.equal(stray, null, `${where}: תגית לא נתמכת ${stray && stray[0]}`);
};

test('F2 · כל תשובות ה-KB הן HTML תקין לטלגרם', () => {
  for (const c of KB.KB) checkHtml(c.a, `kb:${c.id}`);
});

test('F2 · כל הטקסטים הסטטיים ב-content.js תקינים', () => {
  for (const [name, val] of Object.entries(C)) {
    if (typeof val === 'string') checkHtml(val, `content:${name}`);
  }
});

test('F2 · TOOL_TEXTS תקינים', () => {
  for (const [k, v] of Object.entries(M.TOOL_TEXTS)) {
    if (typeof v === 'string') checkHtml(v, `tool:${k}`);
  }
});

// ==========================================================================
//  ו׳ — F1: בוני ההודעות בשלושת מצבי היום
// ==========================================================================

const META = {
  chatId: 1, costPerDay: 25, gumSoftCap: 18, partner: '', identity: 'אני לא מווייפ.',
  totals: { surfed: 3, waves: 47, slips: 0, outs: 0, mDone: 0, eDone: 0, gum: 62, patch: 3, planning: 7, chainStops: 0, enroute: 13 },
  jarTotal: 0, sent: {}, scenes: '',
};
const IL = P.il(new Date('2026-08-03T09:00:00Z'));

test('F1 · בוני ההודעות לא פולטים undefined בשום מצב של היום', () => {
  // לפני התוכנית / בתוכנית / אחריה — שלושתם צורות שונות של pl,
  // ורק אחת מהן מכילה dose ו-site.
  const days = ['2026-07-20', '2026-08-03', '2026-09-20'];
  for (const iso of days) {
    const pl = P.planFor(iso, 0);
    const d = day({ gum: 5, waves: 2, surfed: 1, patch: true });
    const outs = [
      M.morning(pl, d, META),
      M.noon(pl, iso, d, META),
      M.evening(pl, iso, d, META, false),
      M.status(pl, iso, d, META),
      M.outing(pl, iso, d, META, IL),
      M.welcome(pl, META),
      M.jar(pl, META),
    ];
    for (const o of outs) {
      const txt = typeof o === 'string' ? o : (o && o.text) || '';
      assert.ok(txt.length, `${iso}: הודעה ריקה`);
      // ההודעה חייבת להיות בטוחה-ל-null: assert.ok מעריך את הארגומנט
      // השני **תמיד**, גם כשהתנאי מתקיים, ולכן match(...)[0] על התאמה
      // ריקה הפיל את הבדיקה שעברה בפועל.
      const bad = txt.match(/.{0,40}(undefined|NaN|\[object).{0,20}/);
      assert.equal(bad, null, `${iso}: ${bad ? bad[0] : ''}`);
      checkHtml(txt, `msg:${iso}`);
    }
  }
});

test('F1 · sos ו-rainWalk תקינים בכל שלב', () => {
  for (let i = 1; i <= 4; i++) {
    const m = M.sos(i);
    const t = typeof m === 'string' ? m : m.text;
    assert.ok(t && !/undefined/.test(t), `sos(${i})`);
    checkHtml(t, `sos:${i}`);
  }
  for (let i = 0; i < 4; i++) {
    const t = M.rainWalk(i);
    const s = typeof t === 'string' ? t : (t && t.text) || '';
    if (s) checkHtml(s, `rain:${i}`);
  }
});

// ==========================================================================
//  ו׳ — F3: telegram.js
// ==========================================================================

test('F3 · esc בורח מהתווים שטלגרם דורש, ולא מהאחרים', () => {
  assert.equal(esc('<b>'), '&lt;b&gt;');
  assert.equal(esc('a & b'), 'a &amp; b');
  assert.equal(esc('שלום'), 'שלום');
  assert.equal(esc(''), '');
});
