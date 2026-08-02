// ==========================================================================
//  C — המסטיק לעומק: טבלת ענפים מלאה
//
//  gum.test.mjs מכסה את מה שנשבר בעבר. כאן **כל** ענף ב-dueNow מקבל
//  בדיקה משלו, לפי הסדר שבו הוא נבדק בקוד — כי הסדר עצמו הוא הלוגיקה,
//  והוא כבר נשבר פעם אחת (MAX_GAP שעקף את הנסיגה וייצר 20 תזכורות).
// ==========================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../src/gum.js';
import { day, week, weekOf, gumAt, simulateDay } from './helpers.mjs';

const ISO = '2026-08-15';
const P = { ...G.DEFAULT_PLAN };
const at = (h, m = 0) => h * 60 + m;

// ==========================================================================
//  C1 — טבלת הענפים של dueNow, לפי סדר ההופעה בקוד
// ==========================================================================

test('ענף 1 · תוכנית כבויה', () => {
  const r = G.dueNow({ ...P, on: false }, ISO, day(), at(12));
  assert.equal(r.due, false);
  assert.equal(r.why, 'off');
});

test('ענף 1ב · יעד אפס (סוף הצמצום) משתיק לגמרי', () => {
  const done = { ...P, times: [] };
  assert.equal(G.dueNow(done, ISO, day(), at(12)).why, 'off');
});

test('ענף 2 · לפני תחילת החלון', () => {
  assert.equal(G.dueNow(P, ISO, day(), at(6)).why, 'לפני תחילת החלון');
});

test('ענף 3 · אחרי סוף החלון, עם 45 דק׳ חסד', () => {
  const { end } = G.windowOf(P);
  assert.equal(G.dueNow(P, ISO, day(), end + 30).why !== 'אחרי סוף החלון', true, 'בתוך החסד');
  assert.equal(G.dueNow(P, ISO, day(), end + 46).why, 'אחרי סוף החלון');
});

test('ענף 4 · הושלם היעד מחוץ לחלון הסיכון', () => {
  const d = day({ gum: 12, ev: [gumAt(11, 0)] });
  assert.equal(G.dueNow(P, ISO, d, at(14)).why, 'הושלם היעד');
});

test('ענף 4ב · חריג הגעה-ליעד דורש את שלושת התנאים יחד', () => {
  // בחלון + פער ארוך + מתחת לתקרה. חסר אחד — שקט.
  const long = day({ gum: 12, ev: [gumAt(13, 0)] });     // פער 6 שעות ב-19:00
  assert.equal(G.dueNow(P, ISO, long, at(19), null, 18).due, true, 'שלושתם מתקיימים');
  assert.equal(G.dueNow(P, ISO, long, at(15), null, 18).due, false, 'מחוץ לחלון');
  const short = day({ gum: 12, ev: [gumAt(18, 30)] });   // פער 30 דק׳
  assert.equal(G.dueNow(P, ISO, short, at(19), null, 18).due, false, 'פער קצר');
  assert.equal(G.dueNow(P, ISO, long, at(19), null, 12).due, false, 'בתקרה');
});

test('ענף 5 · MIN_GAP מהמנה האחרונה, לא משנה מי יזם אותה', () => {
  const d = day({ gum: 3, gumExtra: 3, ev: [gumAt(11, 0)] });
  const r = G.dueNow(P, ISO, d, at(11, 59));
  assert.equal(r.due, false);
  assert.match(r.why, /נלקח לפני 59/);
  assert.equal(G.dueNow(P, ISO, d, at(12, 1)).due, true, 'דקה אחרי MIN_GAP — כן');
});

test('ענף 6 · סנוז פעיל משתיק, בלי קשר לכל השאר', () => {
  const d = day({ gum: 0, ev: [] });
  const r = G.dueNow(P, ISO, d, at(12), null, 18, at(13));
  assert.equal(r.due, false);
  assert.match(r.why, /נדחה עד 13:00/);
});

test('ענף 7א · תזכורת שנענתה — MIN_GAP הוא שחוסם, לא GAP_REMIND', () => {
  // ממצא מהבדיקה: הענף של GAP_REMIND כמעט בלתי-נגיש. אם נלקח מסטיק
  // אחרי התזכורת, אז since <= now-lastRemind, ולכן MIN_GAP (60) תמיד
  // חוסם ראשון. הקבוע קיים אבל אינו קובע את המרווח בפועל — וזה מה
  // שהבדיקה נועלת, כדי שאיש לא יכוונן אותו ויתפלא שכלום לא זז.
  const d = day({ gum: 3, ev: [gumAt(11, 5)] });
  const last = at(11);
  assert.match(G.dueNow(P, ISO, d, at(11, 45), last).why, /נלקח לפני/);
  assert.equal(G.dueNow(P, ISO, d, at(12, 10), last).due, true, 'אחרי MIN_GAP — משוחרר');
});

test('ענף 7ב · נסיגה אחרי תזכורת שלא נענתה — BACKOFF', () => {
  const d = day({ gum: 3, ev: [gumAt(9, 0)] });    // אין מסטיק אחרי התזכורת
  const last = at(11);
  assert.equal(G.dueNow(P, ISO, d, at(12, 10), last).why, 'ממתין — התזכורת הקודמת לא נענתה');
  assert.equal(G.dueNow(P, ISO, d, at(12, 35), last).due, true, 'אחרי BACKOFF');
});

test('ענף 8 · סנוז שפג גובר על הנסיגה', () => {
  const d = day({ gum: 3, ev: [gumAt(9, 0)] });
  const last = at(11);
  const r = G.dueNow(P, ISO, d, at(11, 30), last, 18, at(11, 20));
  assert.equal(r.due, true, 'הסנוז נקבע ל-11:20 והנסיגה עוד פעילה');
  assert.equal(r.why, 'הסנוז פג');
});

test('ענף 9 · MAX_GAP מזכיר בלי קשר לקצב', () => {
  const d = day({ gum: 9, ev: [gumAt(10, 0)] });
  const r = G.dueNow(P, ISO, d, at(12, 40));
  assert.equal(r.due, true);
  assert.equal(r.why, 'פער ארוך מדי');
});

test('ענף 10 · "עוד לא היה מסטיק היום" רק כשבאמת לא היה', () => {
  assert.equal(G.dueNow(P, ISO, day({ gum: 0, ev: [] }), at(9)).why, 'עוד לא היה מסטיק היום');
  // עם מונה גדול מאפס — נופל לענף הקצב ולא מכריז הכרזה סותרת
  assert.notEqual(G.dueNow(P, ISO, day({ gum: 6, ev: [] }), at(9)).why, 'עוד לא היה מסטיק היום');
});

test('ענף 11 · קצב, עם סובלנות של מנה אחת', () => {
  // בחצי החלון היעד הוא ~6. פיגור של 1 הוא רעש; של 3 הוא סטייה.
  const mid = at(14);
  const near = day({ gum: 6, ev: [gumAt(12, 30)] });
  const far = day({ gum: 3, ev: [gumAt(12, 30)] });
  assert.equal(G.dueNow(P, ISO, near, mid).due, false, 'בקצב — שקט');
  assert.equal(G.dueNow(P, ISO, far, mid).due, true, 'מאחור — מזכיר');
});

test('סדר הענפים: הנסיגה נבדקת לפני MAX_GAP', () => {
  // כשהסדר היה הפוך, יום איטי עקף את הנסיגה וייצר 20 תזכורות ביום.
  const d = day({ gum: 1, ev: [gumAt(9, 0)] });
  assert.equal(G.dueNow(P, ISO, d, at(12), at(11, 30)).due, false);
});

// ==========================================================================
//  C2 — סימולציות יום שלם: תקציב תזכורות **ותקציב שקט**
// ==========================================================================

const sims = [
  // קצב, מינ׳ מנות, מקס׳ תזכורות, מינ׳ תזכורות
  ['מקדים · 45 דק׳', 45, 12, 4, 0],
  ['הקצב שלו · 70 דק׳', 70, 10, 9, 0],
  ['מאחור · 120 דק׳', 120, 6, 11, 2],
  ['איטי · 180 דק׳', 180, 4, 11, 3],
];
for (const [label, gap, minTaken, maxRem, minRem] of sims) {
  test(`יום שלם · ${label}`, () => {
    const { taken, reminders } = simulateDay(G, P, { gapMinutes: gap });
    assert.ok(taken >= minTaken, `נלקחו ${taken}, ציפינו ל-${minTaken}+`);
    assert.ok(reminders <= maxRem, `${reminders} תזכורות — נודניקי`);
    // תקציב השקט: מי שנשאר מאחור **חייב** לקבל תזכורות. בלי הצד הזה
    // אפשר "לשפר" את המנוע עד שהוא שותק לגמרי ועדיין לעבור.
    assert.ok(reminders >= minRem, `רק ${reminders} תזכורות למי שמפגר — שקט מדי`);
  });
}

test('מי שמתעלם לגמרי מקבל תזכורות, אבל לא יותר מ-10', () => {
  const { reminders } = simulateDay(G, P, { gapMinutes: 99999 });
  assert.ok(reminders >= 5, `רק ${reminders} — הבוט ויתר`);
  assert.ok(reminders <= 10, `${reminders} — נודניקי`);
});

// ==========================================================================
//  C3 — activeTimes / dropOrderOf בקצוות
// ==========================================================================

test('רשימת שעות ריקה לא מפילה', () => {
  assert.deepEqual(G.activeTimes({ ...P, times: [] }, ISO), []);
  assert.equal(G.dailyTarget({ ...P, times: [] }, ISO), 0);
});

test('משבצת אחת — הבוקר לא נופל לפני שהכול נופל', () => {
  const p = { ...P, times: ['07:30'], confirmedTaper: true, taperStartISO: '2026-09-15', stepDays: 4 };
  assert.deepEqual(G.activeTimes(p, '2026-09-15'), ['07:30']);
  assert.deepEqual(G.activeTimes(p, '2026-09-19'), []);
});

test('שעות מותאמות אישית — הראשונה אחרונה לנפול', () => {
  const p = { ...P, times: ['06:00', '12:00', '18:00'], confirmedTaper: true,
              taperStartISO: '2026-09-15', stepDays: 4 };
  const last = G.activeTimes(p, '2026-09-23');
  assert.deepEqual(last, ['06:00'], `נשאר ${last.join(',')}`);
});

test('dropOrderOf מכיל את כל השעות בדיוק פעם אחת', () => {
  const order = G.dropOrderOf(G.RECOMMENDED.times);
  assert.equal(order.length, G.RECOMMENDED.times.length);
  assert.equal(new Set(order).size, order.length, 'כפילות בסדר ההורדה');
  assert.equal(order[order.length - 1], '07:30', 'הבוקר לא אחרון');
});

test('הקפאה עתידית לא משפיעה על היום', () => {
  const p = { ...P, confirmedTaper: true, taperStartISO: '2026-09-15', stepDays: 4,
              pausedISO: '2026-10-01' };
  assert.equal(G.activeTimes(p, '2026-09-23').length, G.activeTimes(
    { ...p, pausedISO: null }, '2026-09-23').length, 'הקפאה בעתיד שינתה את ההווה');
});

// ==========================================================================
//  C5 — reminderText / taperInfo
// ==========================================================================

test('טקסט הבוקר לפי שעה, גם כשזו המנה הראשונה בערב', () => {
  const late = G.reminderText('19:15', P, ISO, day({ gum: 0 }), 0, 12);
  assert.ok(!late.includes('המדבקה הוסרה'), 'טקסט גישור-לילה ב-19:15');
  const morning = G.reminderText('07:30', P, ISO, day({ gum: 0 }), 0, 12);
  assert.ok(morning.includes('המדבקה הוסרה'), 'חסר טקסט הגישור בבוקר');
});

test('taperInfo לפני אישור מסמן pending', () => {
  const t = G.taperInfo({ ...P, confirmedTaper: false }, ISO);
  assert.equal(t.pending, true);
  assert.equal(t.dropsSoFar, 0);
});

test('taperInfo ברצפה לא מבטיח נפילה הבאה', () => {
  const p = { ...P, confirmedTaper: true, taperStartISO: '2026-09-15', stepDays: 4 };
  const t = G.taperInfo(p, '2026-11-05');
  assert.equal(t.atFloor, true);
  assert.equal(t.nextDropISO, null);
  assert.equal(t.nextToGo, null);
});
