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
test('יעד היום הוא 12 יחידות לפני התצמצום', () => {
  assert.equal(G.dailyTarget(plan, ISO), 12);
});

test('ארבע מנות יושבות בחלון הסיכון 17:00–21:00', () => {
  // הפריסה אינה אחידה במכוון: הגלים שלו מרוכזים שם, ולכן הצפיפות
  // עוקבת אחרי הסיכון ולא אחרי השעון.
  const inRisk = G.RECOMMENDED.times.filter(t => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m >= 17 * 60 && h * 60 + m < 21 * 60;
  });
  assert.equal(inRisk.length, 4, inRisk.join(','));
});

test('היעד נמוך מהתקרה הרכה — אחרת ציות מלא נקרא כמינון יתר', () => {
  // כשהיעד היה 10 והתקרה 12 זה עבד. עם יעד 12 ותקרה 12, כל יום שבו
  // הוא עומד ביעד היה מפיק אזהרה וגם דגל הסלמה שבועי.
  assert.ok(G.dailyTarget(plan, ISO) < 18, 'gumSoftCap הוא 18');
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
  const d = day({ gum: 12, ev: [gumAt(18, 0)] });
  assert.equal(G.dueNow(plan, ISO, d, 14 * 60).due, false);
});

test('הגעה ליעד לא משתיקה את חלון הסיכון אחרי פער ארוך', () => {
  // קודם לכן `taken >= target` השתיק את הבוט לשארית היום — כולל דרך
  // כל 17:00–21:00, שבשבילו נבנתה הפריסה. יום שהתחיל קשה וצרך את
  // היעד עד 13:00 השאיר את הערב בלי כלום.
  const d = day({ gum: 12, ev: [gumAt(13, 0)] });
  assert.equal(G.dueNow(plan, ISO, d, 15 * 60).due, false, 'מחוץ לחלון — שקט');
  assert.equal(G.dueNow(plan, ISO, d, 19 * 60).due, true, 'בתוך החלון, פער ארוך — מזכיר');
});

test('החריג בחלון הסיכון עוצר בתקרה הרכה', () => {
  const d = day({ gum: 18, ev: [gumAt(13, 0)] });
  assert.equal(G.dueNow(plan, ISO, d, 19 * 60, null, 18).due, false, 'בתקרה — לא דוחפים מעבר');
});

test('יום עם מסטיקים אבל בלי אירועים לא מייצר "עוד לא היה מסטיק היום"', () => {
  // day.gum מתעדכן בשלושה מסלולים שלא כולם כותבים אירוע, ו-ev נחתך
  // ל-120. בלי בדיקת taken, יום כזה ייצר ~9 תזכורות שכל אחת סותרת
  // את המונה שמופיע באותה הודעה ממש.
  const d = day({ gum: 8, ev: [] });
  for (const t of [8 * 60, 12 * 60, 16 * 60, 20 * 60]) {
    assert.notEqual(G.dueNow(plan, ISO, d, t).why, 'עוד לא היה מסטיק היום');
  }
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
  ['הקצב שלו — כל 70 דק׳', 70, 10, 9],
  ['נשאר מאחור — כל 120 דק׳', 120, 6, 11],
  ['איטי מאוד — כל 180 דק׳', 180, 4, 11],
  ['מקדים — כל 45 דק׳', 45, 12, 4],
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
const TAPER = { ...plan, taperStartISO: '2026-09-15', confirmedTaper: true, stepDays: 4 };
const dayAfter = n => new Date(Date.UTC(2026, 8, 15) + n * 86400000).toISOString().slice(0, 10);
const isRisk = t => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m >= 17 * 60 && h * 60 + m < 21 * 60;
};

test('התצמצום לא מתחיל בלי אישור מפורש, גם אחרי התאריך', () => {
  const p = { ...TAPER, confirmedTaper: false };
  assert.equal(G.activeTimes(p, '2026-10-01').length, 12);
});

test('אחרי אישור — יחידה אחת פחות כל stepDays, ומונוטוני יורד עד אפס', () => {
  // הגרסה הקודמת של הבדיקה בנתה `iso` והתעלמה ממנו, ולכן 25 מתוך 41
  // האיטרציות בדקו את אותו יום קבוע. כאן התאריכים אמיתיים.
  let prev = Infinity;
  for (let d = 0; d <= 60; d++) {
    const n = G.activeTimes(TAPER, dayAfter(d)).length;
    assert.ok(n <= prev, `יום ${d}: עלה מ-${prev} ל-${n}`);
    prev = n;
  }
  assert.equal(prev, 0, 'הרצפה היא אפס — "תאריך סיום מוגדר, לא הרגל פתוח"');
});

test('חלון הסיכון שורד את ההורדות הראשונות — אמצע-היום יורד קודם', () => {
  // זה הפגם המהותי שתוקן: הסדר הקודם (מהמאוחר לכיוון הבוקר) מחק את
  // ארבע מנות הערב **ראשונות**, כלומר פירק את החלון המכוסה ביותר,
  // בזמן שמנות אמצע-היום שרדו עד הסוף.
  for (const d of [4, 8, 12, 16, 20, 24, 28]) {
    const a = G.activeTimes(TAPER, dayAfter(d));
    assert.equal(a.filter(isRisk).length, 4,
      `יום ${d}: נשארו ${a.filter(isRisk).length} מנות ערב מתוך 4 — ${a.join(' ')}`);
  }
});

test('קצוות חלון הסיכון נשמרים אחרונים, כדי שהחלון יישאר ממוסגר', () => {
  const a = G.activeTimes(TAPER, dayAfter(36));   // ירדנו ל-3
  assert.ok(a.includes('17:15') && a.includes('20:30'),
    `הקצוות נפלו לפני האמצע — ${a.join(' ')}`);
});

test('יחידת הבוקר נופלת אחרונה — היא מכסה את הלילה בלי מדבקה', () => {
  const one = G.activeTimes(TAPER, dayAfter(44));
  assert.deepEqual(one, ['07:30']);
});

test('הקפאה עוצרת את הצמצום בפועל, לא רק בהבטחה', () => {
  // הבוט הודיע "אני לא מוריד עוד יחידה עד שתחליט" ו-activeTimes המשיכה
  // להוריד מנה כל 4 ימים בלי להתייעץ בכלום.
  const frozen = { ...TAPER, pausedISO: dayAfter(12) };
  const at12 = G.activeTimes(frozen, dayAfter(12)).length;
  assert.equal(G.activeTimes(frozen, dayAfter(24)).length, at12, 'המשיך לרדת בזמן הקפאה');
  assert.equal(G.taperInfo(frozen, dayAfter(24)).nextDropISO, null);
  assert.equal(G.taperInfo(frozen, dayAfter(24)).paused, true);
});

test('nextToGo מצביע על המנה שבאמת תיפול', () => {
  // קודם לכן הוא החזיר את האחרונה ברשימה, כלומר הבטיח שתיפול מנת ערב
  // בזמן שבפועל נפלה מנת צהריים.
  const t = G.taperInfo(TAPER, dayAfter(1));
  const after = G.activeTimes(TAPER, dayAfter(4));
  assert.ok(!after.includes(t.nextToGo), `הובטח ${t.nextToGo} אבל הוא עוד כאן`);
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

test('שבוע לא מתועד עוצר את הצמצום במקום לשתוק', () => {
  // הגרסה הקודמת החזירה null — "אין נתונים, אין מסקנה". זה נשמע נכון
  // אבל היה כשל שקט בכיוון המזיק: הניטור נעלם בדיוק בשבוע שבו קשה,
  // שהוא השבוע שבו מפסיקים לדווח, **בזמן שהצמצום המשיך להוריד מנה
  // כל 4 ימים**. חוסר ידיעה הוא סיבה לעצור, לא סיבה להמשיך.
  const tw = G.taperWatch(week(), baseline);
  assert.ok(tw, 'כיסוי חסר חייב להחזיר משהו, לא null');
  assert.equal(tw.lowCoverage, true);
  assert.ok(tw.worse.length >= 1, 'חייבת להיות סיבה להצגה');
});

test('שבוע מתועד ויציב עדיין לא מתריע', () => {
  const stable = weekOf(() => ({ gum: 11, waves: 1, surfed: 1, patch: true, ev: [gumAt(9, 0)] }));
  assert.equal(G.taperWatch(stable, baseline), null);
});

// ---------------------------------------------------------------- מיגרציה
test('תוכנית שמורה בברירת המחדל הישנה משודרגת ל-12', () => {
  // בלי זה השינוי המרכזי לא היה חל בכלל: המיזוג
  // {...DEFAULT_PLAN, ...meta.gumPlan} לוקח את times השמור, ולכן
  // משתמש קיים היה נשאר על 10 מנות אחרי הפריסה — היעד החדש קיים
  // בקוד ולא בפועל.
  const old = { on: true, times: G.LEGACY_TIMES_V1, stepDays: 4 };
  const up = G.migratePlan(old);
  assert.equal(up.times.length, 12);
  assert.equal(up.ver, G.PLAN_VER);
});

test('שעות שהמשתמש שינה ידנית לא נדרסות', () => {
  const custom = { on: true, times: ['08:00', '14:00', '20:00'], stepDays: 4 };
  assert.deepEqual(G.migratePlan(custom).times, ['08:00', '14:00', '20:00']);
});

test('מיגרציה רצה פעם אחת בלבד', () => {
  const once = G.migratePlan({ on: true, times: G.LEGACY_TIMES_V1 });
  const twice = G.migratePlan(once);
  assert.deepEqual(twice.times, once.times, 'ריצה שנייה שינתה משהו');
});

test('שיעור שחרור 0% אינו חוסם — זה ארטיפקט דיווח, לא כשל', () => {
  // בנתונים האמיתיים: 3 מתוך 47 גלים סומנו כ"עברו" (6%), כי הכפתור
  // כמעט לא נלחץ. בלי התנאי surfed>0 הצמצום היה חסום לנצח אצל מישהו
  // שאולי גולש מצוין ופשוט לא מתעד.
  const wk = Array.from({ length: 7 }, () =>
    day({ gum: 11, waves: 2, surfed: 0, patch: true, ev: [gumAt(9, 0)] }));
  const r = G.readiness(wk, wk, 12);
  assert.equal(r.ready, true, r.reasons.join(' | '));
  assert.equal(r.unmeasured, true);
  assert.equal(r.confidence, 'weak', 'בלי מדד איכות אסור להכריז "מצוין"');
});

test('שיעור שחרור נמוך אמיתי כן חוסם', () => {
  const wk = Array.from({ length: 7 }, () =>
    day({ gum: 11, waves: 5, surfed: 1, patch: true, ev: [gumAt(9, 0)] }));
  const r = G.readiness(wk, wk, 12);
  assert.equal(r.ready, false);
  assert.ok(r.reasons.some(x => x.includes('עברו בלי שנדרש')));
});

test('תוכנית בלי times נופלת לברירת המחדל ולא מכבה תזכורות', () => {
  // migratePlan קבע `times: plan.times` גם כשהוא undefined, מה שהוסיף
  // מפתח מפורש בערך undefined — והוא גובר על DEFAULT_PLAN בפריסה.
  // התוצאה הייתה dailyTarget=0, כלומר תזכורות המסטיק כבויות לגמרי.
  const merged = { ...G.DEFAULT_PLAN, ...G.migratePlan({ on: true, stepDays: 4 }) };
  assert.ok(Array.isArray(merged.times), 'times חייב להישאר מערך');
  assert.equal(G.dailyTarget(merged, ISO), 12);
});

// ==========================================================================
//  שלב 0 — הבאגים שדווחו מהשטח
// ==========================================================================

test('סנוז מפורש מכובד בזמן, ולא נבלע בנסיגה', () => {
  // הבאג שדווח: "אזכיר שוב בסביבות 10:51" ולא הגיעה תזכורת.
  // index.js הציב רצפה (now >= snoozedTo) ו-gum.js החזיק תקרה
  // (BACKOFF=90, כי סנוז לא רושם מסטיק). שני הצדדים תקינים לחוד,
  // והמכפלה דחתה את התזכורת ל-12:10 — 79 דקות באיחור.
  const remindAt = 10 * 60 + 31, snoozeTo = 10 * 60 + 51;
  const d = day({ gum: 5, ev: [gumAt(9, 15)] });

  assert.equal(G.dueNow(plan, ISO, d, 10 * 60 + 40, remindAt, 18, snoozeTo).due, false,
    'לפני שהסנוז פג — שקט');
  const after = G.dueNow(plan, ISO, d, 11 * 60, remindAt, 18, snoozeTo);
  assert.equal(after.due, true, 'אחרי שהסנוז פג — תזכורת, למרות שהנסיגה עוד פעילה');
  assert.equal(after.why, 'הסנוז פג');
});

test('בלי סנוז, הנסיגה עדיין חוסמת כרגיל', () => {
  // הסנוז מדלג על הנסיגה — אבל רק כשהוא קיים. אסור שהתיקון יפתח
  // את הנסיגה לכולם.
  const d = day({ gum: 5, ev: [gumAt(9, 15)] });
  const r = G.dueNow(plan, ISO, d, 11 * 60, 10 * 60 + 31, 18, 0);
  assert.equal(r.due, false);
  assert.match(r.why, /ממתין/);
});

test('פריסט "1 ביום" לא מכבה את התזכורות בשקט', () => {
  // windowOf החזיר start===end, ולכן כל בדיקה אחרי 08:15 נפלה על
  // "אחרי סוף החלון" — בחירת הפריסט בתפריט השביתה את המנגנון כולו.
  const p = { ...G.DEFAULT_PLAN, times: G.PRESETS.one.times };
  assert.ok(G.windowOf(p).end > G.windowOf(p).start, 'חלון מנוון');
  assert.equal(G.dueNow(p, ISO, day({ gum: 0, ev: [] }), 19 * 60).due, true);
});

test('תוכנית מרובת-משבצות לא מורחבת מלאכותית', () => {
  // "2 ביום" נגמר ב-18:00, ושקט ב-19:00 הוא מכוון: היעד מכוסה.
  // הרחבה גורפת הייתה הופכת שקט תקין לנדנוד.
  const p = { ...G.DEFAULT_PLAN, times: G.PRESETS.two.times };
  assert.equal(G.windowOf(p).end, 18 * 60);
  assert.equal(G.dueNow(p, ISO, day({ gum: 2, ev: [gumAt(18, 0)] }), 19 * 60).due, false);
});

test('minutesSinceLastGum לפי הזמן המאוחר ולא לפי סדר המערך', () => {
  // ev אינו ממוין: /trigger יכול להיכתב אחרי webhook מדקה מוקדמת.
  // נמדד בפועל: 360 דקות במקום 60, כלומר MAX_GAP נחצה שלא בצדק.
  const d = day({ gum: 2, ev: [gumAt(14, 0), gumAt(9, 0)] });
  assert.equal(G.minutesSinceLastGum(d, 15 * 60), 60);
});
