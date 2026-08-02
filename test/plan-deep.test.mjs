// ==========================================================================
//  A1 — plan.js לעומק: גבולות, שעון, ורוטציה
//
//  plan.test.mjs מכסה את הציר. כאן הענפים: מה קורה לפני התוכנית ואחריה,
//  מה קורה במעבר שעון החורף שנופל **בתוך** צמצום המסטיק (25.10.2026),
//  ומה קורה בקצוות של חשבון התאריכים.
// ==========================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/plan.js';

// ---------- חשבון תאריכים ----------

test('addDaysISO ו-diffDays הפוכים, כולל חציית שנה ושנה מעוברת', () => {
  const cases = [
    ['2026-12-31', 1, '2027-01-01'],
    ['2027-01-01', -1, '2026-12-31'],
    ['2026-02-28', 1, '2026-03-01'],   // 2026 אינה מעוברת
    ['2028-02-28', 1, '2028-02-29'],   // 2028 כן
    ['2026-08-31', 1, '2026-09-01'],
    ['2026-09-15', 36, '2026-10-21'],
  ];
  for (const [from, n, to] of cases) {
    assert.equal(P.addDaysISO(from, n), to, `${from} + ${n}`);
    assert.equal(P.diffDays(from, to), n, `diff ${from}→${to}`);
  }
});

test('diffDays סימטרי ואפס לעצמו', () => {
  assert.equal(P.diffDays('2026-08-02', '2026-08-02'), 0);
  assert.equal(P.diffDays('2026-08-02', '2026-08-09'), 7);
  assert.equal(P.diffDays('2026-08-09', '2026-08-02'), -7);
});

test('fmtHe מסיר אפסים מובילים', () => {
  assert.equal(P.fmtHe('2026-08-02'), '2.8.26');
  assert.equal(P.fmtHe('2026-12-31'), '31.12.26');
});

// ---------- מעבר שעון החורף — נופל בתוך צמצום המסטיק ----------

test('מעבר שעון החורף (25.10.2026) לא מדלג על יום ולא מכפיל יום', () => {
  // ישראל עוברת לשעון חורף ב-25.10.2026: 02:00 IDT → 01:00 IST.
  // diffDays עובד ב-UTC ולכן חסין, אבל il() נגזר מ-Intl באזור הזמן —
  // ואם שם היה סחף, מספר היום בתוכנית היה קופץ או נתקע.
  const at = utc => P.il(new Date(utc));
  assert.equal(at('2026-10-24T20:00:00Z').iso, '2026-10-24', 'ערב לפני, IDT');
  assert.equal(at('2026-10-24T21:00:00Z').iso, '2026-10-25', 'חצות IDT');
  assert.equal(at('2026-10-24T22:30:00Z').iso, '2026-10-25', 'לפני המעבר');
  assert.equal(at('2026-10-24T23:30:00Z').iso, '2026-10-25', 'אחרי המעבר — אותו יום');
  assert.equal(at('2026-10-25T21:59:00Z').iso, '2026-10-25', 'סוף היום ב-IST');
  assert.equal(at('2026-10-25T22:00:00Z').iso, '2026-10-26', 'חצות IST');
});

test('השעה המקומית נכונה משני צדי המעבר', () => {
  // אותה שעת קיר (01:30) מופיעה פעמיים — פעם ב-IDT ופעם ב-IST.
  assert.equal(P.il(new Date('2026-10-24T22:30:00Z')).hhmm, '01:30');
  assert.equal(P.il(new Date('2026-10-24T23:30:00Z')).hhmm, '01:30');
});

test('רצף ימים לאורך המעבר עולה ב-1 בדיוק', () => {
  let prev = null;
  for (let h = 0; h < 96; h++) {
    const iso = P.il(new Date(Date.parse('2026-10-23T12:00:00Z') + h * 3600000)).iso;
    if (prev && iso !== prev) {
      assert.equal(P.diffDays(prev, iso), 1, `קפיצה מ-${prev} ל-${iso}`);
    }
    prev = iso;
  }
});

test('il מחזיר יום-בשבוע תקין — 6 הוא שבת', () => {
  // dow משמש לדוח השבועי (now.dow === 6). אם Intl יחזיר פורמט אחר,
  // indexOf יחזיר -1 והדוח פשוט לא יישלח לעולם.
  assert.equal(P.il(new Date('2026-08-01T09:00:00Z')).dow, 6, '1.8.2026 הוא שבת');
  assert.equal(P.il(new Date('2026-08-02T09:00:00Z')).dow, 0, '2.8 ראשון');
  for (let d = 0; d < 7; d++) {
    const x = P.il(new Date(Date.parse('2026-08-01T09:00:00Z') + d * 86400000));
    assert.ok(x.dow >= 0 && x.dow <= 6, `dow לא תקין: ${x.dow}`);
    assert.ok(x.dowHe && x.dowHe.length, 'dowHe ריק');
  }
});

// ---------- planFor: שלושת המצבים ----------

test('לפני התוכנית — before, עם ספירה לאחור', () => {
  const p = P.planFor('2026-07-20');
  assert.equal(p.before, true);
  assert.equal(p.daysToQuit, 5);
  assert.equal(p.dose, undefined, 'אין מינון לפני שהתחלנו');
});

test('אחרי התוכנית — after, עם ימים נקיים', () => {
  const p = P.planFor('2026-09-20');
  assert.equal(p.after, true);
  assert.equal(p.cleanDays, 57);
});

test('היום הראשון והאחרון בדיוק על הגבול', () => {
  assert.equal(P.planFor('2026-07-24').before, true);
  assert.equal(P.planFor('2026-07-25').n, 1);
  assert.equal(P.planFor('2026-09-14').n, P.TOTAL_DAYS);
  assert.equal(P.planFor('2026-09-15').after, true);
});

test('כל יום בתוכנית מקבל מינון, שלב, מקום ומיקוד', () => {
  for (let i = 0; i < P.TOTAL_DAYS; i++) {
    const p = P.planFor(P.addDaysISO(P.QUIT, i));
    assert.ok([21, 14, 7].includes(p.dose), `יום ${p.n}: מינון ${p.dose}`);
    assert.ok(p.phase && p.product && p.site, `יום ${p.n}: שדה חסר`);
    assert.ok(p.focus && p.focus.length > 10, `יום ${p.n}: מיקוד ריק`);
    assert.equal(p.week, Math.floor(i / 7) + 1);
    assert.equal(p.clean, i);
  }
});

// ---------- תוכן לפי יום ----------

test('כל מפתח באבני הדרך נמצא בתוך התוכנית', () => {
  for (const k of Object.keys(P.MILESTONES).map(Number)) {
    assert.ok(k >= 1 && k <= P.TOTAL_DAYS, `אבן דרך ליום ${k} מחוץ ל-1..${P.TOTAL_DAYS}`);
    assert.equal(P.planFor(P.addDaysISO(P.QUIT, k - 1)).milestone, P.MILESTONES[k]);
  }
});

test('אבני הדרך של ירידות המינון נופלות ביום שבו המינון באמת יורד', () => {
  // אם המפתח והפאזה יתפצלו, ההודעה תבשר על ירידה ביום הלא נכון.
  for (const [dayN, mustDrop] of [[25, 14], [39, 7]]) {
    const p = P.planFor(P.addDaysISO(P.QUIT, dayN - 1));
    const prev = P.planFor(P.addDaysISO(P.QUIT, dayN - 2));
    assert.equal(p.dose, mustDrop, `יום ${dayN}`);
    assert.ok(prev.dose > p.dose, `יום ${dayN}: המינון לא ירד בפועל`);
    assert.ok(P.MILESTONES[dayN].includes(String(mustDrop)), 'הטקסט לא תואם למינון');
  }
});

test('WEEK_FOCUS מכסה את כל השבועות בלי ערכים מתים', () => {
  const weeks = Math.ceil(P.TOTAL_DAYS / 7);
  assert.equal(P.WEEK_FOCUS.length, weeks,
    `${P.WEEK_FOCUS.length} מיקודים ל-${weeks} שבועות — עודף הוא קוד מת, חוסר הוא נפילה לברירת מחדל`);
});

test('טיפ יומי קיים בחלון האקוטי ונעלם אחריו', () => {
  assert.ok(P.planFor(P.addDaysISO(P.QUIT, 0)).tip, 'יום 1 בלי טיפ');
  assert.ok(P.planFor(P.addDaysISO(P.QUIT, 20)).tip, 'יום 21 בלי טיפ');
  assert.equal(P.planFor(P.addDaysISO(P.QUIT, 40)).tip, null, 'טיפ אחרי החלון');
});

// ---------- רוטציית מקום ההדבקה ----------

test('העוגן מדויק — 27.7.2026 הוא כתף ימין', () => {
  // נמדד מול המציאות, ולכן זו הבדיקה שמגנה על כל השאר.
  assert.equal(P.planFor(P.SITE_ANCHOR.iso).site, P.SITES[P.SITE_ANCHOR.index]);
  assert.equal(P.planFor('2026-07-27').site, 'כתף ימין');
});

test('אותו מקום לא חוזר לפני 6 ימים', () => {
  for (let i = 0; i + 6 <= P.TOTAL_DAYS; i++) {
    const win = Array.from({ length: 6 }, (_, k) =>
      P.planFor(P.addDaysISO(P.QUIT, i + k)).site);
    assert.equal(new Set(win).size, 6, `ימים ${i + 1}–${i + 6}: ${win.join(', ')}`);
  }
});

test('siteOffset מזיז את הרוטציה ומתגלגל, בלי לשבור אותה', () => {
  for (let off = -3; off <= 8; off++) {
    const s = Array.from({ length: 6 }, (_, k) =>
      P.planFor(P.addDaysISO(P.QUIT, k), off).site);
    assert.equal(new Set(s).size, 6, `offset ${off} שבר את הרוטציה`);
  }
});

// ---------- pick ----------

test('pick יציב לאותו תאריך ומתגלגל על פני ימים', () => {
  const arr = ['א', 'ב', 'ג', 'ד', 'ה'];
  assert.equal(P.pick(arr, '2026-08-15'), P.pick(arr, '2026-08-15'));
  const seen = new Set(Array.from({ length: 5 }, (_, i) =>
    P.pick(arr, P.addDaysISO('2026-08-15', i))));
  assert.equal(seen.size, 5, 'לא עובר על כל הפריטים ב-5 ימים');
});

test('pick לא מחזיר undefined על offset שלילי', () => {
  const arr = ['א', 'ב', 'ג'];
  for (let o = -5; o <= 5; o++) {
    assert.ok(P.pick(arr, '2026-08-15', o), `offset ${o}`);
  }
});
