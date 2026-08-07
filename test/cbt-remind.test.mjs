// ==========================================================================
//  התזכורת לסשן
//
//  הפרוטוקול היה בנוי ובדוק, ואיש לא ידע מתי להריץ אותו: הסשנים רצים
//  בסוכן, והבוט — היחיד שפונה ביוזמתו — לא ידע עליהם דבר. התערבות
//  שתלויה בכך שייזכר לבד אינה התערבות.
//
//  שתי התכונות שנבדקות כאן:
//    • **ברירת מחדל להזכיר.** מראה חסרה לא משתיקה. תזכורת מיותרת עולה
//      הודעה; תזכורת שנחסמה עולה סשן.
//    • **כיוון כתיבה אחד.** הבוט משקף את `sessionsDone`, לא מחליט עליו.
// ==========================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cbtRemindDue, CBT_REMIND_MIN } from '../src/tick-logic.js';
import { dueSession } from '../src/cbt/protocol.js';
import { DEFAULT_META } from '../src/store.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const ISO = '2026-08-07';
const meta = (o = {}) => ({ quiet: false, sent: {}, cbtSeen: null, ...o });
const at = (h, m = 0) => h * 60 + m;
const addDays = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);

test('לפני השעה — שקט', () => {
  assert.equal(cbtRemindDue(at(20, 29), meta(), ISO, dueSession), null);
});

test('בשעה — מזכיר', () => {
  const d = cbtRemindDue(CBT_REMIND_MIN, meta(), ISO, dueSession);
  assert.ok(d, 'לא הזכיר על סשן שאמור לרוץ');
  assert.equal(d.id, 'intake');
});

test('מצב שקט — לא מזכיר', () => {
  assert.equal(cbtRemindDue(at(21), meta({ quiet: true }), ISO, dueSession), null);
});

test('כבר נשלח היום — לא חוזר', () => {
  assert.equal(cbtRemindDue(at(21), meta({ sent: { [`${ISO}:cbt`]: 1 } }), ISO, dueSession), null);
});

test('הסשן כבר רץ לפי המראה — מפסיק להזכיר', () => {
  // בלי זה התזכורת חוזרת כל ערב על סשן שנסגר, וזה בדיוק הרעש שגורם
  // להתעלם מהתזכורות בכלל.
  const m = meta({ cbtSeen: { sessionsDone: ['intake'], startISO: ISO } });
  const d = cbtRemindDue(at(21), m, ISO, dueSession);
  assert.notEqual(d && d.id, 'intake', 'הזכיר על סשן שכבר רץ');
});

test('מראה חסרה — מזכיר, לא משתיק', () => {
  assert.ok(cbtRemindDue(at(21), meta({ cbtSeen: null }), ISO, dueSession),
    'תקלת סנכרון השתיקה את הטיפול');
  assert.ok(cbtRemindDue(at(21), meta({ cbtSeen: {} }), ISO, dueSession),
    'מראה ריקה השתיקה את הטיפול');
});

// ---------- נסיגה ----------

test('שלושה ימים ראשונים — כל יום', () => {
  const seen = { sessionsDone: [], startISO: '2026-08-07' };
  for (const d of [0, 1, 2]) {
    const iso = addDays('2026-08-07', d);
    assert.ok(cbtRemindDue(at(21), meta({ cbtSeen: seen }), iso, dueSession),
      `יום ${d} מהיעד — לא הזכיר`);
  }
});

test('אחר כך פעם בשבוע, לא כל ערב', () => {
  // תזכורת יומית שמתעלמים ממנה מאמנת להתעלם גם מהבאות.
  const seen = { sessionsDone: [], startISO: '2026-08-07' };
  const fired = [];
  for (let d = 0; d <= 21; d++) {
    const iso = addDays('2026-08-07', d);
    if (cbtRemindDue(at(21), meta({ cbtSeen: seen }), iso, dueSession)) fired.push(d);
  }
  assert.deepEqual(fired, [0, 1, 2, 7, 14, 21], `דפוס שגוי: ${fired}`);
});

test('הנסיגה לא משתיקה לגמרי', () => {
  // הדלת נשארת פתוחה — אחרת זו לא נסיגה אלא ויתור.
  const seen = { sessionsDone: [], startISO: '2026-08-07' };
  assert.ok(cbtRemindDue(at(21), meta({ cbtSeen: seen }), addDays('2026-08-07', 70), dueSession),
    'אחרי עשרה שבועות — שתיקה מוחלטת');
});

test('לתזכורת יש כותרת, אורך ומספר שלבים אמיתיים', () => {
  const d = cbtRemindDue(at(21), meta(), ISO, dueSession);
  assert.ok(d.title && d.title.length > 3);
  assert.ok(Array.isArray(d.checklist) && d.checklist.length > 0);
  assert.equal(typeof d.minMinutes, 'number');
});

// ---------- הכיוון החד-סטרי ----------

test('cbtSeen נכתב רק ב-endpoint — לא מהטיק ולא מהודעות', () => {
  // בדיקה **מבנית** ולא רשימת חריגים: כל השמה ל-cbtSeen נספרת, ורק
  // אחת מותרת. רשימה ידנית הייתה מפגרת אחרי הכותב הבא.
  const src = readFileSync(join(SRC, 'index.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const writes = [...src.matchAll(/meta\.cbtSeen\s*=/g)];
  assert.equal(writes.length, 1, `${writes.length} כותבים ל-cbtSeen — הבעלוּת התפצלה`);
  // והכותב היחיד יושב בתוך הטיפול ב-/cbt-state
  const ep = src.indexOf("'/cbt-state'");
  const w = src.indexOf('meta.cbtSeen =');
  assert.ok(ep > -1 && w > ep, 'הכתיבה אינה בתוך ה-endpoint');
});

test('הטיק קורא את המראה ולא כותב אליה', () => {
  const src = readFileSync(join(SRC, 'tick-logic.js'), 'utf8');
  assert.match(src, /meta\.cbtSeen/, 'הטיק לא קורא את המראה בכלל');
  assert.doesNotMatch(src, /cbtSeen\s*=/, 'הטיק כותב למראה');
});

test('cbtSeen קיים ב-DEFAULT_META', () => {
  assert.ok('cbtSeen' in DEFAULT_META, 'מפתח חסר — מיגרציה תיפול');
  assert.equal(DEFAULT_META.cbtSeen, null);
});
