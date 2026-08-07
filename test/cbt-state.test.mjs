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
  const c = run([['summary-and-homework', 'לשים לב מתי בערב']]);
  assert.equal(c.homework.done, false);
  const ctx = S.openingContext(c, '2026-08-15');
  assert.ok(ctx.some(b => b.kind === 'homework'), 'שיעורי הבית לא עולים בפתיחה');
  assert.equal(S.markHomeworkDone(c).homework.done, true);
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
