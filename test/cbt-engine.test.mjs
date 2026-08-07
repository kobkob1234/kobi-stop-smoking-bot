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
  const call = async (role, prompt) => { seen.push({ role, prompt }); return answers[role] ?? `[${role}]`; };
  return { call, seen };
};

// ---------- תקציב חשיבה לפי תפקיד ----------

test('לכל תפקיד תקציב משלו — ולא אותה תצורה לכולם', () => {
  assert.equal(E.ROLES.triage.think, 'none', 'triage מבזבז חשיבה על סיווג');
  assert.equal(E.ROLES.respond.think, 'high', 'התשובה עצמה בלי חשיבה');
  assert.ok(E.ROLES.respond.reserve > E.ROLES.triage.reserve * 3);
});

test('לא שולחים thinkingConfig לכינוי -latest', () => {
  // מתועד בקוד הקיים: הכינויים דוחים את הפרמטר ב-400.
  const b = E.buildRequest('respond', { system: 's', user: 'u', model: 'gemini-flash-lite-latest' });
  assert.equal(b.generationConfig.thinkingConfig, undefined);
  assert.equal(b.generationConfig.thinkingLevel, undefined);
});

test('גמיני 3 מקבל thinkingLevel · גמיני 2.5 מקבל thinkingBudget — לעולם לא שניהם', () => {
  // שליחת שניהם מחזירה שגיאה.
  const g3 = E.buildRequest('respond', { system: 's', user: 'u', model: 'gemini-3-flash-001' });
  assert.equal(g3.generationConfig.thinkingLevel, 'high');
  assert.equal(g3.generationConfig.thinkingBudget, undefined);

  const g25 = E.buildRequest('respond', { system: 's', user: 'u', model: 'gemini-2.5-flash-002' });
  assert.ok(g25.generationConfig.thinkingConfig.thinkingBudget > 0);
  assert.equal(g25.generationConfig.thinkingLevel, undefined);
});

test('תקציב הפלט נדיב — טוקני חשיבה נאכלים ממנו', () => {
  // הכשל המתועד: התשובה נחתכה באמצע מילה כי החשיבה אכלה את התקציב.
  const b = E.buildRequest('respond', { system: 's', user: 'u', model: 'gemini-3-flash-001' });
  assert.ok(b.generationConfig.maxOutputTokens >= 2000);
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
  assert.ok(r.text.includes('שאיפה'));
  assert.equal(E.turnCost('fixed'), 0);
});

// ---------- התור התגובתי ----------

test('תור תגובתי עובר triage → fetch → respond → critique', async () => {
  const { call, seen } = fake({ triage: 'תשובה', critique: 'OK' });
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
  const { call, seen } = fake({ triage: 'תשובה', critique: 'OK' });
  await E.runTurn({ tool: T.byId(P.BCT.COPING), state, userText: 'פשוט לא בא לי', call });
  const respond = seen.find(s => s.role === 'respond');
  assert.match(respond.prompt, /פשוט לא בא לי/);
  assert.match(respond.prompt, /שאל, אל תורה/);
});

test('ביקורת שמחזירה תיקון מחליפה את התשובה', async () => {
  const { call } = fake({ triage: 'תשובה', respond: 'תשובה גנרית', critique: 'גרסה מתוקנת' });
  const r = await E.runTurn({ tool: T.byId(P.BCT.COPING), state, userText: 'משהו', call });
  assert.equal(r.text, 'גרסה מתוקנת');
  assert.equal(r.revised, true);
});

test('חשיפה מדאיגה עוצרת את הפרוטוקול', async () => {
  // הצ׳קליסט אינו חשוב יותר מזה.
  const { call, seen } = fake({ triage: 'חשיפה' });
  const r = await E.runTurn({ tool: T.byId(P.BCT.COPING), state, userText: '...', call });
  assert.equal(r.halt, true);
  assert.equal(seen.length, 1, 'המשיך לשאול אחרי חשיפה');
});

test('כישלון המודל אינו מחזיר טקסט חלקי', async () => {
  const call = async (role) => (role === 'respond' ? null : 'x');
  const r = await E.runTurn({ tool: T.byId(P.BCT.COPING), state, userText: 'x', call });
  assert.equal(r.text, null);
  assert.equal(r.mode, 'failed');
});

test('עלות תור נשארת בתוך המכסה', async () => {
  // 8 כלים לסשן, מתוכם ~6 תגובתיים × 4 קריאות = 24. מול 1,500 ליום.
  const s = P.byId('wk3');
  const cost = s.checklist
    .map(c => T.byId(c.bct))
    .reduce((t, tool) => t + E.turnCost(tool.mode), 0);
  assert.ok(cost < 40, `סשן עולה ${cost} קריאות`);
  assert.ok(cost > 10, 'העלות נמוכה מדי — סימן שהתגובתיות לא באמת רצה');
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
  const call = async (role, prompt, sys) => { seen.push({ role, prompt, sys }); return role === 'critique' ? 'OK' : 'x'; };
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
    : role === 'critique' ? 'OK' : 'x');
  const r = await E.runTurn({
    tool: T.byId(P.BCT.TRIGGERS), state: RICH, call,
    userText: 'אני חושב שזה בעיקר בערב מול הטלוויזיה כשאני עייף אחרי העבודה',
  });
  assert.equal(r.captured, 'ערב מול הטלוויזיה');
});

test('NONE מהחילוץ אינו נשמר', async () => {
  const call = async (role) => (role === 'extract' ? 'NONE' : role === 'critique' ? 'OK' : 'x');
  const r = await E.runTurn({ tool: T.byId(P.BCT.TRIGGERS), state: RICH, call, userText: 'לא יודע' });
  assert.equal(r.captured, null);
});

test('כלי הצהרתי אינו מפעיל חילוץ', async () => {
  const seen = [];
  const call = async (role) => { seen.push(role); return 'x'; };
  await E.runTurn({ tool: T.byId(P.BCT.NAP), state: RICH, call, userText: 'ok' });
  assert.ok(!seen.includes('extract'));
});

test('הביקורת רואה את הנתונים ואת השאלה', async () => {
  // בלעדיהם היא לא יכולה לשפוט את הכלל "חבר בין מה שאמר לנתונים".
  const seen = [];
  const call = async (role, prompt) => { seen.push({ role, prompt }); return role === 'critique' ? 'OK' : 'x'; };
  await E.runTurn({ tool: T.byId(P.BCT.MEDS), state: RICH, call, userText: 'לא בא לי' });
  const c = seen.find(s => s.role === 'critique');
  assert.match(c.prompt, /7\.4/, 'הביקורת בלי נתונים');
  assert.match(c.prompt, /מה מפריע/, 'הביקורת בלי השאלה שנשאלה');
});

test('תיקון מהביקורת מאומת ולא נלקח בעיוורון', async () => {
  const seen = [];
  const call = async (role) => {
    if (role === 'critique') { seen.push(1); return seen.length === 1 ? 'גרסה מתוקנת' : 'OK'; }
    return 'x';
  };
  const r = await E.runTurn({ tool: T.byId(P.BCT.MEDS), state: RICH, call, userText: 'x' });
  assert.equal(seen.length, 2, 'התיקון נשלח בלי אימות');
  assert.equal(r.verified, true);
});

test('תיקון שנכשל שוב מסומן כלא-מאומת', async () => {
  const call = async (role) => (role === 'critique' ? 'עוד גרסה' : 'x');
  const r = await E.runTurn({ tool: T.byId(P.BCT.MEDS), state: RICH, call, userText: 'x' });
  assert.equal(r.verified, false, 'גרסה לא מאומתת מוצגת כמאומתת');
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
  const call = async (role) => { seen.push(role); return role === 'critique' ? 'OK' : 'x'; };
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
