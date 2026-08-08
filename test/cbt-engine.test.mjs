// ==========================================================================
//  המנוע — מה קורה בתוך תור אחד
//
//  שתי טענות שהבדיקות כאן שומרות עליהן:
//    • הבחירה איזה כלי להפעיל **אינה** של המודל. ReAct בשכבה הזאת היה
//      הופך את מדד הנאמנות לחסר משמעות.
//    • כלי הצהרתי אינו שורף קריאות. "אף לא שאיפה אחת" לא משתפר ממודל.
// ==========================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/cbt/engine.js';
import * as T from '../src/cbt/tools.js';
import * as P from '../src/cbt/protocol.js';
import { readFileSync } from 'node:fs';

const state = { ...T.EMPTY_STATE, dayNum: 22, cleanDays: 22, gum7: 52, gumTarget: 9,
                patchDays7: 7, triggers: ['ערב מול הטלוויזיה'] };

/** מודל מזויף שמתעד מה נשאל */
const fake = (answers = {}) => {
  const seen = [];
  // ברירת המחדל ל-triage היא 'answer': הסיווג נוטה ל-distress בכל
  // קלט לא מוכר, ולכן פיקסצ׳ר שמחזיר 'x' היה עוצר כל תור.
  const call = async (role, prompt) => {
    seen.push({ role, prompt });
    if (answers[role] !== undefined) return answers[role];
    return role === 'triage' ? 'answer' : `[${role}]`;
  };
  return { call, seen };
};

// ---------- תקציב חשיבה לפי תפקיד ----------

test('לכל תפקיד תקציב משלו — ולא אותה תצורה לכולם', () => {
  assert.equal(E.ROLES.triage.think, 'none', 'triage מבזבז חשיבה על סיווג');
  assert.equal(E.ROLES.respond.think, 'high', 'התשובה עצמה בלי חשיבה');
  assert.ok(E.ROLES.respond.reserve > E.ROLES.triage.reserve * 3);
});

// ==========================================================================
//  תצורת הבקשה — נבדקת על מה שבאמת נשלח
//
//  שלוש הבדיקות האלה כוונו ל-`buildRequest`, שלא נקרא מ-`src/` בכלל
//  ו**חלק על הפרודקשן** (4096 מול 8192 טוקני חשיבה). כלומר הכיסוי
//  אימת מספרים של ענף מת. עכשיו הן חוטפות את הבקשה האמיתית מ-`cbtCall`.
// ==========================================================================

/** לוכד את גוף הבקשה ש-`cbtCall` שולח, בלי רשת */
async function captureBody(env, role = 'respond') {
  const AI = await import('../src/ai.js');
  const orig = globalThis.fetch;
  let body = null;
  globalThis.fetch = async (_u, opt) => {
    body = JSON.parse(opt.body);
    return { ok: true, status: 200,
             json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }) };
  };
  try { await AI.cbtCall({ GEMINI_KEY: 'k', ...env }, E.ROLES)(role, 'p', 's'); }
  finally { globalThis.fetch = orig; }
  return body;
}

test('לא שולחים thinkingConfig לכינוי -latest', async () => {
  // מתועד בקוד: הכינויים דוחים את הפרמטר ב-400. `CBT_MODEL` ריק ⇒
  // רצים על הכינוי ⇒ אסור לשלוח חשיבה.
  const b = await captureBody({ GEMINI_MODEL: 'gemini-flash-lite-latest' });
  assert.equal(b.generationConfig.thinkingConfig, undefined);
  assert.equal(b.generationConfig.thinkingLevel, undefined);
});

test('מודל מקובע כן מקבל תקציב חשיבה', async () => {
  const b = await captureBody({ CBT_MODEL: 'gemini-2.5-flash-002' });
  assert.ok(b.generationConfig.thinkingConfig?.thinkingBudget > 0,
    'מודל מקובע רץ בלי חשיבה — respond הוא בדיוק מה שדורש אותה');
  // לעולם לא שניהם — שליחת שניהם מחזירה שגיאה
  assert.equal(b.generationConfig.thinkingLevel, undefined);
});

test('תקציב הפלט נדיב — טוקני חשיבה נאכלים ממנו', async () => {
  // הכשל המתועד: התשובה נחתכה באמצע מילה כי החשיבה אכלה את התקציב.
  const b = await captureBody({ CBT_MODEL: 'gemini-2.5-flash-002' });
  const cfg = b.generationConfig;
  assert.ok(cfg.maxOutputTokens > cfg.thinkingConfig.thinkingBudget,
    `פלט ${cfg.maxOutputTokens} מול חשיבה ${cfg.thinkingConfig.thinkingBudget}`);
});

test('אין בונה-בקשה שני', () => {
  // שני מימושים לאותה בקשה נפרדו והתחילו לחלוק על עצמם.
  const src = readFileSync(new URL('../src/cbt/engine.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /generationConfig/,
    'engine בונה בקשה במקביל ל-ai.js');
});


// ---------- הבחירה נשארת דטרמיניסטית ----------

test('המנוע מבצע כלי שנבחר — הוא לא בוחר אותו', () => {
  // מנקים הערות קודם: הגרסה הראשונה נכשלה על הערה שמזכירה nextTool,
  // וזו בדיוק אותה טעות של גרפ שתופס תיעוד במקום קוד.
  const src = readFileSync(new URL('../src/cbt/engine.js', import.meta.url), 'utf8')
    .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
  assert.ok(!/\bnextTool\s*\(|\bapplicable\s*\(/.test(src),
    'המנוע בוחר כלים בעצמו — ReAct בשכבה הזאת שובר את מדד הנאמנות');
  // ובכיוון השני: הוא חייב לקבל כלי מבחוץ
  assert.match(src, /runTurn\(\{ tool/, 'המנוע אינו מקבל כלי כפרמטר');
});

// ---------- כלי הצהרתי לא שורף קריאות ----------

test('כלי fixed אינו קורא למודל בכלל', async () => {
  const { call, seen } = fake();
  const r = await E.runTurn({ tool: T.byId(P.BCT.NAP), state, userText: 'ok', call });
  assert.equal(seen.length, 0, `נשרפו ${seen.length} קריאות על הצהרה`);
  // **בלי תשובה.** הוא החזיר את הטקסט של עצמו, והבוט שלח אותו — אחרי
  // שכבר הציג אותו בתור הקודם. כל סשן הראה את הכלים ההצהרתיים פעמיים.
  assert.equal(r.text, null, 'כלי הצהרתי מחזיר תשובה וגורם להדפסה כפולה');
});

// ---------- התור התגובתי ----------

test('תור תגובתי עובר triage → fetch → respond → critique', async () => {
  const { call, seen } = fake({ triage: 'answer', critique: 'OK' });
  const r = await E.runTurn({
    tool: T.byId(P.BCT.COPING), state, userText: 'פשוט לא בא לי',
    call, retrieve: async () => [{ text: 'רקע' }],
  });
  // extract נוסף אחרי triage: בלעדיו נשמר המשפט השלם כטריגר.
  assert.deepEqual(seen.map(s => s.role),
    ['triage', 'extract', 'fetch', 'respond', 'critique']);
  assert.equal(r.mode, 'responsive');
  assert.equal(r.revised, false, 'OK נחשב בטעות לתיקון');
});

test('מה שהמשתמש אמר מגיע לשלב התשובה במילים שלו', async () => {
  // הכשל שההרצה חשפה: התשובה נכתבה מראש בלי קשר למה שנאמר.
  const { call, seen } = fake({ triage: 'answer', critique: 'OK' });
  await E.runTurn({ tool: T.byId(P.BCT.COPING), state, userText: 'פשוט לא בא לי', call });
  const respond = seen.find(s => s.role === 'respond');
  assert.match(respond.prompt, /פשוט לא בא לי/);
  assert.match(respond.prompt, /שאל, אל תורה/);
});

test('ביקורת שמחזירה תיקון מחליפה את התשובה', async () => {
  const { call } = fake({ triage: 'answer', respond: 'תשובה גנרית', critique: 'גרסה מתוקנת' });
  const r = await E.runTurn({ tool: T.byId(P.BCT.COPING), state, userText: 'משהו', call });
  assert.equal(r.text, 'גרסה מתוקנת');
  assert.equal(r.revised, true);
});

test('חשיפה מדאיגה עוצרת את הפרוטוקול', async () => {
  // הצ׳קליסט אינו חשוב יותר מזה.
  const { call, seen } = fake({ triage: 'distress' });
  const r = await E.runTurn({ tool: T.byId(P.BCT.COPING), state, userText: '...', call });
  assert.equal(r.halt, true);
  assert.equal(seen.length, 1, 'המשיך לשאול אחרי חשיפה');
});

test('כישלון המודל אינו מחזיר טקסט חלקי', async () => {
  const call = async (role) => (role === 'respond' ? null : role === 'triage' ? 'answer' : 'x');
  const r = await E.runTurn({ tool: T.byId(P.BCT.COPING), state, userText: 'x', call });
  assert.equal(r.text, null);
  assert.equal(r.mode, 'failed');
});

test('עלות סשן נשארת בתוך המכסה — נמדדת, לא מוערכת', async () => {
  // הגרסה הקודמת סכמה `turnCost`, שהחזיר 4 בזמן שתור תגובתי עולה 5.
  // כאן נספרות הקריאות בפועל דרך תור אמיתי.
  const SESS = await import('../src/cbt/session.js');
  const S = await import('../src/cbt/state.js');
  const sess = P.byId('wk3');
  let calls = 0;
  const count = async (role) => { calls++; return role === 'triage' ? 'answer' : role === 'critique' ? 'OK' : 'x'; };
  let cbt = S.startSession(S.migrateCbt(null), 'wk3', '2026-08-15');
  for (const c of sess.checklist) {
    const tool = T.byId(c.bct);
    ({ cbt } = await SESS.runStep(cbt, tool, RICH, 'תשובה', { call: count }));
  }
  assert.ok(calls < 60, `סשן עולה ${calls} קריאות`);
  assert.ok(calls > 10, `רק ${calls} קריאות — התגובתיות לא באמת רצה`);
});


// ==========================================================================
//  איכות הפרומפט — מה שנקבע בסימולציה
//
//  הגרסה הראשונה שלחה 416 תווים בלי השאלה שנשאלה, בלי הנתונים ובלי
//  עמדה. הכלל "חבר בין מה שאמר לנתונים" היה בלתי-אפשרי לביצוע, כי
//  הנתונים לא היו בפרומפט. הבדיקות כאן מונעות חזרה לשם.
// ==========================================================================

const RICH = {
  ...T.EMPTY_STATE, dayNum: 22, cleanDays: 22, gum7: 52, gumTarget: 9,
  patchDays7: 7, mood: 3, waves7: 1, triggers: ['ערב מול הטלוויזיה'], confidence: 5,
};
const grab = async (over = {}) => {
  const seen = [];
  const call = async (role, prompt, sys) => { seen.push({ role, prompt, sys }); return role === 'critique' ? 'OK' : role === 'triage' ? 'answer' : 'x'; };
  await E.runTurn({ tool: T.byId(P.BCT.MEDS), state: RICH, userText: 'לא בא לי בערב', call, ...over });
  return seen.find(s => s.role === 'respond');
};

test('הפרומפט כולל את השאלה שנשאלה — הליקוי החמור ביותר', async () => {
  // בלעדיה המודל רואה תשובה ולא יודע על מה. "לא בא לי" יכול להיות
  // על הטעם, על השעה, או על הכול.
  const r = await grab();
  assert.match(r.prompt, /שאלת אותו/);
  assert.match(r.prompt, /מה מפריע/, 'השאלה עצמה אינה בפרומפט');
});

test('הנתונים בפרומפט — אחרת הכלל על דפוסים בלתי-אפשרי', async () => {
  const r = await grab();
  assert.match(r.prompt, /7\.4/, 'קצב המסטיק חסר');
  assert.match(r.prompt, /יעד 9/);
  assert.match(r.prompt, /ערב מול הטלוויזיה/, 'הטריגר הידוע חסר — אין ממה לבנות דפוס');
  assert.match(r.prompt, /ביטחון 5/);
});

test('העמדה נשלחת כ-system ולא כטקסט משתמש', async () => {
  const r = await grab();
  assert.ok(r.sys, 'אין system prompt');
  assert.match(r.sys, /גילוי מודרך/);
  assert.match(r.sys, /אל תציע|אסור|להמליץ על תרופות מרשם/);
});

test('רק respond מקבל את העמדה — triage לא צריך אותה', async () => {
  const seen = [];
  const call = async (role, prompt, sys) => { seen.push({ role, sys }); return role === 'critique' ? 'OK' : 'x'; };
  await E.runTurn({ tool: T.byId(P.BCT.MEDS), state: RICH, userText: 'x', call });
  assert.ok(!seen.find(s => s.role === 'triage').sys, 'triage מקבל system מיותר');
});

test('היסטוריית הסשן עוברת — תור 3 יודע שתור 1 קרה', async () => {
  const r = await grab({ turns: [{ tool: 'בדיקת התקדמות', answer: 'קצת לחוץ בעבודה' }] });
  assert.match(r.prompt, /קצת לחוץ בעבודה/);
});

test('הרצף מהסשן הקודם מגיע לפרומפט', async () => {
  // openingContext נבנה בשלב 4 ולא היה בשימוש בכלל.
  const r = await grab({ opening: [{ kind: 'confidence', from: 8, to: 5 }] });
  assert.match(r.prompt, /8→5/, 'הרצף נבנה ולא מחובר');
});

test('מקורות מגיעים עם ייחוס ועם הגבלת ציטוט', async () => {
  const r = await grab({ retrieve: async () => [{ src: 'ווסט, פרק 10', text: 'רקע' }] });
  assert.match(r.prompt, /ווסט, פרק 10/, 'המקור בלי ייחוס — אי אפשר לצטט');
  assert.match(r.prompt, /אל תצטט ממנו יותר ממשפט/, 'אין הגבלה על העתקה מהספר');
});

test('היסטוריה ארוכה נחתכת', async () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ tool: `כלי${i}`, answer: `ת${i}` }));
  const r = await grab({ turns: many });
  assert.ok(!r.prompt.includes('כלי0'), 'כל ההיסטוריה נשלחת — הפרומפט יתפוצץ');
  assert.match(r.prompt, /כלי9/);
});

// ==========================================================================
//  שלושה ליקויים שנמצאו בקריאה חוזרת של המימוש
// ==========================================================================

test('חילוץ מובנה — לא נשמר המשפט השלם', async () => {
  // "אני חושב שזה בעיקר בערב מול הטלוויזיה כשאני עייף" נשמר כטריגר
  // והזין את הפרומפט של הסשן הבא. רעש שמצטבר משבוע לשבוע.
  const call = async (role) => (role === 'extract' ? 'ערב מול הטלוויזיה'
    : role === 'critique' ? 'OK' : role === 'triage' ? 'answer' : 'x');
  const r = await E.runTurn({
    tool: T.byId(P.BCT.TRIGGERS), state: RICH, call,
    userText: 'אני חושב שזה בעיקר בערב מול הטלוויזיה כשאני עייף אחרי העבודה',
  });
  assert.equal(r.captured, 'ערב מול הטלוויזיה');
});

test('NONE מהחילוץ אינו נשמר', async () => {
  const call = async (role) => (role === 'extract' ? 'NONE' : role === 'critique' ? 'OK' : role === 'triage' ? 'answer' : 'x');
  const r = await E.runTurn({ tool: T.byId(P.BCT.TRIGGERS), state: RICH, call, userText: 'לא יודע' });
  assert.equal(r.captured, null);
});

test('כלי הצהרתי אינו מפעיל חילוץ', async () => {
  const seen = [];
  const call = async (role) => { seen.push(role); return role === 'triage' ? 'answer' : 'x'; };
  await E.runTurn({ tool: T.byId(P.BCT.NAP), state: RICH, call, userText: 'ok' });
  assert.ok(!seen.includes('extract'));
});

test('הביקורת רואה את הנתונים ואת השאלה', async () => {
  // בלעדיהם היא לא יכולה לשפוט את הכלל "חבר בין מה שאמר לנתונים".
  const seen = [];
  const call = async (role, prompt) => { seen.push({ role, prompt }); return role === 'critique' ? 'OK' : role === 'triage' ? 'answer' : 'x'; };
  await E.runTurn({ tool: T.byId(P.BCT.MEDS), state: RICH, call, userText: 'לא בא לי' });
  const c = seen.find(s => s.role === 'critique');
  assert.match(c.prompt, /7\.4/, 'הביקורת בלי נתונים');
  assert.match(c.prompt, /מה מפריע/, 'הביקורת בלי השאלה שנשאלה');
});

test('תיקון מהביקורת מאומת ולא נלקח בעיוורון', async () => {
  const seen = [];
  const call = async (role) => {
    if (role === 'critique') { seen.push(1); return seen.length === 1 ? 'גרסה מתוקנת' : 'OK'; }
    return role === 'triage' ? 'answer' : 'x';
  };
  const r = await E.runTurn({ tool: T.byId(P.BCT.MEDS), state: RICH, call, userText: 'x' });
  assert.equal(seen.length, 2, 'התיקון נשלח בלי אימות');
  assert.equal(r.verified, true);
});

// ==========================================================================
//  הביקורת — החוזה, ומה שקורה כשהוא מופר
//
//  הגרסה הקודמת בדקה `/^OK\b/i` בלבד ולקחה כל מחרוזת אחרת כתשובת
//  המטפל. מודל שענה על הכללים בפרוזה שלח את **הביקורת** לאדם בגמילה.
//  והסיבוב השני לא הכריע כלל: `text: first` הוחזר בין אם אישר ובין אם
//  לא, ורק `verified` חושב — ו-`session.js` זרק אותו.
// ==========================================================================

test('פרוזה של ביקורת אינה הופכת לתשובת המטפל', async () => {
  const meta = 'התשובה גנרית, היא לא מתייחסת למה שהוא אמר';
  const call = async (role) => (role === 'critique' ? meta
    : role === 'triage' ? 'answer' : 'טיוטה. מה קרה אז?');
  const r = await E.runTurn({ tool: T.byId(P.BCT.MEDS), state: RICH, call, userText: 'x' });
  assert.notEqual(r.text, meta, 'הביקורת נשלחה למשתמש');
  assert.equal(r.text, 'טיוטה. מה קרה אז?', 'לא נפלנו חזרה לטיוטה');
});

test('תיקון ארוך מדי נדחה — תשובת מטפל אינה פסקה', async () => {
  const long = 'FIX: ' + 'מילה '.repeat(300);
  const call = async (role) => (role === 'critique' ? long
    : role === 'triage' ? 'answer' : 'טיוטה קצרה?');
  const r = await E.runTurn({ tool: T.byId(P.BCT.MEDS), state: RICH, call, userText: 'x' });
  assert.equal(r.text, 'טיוטה קצרה?', 'תיקון באורך פסקה התקבל');
});

test('הסיבוב השני מכריע ולא רק מחשב דגל', async () => {
  let n = 0;
  const call = async (role) => {
    if (role === 'triage') return 'answer';
    if (role !== 'critique') return 'טיוטה?';
    return ++n === 1 ? 'FIX: גרסה שנייה?' : 'FIX: גרסה שלישית?';
  };
  const r = await E.runTurn({ tool: T.byId(P.BCT.MEDS), state: RICH, call, userText: 'x' });
  assert.equal(r.text, 'גרסה שלישית?', 'הצעת הסיבוב השני נזרקה');
  assert.equal(r.verified, false, 'גרסה שלא אושרה סומנה כמאומתת');
});

test('סיבוב שני שמאשר — הגרסה המתוקנת נשלחת ומסומנת מאומתת', async () => {
  let n = 0;
  const call = async (role) => {
    if (role === 'triage') return 'answer';
    if (role !== 'critique') return 'טיוטה?';
    return ++n === 1 ? 'FIX: גרסה מתוקנת?' : 'OK';
  };
  const r = await E.runTurn({ tool: T.byId(P.BCT.MEDS), state: RICH, call, userText: 'x' });
  assert.equal(r.text, 'גרסה מתוקנת?');
  assert.equal(r.revised, true);
  assert.equal(r.verified, true);
});

test('ביקורת שנכשלה משאירה את הטיוטה', async () => {
  const call = async (role) => (role === 'critique' ? null
    : role === 'triage' ? 'answer' : 'טיוטה?');
  const r = await E.runTurn({ tool: T.byId(P.BCT.MEDS), state: RICH, call, userText: 'x' });
  assert.equal(r.text, 'טיוטה?');
});

test('הפרומפט מכתיב את החוזה OK / FIX', async () => {
  const { call, seen } = fake({ triage: 'answer', critique: 'OK' });
  await E.runTurn({ tool: T.byId(P.BCT.MEDS), state: RICH, call, userText: 'x' });
  const c = seen.find(x => x.role === 'critique');
  // **דורשים את המשפט שמכתיב את הצורה**, לא רק את המחרוזת "FIX:" —
  // מוטציה שהסירה את ההכתבה השאירה את שורות הדוגמה ועברה.
  assert.match(c.prompt, /בדיוק אחת משתי הצורות/, 'הפרומפט אינו מכתיב צורת פלט');
  assert.match(c.prompt, /^\s*OK$/m, 'צורת OK אינה מוגדרת');
  assert.match(c.prompt, /FIX: </, 'צורת FIX אינה מוגדרת');
  assert.match(c.prompt, /גוף שלישי/, 'לא נאסר לדבר על התשובה');
});

test('session.js מעביר את דגלי הביקורת הלאה', async () => {
  const SESS = await import('../src/cbt/session.js');
  const S = await import('../src/cbt/state.js');
  const o = SESS.openSession(S.migrateCbt(null), '2026-08-07');
  const tool = SESS.nextStep(o.cbt, RICH);
  let n = 0;
  const call = async (role) => {
    if (role === 'triage') return 'answer';
    if (role !== 'critique') return 'טיוטה?';
    return ++n === 1 ? 'FIX: אחרת?' : 'FIX: שלישית?';
  };
  const r = await SESS.runStep(o.cbt, tool, RICH, 'x', { call });
  assert.equal(r.revised, true, 'revised נזרק');
  assert.equal(r.verified, false, 'verified נזרק');
  assert.ok('kind' in r, 'kind נזרק');
});

test('בחירת מקטעים מקבלת חשיבה — היא משימת הסקה', () => {
  assert.notEqual(E.ROLES.fetch.think, 'none',
    'בחירה מתוך 140 מקטעים בלי חשיבה');
});

test('התיעוד אינו טוען ל-ReAct', () => {
  // אין כאן לולאה ואין התבוננות בתוצאה — קריאה לזה ReAct היא הגזמה.
  const src = readFileSync(new URL('../src/cbt/engine.js', import.meta.url), 'utf8');
  const claim = /\*\*כאן ReAct כן\s*מתאים\*\*/.test(src);
  assert.equal(claim, false, 'התיעוד עדיין טוען ל-ReAct בלי לולאה');
  assert.match(src, /לא ReAct/, 'ההבחנה לא מתועדת');
});

test('כלי תגובתי שאינו שואל שאלה פתוחה אינו מחלץ', async () => {
  // בדיקת NRT כשהמסטיק בקצב מחזירה expects:'ack'. היא responsive
  // (ולכן לא נעצרת מוקדם), אבל אין שם ערך לשמור — וחילוץ מ"אישור"
  // היה מייצר טריגר מתוך "אוקיי".
  const onTarget = { ...RICH, gum7: 63, gumTarget: 9 };
  assert.equal(T.byId(P.BCT.MEDS).run(onTarget).expects, 'ack', 'הנחת הבדיקה נשברה');
  const seen = [];
  const call = async (role) => { seen.push(role); return role === 'critique' ? 'OK' : role === 'triage' ? 'answer' : 'x'; };
  const r = await E.runTurn({ tool: T.byId(P.BCT.MEDS), state: onTarget, call, userText: 'אוקיי' });
  assert.ok(!seen.includes('extract'), 'חילוץ רץ על אישור');
  assert.equal(r.captured, null);
});

// ==========================================================================
//  קהל, דוגמאות, ופורמולציה
//
//  שלושת אלה הם מה שנשאר אחרי שסיננתי רשימת ארכיטקטורות: CoT כבר קיים
//  דרך thinkingLevel, Reflection כבר קיים כ-critique, ו-Supervisor יש לו
//  מקבילה דטרמיניסטית זולה יותר. מה שבאמת חסר היה לא-זוהר.
// ==========================================================================

test('העמדה יודעת מי יושב מולה', () => {
  // עמדה בלי קהל מייצרת ניסוח שמתאים לכל אחד ולכן לא לאף אחד.
  // /וויפ/ לבדו עובר דרך שורת הכותרת. הבדיקה חייבת לתפוס את **ההבחנה**.
  assert.match(E.THERAPIST_SYSTEM, /לא מסיגריות/, 'לא מבחין בין ויפ לסיגריות');
  assert.match(E.THERAPIST_SYSTEM, /שאכטה/, 'לא אוסר על שפה של מעשנים');
  assert.match(E.THERAPIST_SYSTEM, /2 מ"ג/, 'לא יודע על החלטות סגורות');
  assert.match(E.THERAPIST_SYSTEM, /אנליטי|מעורפל/, 'לא יודע איך הוא מגיב');
});

test('העמדה מגנה על ההחלטות הסגורות', () => {
  assert.match(E.THERAPIST_SYSTEM, /אל תציע לשנות מינון/);
  assert.match(E.THERAPIST_SYSTEM, /תרופות מרשם/);
});

test('לכל דוגמה יש רע, טוב, וסיבה', () => {
  assert.ok(E.EXEMPLARS.length >= 2);
  for (const e of E.EXEMPLARS) {
    assert.ok(e.said && e.bad && e.good && e.badWhy, JSON.stringify(e).slice(0, 60));
    assert.notEqual(e.bad, e.good);
    assert.ok(e.badWhy.length > 15, 'הסיבה לא מוסברת — הדוגמה לא מלמדת');
  }
});

test('הדוגמאות מגיעות לפרומפט', async () => {
  const r = await grab();
  assert.match(r.prompt, /דוגמאות:/);
  assert.match(r.prompt, /❌/);
  assert.match(r.prompt, /✅/);
});

// ---------- פורמולציה ----------

test('פורמולציה מקבלת את הסשן כולו ואת הנתונים', async () => {
  let got = null;
  await E.formulate({
    state: RICH, turns: [{ tool: 'NRT', answer: 'לא בא לי בערב' }],
    priorFormulation: null, call: async (role, p) => { got = p; return 'דפוס'; },
  });
  assert.match(got, /7\.4/, 'הפורמולציה בלי נתונים');
  assert.match(got, /לא בא לי בערב/, 'הפורמולציה בלי מה שנאמר');
  assert.match(got, /דפוס אחד/, 'מבקשת סיכום ולא דפוס');
});

test('פורמולציה קודמת מועברת — הדפוס נבנה על פני סשנים', async () => {
  let got = null;
  await E.formulate({
    state: RICH, turns: [{ tool: 'x', answer: 'y' }],
    priorFormulation: 'הערב הוא הנקודה', call: async (r, p) => { got = p; return 'ד'; },
  });
  assert.match(got, /הערב הוא הנקודה/);
});

test('NONE אינו נשמר כדפוס — עדיף כלום מדפוס מומצא', async () => {
  const r = await E.formulate({
    state: RICH, turns: [{ tool: 'x', answer: 'y' }], call: async () => 'NONE',
  });
  assert.equal(r, null);
});

test('סשן ריק אינו מייצר פורמולציה', async () => {
  let called = false;
  const r = await E.formulate({ state: RICH, turns: [], call: async () => { called = true; return 'ד'; } });
  assert.equal(r, null);
  assert.equal(called, false, 'נשרפה קריאה על סשן ריק');
});

test('לפורמולציה החשיבה הגבוהה ביותר — לטנציה לא רלוונטית שם', () => {
  assert.equal(E.ROLES.formulate.think, 'high');
  assert.ok(E.ROLES.formulate.reserve > E.ROLES.critique.reserve);
});

// ==========================================================================
//  תיקונים שנבעו מביקורת חיצונית — אחרי אימות כל טענה מול הקוד
// ==========================================================================

test('טריאז׳ מובנה ונוטה לצד הבטוח', () => {
  // regex על טקסט חופשי החמיץ "he is in distress" ו"הוא בשבר".
  // ל-triage שמופקד על בטיחות אסור false negative.
  assert.equal(E.classifyTriage('answer'), 'answer');
  assert.equal(E.classifyTriage('he is in distress'), 'distress');
  assert.equal(E.classifyTriage('pushback'), 'pushback');
  // תשובה שהתקבלה ואינה קטגוריה מוכרת — נוטים לבטוח
  for (const bad of ['משהו לא מוכר', '???', 'maybe ok']) {
    assert.equal(E.classifyTriage(bad), 'distress', `${JSON.stringify(bad)} לא נטה לבטוח`);
  }
  // **היעדר תשובה אינו סיגנל קליני.** null אומר שהרשת נפלה או שהמכסה
  // נגמרה, ולהציג טלפוני חירום למי שהחיבור שלו נותק זה שגוי ומפחיד —
  // וגם היה תוקע את הסשן, כי halt אינו רושם את הכלי כבוצע.
  for (const none of ['', '   ', null, undefined]) {
    assert.equal(E.classifyTriage(none), null,
      `${JSON.stringify(none)} — כשל תשתית סווג כמצוקה`);
  }
});

test('כשל מודל אינו מפעיל עצירת בטיחות', async () => {
  const r = await E.runTurn({ tool: T.byId(P.BCT.CRAVINGS), state: RICH,
                              userText: 'משהו', call: async () => null });
  assert.notEqual(r.mode, 'halt', 'רשת שנפלה הוצגה כמצוקה');
});

test('הטריאז׳ מבקש קטגוריה מפורשת, לא טקסט חופשי', async () => {
  const { call, seen } = fake();
  await E.runTurn({ tool: T.byId(P.BCT.MEDS), state: RICH, userText: 'x', call });
  const tr = seen.find(s => s.role === 'triage');
  assert.match(tr.prompt, /answer/);
  assert.match(tr.prompt, /distress/);
  assert.match(tr.prompt, /pushback/, 'התנגדות אינה קטגוריה — היא הנפוצה בגמילה');
});

test('הסיווג מוחזר לקורא', async () => {
  const { call } = fake({ triage: 'pushback', critique: 'OK' });
  const r = await E.runTurn({ tool: T.byId(P.BCT.MEDS), state: RICH, userText: 'x', call });
  assert.equal(r.kind, 'pushback');
});

test('הדפוס שזוהה מגיע ל-respond ול-critique', async () => {
  // הפורמולציה נבנתה ומעולם לא נשלחה — תרגיל שאיש לא קרא את תוצאתו.
  const { call, seen } = fake({ critique: 'OK' });
  await E.runTurn({
    tool: T.byId(P.BCT.MEDS), state: RICH, userText: 'x', call,
    formulation: 'הערב הוא הנקודה שבה הכול נשבר',
  });
  assert.match(seen.find(s => s.role === 'respond').prompt, /הערב הוא הנקודה/);
  assert.match(seen.find(s => s.role === 'critique').prompt, /הערב הוא הנקודה/);
});

test('הביקורת בודקת אישוש עיוותים', () => {
  // הכשל המסוכן של מטפל-מכונה: נשמע אמפתי ומחזק את ההנחה שצריך לברר.
  assert.ok(E.CRITIQUE_RULES.some(r => /מאשרת|עיוות/.test(r)));
  assert.ok(E.CRITIQUE_RULES.some(r => /דפוס/.test(r)));
});

test('השרשרת המחולצת שורדת את חיתוך ההיסטוריה', async () => {
  // תור 7 חייב לראות מה נאמר בתור 1. הערכים כבר מחולצים, 6 מילים כל אחד.
  const turns = Array.from({ length: 8 }, (_, i) =>
    ({ tool: `כלי${i}`, answer: `תשובה ארוכה ${i}`, captured: `ערך${i}` }));
  const { call, seen } = fake({ critique: 'OK' });
  await E.runTurn({ tool: T.byId(P.BCT.MEDS), state: RICH, userText: 'x', call, turns });
  const p = seen.find(s => s.role === 'respond').prompt;
  assert.match(p, /ערך0/, 'הערך מתור 1 אבד');
  assert.match(p, /ערך7/);
  assert.ok(!p.includes('תשובה ארוכה 0'), 'הציטוט הגולמי מתור 1 עדיין נשלח');
});

test('capturedChain ריק כשאין מה לשרשר', () => {
  assert.equal(E.capturedChain([]), '');
  assert.equal(E.capturedChain([{ tool: 'x', answer: 'y' }]), '');
});
