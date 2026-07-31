// ==========================================================================
//  ציר 70 הימים — התוכנית שהוא באמת חי לפיה
// ==========================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/plan.js';

const days = Array.from({ length: P.TOTAL_DAYS }, (_, i) =>
  P.planFor(P.addDaysISO(P.QUIT, i), 0));

test(`התוכנית היא ${P.TOTAL_DAYS} ימים`, () => {
  assert.equal(days.length, 70);
  assert.equal(days[0].n, 1);
  assert.equal(days[69].n, 70);
});

test('חלוקת המינונים: 42 × 21 מ״ג · 14 × 14 מ״ג · 14 × 7 מ״ג', () => {
  const count = d => days.filter(x => x.dose === d).length;
  assert.equal(count(21), 42);
  assert.equal(count(14), 14);
  assert.equal(count(7), 14);
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

test('היום האחרון הוא 14.9.2026', () => {
  assert.equal(days[69].iso, '2026-09-14');
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
