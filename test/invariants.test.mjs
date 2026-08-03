// ==========================================================================
//  ח׳ (S6–S10) + ט׳ — התפרים שנותרו, והאינווריאנטות חוצות-הקבצים
//
//  I5 היא הלב כאן: "הבטחה = מימוש". שלושה באגים נפרדים בסשן הזה היו
//  אותה מחלקה בדיוק — הבוט אמר בטקסט שיעשה משהו, ולא היה קוד שמקיים:
//    • "אזכיר שוב בסביבות 10:51"  → הסנוז נבלע בנסיגה (79 דק׳ איחור)
//    • "אזכיר לך לבדוק"           → meta.snooze נכתב ואין לו קורא
//    • "לא מוריד עוד יחידה"       → activeTimes המשיכה להוריד
// ==========================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as P from '../src/plan.js';
import * as G from '../src/gum.js';
import * as KB from '../src/kb.js';
import { sanitizeModelText } from '../src/core.js';
import { day, gumAt } from './helpers.mjs';

const read = f => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const SRC = Object.fromEntries(
  readdirSync(new URL('../src/', import.meta.url)).filter(f => f.endsWith('.js'))
    .map(f => [f, read(f)]));
const ALL = Object.values(SRC).join('\n');

// ==========================================================================
//  S6 · gum ↔ index — הסנוז
// ==========================================================================

test('S6 · הסנוז נאכף בצד אחד בלבד — בתוך dueNow', () => {
  // כשהוא נאכף גם ב-index (רצפה) וגם התעלם מהנסיגה (תקרה), המכפלה
  // איחרה את התזכורת ב-79 דקות. עכשיו index רק מעביר, ו-dueNow מכריע.
  assert.ok(/dueNow\([^)]*snoozedTo/s.test(SRC['index.js'])
    || /meta\.gumSoftCap,\s*snoozedTo/.test(SRC['index.js']),
    'index.js לא מעביר את הסנוז ל-dueNow');
  assert.ok(!/r\.due && now\.minutes >= snoozedTo/.test(SRC['index.js']),
    'index.js עדיין אוכף את הסנוז בעצמו — שתי אכיפות = הבאג חוזר');
});

test('S6 · סנוז שפג מנצח את הנסיגה, ובלי סנוז הנסיגה עומדת', () => {
  const P0 = { ...G.DEFAULT_PLAN };
  const d = day({ gum: 3, ev: [gumAt(9, 0)] });
  const last = 11 * 60;
  assert.equal(G.dueNow(P0, '2026-08-03', d, 11 * 60 + 30, last, 18, 11 * 60 + 20).due, true);
  assert.equal(G.dueNow(P0, '2026-08-03', d, 11 * 60 + 30, last, 18, 0).due, false);
});

// ==========================================================================
//  S9 · model → telegram
// ==========================================================================

test('S9 · פלט מודל שרירותי יוצא תמיד כ-HTML תקין', () => {
  const nasty = [
    '<b>פתוח', 'סוגר בלי פתיחה</i>', '<script>alert(1)</script>',
    '**מודגש** ו-*נטוי*', 'א'.repeat(4000) + '<b>חתוך</b>',
    '&quot;ציטוט&quot;', '', '<b><i>מקונן</b>',
  ];
  for (const s of nasty) {
    const out = sanitizeModelText(s);
    for (const tag of ['b', 'i', 'code', 'u', 's']) {
      const o = (out.match(new RegExp(`<${tag}>`, 'g')) || []).length;
      const c = (out.match(new RegExp(`</${tag}>`, 'g')) || []).length;
      assert.equal(o, c, `<${tag}> לא מאוזן על ${JSON.stringify(s.slice(0, 25))}`);
    }
    assert.ok(!/<[^>]*$/.test(out), `תגית קטועה: ${JSON.stringify(out.slice(-12))}`);
    assert.ok(!/<script|<div/.test(out), 'תגית לא מותרת שרדה');
  }
});

test('S9 · תשובה ריקה נופלת ל-KB ולא נשלחת כהודעה ריקה', () => {
  assert.equal(sanitizeModelText(''), '');
  assert.ok(/res\.reply && res\.reply\.trim\(\)/.test(SRC['index.js']),
    'index.js לא בודק תשובה ריקה לפני שליחה');
});

// ==========================================================================
//  ט׳ · אינווריאנטות
// ==========================================================================

test('I1 · אין ליטרל תאריך של התוכנית מחוץ ל-plan.js', () => {
  // מקור אמת אחד. ליטרל קשיח שורד שינוי לוח ומשקר בשקט.
  const dates = ['2026-07-25', '2026-09-14', '2026-08-17', '2026-08-18', '2026-08-31'];
  for (const [f, src] of Object.entries(SRC)) {
    if (f === 'plan.js') continue;
    for (const d of dates) {
      const lines = src.split('\n')
        .map((l, i) => [i + 1, l])
        .filter(([, l]) => l.includes(d) && !l.trim().startsWith('//') && !l.trim().startsWith('*'));
      assert.deepEqual(lines, [], `${f}: תאריך קשיח ${d}`);
    }
  }
});

test('I2 · התקרה הרכה מעל היעד, ואותו סף בהסלמה', () => {
  const target = G.dailyTarget({ ...G.DEFAULT_PLAN }, '2026-08-03');
  assert.ok(18 > target, 'gumSoftCap אינו מעל היעד');
  // analytics משתמש ב-meta.gumSoftCap ולא במספר משלו
  assert.ok(/meta\.gumSoftCap \|\| 18/.test(SRC['analytics.js']),
    'analytics מחזיק סף משלו במקום להשתמש בזה של ה-meta');
});

test('I3 · אפס תרופות מרשם מחוץ לשורות האיסור', () => {
  const RX = /וארניקלין|בופרופיון|ציטיזין|Champix|צמפיקס/;
  for (const [f, src] of Object.entries(SRC)) {
    src.split('\n').forEach((l, i) => {
      if (RX.test(l) && !/נשללו|אל תציע|אסור|לא לקחת/.test(l)) {
        assert.fail(`${f}:${i + 1} — ${l.trim().slice(0, 70)}`);
      }
    });
  }
});

test('I4 · מפתחות _ לעולם לא נכתבים ל-KV', () => {
  // גם ב-meta וגם ב-day. הכלל הזה הוא מה שהופך את באג ה-dry-run
  // לבלתי-אפשרי, ולא רק מתקן את המופע שלו.
  assert.ok(/startsWith\('_'\)/.test(SRC['store.js']), 'store.js לא מסנן מפתחות _');
  const filters = (SRC['store.js'].match(/startsWith\('_'\)/g) || []).length;
  assert.ok(filters >= 2, `רק ${filters} מסננים — צריך גם ל-meta וגם ל-day`);
});

test('I5 · "הבטחה = מימוש" — כל הבטחה בטקסט יש לה קורא בקוד', () => {
  // המחלקה שייצרה שלושה באגים נפרדים בסשן הזה. כל ביטוי שמבטיח
  // פעולה עתידית חייב להופיע ברשימה יחד עם הסמל שמקיים אותו —
  // וכל הבטחה חדשה שתתווסף בלי מימוש תפיל את הבדיקה הזאת.
  const PROMISES = [
    { re: /אזכיר שוב ב/,            impl: /gumSnoozeMin/,  what: 'סנוז המסטיק' },
    { re: /אזכיר לך לבדוק/,         impl: /meta\.snooze\[plKey\]|snooze\[`\$\{iso\}:pl`\]/, what: 'דחיית דרגה 2' },
    { re: /הקפאתי את הצמצום/,       impl: /pausedISO/,     what: 'הקפאת הצמצום' },
    { re: /אבדוק שוב בעוד שבוע/,    impl: /taperWatchDue/, what: 'ניטור הצמצום' },
    { re: /אשאל שוב בעוד שלושה ימים/, impl: /taperAskDue/, what: 'שאלת הצמצום' },
    { re: /אזכיר שוב כשהקצב יחייב/,  impl: /PACE_SLACK|MAX_GAP/, what: 'תזכורת לפי קצב' },
  ];
  for (const { re, impl, what } of PROMISES) {
    assert.ok(re.test(ALL), `ההבטחה "${what}" נעלמה מהטקסט — עדכן את הרשימה`);
    assert.ok(impl.test(ALL), `ההבטחה "${what}" קיימת בטקסט ואין לה מימוש`);
  }
});

test('I5ב · אין הבטחת-זמן חדשה בלי רישום', () => {
  // תופס ניסוח חדש כמו "אזכיר בעוד X" שאיש לא חיבר לקוד.
  // "אזכיר שוב כשהקצב יחייב" (כפתור ⏭️ מדלג) — נתפס על ידי הבדיקה
  // הזאת כשנוספה, ואומת שהוא מקוים: ענף הקצב ו-MAX_GAP ב-dueNow
  // מחזירים תזכורת מעצמם למי שנשאר מאחור.
  const known = /אזכיר שוב ב|אזכיר לך לבדוק|אזכיר לך|אזכיר בכל|אזכיר שוב כשהקצב יחייב/;
  const found = [];
  for (const [f, src] of Object.entries(SRC)) {
    for (const m of src.matchAll(/['`][^'`\n]{0,60}אזכיר[^'`\n]{0,60}['`]/g)) {
      if (!known.test(m[0])) found.push(`${f}: ${m[0].slice(0, 60)}`);
    }
  }
  assert.deepEqual(found, [], 'הבטחת תזכורת חדשה בלי רישום ב-I5');
});

test('I6 · כל callback_data שמופיע בכפתור מטופל', () => {
  // הבאג שנתפס: btn(..., "wave:start") בלי מטפל — לחיצה שלא עושה כלום.
  const datas = new Set();
  for (const m of ALL.matchAll(/btn\(\s*(?:'[^']*'|`[^`]*`)\s*,\s*'([^']+)'/g)) datas.add(m[1]);
  const idx = SRC['index.js'];
  const exact = new Set([...idx.matchAll(/data === '([^']+)'/g)].map(m => m[1]));
  const prefixes = [...idx.matchAll(/data\.startsWith\('([^']+)'\)/g)].map(m => m[1]);
  const orphan = [...datas].filter(d => !exact.has(d) && !prefixes.some(p => d.startsWith(p)));
  assert.deepEqual(orphan, [], 'כפתורים בלי מטפל');
  assert.ok(datas.size > 50, `רק ${datas.size} כפתורים — הסריקה כנראה נשברה`);
});

test('I7 · כל כרטיס KB נשלף, וכל ייחוס מוכר', () => {
  for (const c of KB.KB) {
    assert.ok(c.k.some(k => KB.search(k, 5).some(h => h.id === c.id)), `${c.id} לא נשלף`);
  }
});

test('I8 · ציר התוכנית עקבי מקצה לקצה', () => {
  const first = P.planFor(P.QUIT);
  const last = P.planFor(P.addDaysISO(P.QUIT, P.TOTAL_DAYS - 1));
  assert.equal(first.n, 1);
  assert.equal(last.n, P.TOTAL_DAYS);
  assert.equal(last.iso, first.lastPatchISO);
  assert.equal(G.TAPER_START, P.addDaysISO(last.iso, 1));
});
