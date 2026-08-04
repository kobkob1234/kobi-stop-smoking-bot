// ==========================================================================
//  ב1 — החלטת מצב הצמצום
//
//  זו ההחלטה היחידה בכל התהליך שנורית **פעם אחת** (15.9), אינה חוזרת,
//  וקובעת את צורת הצמצום כולו. עד עכשיו היא ישבה מועתקת בשני מקומות
//  בתוך index.js — נתיב האישור ונתיב הרצפה הזמנית — ולכן לא הייתה
//  ניתנת לבדיקה משום צד.
//
//  ומה שהבדיקה הזאת חשפה מיד: taperInfo היה משבצתי בלבד, ולכן ההודעה
//  שנשלחת ברגע תחילת הצמצום הבטיחה "9 יחידות עכשיו · יחידה אחת פחות
//  כל 4 ימים · הראשונה שנופלת 14:15" — בזמן שבמצב-מרווח היעד ביום
//  הראשון הוא 8, הוא אינו יורד כל 4 ימים, ושום משבצת אינה נופלת.
// ==========================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as G from '../src/gum.js';
import * as P from '../src/plan.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ISO = '2026-09-15';

/** יום עם n מנות פרוסות במרווח קבוע מ-09:00 */
const dayWith = (n, gap = 91) => ({
  gum: n,
  ev: Array.from({ length: n }, (_, i) => {
    const m = 9 * 60 + i * gap;
    return { k: 'g', h: Math.floor(m / 60), m: m % 60 };
  }),
});

// ==========================================================================
//  בחירת המצב
// ==========================================================================

test('ב1 · 5 ימים מדודים בדיוק — הגבול — בוחר מרווח', () => {
  const plan = { ...G.DEFAULT_PLAN };
  const r = G.chooseTaperMode(plan, Array.from({ length: 5 }, () => dayWith(8)));
  assert.equal(r.mode, 'interval');
  assert.equal(plan.mode, 'interval');
  assert.equal(plan.baseGap, 91);
  assert.equal(plan.gapStepPct, G.GAP_STEP_PCT);
});

test('ב1 · 4 ימים — צעד אחד מתחת לגבול — נופל למשבצות', () => {
  const plan = { ...G.DEFAULT_PLAN };
  const r = G.chooseTaperMode(plan, Array.from({ length: 4 }, () => dayWith(8)));
  assert.equal(r.mode, 'slot');
  assert.equal(plan.mode, 'slot');
  assert.equal(plan.baseGap, undefined, 'baseGap נקבע למרות שהמצב משבצות');
});

test('ב1 · אפס נתונים — נופל למשבצות ולא קורס', () => {
  const plan = { ...G.DEFAULT_PLAN };
  assert.equal(G.chooseTaperMode(plan, []).mode, 'slot');
  assert.equal(G.chooseTaperMode({ ...G.DEFAULT_PLAN }, undefined).mode, 'slot');
});

test('ב1 · ימים עם מנה בודדת אינם נספרים — אין מרווח למדוד', () => {
  // measureRhythm מדלג על יום עם פחות משתי מנות: אי אפשר לגזור מרווח
  // ממנה אחת. עשרה ימים כאלה עדיין אינם בסיס.
  const plan = { ...G.DEFAULT_PLAN };
  assert.equal(G.chooseTaperMode(plan, Array.from({ length: 10 }, () => dayWith(1))).mode, 'slot');
});

test('ב1 · הסיבה נשמרת בשני המצבים — הנפילה חייבת להיות גלויה', () => {
  const a = { ...G.DEFAULT_PLAN }, b = { ...G.DEFAULT_PLAN };
  G.chooseTaperMode(a, Array.from({ length: 6 }, () => dayWith(8)));
  G.chooseTaperMode(b, [dayWith(8)]);
  assert.match(a.rhythmBasis, /מרווח/);
  assert.match(b.rhythmBasis, /פחות מ-5|רק 1/);
});

// ==========================================================================
//  ריפליי על הנתונים האמיתיים
// ==========================================================================

test('ב1 · על הנתונים האמיתיים ב-KV — מרווח, לא משבצות', () => {
  const dir = join(HERE, '..', '..', 'backups', 'days-20260803');
  if (!existsSync(dir)) {
    assert.fail('גיבוי הימים חסר — הבדיקה הזאת לא אמורה לדלג בשקט');
  }
  const days = readdirSync(dir).filter(f => f.endsWith('.json')).sort().reverse()
    .map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')));

  const plan = { ...G.DEFAULT_PLAN };
  const r = G.chooseTaperMode(plan, days.slice(0, 14));

  assert.equal(r.mode, 'interval', 'הצמצום שנבחר (א+ד) לא היה רץ על הנתונים האמיתיים');
  assert.ok(plan.baseGap >= 60 && plan.baseGap <= 150, `baseGap לא סביר: ${plan.baseGap}`);
  assert.ok(plan.winStart >= 8 * 60, 'תחילת חלון מוקדמת מדי');
  assert.ok(plan.winEnd <= 23 * 60, 'סוף חלון מאוחר מדי');
});

// ==========================================================================
//  taperInfo מודע-מצב — הבאג שנמצא כאן
// ==========================================================================

const ivPlan = (over = {}) => ({
  ...G.DEFAULT_PLAN, on: true, confirmedTaper: true, taperStartISO: ISO,
  stepDays: 4, mode: 'interval', baseGap: 91, gapStepPct: 10,
  winStart: 540, winEnd: 1294, ...over,
});

test('ב1 · במצב-מרווח שום משבצת אינה נופלת', () => {
  const t = G.taperInfo(ivPlan(), ISO);
  assert.equal(t.mode, 'interval');
  assert.equal(t.nextToGo, null, 'הובטחה משבצת שנופלת — אין כזו במצב-מרווח');
});

test('ב1 · active במצב-מרווח הוא היעד בפועל, לא מספר המשבצות', () => {
  const plan = ivPlan();
  const t = G.taperInfo(plan, ISO);
  assert.equal(t.active, G.dailyTarget(plan, ISO));
  assert.notEqual(t.active, G.sortTimes(plan.times).length,
    'active עדיין מחזיר את מספר המשבצות — זה בדיוק הבאג');
});

test('ב1 · המרווח והמרווח הבא מדווחים ועולים', () => {
  const t = G.taperInfo(ivPlan(), ISO);
  assert.equal(t.gap, 91);
  assert.ok(t.nextGap > t.gap, `${t.nextGap} אינו גדול מ-${t.gap}`);
  assert.equal(t.nextGap, Math.round(91 * 1.1));
});

test('ב1 · במצב משבצות ההתנהגות לא זזה', () => {
  const plan = { ...G.DEFAULT_PLAN, on: true, confirmedTaper: true,
                 taperStartISO: ISO, stepDays: 4 };
  const t = G.taperInfo(plan, ISO);
  assert.equal(t.mode, 'slot');
  assert.equal(t.start, G.sortTimes(plan.times).length);
  assert.ok(t.nextToGo, 'במצב משבצות חייבת להיות משבצת שנופלת');
  assert.equal(t.gap, undefined);
});

test('ב1 · לפני אישור — mode מדווח ולא נעלם', () => {
  const t = G.taperInfo({ ...G.DEFAULT_PLAN, taperStartISO: ISO, mode: 'interval' }, ISO);
  assert.equal(t.pending, true);
  assert.equal(t.mode, 'interval');
});

// ==========================================================================
//  המסלול — שני המצבים חייבים להגיע לאפס
// ==========================================================================

for (const [name, plan] of [
  ['מרווח', ivPlan()],
  ['משבצות', { ...G.DEFAULT_PLAN, on: true, confirmedTaper: true, taperStartISO: ISO, stepDays: 4 }],
]) {
  test(`ב2 · מסלול ${name}: מונוטוני, ומגיע לאפס בתאריך מוגדר`, () => {
    let prev = Infinity, zeroAt = null;
    for (let d = 0; d <= 200; d++) {
      const iso = P.addDaysISO(ISO, d);
      const t = G.dailyTarget(plan, iso);
      assert.ok(t <= prev, `${iso}: היעד עלה ${prev}→${t}`);
      if (t === 0 && zeroAt === null) zeroAt = d;
      prev = t;
    }
    assert.notEqual(zeroAt, null, `מצב ${name} לא מגיע לאפס — "מנה אחת לנצח" חזר`);
    assert.ok(zeroAt <= 150, `${zeroAt} ימים עד האפס — ארוך מדי`);
  });
}

// ==========================================================================
//  ב2 · סך הניקוטין — הבדיקה היחידה שמסתכלת על מה שנכנס לגוף
//
//  לכל אחד משני המקורות יש לוח משלו, והם יורדים בזמנים שונים: המדבקה
//  21→14 ביום 25 ו-14→7 ביום 39, בזמן שהמסטיק עוד לא התחיל לרדת בכלל.
//  אף בדיקה לא הצליבה אותם, ולכן שינוי סביר בצד אחד יכול היה לייצר
//  **עלייה** בסך הכול בלי שאיש ישים לב.
// ==========================================================================

test('ב2 · סך הניקוטין היומי לעולם אינו עולה — מדבקה ומסטיק יחד', () => {
  const plan = ivPlan({ taperStartISO: G.TAPER_START });
  const total = iso => {
    const pl = P.planFor(iso);
    const patch = pl && pl.n <= P.TOTAL_DAYS ? pl.dose : 0;
    return patch + G.dailyTarget(plan, iso) * 2;   // מסטיק 2 מ"ג
  };

  let prev = Infinity, drops = 0;
  for (let d = 0; d < 200; d++) {
    const iso = P.addDaysISO(P.QUIT, d);
    const cur = total(iso);
    assert.ok(cur <= prev, `${iso} (יום ${d + 1}): סך הניקוטין עלה ${prev}→${cur} מ"ג`);
    if (cur < prev) drops++;
    prev = cur;
  }
  assert.ok(drops >= 4, `רק ${drops} ירידות — הלוח כמעט שטוח`);
  assert.equal(prev, 0, 'לא הגיע לאפס ניקוטין');
});

test('ב2 · אין קפיצה גדולה מדי בשום יום בודד', () => {
  // מדרגה חדה מדי היא הסיכון הקליני האמיתי. הגדולה ביותר המתוכננת
  // היא הורדת המדבקה 21→14, כלומר 7 מ"ג.
  const plan = ivPlan({ taperStartISO: G.TAPER_START });
  const total = iso => {
    const pl = P.planFor(iso);
    return (pl && pl.n <= P.TOTAL_DAYS ? pl.dose : 0) + G.dailyTarget(plan, iso) * 2;
  };
  for (let d = 1; d < 200; d++) {
    const a = total(P.addDaysISO(P.QUIT, d - 1));
    const b = total(P.addDaysISO(P.QUIT, d));
    assert.ok(a - b <= 9, `יום ${d + 1}: ירידה של ${a - b} מ"ג ביום אחד`);
  }
});

// ==========================================================================
//  ב2 · מעבר שעון החורף — 25.10.2026, בתוך הצמצום
// ==========================================================================

test('ב2 · dropsSoFar אינו מדלג ואינו סופר יום פעמיים בשעון החורף', () => {
  // dropsSoFar נשען על diffDays שעובד ב-UTC, והמעבר נופל בתוך הצמצום.
  const plan = ivPlan({ taperStartISO: '2026-10-01', stepDays: 4 });
  const seen = [];
  for (let d = 0; d <= 40; d++) {
    const iso = P.addDaysISO('2026-10-01', d);
    seen.push(G.taperInfo(plan, iso).dropsSoFar);
  }
  // מונוטוני, עולה ב-1 בכל פעם, ובדיוק כל 4 ימים
  for (let i = 1; i < seen.length; i++) {
    assert.ok(seen[i] >= seen[i - 1], `נסיגה ביום ${i}`);
    assert.ok(seen[i] - seen[i - 1] <= 1, `קפיצה כפולה ביום ${i}: ${seen[i - 1]}→${seen[i]}`);
  }
  assert.equal(seen[40], 10, `אחרי 40 ימים בצעדי 4 — צפוי 10, התקבל ${seen[40]}`);
});

test('ב2 · הצעד נופל ביום המדויק — לא מוקדם ולא מאוחר', () => {
  // בדיקת המונוטוניות לבדה אינה תופסת החלפת floor ב-round: הקצב נשאר
  // צעד לכל 4 ימים, אבל **הפאזה** זזה והצעד יורה יומיים מוקדם. על פני
  // צמצום שלם זה מקדים את כל הלוח.
  const step = 4;
  const plan = ivPlan({ taperStartISO: G.TAPER_START, stepDays: step });
  for (let d = 0; d < step; d++) {
    assert.equal(G.taperInfo(plan, P.addDaysISO(G.TAPER_START, d)).dropsSoFar, 0,
      `יום ${d} מהתחלת הצמצום כבר ספר צעד`);
  }
  assert.equal(G.taperInfo(plan, P.addDaysISO(G.TAPER_START, step)).dropsSoFar, 1,
    `הצעד הראשון לא נפל ביום ${step}`);
  assert.equal(G.taperInfo(plan, P.addDaysISO(G.TAPER_START, 2 * step - 1)).dropsSoFar, 1);
  assert.equal(G.taperInfo(plan, P.addDaysISO(G.TAPER_START, 2 * step)).dropsSoFar, 2);
});

test('ב2 · היעד יציב סביב 25.10 עצמו', () => {
  const plan = ivPlan({ taperStartISO: '2026-10-01' });
  for (const iso of ['2026-10-24', '2026-10-25', '2026-10-26']) {
    assert.equal(typeof G.dailyTarget(plan, iso), 'number');
    assert.ok(G.dailyTarget(plan, iso) >= 0, `יעד שלילי ב-${iso}`);
  }
  // היום שאחרי המעבר אינו קופץ מעלה
  assert.ok(G.dailyTarget(plan, '2026-10-26') <= G.dailyTarget(plan, '2026-10-24'));
});

test('ב2 · המרווח לא מתנפח למספרים חסרי משמעות', () => {
  // הכשל שכבר תוקן פעם: היעד נתקע על 1 והמרווח גדל מעבר למיליון דקות.
  const plan = ivPlan();
  for (let d = 0; d <= 200; d += 4) {
    const iso = P.addDaysISO(ISO, d);
    if (G.dailyTarget(plan, iso) === 0) break;
    assert.ok(G.targetGap(plan, iso) <= G.GAP_CEILING * 2,
      `מרווח ${G.targetGap(plan, iso)} ביום ${d}`);
  }
});

// ==========================================================================
//  ג3 · מרווח התזכורות למשתמש שמגיב מהר
//
//  הענף `gumSinceRemind ? GAP_REMIND : BACKOFF` נראה מת: שלוש מוטציות
//  נפרדות (GAP_REMIND=5, =90, ומחיקת הענף כליל) עברו את כל 390 הטסטים.
//  אבל מדידה ישירה הראתה שהוא **כן** קובע — למי שלוקח מנה תוך ~15 דקות
//  מהתזכורת הוא נותן 80 דקות בין תזכורות במקום 90.
//
//  כלומר לא הקוד היה מת אלא הכיסוי. זה בדיוק המקרה שבו מחיקת "קוד מת"
//  הייתה משנה התנהגות בשקט.
// ==========================================================================

/** מריץ יום שלם ומחזיר את המרווחים בין תזכורות */
function reminderGaps(delayAfterRemind) {
  const iso = '2026-08-03';
  const plan = { ...G.DEFAULT_PLAN, on: true };
  let taken = 0, lastR = null, ev = [], prev = null;
  const gaps = [];
  for (let m = 0; m < 24 * 60; m += 5) {
    const r = G.dueNow(plan, iso, { gum: taken, ev }, m, lastR, 18, 0);
    if (!r || !r.due) continue;
    if (prev !== null) gaps.push(m - prev);
    prev = m; lastR = m;
    const t = m + delayAfterRemind;
    ev = [...ev, { k: 'g', h: Math.floor(t / 60), m: t % 60 }];
    taken++;
  }
  return gaps;
}

test('ג3 · מי שלוקח מהר מקבל 80 דק׳ בין תזכורות, לא 90', () => {
  for (const delay of [5, 15]) {
    const gaps = reminderGaps(delay);
    assert.ok(gaps.length > 0, `אין תזכורות כלל בעיכוב ${delay}`);
    assert.equal(Math.min(...gaps), 80,
      `עיכוב ${delay} דק׳: המרווח המינימלי ${Math.min(...gaps)} — הענף של GAP_REMIND הפסיק לקבוע`);
  }
});

test('ג3 · מי שלוקח לאט נשלט על ידי MIN_GAP מהמנה', () => {
  // כאן MIN_GAP (60 מהמנה) הוא שחוסם, והמרווח גדל עם העיכוב.
  assert.equal(Math.min(...reminderGaps(45)), 105);
  assert.equal(Math.min(...reminderGaps(60)), 120);
});

test('ג3 · שום מרווח בין תזכורות אינו קטן מ-80 דק׳', () => {
  // ההבטחה למשתמש. אם היא נשברת, הטקסט ב-/מסטיקים וב-README שקרי.
  for (const delay of [0, 5, 15, 30, 45, 60]) {
    const gaps = reminderGaps(delay);
    if (!gaps.length) continue;
    assert.ok(Math.min(...gaps) >= 80,
      `עיכוב ${delay}: מרווח ${Math.min(...gaps)} דק׳ — מתחת להבטחה`);
  }
});

test('ג3 · חריגת חלון-הסיכון נעצרת ב-21:00, גם שהחלון נמשך עד 21:30', () => {
  // שני גבולות שונים לחלון הסיכון, בכוונה: dropOrderOf מותח עד המנה
  // האחרונה כדי לסווג משבצות נכון, ו-dueNow נשאר על 21:00 כי מתן מנה
  // **מעבר ליעד** סמוך לשינה אינו רצוי. הבדיקה מקבעת את ההבדל.
  const iso = '2026-08-03';
  const plan = { ...G.DEFAULT_PLAN, on: true };
  const target = G.dailyTarget(plan, iso);
  // יעד הושלם, והמנה האחרונה לפני הרבה זמן — התנאי לחריגה
  const day = { gum: target, ev: [{ k: 'g', h: 14, m: 0 }] };

  const at = m => G.dueNow(plan, iso, day, m, null, 18, 0);
  assert.equal(at(19 * 60).due, true, 'בתוך חלון הסיכון החריגה לא פעלה');
  assert.equal(at(20 * 60 + 55).due, true, 'רגע לפני 21:00 החריגה לא פעלה');
  assert.equal(at(21 * 60 + 5).due, false, 'החריגה נמשכה מעבר ל-21:00');
  assert.equal(at(21 * 60 + 25).due, false, 'הוצעה מנה נוספת סמוך לשינה');
});

// ==========================================================================
//  ג2 · צורת התוכנית — הצירוף שנופל בשקט
// ==========================================================================

test('ג2 · תוכנית תקינה אינה מדווחת על בעיות ואינה משתנה', () => {
  assert.deepEqual(G.planProblems(G.DEFAULT_PLAN), []);
  assert.equal(G.repairPlan(G.DEFAULT_PLAN), G.DEFAULT_PLAN, 'תוכנית תקינה שוכפלה');
  assert.deepEqual(G.planProblems(ivPlan()), []);
});

test('ג2 · mode=interval בלי baseGap מזוהה ולא נופל בשקט', () => {
  // זה הצירוף המסוכן: targetGap מחזיר null, dailyTarget עובר למשבצות,
  // ואין שום סימן לכך בשום מקום.
  const bad = { ...G.DEFAULT_PLAN, mode: 'interval', winStart: 540, winEnd: 1294 };
  const probs = G.planProblems(bad);
  assert.ok(probs.some(p => p.includes('baseGap')), probs.join(' | '));

  const fixed = G.repairPlan(bad);
  assert.equal(fixed.mode, 'slot', 'לא נורמל למשבצות');
  assert.ok(fixed.planRepaired.length, 'התיקון לא השאיר עקבות');
  assert.match(fixed.rhythmBasis, /נפל למשבצות/, 'הסיבה אינה גלויה בטקסט');
});

test('ג2 · כל צירוף פגום מזוהה', () => {
  const cases = [
    ['mode לא מוכר',        { mode: 'weird' }],
    ['interval בלי חלון',   { mode: 'interval', baseGap: 91 }],
    ['stepDays אפס',        { stepDays: 0 }],
    ['אישור בלי תאריך',     { confirmedTaper: true, taperStartISO: null }],
  ];
  for (const [name, over] of cases) {
    const probs = G.planProblems({ ...G.DEFAULT_PLAN, ...over });
    assert.ok(probs.length > 0, `${name}: לא זוהה`);
  }
});

test('ג2 · התיקון מחזיר תוכנית שעוברת את הבדיקה, ושומר על ההתנהגות', () => {
  const bad = { ...G.DEFAULT_PLAN, mode: 'interval', stepDays: 0, confirmedTaper: true,
                taperStartISO: ISO };
  const fixed = G.repairPlan(bad);
  assert.equal(fixed.stepDays, 4);
  // אחרי התיקון התוכנית עדיין מייצרת יעד שפוי ומגיעה לאפס
  assert.ok(G.dailyTarget(fixed, ISO) > 0);
  let prev = Infinity;
  for (let d = 0; d <= 200; d++) {
    const t = G.dailyTarget(fixed, P.addDaysISO(ISO, d));
    assert.ok(t <= prev, 'התיקון שבר את המונוטוניות');
    prev = t;
  }
  assert.equal(prev, 0, 'תוכנית מתוקנת אינה מגיעה לאפס');
});

test('ג2 · migratePlan מריץ את התיקון, ולא רק בשדרוג גרסה', () => {
  // תוכנית שכבר בגרסה הנוכחית חוזרת דרך migratePlan בכל קריאת getMeta.
  // אם התיקון היה רק בענף השדרוג, מצב פגום היה שורד לנצח.
  const cur = { ...G.DEFAULT_PLAN, ver: G.PLAN_VER, mode: 'interval' };
  assert.equal(G.migratePlan(cur).mode, 'slot', 'תוכנית בגרסה נוכחית לא תוקנה');

  const old = { ver: 1, times: G.LEGACY_TIMES_V1, mode: 'interval' };
  const out = G.migratePlan(old);
  assert.equal(out.ver, G.PLAN_VER);
  assert.equal(out.mode, 'slot');
});
