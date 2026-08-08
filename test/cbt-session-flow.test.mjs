// ==========================================================================
//  הסשן כפי שהוא רץ בבוט
//
//  עד עכשיו הפרוטוקול היה בנוי ובדוק, וניתן להרצה רק מהסוכן — כלומר
//  בבוט לא היה סשן בכלל. `session.js` הוא החוליה שחסרה, והיא נטולת
//  I/O בדיוק כדי שסשן שלם ייבדק כאן בלי טלגרם, בלי KV ובלי מפתח.
// ==========================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as SESS from '../src/cbt/session.js';
import * as S from '../src/cbt/state.js';
import * as P from '../src/cbt/protocol.js';
import { ROLES } from '../src/cbt/engine.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const ISO = '2026-08-07';
const ST = { iso: ISO, dayNum: 14, cleanDays: 14, gum7: 60, gumTarget: 9,
             patchDays7: 7, mood: 3, fatigue: 2, waves7: 5, slips7: 0,
             triggers: [], pastAttempts: [], confidence: null,
             homework: null, sessionsDone: [], taperStarted: true };

const fresh = () => S.migrateCbt(null);
/** מודל מזויף: עונה משהו סביר לכל תפקיד */
const fake = (over = {}) => async (role) => over[role] ??
  ({ triage: 'answer', extract: 'ערך', fetch: 'craving', respond: 'תגובה. ומה קרה אז?',
     critique: 'OK', formulate: 'הדפוס: בערב, כשהוא לבד.' }[role] ?? 'x');

// ---------- פתיחה ----------

test('נפתח הסשן שאמור לרוץ', () => {
  const r = SESS.openSession(fresh(), ISO);
  assert.ok(!r.error, r.error);
  assert.equal(r.session.id, 'intake');
  assert.ok(r.cbt.active, 'לא נפתח סשן');
  assert.equal(r.cbt.active.remaining.length, r.session.checklist.length);
});

test('אי אפשר לפתוח שניים', () => {
  const a = SESS.openSession(fresh(), ISO);
  assert.equal(SESS.openSession(a.cbt, ISO).error, 'active');
});

test('כשאין סשן ליום — אומר מתי הבא', () => {
  const cbt = { ...fresh(), sessionsDone: ['intake'], startISO: ISO };
  const r = SESS.openSession(cbt, ISO);
  assert.equal(r.error, 'none-due');
  assert.ok(r.nextISO, 'לא נאמר מתי הבא');
});

// ---------- תור ----------

test('תור מריץ, רושם, ומקטין את הנותרים', async () => {
  const o = SESS.openSession(fresh(), ISO);
  const tool = SESS.nextStep(o.cbt, ST);
  assert.ok(tool);
  const before = o.cbt.active.remaining.length;
  const r = await SESS.runStep(o.cbt, tool, ST, 'בערב מול הטלוויזיה', { call: fake() });
  assert.equal(r.cbt.active.remaining.length, before - 1, 'הכלי לא נרשם');
  assert.ok(r.reply, 'אין תגובה');
});

test('מודל שנכשל עדיין מקדם את הסשן', async () => {
  // תור שלא נרשם משאיר את הכלי ב-remaining לנצח, והסשן נתקע על אותה
  // שאלה — כישלון רשת שהופך לסשן שאי אפשר לסיים.
  const o = SESS.openSession(fresh(), ISO);
  const tool = SESS.nextStep(o.cbt, ST);
  const before = o.cbt.active.remaining.length;
  const r = await SESS.runStep(o.cbt, tool, ST, 'משהו', { call: async () => null });
  assert.equal(r.cbt.active.remaining.length, before - 1, 'כישלון מודל תקע את הסשן');
});

test('הערך שנקלט מוזן ל-state הקבוע ולא רק לסשן', async () => {
  const o = SESS.openSession(fresh(), ISO);
  const tool = P.byId('intake').checklist.map(c => c.bct).includes('identify-triggers')
    ? (await import('../src/cbt/tools.js')).byId('identify-triggers') : null;
  assert.ok(tool, 'הכלי אינו בצ׳קליסט של הקליטה');
  const r = await SESS.runStep(o.cbt, tool, ST, 'בערב', { call: fake({ extract: 'ערב מול הטלוויזיה' }) });
  assert.ok(r.cbt.triggers.includes('ערב מול הטלוויזיה'),
    'הטריגר לא שרד את הסשן — הרצף נשבר בדיוק במקום שהוא נחוץ');
});

// ---------- סשן שלם ----------

test('סשן שלם רץ עד הסוף ונסגר עם נאמנות מלאה', async () => {
  let cbt = SESS.openSession(fresh(), ISO).cbt;
  let n = 0;
  for (;;) {
    const tool = SESS.nextStep(cbt, ST);
    if (!tool) break;
    assert.ok(++n <= SESS.MAX_TURNS, 'הסשן לא נגמר');
    ({ cbt } = await SESS.runStep(cbt, tool, ST, `תשובה ${n}`, { call: fake() }));
  }
  assert.ok(n >= 5, `רק ${n} תורות`);
  const turns = Object.entries(cbt.active.captured).map(([tool, answer]) => ({ tool, answer }));
  const r = await SESS.closeSession(cbt, ST, { call: fake(), turns });
  assert.equal(r.fidelity.score, 1, `נאמנות ${r.fidelity.score} · דולג ${r.fidelity.missed}`);
  assert.equal(r.cbt.active, null, 'הסשן נשאר פתוח');
  assert.ok(r.cbt.sessionsDone.includes('intake'));
  assert.ok(r.formulation, 'לא נוסח דפוס');
  assert.ok(S.latestFormulation(r.cbt), 'הדפוס לא נשמר');
});

test('סגירה באמצע נרשמת עם ציון חלקי — לא נוטשת', async () => {
  // סשן שנשאר פתוח חוסם את כל הבאים אחריו. ציון חלקי הוא מידע;
  // נטישה שקטה אינה.
  const o = SESS.openSession(fresh(), ISO);
  const r = await SESS.closeSession(o.cbt, ST, { call: fake(), turns: [] });
  assert.equal(r.cbt.active, null, 'לא נסגר');
  assert.ok(r.fidelity.score < 1, 'סשן ריק קיבל ציון מלא');
  assert.ok(r.cbt.notes.length, 'לא נרשמה הערה');
  assert.ok(r.cbt.notes.at(-1).missed.length, 'החוסרים לא נרשמו');
});

test('בלי מודל — נסגר בלי דפוס, ולא קורס', async () => {
  const o = SESS.openSession(fresh(), ISO);
  const r = await SESS.closeSession(o.cbt, ST, { call: null, turns: [] });
  assert.equal(r.formulation, null);
  assert.equal(r.cbt.active, null);
});

test('מודל שזורק חריגה לא מפיל את הסגירה', async () => {
  const o = SESS.openSession(fresh(), ISO);
  const boom = async () => { throw new Error('down'); };
  const turns = [{ tool: 'a', answer: '1' }, { tool: 'b', answer: '2' }, { tool: 'c', answer: '3' }];
  const r = await SESS.closeSession(o.cbt, ST, { call: boom, turns });
  assert.equal(r.cbt.active, null, 'חריגה השאירה סשן פתוח לנצח');
});

test('דפוס NONE אינו נשמר', async () => {
  // "עדיף כלום מדפוס מומצא" — וזה חייב להיאכף, לא רק להיכתב בפרומפט.
  const o = SESS.openSession(fresh(), ISO);
  const turns = [{ tool: 'a', answer: '1' }, { tool: 'b', answer: '2' }, { tool: 'c', answer: '3' }];
  const r = await SESS.closeSession(o.cbt, ST, { call: fake({ formulate: 'NONE' }), turns });
  assert.equal(r.formulation, null, 'NONE נשמר כדפוס');
  assert.equal(S.latestFormulation(r.cbt), null);
});

// ---------- החיווט לבוט ----------

test('הפקודה קיימת בתפריט ובניתוב', () => {
  const src = readFileSync(join(SRC, 'index.js'), 'utf8');
  assert.match(src, /command: 'therapy'/, 'לא בתפריט הפקודות');
  assert.match(src, /therapy:\s*\[[^\]]*'טיפול'/, 'אין כינוי בעברית');
  assert.match(src, /case 'therapy'/, 'אין מטפל לפקודה');
  assert.match(src, /case 'endsess'/, 'אין דרך לעצור באמצע');
});

test('תור בסשן מנותב דרך awaiting', () => {
  const src = readFileSync(join(SRC, 'index.js'), 'utf8');
  assert.match(src, /field === 'cbt'/, "awaiting='cbt' אינו מטופל");
  assert.match(src, /runTherapyTurn/, 'אין מריץ תור');
});

test('ההחלטות אינן ב-index.js', () => {
  // אותו לקח מ-tick-logic: החלטה שקבורה ב-I/O היא החלטה שאי אפשר
  // לבדוק. index.js מותר לו לשלוח הודעות, לא להחליט מה הכלי הבא.
  const src = readFileSync(join(SRC, 'index.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(src, /nextTool\(/, 'בחירת כלי דלפה ל-index');
  assert.doesNotMatch(src, /P\.fidelity\(|fidelity\(sess/, 'חישוב נאמנות דלף ל-index');
  assert.match(src, /CBTSESS\.(nextStep|runStep|closeSession)/, 'index אינו משתמש במודול');
});

test('לכל תפקיד במנוע יש תצורה', () => {
  for (const r of ['triage', 'extract', 'fetch', 'respond', 'critique', 'formulate']) {
    assert.ok(ROLES[r], `אין תצורה ל-${r}`);
    assert.ok(['none', 'low', 'high'].includes(ROLES[r].think), `${r}: think לא תקין`);
  }
  assert.equal(ROLES.respond.think, 'high', 'הניסוח רץ בלי חשיבה');
  assert.equal(ROLES.triage.think, 'none', 'הניתוב שורף חשיבה');
});


// ---------- עצירת בטיחות ----------

test('halt אינו נרשם ככלי שבוצע', async () => {
  // רישום הכלי בעצירת בטיחות היה מסמן אותו כבוצע ומדלג עליו כשחוזרים.
  const o = SESS.openSession(fresh(), ISO);
  const tool = SESS.nextStep(o.cbt, ST);
  const before = o.cbt.active.remaining.length;
  const r = await SESS.runStep(o.cbt, tool, ST, 'אין טעם בכלום', {
    call: fake({ triage: 'distress' }),
  });
  assert.equal(r.mode, 'halt', 'לא זוהתה מצוקה');
  assert.equal(r.cbt.active.remaining.length, before, 'הכלי סומן כבוצע');
});

test('הבוט מציג טלפוני עזרה על halt ולא "ממשיכים"', () => {
  // ה-halt הגיע כ-reply ריק, ולכן הוצג כ"לא הצלחתי לנסח תגובה".
  // כלומר זיהוי מצוקה אמיתי נבלע והסשן המשיך לצ׳קליסט.
  // **בלי הערות.** הבדיקה הראשונה כאן נכשלה על ההערה שאני עצמי כתבתי
  // בתוך הבלוק, שציטטה את הודעת הכישלון — כלומר היא בדקה תיעוד ולא קוד.
  const src = readFileSync(join(SRC, 'index.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const i = src.indexOf("r.mode === 'halt'");
  assert.ok(i > 0, 'הבוט אינו מטפל ב-halt בכלל');
  const block = src.slice(i, i + 700);
  assert.match(block, /PHONES/, 'עצירת בטיחות בלי טלפוני עזרה');
  assert.match(block, /awaiting = null/, 'הסשן ממשיך אחרי עצירת בטיחות');
  // והבליעה עצמה אסורה: הטיפול ב-halt חייב להיות **לפני** הודעת הכישלון
  assert.ok(i < src.indexOf('לא הצלחתי לנסח תגובה'),
    'ה-halt נבלע בהודעת הכישלון הכללית');
});

test('תוכן רגיל של סשן אינו מסווג כמצוקה', () => {
  // "היה לי דחף חזק אתמול בלילה" סווג distress, כלומר הכלי שכל תפקידו
  // לדבר על דחפים עצר ברגע שנאמר "דחף".
  const src = readFileSync(join(SRC, 'cbt', 'engine.js'), 'utf8');
  const i = src.indexOf("· distress");
  assert.ok(i > 0);
  const block = src.slice(i, i + 900);
  for (const w of ['דחף', 'מעידה', 'שבוע קשה']) {
    assert.ok(block.includes(w), `הפרומפט אינו מוציא "${w}" מהגדרת המצוקה`);
  }
  assert.match(block, /answer/, 'לא נאמר לאן לסווג אותם');
});

// ---------- מגבלת קצב ----------

test('429 מנוסה שוב, שגיאה אחרת לא', async () => {
  // תור עולה 5 קריאות, והמדרג החינמי מוגבל בבקשות לדקה. בלי ניסיון
  // חוזר, 429 שורף פריט בצ׳קליסט: הכלי נרשם כבוצע, המשתמש מקבל
  // "לא הצלחתי לנסח תגובה", והסשן מתקדם בלי שקרה בו כלום.
  const { cbtCall, RETRY_MS } = await import('../src/ai.js');
  assert.ok(RETRY_MS >= 1000, 'ההמתנה קצרה מכדי שחלון הדקה יתגלגל');

  const calls = [];
  const orig = globalThis.fetch;
  const reply = (status, text) => {
    globalThis.fetch = async () => {
      calls.push(status);
      return { ok: status === 200, status,
               json: async () => (status === 200
                 ? { candidates: [{ content: { parts: [{ text }] } }] }
                 : { error: { code: status } }) };
    };
  };
  try {
    reply(429);
    const env = { GEMINI_KEY: 'k' };
    const t0 = Date.now();
    await cbtCall(env, ROLES)('respond', 'x');
    assert.equal(calls.length, 2, `429 נוסה ${calls.length} פעמים`);
    assert.ok(Date.now() - t0 >= RETRY_MS - 200, 'לא הייתה המתנה בין הניסיונות');

    calls.length = 0;
    reply(400);
    await cbtCall(env, ROLES)('respond', 'x');
    assert.equal(calls.length, 1, '400 נוסה שוב — הוא יחזור זהה');
  } finally { globalThis.fetch = orig; }
});

test('הביקורת תופסת חיבור מספרים שאינו קשור', async () => {
  // "היה לי דחף" + "אתה מקפיד על המדבקה" הם שני דברים נכונים בלי קשר.
  const { CRITIQUE_RULES } = await import('../src/cbt/engine.js');
  const joined = CRITIQUE_RULES.join(' ');
  assert.match(joined, /מספרים/, 'הביקורת אינה בודקת חיבור נתונים גנרי');
  assert.match(joined, /קשר ממשי/, 'לא נדרש קשר ממשי');
});
