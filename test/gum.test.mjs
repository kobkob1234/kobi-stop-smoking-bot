// ==========================================================================
//  המסטיק: תזמון מסתגל, תצמצום, וגלאי המוכנות
// ==========================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../src/gum.js';
import { day, week, weekOf, gumAt, simulateDay } from './helpers.mjs';

const ISO = '2026-08-15';
const plan = { ...G.DEFAULT_PLAN };

// ---------------------------------------------------------------- תזמון
test('יעד היום הוא 10 יחידות לפני התצמצום', () => {
  assert.equal(G.dailyTarget(plan, ISO), 10);
});

test('לא מזכיר בתוך MIN_GAP מהיחידה האחרונה', () => {
  const d = day({ gum: 3, ev: [gumAt(11, 0)] });
  const r = G.dueNow(plan, ISO, d, 11 * 60 + 30);
  assert.equal(r.due, false);
  assert.match(r.why, /נלקח לפני 30/);
});

test('יחידה שנלקחה ביוזמתו דוחה את התזכורת בדיוק כמו יחידה אחרי תזכורת', () => {
  // זו הייתה התלונה המקורית: הוא לקח מסטיק בכפתור 🍬 והתזכורת הגיעה בכל זאת
  const d = day({ gum: 5, gumExtra: 5, gumSched: 0, ev: [gumAt(13, 50)] });
  assert.equal(G.dueNow(plan, ISO, d, 14 * 60).due, false);
});

test('אחרי MAX_GAP בלי כלום — מזכיר בלי קשר לקצב', () => {
  const d = day({ gum: 8, ev: [gumAt(10, 0)] });
  const r = G.dueNow(plan, ISO, d, 12 * 60 + 40);   // 160 דק׳
  assert.equal(r.due, true);
  assert.equal(r.why, 'פער ארוך מדי');
});

test('הושלם היעד — לא מזכיר יותר', () => {
  const d = day({ gum: 10, ev: [gumAt(18, 0)] });
  assert.equal(G.dueNow(plan, ISO, d, 20 * 60).due, false);
});

test('לפני תחילת החלון ואחריו — שקט', () => {
  assert.equal(G.dueNow(plan, ISO, day(), 6 * 60).due, false);
  assert.equal(G.dueNow(plan, ISO, day({ gum: 4 }), 23 * 60).due, false);
});

test('נסיגה: תזכורת שלא נענתה לא חוזרת לפני BACKOFF', () => {
  const d = day({ gum: 2, ev: [gumAt(9, 0)] });
  const lastRemind = 11 * 60;
  assert.equal(G.dueNow(plan, ISO, d, 12 * 60, lastRemind).due, false, '60 דק׳ אחרי — עוד לא');
  assert.equal(G.dueNow(plan, ISO, d, 12 * 60 + 40, lastRemind).due, true, '100 דק׳ אחרי — כן');
});

test('הנסיגה נבדקת לפני ענף "פער ארוך מדי" ולא אחריו', () => {
  // כשהסדר היה הפוך, יום איטי עקף את הנסיגה וייצר 20 תזכורות ביום
  const d = day({ gum: 1, ev: [gumAt(9, 0)] });
  const r = G.dueNow(plan, ISO, d, 12 * 60, 11 * 60 + 30);  // 180 דק׳ בלי מסטיק
  assert.equal(r.due, false, 'MAX_GAP לא אמור לעקוף את הנסיגה');
});

// ------------------------------------------------- סימולציות יום שלם
const sims = [
  ['הקצב שלו — כל 70 דק׳', 70, 10, 8],
  ['נשאר מאחור — כל 120 דק׳', 120, 6, 11],
  ['איטי מאוד — כל 180 דק׳', 180, 4, 11],
  ['מקדים — כל 45 דק׳', 45, 10, 3],
];
for (const [label, gap, minTaken, maxReminders] of sims) {
  test(`יום שלם · ${label}: ≥${minTaken} יחידות, ולא יותר מ-${maxReminders} תזכורות`, () => {
    const { taken, reminders } = simulateDay(G, plan, { gapMinutes: gap });
    assert.ok(taken >= minTaken, `נלקחו ${taken}`);
    assert.ok(reminders <= maxReminders, `נשלחו ${reminders} תזכורות — נודניקיות`);
  });
}

test('מי שמתעלם לגמרי לא מקבל יותר מ-10 תזכורות ביום', () => {
  const { reminders } = simulateDay(G, plan, { gapMinutes: 99999 });
  assert.ok(reminders <= 10, `נשלחו ${reminders}`);
});

// ---------------------------------------------------------------- תצמצום
test('התצמצום לא מתחיל בלי אישור מפורש, גם אחרי התאריך', () => {
  const p = { ...plan, taperStartISO: '2026-09-15', confirmedTaper: false };
  assert.equal(G.activeTimes(p, '2026-10-01').length, 10);
});

test('אחרי אישור — יחידה אחת פחות כל stepDays, ומונוטוני יורד', () => {
  const p = { ...plan, taperStartISO: '2026-09-15', confirmedTaper: true, stepDays: 4 };
  let prev = Infinity;
  for (let d = 0; d <= 40; d++) {
    const iso = `2026-09-${String(15 + d).padStart(2, '0')}`.replace(/-(\d\d)$/, (m, x) =>
      +x > 30 ? `-${String(+x - 30).padStart(2, '0')}` : m);
    const n = G.activeTimes(p, d <= 15 ? `2026-09-${String(15 + d).padStart(2, '0')}` : '2026-10-25').length;
    assert.ok(n <= prev, `עלה מ-${prev} ל-${n}`);
    prev = n;
  }
  assert.equal(prev, 1, 'הרצפה היא יחידה אחת');
});

test('יחידת הבוקר נופלת אחרונה — היא מכסה את הלילה בלי מדבקה', () => {
  const p = { ...plan, taperStartISO: '2026-09-15', confirmedTaper: true, stepDays: 4 };
  const last = G.activeTimes(p, '2026-11-01');
  assert.deepEqual(last, ['07:30']);
});

// --------------------------------------------------------- גלאי המוכנות
test('שבוע בלי תיעוד אינו "יציב" — הכשל שהגלאי נבנה מחדש בשבילו', () => {
  const r = G.readiness(week(), week({ gum: 10, waves: 2, surfed: 2, mDone: true }), 10);
  assert.equal(r.ready, false);
  assert.match(r.reasons.join(' '), /מתועדים/);
  assert.equal(r.signals.length, 0, 'בלי כיסוי אין גם סימנים חיוביים');
});

test('תיעוד חלקי (4/7) חוסם', () => {
  const l = weekOf(i => (i < 4 ? { gum: 9, waves: 1, surfed: 1, mDone: true } : {}));
  assert.equal(G.readiness(l, week({ gum: 10, mDone: true }), 10).ready, false);
});

test('מעידה אחת חוסמת', () => {
  const l = weekOf(i => ({ gum: 9, waves: 1, surfed: 1, slips: i === 3 ? 1 : 0, mDone: true }));
  assert.equal(G.readiness(l, week({ gum: 9, waves: 1, surfed: 1, mDone: true }), 10).ready, false);
});

test('עלייה בגודל רעש (0.1 ליום) אינה חוסמת', () => {
  const l = weekOf(i => ({ gum: i === 0 ? 9 : 8, waves: 1, surfed: 1, mDone: true }));
  const r = G.readiness(l, week({ gum: 8, waves: 1, surfed: 1, mDone: true }), 10);
  assert.equal(r.ready, true, r.reasons.join(' · '));
});

test('עלייה אמיתית (2 ליום) כן חוסמת', () => {
  const l = week({ gum: 10, waves: 1, surfed: 1, mDone: true });
  const r = G.readiness(l, week({ gum: 8, waves: 1, surfed: 1, mDone: true }), 10);
  assert.equal(r.ready, false);
  assert.match(r.reasons.join(' '), /עלתה/);
});

test('דחפים תכופים שכולם עוברים — לא חוסם (אחרת מענישים על דיווח כן)', () => {
  const l = week({ gum: 9, waves: 2, surfed: 2, mDone: true });
  assert.equal(G.readiness(l, week({ gum: 9, waves: 2, surfed: 2, mDone: true }), 10).ready, true);
});

test('דחפים שלא עוברים — כן חוסם', () => {
  const l = week({ gum: 10, waves: 2, surfed: 1, mDone: true });
  const r = G.readiness(l, week({ gum: 10, waves: 2, surfed: 2, mDone: true }), 10);
  assert.equal(r.ready, false);
  assert.match(r.reasons.join(' '), /עברו/);
});

test('ירידה ספונטנית מזוהה כסימן חיובי ומעלה confidence', () => {
  const l = week({ gum: 7, waves: 1, surfed: 1, mDone: true, eDone: true, patch: true });
  const r = G.readiness(l, week({ gum: 10, waves: 3, surfed: 3, mDone: true }), 10);
  assert.equal(r.ready, true);
  assert.equal(r.declining, true);
  assert.equal(r.confidence, 'strong');
});

test('יציב בלי שום סימן חיובי מסומן כ-weak ולא כ-strong', () => {
  const l = week({ gum: 10, waves: 0, surfed: 0, mDone: true });
  const r = G.readiness(l, week({ gum: 10, waves: 0, surfed: 0, mDone: true }), 10);
  assert.equal(r.ready, true);
  assert.ok(['weak', 'ok'].includes(r.confidence));
});

// --------------------------------------------------- ניטור תוך כדי תצמצום
const baseline = { waves: 7, surfed: 7, gum: 70 };

test('שבוע יציב בתצמצום — אין התראה', () => {
  assert.equal(G.taperWatch(week({ gum: 8, waves: 1, surfed: 1, mDone: true }), baseline), null);
});

test('קפיצה בדחפים מייצרת התראה', () => {
  const w = G.taperWatch(week({ gum: 8, waves: 3, surfed: 2, mDone: true }), baseline);
  assert.ok(w && w.worse.length);
});

test('יציאה לדרך לקנות מייצרת התראה גם בלי קפיצה בדחפים', () => {
  const l = weekOf(i => ({ gum: 8, waves: 1, surfed: 1, enroute: i === 2 ? 1 : 0, mDone: true }));
  const w = G.taperWatch(l, baseline);
  assert.ok(w && w.worse.join(' ').includes('בדרך לקנות'));
});

test('שבוע לא מתועד אינו מסיק החמרה — אין נתונים, אין מסקנה', () => {
  assert.equal(G.taperWatch(week(), baseline), null);
});
