// ==========================================================================
//  ח׳ — התפרים בין המודולים
//
//  לכל מודול יש בעלים בקוד ובדיקות. **לתפר אין בעלים** — ולכן שם נולדו
//  הבאגים החמורים ביותר, וכל אחד מהם נראה תקין משני הצדדים:
//
//    • הסנוז: index.js הציב רצפת-זמן, gum.js החזיק תקרת-נסיגה. כל צד
//      נכון לחוד; המכפלה איחרה תזכורת ב-79 דקות.
//    • ההסלמה: analytics.js ייצר דגלים, index.js קבע את הסף. אף צד לא
//      ראה ששבוע שקט מייצר דגל אחד בלבד.
//    • הכיסוי: store.js ידע מה חסר, analytics.js לא קיבל את המידע.
//
//  הבדיקות כאן אינן על ערכים אלא על **יחסים**: הן חייבות להיכשל אם
//  מישהו ישנה צד אחד בלבד.
// ==========================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/plan.js';
import * as G from '../src/gum.js';
import * as S from '../src/store.js';
import * as ANL from '../src/analytics.js';
import { makeKV, makeEnv, seedRecent, day } from './helpers.mjs';

const TODAY = '2026-08-02';

// ==========================================================================
//  S1 · plan → gum
// ==========================================================================

test('S1 · תחילת הצמצום נגזרת מהלוח ואינה מקודדת', () => {
  // אם מישהו יזיז את QUIT או את TOTAL_DAYS, הצמצום חייב לזוז איתם.
  // הערך היה '2026-09-15' קשיח, וכל שינוי בלוח היה משאיר אותו מאחור.
  assert.equal(G.TAPER_START, P.addDaysISO(P.QUIT, P.TOTAL_DAYS));
});

test('S1 · הצמצום מתחיל אחרי המדבקה האחרונה, לא לפניה', () => {
  // הכלל הקליני: לא מורידים שתי רשתות במקביל.
  const lastPatch = P.planFor(P.QUIT).lastPatchISO;
  assert.ok(G.TAPER_START > lastPatch, `${G.TAPER_START} אינו אחרי ${lastPatch}`);
  assert.equal(P.diffDays(lastPatch, G.TAPER_START), 1, 'יש פער או חפיפה');
});

test('S1 · הרצפה הזמנית מאוחרת מתחילת הצמצום ונגזרת מהגמילה', () => {
  assert.ok(G.TAPER_BACKSTOP > G.TAPER_START);
  assert.equal(G.TAPER_BACKSTOP, P.addDaysISO(P.QUIT, 84), '12 שבועות מהגמילה');
});

test('S1 · ברירת המחדל של התוכנית משתמשת בערך הנגזר', () => {
  assert.equal(G.DEFAULT_PLAN.taperStartISO, G.TAPER_START);
});

// ==========================================================================
//  S2 · store ↔ gum
// ==========================================================================

test('S2 · getMeta מריץ את מיגרציית התוכנית', async () => {
  const kv = makeKV({ meta: JSON.stringify({ gumPlan: { times: G.LEGACY_TIMES_V1 } }) });
  const m = await S.getMeta(makeEnv(kv));
  assert.equal(m.gumPlan.ver, G.PLAN_VER, 'המיגרציה לא רצה בקריאה');
  assert.equal(m.gumPlan.times.length, G.RECOMMENDED.times.length);
});

test('S2 · אין מעגל ייבוא — שני הכיוונים נטענים', async () => {
  // store.js מייבא מ-gum.js. אם gum.js היה מייבא בחזרה, אחד מהם היה
  // רואה undefined בזמן הטעינה והמיגרציה הייתה קורסת בשקט.
  const [a, b] = await Promise.all([import('../src/store.js'), import('../src/gum.js')]);
  assert.equal(typeof a.getMeta, 'function');
  assert.equal(typeof b.migratePlan, 'function');
  assert.ok(a.DEFAULT_META.gumSoftCap > 0, 'store נטען חלקית');
});

test('S2 · התקרה הרכה תמיד מעל היעד שהתוכנית מגדירה', async () => {
  // שני צדדים: store קובע את התקרה, gum קובע את היעד. אם אחד יזוז
  // בלי השני, ציות מלא ייקרא כמינון-יתר.
  const m = await S.getMeta(makeEnv());
  const target = G.dailyTarget({ ...G.DEFAULT_PLAN, ...(m.gumPlan || {}) }, TODAY);
  assert.ok(m.gumSoftCap > target, `תקרה ${m.gumSoftCap} מול יעד ${target}`);
});

// ==========================================================================
//  S3 · store → analytics
// ==========================================================================

test('S3 · _exists שורד את כל השרשרת עד covered', async () => {
  const kv = makeKV();
  seedRecent(kv, TODAY, 3, { gum: 5 });          // 3 ימים נכתבו
  const days = await ANL.collect(makeEnv(kv), TODAY, 7);
  assert.equal(days.filter(d => d._exists).length, 3, 'הדגל אבד ב-collect');
  assert.equal(ANL.analyse(days).coverage, 3, 'הדגל לא הגיע ל-covered');
});

test('S3 · יום מאופס שנכתב אינו זהה ליום שלא נכתב', async () => {
  // זו ההבחנה שאבדה, וממנה נבע העיוות המסוכן ביותר.
  const written = makeKV();
  seedRecent(written, TODAY, 7, {});             // נכתבו, כולם באפסים
  const missing = makeKV();                       // לא נכתב כלום

  const aW = ANL.analyse(await ANL.collect(makeEnv(written), TODAY, 7));
  const aM = ANL.analyse(await ANL.collect(makeEnv(missing), TODAY, 7));
  assert.equal(aW.coverage, 7);
  assert.equal(aM.coverage, 0);
  assert.notEqual(aW.coverage, aM.coverage, 'שני המצבים נראים זהים');
});

test('S3 · רשומה פגומה נספרת כחסרה לאורך כל השרשרת', async () => {
  const kv = makeKV({ [`d:${TODAY}`]: '{פגום' });
  const days = await ANL.collect(makeEnv(kv), TODAY, 7);
  assert.equal(ANL.analyse(days).coverage, 0, 'רשומה פגומה נספרה ככיסוי');
});

// ==========================================================================
//  S4 · gum → analytics
// ==========================================================================

test('S4 · סף הכיסוי אחד, ושני הצדדים מתהפכים באותה נקודה', async () => {
  // analytics מייבא COVERAGE_MIN מ-gum. אם מישהו יגדיר סף שני מקומי,
  // גלאי המוכנות והסלמת הכיסוי יתפצלו — ואז הבוט יגיד "אין מספיק
  // נתונים" בצד אחד ו"הכול טוב" בצד השני, על אותו שבוע.
  for (const n of [G.COVERAGE_MIN - 1, G.COVERAGE_MIN]) {
    const kv = makeKV();
    seedRecent(kv, TODAY, n, { gum: 10, patch: true, ev: [{ k: 'g', h: 9, m: 0 }] });
    const { blind } = ANL.escalationFlags(await ANL.collect(makeEnv(kv), TODAY, 7), { gumSoftCap: 18 });

    const wk = Array.from({ length: 7 }, (_, i) =>
      i < n ? day({ gum: 10, patch: true, ev: [{ k: 'g', h: 9, m: 0 }] }) : day());
    const rd = G.readiness(wk, wk, 12);
    const gumBlocked = rd.reasons.some(r => r.includes('מתועדים'));

    assert.equal(blind, n < G.COVERAGE_MIN, `analytics ב-${n} ימים`);
    assert.equal(gumBlocked, n < G.COVERAGE_MIN, `gum ב-${n} ימים`);
    assert.equal(blind, gumBlocked, `שני הצדדים לא מסכימים על ${n} ימים`);
  }
});

test('S4 · isLogged הוא אותה הגדרה בשני הצדדים', () => {
  // analytics.covered נגזר מ-isLogged של gum. יום עם סימן חיים אחד
  // בלבד חייב להיספר בשניהם.
  const only = [{ gum: 1 }, { waves: 1 }, { slips: 1 }, { patch: true }, { mDone: true }];
  for (const o of only) {
    assert.equal(G.isLogged(day(o)), true, JSON.stringify(o));
    assert.equal(ANL.analyse([day(o)]).coverage, 1, `covered לא הסכים על ${JSON.stringify(o)}`);
  }
  assert.equal(G.isLogged(day()), false, 'יום ריק לגמרי נספר');
});

// ==========================================================================
//  S5 · analytics → index
// ==========================================================================

test('S5 · שער ההסלמה: כיסוי חסר עומד לבדו', async () => {
  const { flags, blind } = ANL.escalationFlags(
    await ANL.collect(makeEnv(makeKV()), TODAY, 7), { gumSoftCap: 18 });
  assert.equal(blind, true);
  assert.ok(flags.length < ANL.ESCALATION_MIN_FLAGS,
    'שבוע שקט מייצר פחות דגלים מהסף — וזה בדיוק למה blind חייב לעמוד לבדו');
  assert.equal(ANL.shouldEscalate({ flags, blind }), true, 'שבוע שקט לא הסלים');
});

test('S5 · דגל בודד בלי blind אינו מספיק', () => {
  assert.equal(ANL.shouldEscalate({ flags: ['אחד'], blind: false }), false);
  assert.equal(ANL.shouldEscalate({ flags: ['אחד', 'שניים'], blind: false }), true);
  assert.equal(ANL.shouldEscalate({ flags: [], blind: true }), true);
});

test('S5 · שבוע מוצלח לא מסלים', async () => {
  const kv = seedRecent(makeKV(), TODAY, 7, {
    patch: true, gum: 12, waves: 2, surfed: 2, ev: [{ k: 'g', h: 9, m: 0 }],
  });
  const res = ANL.escalationFlags(await ANL.collect(makeEnv(kv), TODAY, 7), { gumSoftCap: 18 });
  assert.equal(ANL.shouldEscalate(res), false, res.flags.join(' | '));
});

test('S5 · הטקסט תואם למסלול שהשער בחר', async () => {
  // אם blind, הפנייה חייבת להיות "בדיקה קצרה" ולא סולם הידיות —
  // אין טעם לדחוף סולם שנבנה על נתונים במי שפשוט הפסיק לדווח.
  const silent = ANL.escalationFlags(await ANL.collect(makeEnv(makeKV()), TODAY, 7), { gumSoftCap: 18 });
  const t = ANL.escalationText(silent.flags, silent.stats, silent.blind);
  assert.ok(t.includes('בדיקה קצרה'));
  assert.ok(!t.includes('להעלות מספר מנות'));
});
