// ==========================================================================
//  שלב 3 — ה-BCTs ככלים בדידים
//
//  הבדיקה המרכזית כאן אינה "הכלי מחזיר טקסט" אלא **שהבחירה מגיבה למצב**.
//  כלי שנורה תמיד אינו כלי — הוא פסקה קבועה, וזה בדיוק ההבדל בין
//  פרוטוקול לבין סקריפט.
// ==========================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../src/cbt/tools.js';
import * as P from '../src/cbt/protocol.js';

const S = (over = {}) => ({ ...T.EMPTY_STATE, ...over });
const REAL = S({
  iso: '2026-08-07', dayNum: 14, cleanDays: 14, gum7: 52, gumTarget: 9,
  patchDays7: 7, mood: 4, waves7: 1, slips7: 0, triggers: ['ערב מול הטלוויזיה'],
});

test('כל BCT שהפרוטוקול דורש קיים ככלי', () => {
  const have = new Set(T.TOOLS.map(t => t.id));
  const missing = P.requiredBcts().filter(b => !have.has(b));
  assert.deepEqual(missing, [], `BCTs בלי כלי: ${missing.join(', ')}`);
});

test('לכל כלי יש שם, ראיה, שער ודירוג', () => {
  for (const t of T.TOOLS) {
    assert.ok(t.name && t.evidence, `${t.id}: חסר שם או ראיה`);
    assert.equal(typeof t.appliesWhen, 'function', `${t.id}: אין appliesWhen`);
    assert.equal(typeof t.priority, 'function', `${t.id}: אין priority`);
    const out = t.run(REAL);
    assert.ok(out.text && out.expects, `${t.id}: run לא מחזיר text/expects`);
  }
});

// ---------- השער: כלי שאין לו על מה להישען לא נורה ----------

test('כלים תלויי-נתונים נחסמים על state ריק', () => {
  // זה הלב. "תכנן התמודדות לטריגר" בלי טריגר מזוהה מייצר שאלה מופשטת
  // שנשמעת כמו טיפול ואינה טיפול.
  for (const id of [P.BCT.OBJECTIVE, P.BCT.COPING, P.BCT.MEDS, P.BCT.PROGRESS]) {
    assert.equal(T.byId(id).appliesWhen(T.EMPTY_STATE), false, `${id} נורה על state ריק`);
  }
});

test('לא כל הכלים נורים על state ריק', () => {
  const fire = T.applicable(T.EMPTY_STATE);
  assert.ok(fire.length < T.TOOLS.length / 2,
    `${fire.length} מתוך ${T.TOOLS.length} כלים נורים בלי שום נתון`);
});

test('אימות אובייקטיבי דורש נתונים אמיתיים', () => {
  assert.equal(T.byId(P.BCT.OBJECTIVE).appliesWhen(S({ cleanDays: 5 })), false,
    'נורה בלי מסטיק ובלי מדבקה — זה דיווח עצמי שמתחזה לאימות');
  assert.equal(T.byId(P.BCT.OBJECTIVE).appliesWhen(S({ cleanDays: 5, patchDays7: 7 })), true);
});

test('תוכנית התמודדות דורשת טריגר מזוהה', () => {
  assert.equal(T.byId(P.BCT.COPING).appliesWhen(S({ dayNum: 14 })), false);
  assert.equal(T.byId(P.BCT.COPING).appliesWhen(S({ dayNum: 14, triggers: ['ערב'] })), true);
});

// ---------- הדירוג: המצב משנה סדר ----------

test('מעידה מקפיצה את כלל "אף לא שאיפה אחת" לראש', () => {
  const nap = T.byId(P.BCT.NAP);
  const calm = nap.priority(S({ dayNum: 14 }));
  const slip = nap.priority(S({ dayNum: 14, slips7: 1 }));
  assert.ok(slip > calm + 20, `${calm} → ${slip}: המעידה כמעט לא שינתה דירוג`);
  assert.equal(T.applicable(S({ dayNum: 14, slips7: 1 }))[0].id, P.BCT.NAP);
});

test('תת-שימוש במסטיק מקפיץ את בדיקת ה-NRT', () => {
  const meds = T.byId(P.BCT.MEDS);
  const ok = meds.priority(S({ gumTarget: 9, gum7: 63 }));
  const low = meds.priority(S({ gumTarget: 9, gum7: 35 }));
  assert.ok(low > ok, 'תת-שימוש לא מעלה דחיפות — וזה הכשל המתועד של NRT');
});

test('ביטחון נמוך מעלה את דחיפות ההערכה', () => {
  const r = T.byId(P.BCT.READINESS);
  assert.ok(r.priority(S({ confidence: 3 })) > r.priority(S({ confidence: 9 })));
});

test('הסיכום תמיד אחרון', () => {
  const ranked = T.applicable(REAL);
  assert.equal(ranked[ranked.length - 1].id, P.BCT.SUMMARY,
    'הסיכום אינו אחרון — סיכום שפותח סשן סוגר אותו');
});

// ---------- הבחירה בתוך סשן ----------

test('nextTool בוחר רק מתוך מה שהצ׳קליסט עוד מבקש', () => {
  const s = P.byId('wk3');
  const rem = s.checklist.map(c => c.bct).filter(b => b !== P.BCT.PROGRESS);
  const t = T.nextTool(REAL, rem);
  assert.notEqual(t.id, P.BCT.PROGRESS, 'נבחר כלי שכבר בוצע');
  assert.ok(rem.includes(t.id));
});

test('nextTool מחזיר null כשאין כלי שמתאים למצב', () => {
  assert.equal(T.nextTool(T.EMPTY_STATE, [P.BCT.OBJECTIVE, P.BCT.COPING]), null);
});

test('סשן שלם מתקדם עד שהצ׳קליסט מתרוקן', () => {
  // סימולציה: בכל צעד נבחר כלי, מסמנים כבוצע, וממשיכים.
  const s = P.byId('wk3');
  let rem = s.checklist.map(c => c.bct);
  const done = [];
  for (let i = 0; i < 20 && rem.length; i++) {
    const t = T.nextTool(REAL, rem);
    if (!t) break;
    done.push(t.id);
    rem = rem.filter(b => b !== t.id);
  }
  assert.ok(done.length >= 7, `רק ${done.length} כלים רצו מתוך ${s.checklist.length}`);
  assert.equal(new Set(done).size, done.length, 'כלי רץ פעמיים');
  assert.equal(P.canComplete(s, done).ok, true, `הסשן לא נסגר: ${P.canComplete(s, done).missing}`);
});

test('ה-state שנשלח הוא מספרים, לא טקסט חופשי', () => {
  // ההחלטה על הספק נפלה לטובת יכולת על פני פרטיות — ודווקא לכן
  // מה שיוצא צריך להיות תמצית ולא יומן.
  for (const [k, v] of Object.entries(T.EMPTY_STATE)) {
    if (['iso', 'homework'].includes(k)) continue;
    assert.ok(v === null || typeof v === 'number' || Array.isArray(v) || typeof v === 'boolean',
      `${k} הוא ${typeof v} — טקסט חופשי ב-state נשלח החוצה`);
  }
});
