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
