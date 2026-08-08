// ==========================================================================
//  התזכורת לסשן
//
//  הפרוטוקול היה בנוי ובדוק, ואיש לא ידע מתי להריץ אותו: הסשנים רצים
//  בסוכן, והבוט — היחיד שפונה ביוזמתו — לא ידע עליהם דבר. התערבות
//  שתלויה בכך שייזכר לבד אינה התערבות.
//
//  שתי התכונות שנבדקות כאן:
//    • **ברירת מחדל להזכיר.** מצב חסר לא משתיק. תזכורת מיותרת עולה
//      הודעה; תזכורת שנחסמה עולה סשן.
//    • **בעלים אחד.** `meta.cbt` ב-KV הוא המצב, ושני המקומות שמריצים
//      סשן — הבוט והסוכן — קוראים וכותבים אותו. עותק נפרד עם שני
//      כותבים מתפצל בהגדרה.
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
const meta = (o = {}) => ({ quiet: false, sent: {}, cbt: null, ...o });
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

test('הסשן כבר רץ — מפסיק להזכיר', () => {
  // בלי זה התזכורת חוזרת כל ערב על סשן שנסגר, וזה בדיוק הרעש שגורם
  // להתעלם מהתזכורות בכלל.
  const m = meta({ cbt: { sessionsDone: ['intake'], startISO: ISO } });
  const d = cbtRemindDue(at(21), m, ISO, dueSession);
  assert.notEqual(d && d.id, 'intake', 'הזכיר על סשן שכבר רץ');
});

test('מצב חסר — מזכיר, לא משתיק', () => {
  assert.ok(cbtRemindDue(at(21), meta({ cbt: null }), ISO, dueSession),
    'מצב חסר השתיק את הטיפול');
  assert.ok(cbtRemindDue(at(21), meta({ cbt: {} }), ISO, dueSession),
    'מצב ריק השתיק את הטיפול');
});

// ---------- נסיגה ----------

test('שלושה ימים ראשונים — כל יום', () => {
  const seen = { sessionsDone: [], startISO: '2026-08-07' };
  for (const d of [0, 1, 2]) {
    const iso = addDays('2026-08-07', d);
    assert.ok(cbtRemindDue(at(21), meta({ cbt: seen }), iso, dueSession),
      `יום ${d} מהיעד — לא הזכיר`);
  }
});

test('אחר כך פעם בשבוע, לא כל ערב', () => {
  // תזכורת יומית שמתעלמים ממנה מאמנת להתעלם גם מהבאות.
  const seen = { sessionsDone: [], startISO: '2026-08-07' };
  const fired = [];
  for (let d = 0; d <= 21; d++) {
    const iso = addDays('2026-08-07', d);
    if (cbtRemindDue(at(21), meta({ cbt: seen }), iso, dueSession)) fired.push(d);
  }
  assert.deepEqual(fired, [0, 1, 2, 7, 14, 21], `דפוס שגוי: ${fired}`);
});

test('הנסיגה לא משתיקה לגמרי', () => {
  // הדלת נשארת פתוחה — אחרת זו לא נסיגה אלא ויתור.
  const seen = { sessionsDone: [], startISO: '2026-08-07' };
  assert.ok(cbtRemindDue(at(21), meta({ cbt: seen }), addDays('2026-08-07', 70), dueSession),
    'אחרי עשרה שבועות — שתיקה מוחלטת');
});

test('לתזכורת יש כותרת, אורך ומספר שלבים אמיתיים', () => {
  const d = cbtRemindDue(at(21), meta(), ISO, dueSession);
  assert.ok(d.title && d.title.length > 3);
  assert.ok(Array.isArray(d.checklist) && d.checklist.length > 0);
  assert.equal(typeof d.minMinutes, 'number');
});

// ---------- בעלים אחד ----------

test('סשן פתוח אינו מייצר תזכורת', () => {
  // סשן שפתוח הוא סשן שרץ, לא סשן ש"אמור לרוץ". תזכורת עליו היא רעש
  // שמאמן להתעלם מהתזכורות האמיתיות.
  const m = meta({ cbt: { sessionsDone: [], startISO: ISO, active: { id: 'intake' } } });
  assert.equal(cbtRemindDue(at(21), m, ISO, dueSession), null);
});

test('הטיק קורא את המצב ולא כותב אליו', () => {
  const src = readFileSync(join(SRC, 'tick-logic.js'), 'utf8');
  assert.match(src, /meta\.cbt/, 'הטיק לא קורא את המצב');
  assert.doesNotMatch(src, /meta\.cbt\s*=/, 'הטיק כותב למצב');
});

test('אין יותר עותק נפרד של מצב ה-CBT', () => {
  // `cbtSeen` היה מראה עם כותב אחד. משהתווסף `/טיפול` נוצר כותב שני,
  // ואז זה כבר לא מראה אלא מצב מקביל שמתפצל. הבדיקה **מבנית**: אף
  // קובץ מקור לא מזכיר אותו, כדי שלא יחזור בדלת האחורית.
  for (const f of ['index.js', 'store.js', 'tick-logic.js']) {
    assert.doesNotMatch(readFileSync(join(SRC, f), 'utf8'), /cbtSeen/,
      `${f} עדיין מחזיק עותק נפרד`);
  }
});

test('cbt קיים ב-DEFAULT_META', () => {
  assert.ok('cbt' in DEFAULT_META, 'מפתח חסר — מיגרציה תיפול');
});


test('אין תזכורת כשהסשן הקודם רץ לפני פחות מהמרווח', async () => {
  // התזכורת ירתה על סשן שאי אפשר לפתוח: `dueSession` חוסם לפי מרווח,
  // והתזכורת לא העבירה `lastISO` בכלל — הודעה יומית על משהו שלחיצה
  // עליו מחזירה "אין סשן שאמור לרוץ היום".
  //
  // התרחיש חייב להיות כזה שהסשן **כן** הגיע לתאריך שלו ורק המרווח
  // חוסם אותו — אחרת הבדיקה עוברת מהסיבה הלא-נכונה.
  const P = await import('../src/cbt/protocol.js');
  const cbt = {
    sessionsDone: ['intake', 'wk3'], startISO: '2026-08-07',
    notes: [{ id: 'wk3', iso: '2026-08-21', score: 1, missed: [], bcts: [] }],
  };
  // wk4 מגיע ב-22.8; הסשן הקודם רץ ב-21.8 — יומיים בלבד.
  assert.ok(P.dueSession('2026-08-23', cbt.sessionsDone, cbt.startISO),
    'התרחיש שגוי: wk4 אינו זמין בלי המרווח');
  assert.equal(P.dueSession('2026-08-23', cbt.sessionsDone, cbt.startISO, '2026-08-21'), null,
    'התרחיש שגוי: המרווח אינו חוסם');

  assert.equal(cbtRemindDue(at(21), meta({ cbt }), '2026-08-23', P.dueSession), null,
    'תזכורת על סשן שהמרווח חוסם');

  // ואחרי שהמרווח עבר — כן מזכיר. 29.8 הוא שבוע אחרי היעד של wk4,
  // כלומר גם המרווח וגם הנסיגה השבועית פתוחים.
  assert.ok(cbtRemindDue(at(21), meta({ cbt }), '2026-08-29', P.dueSession),
    'אין תזכורת גם אחרי שהמרווח עבר');
});

