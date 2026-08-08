// ==========================================================================
//  שלב 4 — הרצף בין הסשנים
//
//  זה מה שמפריד טיפול משיחה שבועית. סשן שנפתח מאפס שואל שוב את מה
//  שכבר נענה ומאבד את הדפוס.
//
//  ושתי צורות ל-state, ובכוונה: מה שנשמר כולל **תוכן**, ומה שנשלח
//  למודל הוא **מספרים**. ההפרדה היא גם מה שיאפשר להחליף ספק בלי לגעת
//  במה שנשמר.
// ==========================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/cbt/state.js';
import * as P from '../src/cbt/protocol.js';
import { makeKV, makeEnv, day } from './helpers.mjs';
import { getMeta, putMeta } from '../src/store.js';
import * as TOOLS_MOD from '../src/cbt/tools.js';
const ISO = '2026-08-08';

const run = (steps, iso = '2026-08-07') => {
  let c = S.migrateCbt(null);
  c = S.startSession(c, 'intake', iso);
  for (const [b, v] of steps) c = S.recordBct(c, b, v);
  return S.completeSession(c, iso);
};

// ---------- מיגרציה ----------

test('מצב פגום מ-KV אינו מפיל את המודול', () => {
  // מערך שהגיע כ-null היה מפיל כל .length בהמשך.
  const c = S.migrateCbt({ triggers: null, sessionsDone: 'לא-מערך', notes: undefined });
  for (const k of ['triggers', 'sessionsDone', 'notes', 'confidence', 'pastAttempts']) {
    assert.ok(Array.isArray(c[k]), `${k} אינו מערך`);
  }
  assert.equal(c.ver, S.CBT_VER);
});

test('getMeta מריץ את המיגרציה בכל קריאה, לא רק בשדרוג', async () => {
  // אותו לקח מ-repairPlan: מצב פגום בגרסה הנוכחית היה שורד לנצח.
  const kv = makeKV({ meta: JSON.stringify({ cbt: { ver: S.CBT_VER, triggers: null } }) });
  const m = await getMeta(makeEnv(kv));
  assert.deepEqual(m.cbt.triggers, []);
});

// ---------- הרצף ----------

test('תשובה שנקלטה מזינה את ה-state הקבוע ולא רק את הסשן', () => {
  // בלי זה טריגר שזוהה נעלם בסשן הבא, וכלי ההתמודדות חוזר לשאול
  // "איזה טריגר" — הרצף נשבר בדיוק במקום שהוא נחוץ.
  const c = run([['identify-triggers', 'ערב מול הטלוויזיה']]);
  assert.deepEqual(c.triggers, ['ערב מול הטלוויזיה']);
  assert.equal(c.active, null, 'הסשן נשאר פתוח');
});

test('טריגר שחוזר אינו נכפל', () => {
  let c = run([['identify-triggers', 'ערב']]);
  c = S.startSession(c, 'wk3', '2026-08-15');
  c = S.recordBct(c, 'identify-triggers', 'ערב');
  assert.equal(c.triggers.length, 1);
});

test('ביטחון נשמר כהיסטוריה — המגמה היא הסיגנל', () => {
  let c = run([['assess-readiness', '7']]);
  c = S.startSession(c, 'wk3', '2026-08-15');
  c = S.recordBct(c, 'assess-readiness', '5');
  c = S.completeSession(c, '2026-08-15');
  assert.deepEqual(c.confidence.map(x => x.v), [7, 5]);
});

test('ערך מחוץ לטווח 0–10 נדחה', () => {
  const c = run([['assess-readiness', '42']]);
  assert.deepEqual(c.confidence, []);
});

test('שיעורי בית נשמרים ונשאלים בסשן הבא', () => {
  // `markHomeworkDone` הוסר — הסגירה קורית ב-`completeSession`, שהוא
  // המקום היחיד שבו באמת ידוע שהסשן הסתיים.
  let cbt = S.migrateCbt(null);
  cbt = S.startSession(cbt, 'intake', '2026-08-07');
  cbt = S.recordBct(cbt, 'summary-and-homework', 'לרשום מתי הדחף מגיע');
  assert.equal(cbt.homework.text, 'לרשום מתי הדחף מגיע');
  assert.equal(cbt.homework.done, false, 'ש"ב נסגרו באותו סשן שהוקצו בו');

  // הסשן הבא — הם עדיין פתוחים בפתיחה, ונסגרים בסיומו
  const nxt = S.startSession(S.completeSession(cbt, '2026-08-07'), 'wk3', '2026-08-15');
  assert.ok(S.openingContext(nxt, '2026-08-15').some(b => b.kind === 'homework'),
    'ש"ב לא עלו בפתיחת הסשן הבא');
  assert.equal(S.completeSession(nxt, '2026-08-15').homework.done, true,
    'ש"ב לא נסגרו בסוף הסשן שסקר אותם');
});


test('פתיחת הסשן מזכירה ירידה בביטחון', () => {
  // זה בדיוק מה שמטפל היה פותח בו.
  let c = run([['assess-readiness', '8']]);
  c = S.startSession(c, 'wk3', '2026-08-15');
  c = S.recordBct(c, 'assess-readiness', '4');
  c = S.completeSession(c, '2026-08-15');
  const conf = S.openingContext(c, '2026-08-22').find(b => b.kind === 'confidence');
  assert.deepEqual([conf.from, conf.to], [8, 4]);
});

test('פתיחה על מצב ריק אינה ממציאה הקשר', () => {
  assert.deepEqual(S.openingContext(S.migrateCbt(null), '2026-08-07'), []);
});

// ---------- סגירת סשן ----------

test('סשן חלקי נסגר — אבל נרשם כחלקי', () => {
  // סשן תקוע היה חוסם את כל הבאים אחריו לנצח. חלקי מותר; חלקי
  // שמתחזה לשלם — לא.
  const c = run([['review-progress', null]]);
  assert.equal(c.sessionsDone.length, 1);
  assert.equal(c.notes[0].complete, false);
  assert.ok(c.notes[0].score < 1);
  assert.ok(c.notes[0].missed.length > 0);
});

test('סשן מלא נרשם כמלא', () => {
  const s = P.byId('intake');
  const c = run(s.checklist.filter(x => x.required).map(x => [x.bct, 'x']));
  assert.equal(c.notes[0].complete, true);
  assert.equal(c.notes[0].score, 1);
});

// ---------- מה שנשלח החוצה ----------

test('toolState מספרי — בלי טקסט יומן ובלי שם', () => {
  const c = run([['identify-triggers', 'ערב'], ['past-attempts', 'נשברתי בחתונה']]);
  const days = Array.from({ length: 14 }, () => day({ gum: 8, patch: true, mood: 4 }));
  const st = S.toolState(c, days, { clean: 14, gumTarget: 9 }, '2026-08-07');

  // הבדיקה מבנית ולא לפי רשימת חריגים: **שום מפתח אינו אובייקט**.
  // הגרסה הראשונה החריגה את homework, וכך פספסה מוטציה ששלחה את
  // האובייקט השלם ואת כל ה-notes החוצה.
  for (const [k, v] of Object.entries(st)) {
    if (k === 'iso') continue;
    assert.ok(!(v && typeof v === 'object' && !Array.isArray(v)),
      `${k} הוא אובייקט — מבנה שלם דולף למודל`);
    const ok = v === null || typeof v === 'number' || typeof v === 'boolean'
               || Array.isArray(v) || typeof v === 'string';
    assert.ok(ok, `${k} הוא ${typeof v}`);
    if (Array.isArray(v)) {
      for (const x of v) assert.equal(typeof x, 'string', `${k} מכיל לא-מחרוזת`);
    }
  }
  // ומפתחות שלא הוגדרו במפורש לא נוספים בשקט
  assert.equal(st.notes, undefined, 'היסטוריית הסשנים נשלחת למודל');
  assert.equal(st.gum7, 56);
  assert.equal(st.patchDays7, 7);
  assert.equal(st.cleanDays, 14);
});

test('toolState מעביר טריגרים — הם התוכן היחיד שבלעדיו כלי מתפרק', () => {
  const c = run([['identify-triggers', 'ערב מול הטלוויזיה']]);
  const st = S.toolState(c, [], { clean: 1 }, '2026-08-07');
  assert.deepEqual(st.triggers, ['ערב מול הטלוויזיה']);
});

test('toolState חוסם היסטוריה ארוכה מלדלוף', () => {
  let c = S.migrateCbt(null);
  c.triggers = ['a', 'b', 'c', 'd', 'e'];
  c.pastAttempts = ['1', '2', '3'];
  const st = S.toolState(c, [], {}, '2026-08-07');
  assert.ok(st.triggers.length <= 3);
  assert.ok(st.pastAttempts.length <= 2);
});

test('round-trip מלא דרך KV', async () => {
  const kv = makeKV(); const env = makeEnv(kv);
  let m = await getMeta(env);
  m.cbt = run([['identify-triggers', 'ערב'], ['assess-readiness', '6']]);
  await putMeta(env, m);
  const back = await getMeta(env);
  assert.deepEqual(back.cbt.triggers, ['ערב']);
  assert.equal(back.cbt.confidence[0].v, 6);
  assert.equal(back.cbt.notes.length, 1);
});

// ---------- פורמולציה כהיסטוריה ----------

test('הדפוס נשמר כהיסטוריה ולא כשדה יחיד', () => {
  // שדה יחיד מוחק את הקודם בכל עדכון, ואז אי אפשר לראות איך הדפוס נע.
  let c = S.migrateCbt(null);
  c = S.recordFormulation(c, 'הערב הוא הנקודה', '2026-08-07');
  c = S.recordFormulation(c, 'לא הערב — העייפות', '2026-08-15');
  assert.equal(c.formulations.length, 2);
  assert.equal(S.latestFormulation(c), 'לא הערב — העייפות');
  assert.equal(c.formulations[0].text, 'הערב הוא הנקודה', 'הדפוס הקודם נמחק');
});

test('דפוס ריק אינו נשמר', () => {
  const c = S.recordFormulation(S.migrateCbt(null), null, '2026-08-07');
  assert.deepEqual(c.formulations, []);
});

test('הדפוס עולה בפתיחת הסשן', () => {
  let c = S.recordFormulation(S.migrateCbt(null), 'הערב הוא הנקודה', '2026-08-07');
  const f = S.openingContext(c, '2026-08-15').find(b => b.kind === 'formulation');
  assert.ok(f, 'הדפוס נשמר ולא מוזכר — שוב תרגיל שאיש לא קורא');
  assert.match(f.text, /הערב/);
});

test('formulations שרד מיגרציה ממצב ישן', () => {
  const c = S.migrateCbt({ formulation: 'ישן', formulations: null });
  assert.deepEqual(c.formulations, []);
});


// ==========================================================================
//  מה שהמערכת מציגה כעובדה מדודה
//
//  שני מספרים הוצגו תחת הכותרת "מה שהמערכת רואה, ולא מה שנזכר" —
//  ושניהם לא היו מדידה:
//    · `cleanDays` היה **ימי לוח** מאז הגמילה. לא התאפס במעידה, ולא
//      קרא `slips` בכלל, בזמן שבאותו סשן `slips7` העלה את "אף לא
//      שאיפה אחת" לעדיפות 95.
//    · לסכומים לא היה מכנה, ולכן יום שלא תועד תרם 0 — ומי שתיעד
//      שלושה ימים ביעד קיבל "תת-שימוש הוא הכשל הקלאסי של NRT".
// ==========================================================================

/** יום מלא — `day` כבר תפוס ע"י helpers.mjs */
const d7 = (o = {}) => ({ gum: 4, patch: true, slips: 0, waves: 0, ...o });

test('רצף נקי נשבר במעידה', () => {
  const days = [d7(), d7(), d7(), d7({ slips: 1 }), d7(), d7()];
  assert.equal(S.cleanStreak(days, 30), 3, 'המעידה לא שברה את הרצף');
  assert.equal(S.cleanStreak([d7({ slips: 1 }), d7()], 30), 0, 'מעידה היום');
});

test('רצף נקי אינו מוגבל לחלון הנתונים', () => {
  // 14 ימים בלי מעידה אינם ראיה שהרצף הוא 14 — הוא עשוי להיות ארוך
  // יותר. קיצוץ לחלון היה מדווח חסר על מי שנקי חודשיים.
  assert.equal(S.cleanStreak(Array(14).fill(d7()), 60), 60);
});

test('בלי נתונים — נופלים לספירת התוכנית', () => {
  assert.equal(S.cleanStreak([], 21), 21);
  assert.equal(S.cleanStreak(null, 21), 21);
});

test('`cleanDays` ב-toolState הוא הרצף, לא ימי הלוח', () => {
  // זו הבדיקה שמונעת חזרה ל-`plan.clean`.
  const days = [d7(), d7({ slips: 1 }), d7(), d7()];
  const st = S.toolState(S.migrateCbt(null), days, { clean: 40, gumTarget: 6 }, ISO);
  assert.equal(st.cleanDays, 1, `קיבלנו ${st.cleanDays} — ימי לוח חזרו`);
});

test('כיסוי סופר ימים מתועדים בפועל', () => {
  const days = [d7(), {}, {}, d7(), {}, d7(), {}];
  const st = S.toolState(S.migrateCbt(null), days, { clean: 10, gumTarget: 6 }, ISO);
  assert.equal(st.coverage, 3, `כיסוי ${st.coverage} מתוך 3 ימים מתועדים`);
});

test('יום ריק אינו נספר ככיסוי, יום עם מצב רוח בלבד כן', () => {
  const st = S.toolState(S.migrateCbt(null),
    [{ mood: 3 }, {}, { gum: 0, patch: false }], { clean: 5 }, ISO);
  assert.equal(st.coverage, 1, 'ספירת הכיסוי אינה מבחינה בין ריק לתועד');
});

test('הכלים אומרים את המכנה כשהכיסוי חלקי', () => {
  const T = TOOLS_MOD;
  const low = { ...T.EMPTY_STATE, dayNum: 20, cleanDays: 20, coverage: 3,
                gum7: 12, gumTarget: 6, patchDays7: 3, triggers: [] };
  const obj = T.byId('objective-verification').run(low);
  assert.match(obj.text, /3 מתוך 7/, 'הכלי אינו אומר כמה ימים תועדו');
  assert.match(obj.text, /חלקיים/, 'לא נאמר שהמספרים חלקיים');

  const full = { ...low, coverage: 7 };
  assert.doesNotMatch(T.byId('objective-verification').run(full).text, /חלקיים/,
    'אזהרת כיסוי מוצגת גם כשהכיסוי מלא');
});

test('בדיקת ההתקדמות מסמנת כיסוי חלקי', () => {
  const T = TOOLS_MOD;
  const low = { ...T.EMPTY_STATE, dayNum: 20, cleanDays: 20, coverage: 2 };
  assert.match(T.byId('review-progress').run(low).text, /2\/7/,
    'לא נאמר שהכיסוי חלקי');
});


// ==========================================================================
//  קלט פגום — כל אחד מאלה הפיל את /טיפול ב-500
//
//  `migrateCbt` נעצר ב-`Array.isArray`, ולכן **מערך תקין עם תוכן פגום**
//  עבר. `/cbt-state` POST הוא הנתיב הישיר פנימה, וכל ערך כזה נשמר ל-KV
//  והמשיך להפיל כל בקשה עד עריכה ידנית.
// ==========================================================================

const survives = (bad) => {
  const c = S.migrateCbt(bad);
  P.fidelity(c.active ? P.byId(c.active.id) : P.byId('intake'), c.active?.done || []);
  S.fidelityReport(c);
  S.openingContext(c, '2026-08-08');
  S.toolState(c, [], { clean: 5, gumTarget: 6 }, '2026-08-08');
  return c;
};

test('active פגום מנוטרל ולא מפיל את fidelity', () => {
  assert.equal(survives({ active: {} }).active, null);
  assert.equal(survives({ active: { id: 'לא-קיים' } }).active, null);
  assert.equal(survives({ active: { id: 'intake', remaining: 'x', done: null } })
    .active.remaining.length, 0);
});

test('notes פגומים מסוננים — fidelityReport לא זורק', () => {
  // רשומה חייבת גם תאריך — בלעדיו `openingContext` קרס על diffDays.
  const c = survives({ notes: [null, { score: 1, missed: [], iso: '2026-08-01' },
                               { score: 'x', missed: [], iso: '2026-08-02' },
                               { score: 1, missed: [] }] });
  assert.equal(c.notes.length, 1, `שרדו ${c.notes.length} רשומות`);
});

test('confidence פגום מסונן — openingContext לא זורק', () => {
  assert.equal(survives({ confidence: [null, null, { v: 6 }] }).confidence.length, 1);
});

test('homework שאינו אובייקט מנוטרל', () => {
  // "ש\"ב פתוחים מלפני NaN ימים: undefined" נשלח למשתמש.
  assert.equal(survives({ homework: 'טקסט' }).homework, null);
  assert.equal(survives({ homework: { text: 'ok' } }).homework.text, 'ok');
});

test('קלט שאינו אובייקט מחזיר מצב ריק', () => {
  for (const bad of ['hello', [1, 2], 42, true]) {
    const c = survives(bad);
    assert.deepEqual(c.sessionsDone, [], `${JSON.stringify(bad)} השאיר זבל`);
    assert.equal('0' in c, false, 'מחרוזת התפרקה לאינדקסים');
  }
});

test('מפתחות זרים אינם שורדים דרך migrateCbt+pickCbtFields', () => {
  const c = S.migrateCbt(S.pickCbtFields({ sessionsDone: [], force: true, x: 1 }));
  assert.equal('force' in c, false);
  assert.equal('x' in c, false);
});
