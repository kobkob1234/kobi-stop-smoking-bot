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
import { TOOLS } from '../src/cbt/tools.js';
import * as E from '../src/cbt/engine.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const ISO = '2026-08-07';
const ST = { iso: ISO, dayNum: 14, cleanDays: 14, gum7: 60, gumTarget: 9,
             patchDays7: 7, mood: 3, fatigue: 2, waves7: 5, slips7: 0,
             triggers: [], pastAttempts: [], confidence: null,
             homework: null, sessionsDone: [], taperStarted: true };
/** מצב עשיר — כלים שמייצרים HTML צריכים טריגר וכיסוי */
const RICH_ST = { ...ST, triggers: ['ערב מול הטלוויזיה'], coverage: 7 };

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

// ---------- כשל מודל: לא לשרוף פריט, ולא לתקוע ----------

test('כשל ראשון אינו מסמן את הכלי כבוצע', async () => {
  // הפריט נרשם כבוצע ו-`fidelity` דיווח 100% על סשן שלא נאמר בו דבר:
  // מפתח מבוטל ⇒ שבע הודעות "לא הצלחתי לנסח" ⇒ "נאמנות 100%".
  const o = SESS.openSession(fresh(), ISO);
  const tool = SESS.nextStep(o.cbt, ST);
  const before = o.cbt.active.remaining.length;
  const r = await SESS.runStep(o.cbt, tool, ST, 'משהו', { call: async () => null });
  assert.equal(r.mode, 'failed');
  assert.equal(r.cbt.active.remaining.length, before, 'הכלי נשרף על כשל חולף');
  assert.equal(r.tries, 1);
});

test('אחרי MAX_TRIES הכלי מדולג — לא לולאה אינסופית', async () => {
  // אי-רישום לבדו מחזיר את אותו כלי לנצח כשהמודל מושבת.
  let cbt = SESS.openSession(fresh(), ISO).cbt;
  const tool = SESS.nextStep(cbt, ST);
  const before = cbt.active.remaining.length;
  for (let i = 0; i < SESS.MAX_TRIES; i++) {
    ({ cbt } = await SESS.runStep(cbt, tool, ST, 'משהו', { call: async () => null }));
  }
  assert.equal(cbt.active.remaining.length, before - 1, 'הסשן נתקע על אותו כלי');
});

test('סשן בלי מודל בכלל מסתיים, ונאמנותו אינה 100%', async () => {
  let cbt = SESS.openSession(fresh(), ISO).cbt;
  let n = 0;
  for (;;) {
    const tool = SESS.nextStep(cbt, ST);
    if (!tool) break;
    assert.ok(++n <= 40, 'הסשן לא נגמר בלי מודל');
    ({ cbt } = await SESS.runStep(cbt, tool, ST, 'x', { call: async () => null }));
  }
  const r = await SESS.closeSession(cbt, ST, { call: null, turns: [] });
  assert.ok(r.fidelity.score < 1,
    `נאמנות ${r.fidelity.score} על סשן שלא נאמר בו דבר`);
});

test('גדר האורך סופרת גם ניסיונות חוזרים', async () => {
  // היא נספרה מול `captured` שחסום בגודל הצ׳קליסט (6–8), ולכן 24
  // היה בלתי-מושג והגדר מעולם לא יכלה לירות.
  const many = { active: { tries: Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [`t${i}`, 2])) } };
  assert.equal(SESS.exhausted([], many), true, 'ניסיונות חוזרים אינם נספרים');
  assert.equal(SESS.exhausted([], null), false);
});

test('הבוט אומר "שוב" בכשל ראשון ו"מדלג" בשני', () => {
  const src = readFileSync(join(SRC, 'index.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(src, /r\.tries < CBTSESS\.MAX_TRIES/, 'ההודעה אינה מבחינה בין השניים');
  assert.match(src, /יסומן כנשמט/, 'דילוג מוצג כהתקדמות');
});

test('סשן בלי AI אומר זאת בפתיחה', () => {
  // `sessionMode` נכתב בדיוק בשביל זה ולא נקרא מ-src בכלל.
  const src = readFileSync(join(SRC, 'index.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(src, /sessionMode\(/, 'מנגנון היושר אינו מחווט');
  assert.match(src, /smode/, 'התוצאה אינה מוצגת');
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

// ==========================================================================
//  נאמנות לאורך זמן
//
//  `notes` נכתב בסגירת כל סשן — ציון, פריטים שדולגו — ונקרא רק על ידי
//  `openingContext`, ורק האחרון. מדד איכות שנאסף ואי אפשר לראות.
// ==========================================================================

const note = (score, missed = []) =>
  ({ id: 'x', iso: '2026-08-01', bcts: [], score, missed, complete: score === 1 });

test('בלי היסטוריה — אין דוח, ולא אפס מטעה', async () => {
  assert.equal(S.fidelityReport({ notes: [] }), null);
  assert.equal(S.fidelityLine({ notes: [] }), null);
});

test('הדוח מסכם ממוצע, מגמה ומה נשמט', () => {
  const r = S.fidelityReport({ notes: [note(1), note(1), note(1),
                                       note(0.6, ['coping-plan']), note(0.5, ['coping-plan']),
                                       note(0.5, ['coping-plan', 'summary-and-homework'])] });
  assert.equal(r.sessions, 6);
  assert.ok(r.trend < 0, 'ירידה ברורה לא זוהתה');
  assert.equal(r.topMissed[0].bct, 'coping-plan');
  assert.equal(r.topMissed[0].times, 3);
  assert.equal(r.incomplete, 3);
});

test('ירידה מתמשכת נכשלת בקול', () => {
  // סשן שמדלג על פריטי חובה נראה כמו טיפול ואינו טיפול. ירידה
  // מתמשכת היא בדיוק הסימן, ולכן היא מסומנת ולא רק נספרת.
  const low = { notes: [note(1), note(1), note(0.4), note(0.4), note(0.4)] };
  assert.equal(S.fidelityReport(low).below, true, 'ירידה מתחת לסף לא סומנה');
  assert.match(S.fidelityLine(low), /⚠️/, 'האזהרה אינה מוצגת');
});

test('סשן חלש בודד אינו מגמה', () => {
  // המגמה נמדדת על שלושה, לא על שניים — אחרת כל סשן קצר מייצר אזהרה.
  const one = { notes: [note(1), note(1), note(1), note(1), note(1), note(0.5)] };
  assert.equal(S.fidelityReport(one).below, false, 'סשן חלש בודד הדליק אזהרה');
});

test('הסף מוגדר ואינו 0', () => {
  assert.ok(S.FIDELITY_FLOOR > 0 && S.FIDELITY_FLOOR <= 1);
});

test('הבוט מציג את ההיסטוריה, לא רק את הציון האחרון', () => {
  const src = readFileSync(join(SRC, 'index.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(src, /fidelityLine/, 'ההיסטוריה אינה מוצגת בשום מקום');
  // גם כשאין סשן היום — זה המקום היחיד שבו רואים מגמה
  const i = src.indexOf("'none-due'");
  assert.ok(i > 0);
  assert.match(src.slice(i, i + 600), /fidelityLine/,
    'אין סשן היום ⇒ אין שום משוב על התהליך');
});


// ==========================================================================
//  מה שהמשתמש באמת רואה
//
//  שלושה ליקויים שכולם על המסך ואף אחד מהם לא היה מכוסה:
//    · כלי הצהרתי החזיר את הטקסט של עצמו כתשובה, אחרי שכבר הוצג —
//      הדפסה כפולה בכל סשן.
//    · `tools.js` כותב `<b>` בכוונה, וכל אתר רינדור עטף ב-`esc()`,
//      ולכן טלגרם הציג את התגיות כתווים.
//    · עצירת בטיחות החזירה את אותו כלי לנצח.
// ==========================================================================

test('כלי הצהרתי אינו מייצר תשובה', async () => {
  for (const id of TOOLS.filter(t => t.mode !== 'responsive').map(t => t.id)) {
    const r = await SESS.runStep(SESS.openSession(fresh(), ISO).cbt,
      TOOLS.find(t => t.id === id), ST, 'x', { call: fake() });
    assert.equal(r.reply, null, `${id} מחזיר תשובה — הדפסה כפולה`);
  }
});

test('טקסט כלי אינו עובר escaping בשום אתר רינדור', () => {
  const src = readFileSync(join(SRC, 'index.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // `a.text` הוא טקסט כלי; `r.reply` הוא תשובת מודל.
  assert.doesNotMatch(src, /esc\(a\.text\)/, 'טקסט כלי עובר escaping');
  assert.match(src, /toolText\(a\.text\)/, 'טקסט כלי אינו עובר דרך toolText');
  assert.match(src, /esc\(r\.reply\)/, 'תשובת מודל אינה עוברת escaping');
});

test('הכלים אכן כותבים HTML — אחרת הבדיקה שומרת על כלום', () => {
  const withHtml = TOOLS.filter(t => {
    try { return /<b>|<i>/.test(t.run(RICH_ST).text || ''); } catch { return false; }
  });
  assert.ok(withHtml.length, 'אף כלי לא מייצר HTML — toolText מיותר');
});

// ---------- עצירת בטיחות ----------

test('הטריאז׳ מסווג לפי המילה הראשונה, לא לפי הכלה', () => {
  // `includes('distress')` נבדק ראשון, ולכן "This is an answer, not
  // distress" סווג כמצוקה — ועצר את הסשן על תשובה תמימה.
  assert.equal(E.classifyTriage('This is an answer, not distress'), 'answer');
  assert.equal(E.classifyTriage('answer'), 'answer');
  assert.equal(E.classifyTriage('distress'), 'distress');
  assert.equal(E.classifyTriage('evasion — he changed the subject'), 'evasion');
  // לא מוכר — עדיין נוטים לבטוח
  assert.equal(E.classifyTriage('משהו'), 'distress');
  assert.equal(E.classifyTriage(''), null);
});

test('עצירה חוזרת על אותו כלי אינה לולאה', async () => {
  let cbt = SESS.openSession(fresh(), ISO).cbt;
  const tool = SESS.nextStep(cbt, ST);
  const before = cbt.active.remaining.length;
  for (let i = 0; i < SESS.MAX_HALTS; i++) {
    const r = await SESS.runStep(cbt, tool, ST, 'x', { call: fake({ triage: 'distress' }) });
    assert.equal(r.mode, 'halt');
    cbt = r.cbt;
  }
  assert.equal(cbt.active.remaining.length, before - 1,
    'אותו כלי חוזר לנצח אחרי עצירת בטיחות');
});

test('עצירה שדולגה אינה נספרת כבוצעה', async () => {
  let cbt = SESS.openSession(fresh(), ISO).cbt;
  const tool = SESS.nextStep(cbt, ST);
  for (let i = 0; i < SESS.MAX_HALTS; i++) {
    ({ cbt } = await SESS.runStep(cbt, tool, ST, 'x', { call: fake({ triage: 'distress' }) }));
  }
  assert.ok(!cbt.active.done.includes(tool.id), 'כלי שדולג נספר כבוצע');
});

test('הודעת העצירה מציעה מוצא אמיתי', () => {
  // היא הציעה רק /טיפול — שמחזיר לאותה שאלה ולכן לאותה עצירה.
  // **מחפשים בתוך ההודעה עצמה**, לא בחלון של 900 תווים שבו `/סיום`
  // מופיע ממילא בהקשר אחר — הגרסה הראשונה של הבדיקה עברה מוטציה.
  const src = readFileSync(join(SRC, 'index.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const i = src.indexOf("r.mode === 'halt'");
  assert.ok(i > 0);
  const end = src.indexOf('const bits', i);
  const block = src.slice(i, end > i ? end : i + 700);
  assert.match(block, /\/סיום/, 'הודעת העצירה אינה מציעה דרך לצאת');
  assert.match(block, /לאותו שלב/, 'לא נאמר ש-/טיפול מחזיר לאותה שאלה');
});


// ==========================================================================
//  יכולות שנאספו ומעולם לא רצו
//
//  ארבעה מנגנונים שנכתבו, תועדו, ונספרו בנאמנות — ואף אחד מהם לא
//  עבד. זה הדפוס החוזר בקוד הזה: הערה שמתארת התנהגות שאינה מתקיימת.
// ==========================================================================

test('מדד הביטחון 0–10 נשמר', async () => {
  // `mode:'scale'` חזר בלי `captured`, ולכן `cbt.confidence` מעולם
  // לא נכתב — בזמן שהשאלה נשאלה בכל קליטה ונספרה כפריט חובה.
  const o = SESS.openSession(fresh(), ISO);
  const r = await SESS.runStep(o.cbt, TOOLS.find(t => t.id === 'assess-readiness'),
    ST, '7', { call: fake() });
  assert.equal(r.cbt.confidence.length, 1, 'הביטחון נזרק');
  assert.equal(r.cbt.confidence[0].v, 7);
});

test('תשובה מילולית לסולם עדיין נקלטת', async () => {
  // `parseInt('בערך 7')` → NaN, והערך נזרק בשקט.
  const o = SESS.openSession(fresh(), ISO);
  const r = await SESS.runStep(o.cbt, TOOLS.find(t => t.id === 'assess-readiness'),
    ST, 'אני בערך 7 מתוך 10', { call: fake() });
  assert.equal(r.cbt.confidence[0]?.v, 7, 'מספר בתוך משפט לא חולץ');
});

test('סולם מחוץ לטווח נדחה', async () => {
  const o = SESS.openSession(fresh(), ISO);
  const r = await SESS.runStep(o.cbt, TOOLS.find(t => t.id === 'assess-readiness'),
    ST, '99', { call: fake() });
  assert.equal(r.cbt.confidence.length, 0, 'ערך מחוץ לטווח נשמר');
});

test('כלי scale אינו שורף קריאת מודל', async () => {
  const seen = [];
  const spy = async (role) => { seen.push(role); return 'x'; };
  const o = SESS.openSession(fresh(), ISO);
  await SESS.runStep(o.cbt, TOOLS.find(t => t.id === 'assess-readiness'), ST, '7', { call: spy });
  assert.deepEqual(seen, [], `נשרפו ${seen.length} קריאות על סולם`);
});

test('הרצף בתוך הסשן מגיע לפרומפט', async () => {
  // `index.js` בנה `{tool, answer}` ו-`capturedChain` קרא `.captured`,
  // ולכן הוא החזיר '' תמיד — הרצף בתוך הסשן לא רץ מעולם.
  const E = await import('../src/cbt/engine.js');
  assert.match(E.capturedChain([{ tool: 'a', captured: 'ערב' }]), /ערב/,
    'capturedChain לא קורא את הצורה שנבנית');
  const src = readFileSync(join(SRC, 'index.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(src, /\[tool, captured\]/, 'index בונה צורה אחרת מזו שנקראת');
});

test('ההיסטוריה מסומנת כערך שנקלט, לא כציטוט', async () => {
  const E = await import('../src/cbt/engine.js');
  const h = E.historyDigest([{ tool: 'a', captured: 'ערב' }]);
  assert.match(h, /ערב/);
  assert.doesNotMatch(h, /הוא ענה/, 'ערך מחולץ מוצג כציטוט מילולי');
});

test('שיעורי בית ישנים נסגרים; חדשים נשארים', () => {
  // `markHomeworkDone` היה מיוצא ולא נקרא, ולכן ש"ב נשארו פתוחים
  // לנצח ו-`openingContext` דיווח עליהם עם `daysAgo` שגדל.
  const old = { ...fresh(), homework: { text: 'ישן', assignedISO: '2026-08-01', done: false } };
  const c1 = S.completeSession(S.startSession(old, 'intake', ISO), ISO);
  assert.equal(c1.homework.done, true, 'ש"ב ישנים נשארו פתוחים');

  const now = { ...fresh(), homework: { text: 'חדש', assignedISO: ISO, done: false } };
  const c2 = S.completeSession(S.startSession(now, 'intake', ISO), ISO);
  assert.equal(c2.homework.done, false, 'ש"ב שהוקצו בסשן הזה נסגרו מיד');
});

test('טריגרים נקראים באותו כיוון שהם נכתבים', () => {
  // נכתבו `slice(-5)` ונקראו `slice(0,3)` — טריגר חדש היה בלתי-נראה
  // עד שאחד ישן נשר, ו-`coping-plan` נשאר נעול על הראשון שנקלט.
  let cbt = fresh();
  for (const t of ['ראשון', 'שני', 'שלישי', 'רביעי']) {
    cbt = { ...cbt, triggers: [...cbt.triggers, t].slice(-5) };
  }
  const st = S.toolState(cbt, [], { clean: 10 }, ISO);
  assert.equal(st.triggers[0], 'רביעי', `הכי חדש הוא ${st.triggers[0]}`);
  assert.equal(st.triggers.length, 3);
});

test('קריאות ה-CBT נספרות במונה המכסה', () => {
  // ~35 בקשות לסשן היו בלתי-נראות ל-meta.ai.n.
  const src = readFileSync(join(SRC, 'index.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const calls = [...src.matchAll(/AI\.cbtCall\([^)]*\)/g)].map(m => m[0]);
  assert.ok(calls.length >= 2, `רק ${calls.length} אתרי קריאה`);
  for (const c of calls) {
    assert.match(c, /Meter|meter/, `קריאה בלי מונה: ${c}`);
  }
});
