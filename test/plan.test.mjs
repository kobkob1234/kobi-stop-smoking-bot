// ==========================================================================
//  ציר התוכנית — מעוגן ל-25.7.2026, יום הגמילה האפקטיבי.
//
//  7.7–24.7 היה ניסיון על מדבקה בלבד ובו 7 קניות; ההימנעות הרצופה
//  והמסטיק התחילו ב-25.7. לוח המדבקות עצמו לא זז — ולכן שלב המנה
//  המלאה הוא 24 ימים ולא 42, והתוכנית 52 ימים ולא 70.
//
//  הבדיקות כאן נגזרות מ-P ולא מקבעות מספרים: הן נשברו פעם אחת בדיוק
//  בגלל 70/69/42 קשיחים, וזה בזבוז — מה שבאמת צריך להיות מקובע הוא
//  התאריכים שבהם המינון יורד, לא אורך המערך.
// ==========================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/plan.js';

const days = Array.from({ length: P.TOTAL_DAYS }, (_, i) =>
  P.planFor(P.addDaysISO(P.QUIT, i), 0));
const LAST = days.length - 1;

test(`התוכנית היא ${P.TOTAL_DAYS} ימים ומתחילה ב-${P.QUIT}`, () => {
  assert.equal(days.length, P.TOTAL_DAYS);
  assert.equal(days[0].n, 1);
  assert.equal(days[0].iso, '2026-07-25');
  assert.equal(days[LAST].n, P.TOTAL_DAYS);
});

test('חלוקת המינונים: 24 × 21 מ״ג · 14 × 14 מ״ג · 14 × 7 מ״ג', () => {
  const count = d => days.filter(x => x.dose === d).length;
  assert.equal(count(21), 24);
  assert.equal(count(14), 14);
  assert.equal(count(7), 14);
  assert.equal(count(21) + count(14) + count(7), P.TOTAL_DAYS);
});

test('היום שבו יורדים ל-14 מ״ג הוא יום 25 — שלושה ימים אחרי סגירת החלון האקוטי', () => {
  const first14 = days.find(d => d.dose === 14);
  assert.equal(first14.n, 25, 'אם זה זז, ההערה במיקוד שבוע 4 ובאבן הדרך כבר לא נכונה');
});

test('המינון יורד מונוטונית ולעולם לא עולה', () => {
  let prev = Infinity;
  for (const d of days) {
    assert.ok(d.dose <= prev, `יום ${d.n}: ${prev} → ${d.dose}`);
    prev = d.dose;
  }
});

test('הירידות נופלות בדיוק ב-18.8 וב-1.9', () => {
  const first14 = days.find(d => d.dose === 14);
  const first7 = days.find(d => d.dose === 7);
  assert.equal(first14.iso, '2026-08-18');
  assert.equal(first7.iso, '2026-09-01');
});

test('היום האחרון הוא 14.9.2026 — לוח המדבקות המקורי לא זז', () => {
  assert.equal(days[LAST].iso, '2026-09-14');
  assert.equal(days[LAST].lastPatchISO, '2026-09-14');
  assert.ok(P.planFor('2026-09-15').after, '15.9 כבר מחוץ לתוכנית');
});

test('כל 6 ימים רצופים מכסים את כל ששת המקומות — כלומר מקום חוזר רק אחרי 6 ימים', () => {
  // 6 מקומות ברוטציה יומית: כל מקום חוזר ביום השביעי, וזו ההתנהגות
  // הנכונה. מה שחשוב הוא שאין חזרה *מוקדמת* מזה.
  for (let i = 0; i + 6 <= days.length; i++) {
    const window = days.slice(i, i + 6).map(d => d.site);
    assert.equal(new Set(window).size, 6,
      `ימים ${days[i].n}–${days[i + 5].n}: ${window.join(', ')}`);
  }
});

test('כל ששת המקומות בשימוש, ורק הם', () => {
  assert.deepEqual([...new Set(days.map(d => d.site))].sort(), [...P.SITES].sort());
  assert.equal(P.SITES.length, 6);
});

test('siteOffset מזיז את הרוטציה בלי לשבור אותה', () => {
  for (let off = 0; off < 6; off++) {
    const shifted = Array.from({ length: 12 }, (_, i) =>
      P.planFor(P.addDaysISO(P.QUIT, i), off).site);
    assert.equal(new Set(shifted).size, 6, `offset ${off} שבר את הרוטציה`);
  }
});

test('ספירת הימים הנקיים עולה ב-1 ליום', () => {
  for (let i = 1; i < days.length; i++) {
    assert.equal(days[i].clean, days[i - 1].clean + 1);
  }
});

test('addDaysISO ו-diffDays הפוכים זה לזה, וחוצים גבול חודש', () => {
  assert.equal(P.addDaysISO('2026-08-30', 5), '2026-09-04');
  assert.equal(P.diffDays('2026-08-30', '2026-09-04'), 5);
  assert.equal(P.diffDays('2026-09-04', '2026-08-30'), -5);
});

test('pick יציב — אותו תאריך מחזיר תמיד את אותו פריט', () => {
  const arr = ['א', 'ב', 'ג', 'ד', 'ה'];
  assert.equal(P.pick(arr, '2026-08-15'), P.pick(arr, '2026-08-15'));
});
