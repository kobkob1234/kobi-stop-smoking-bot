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
  assert.deepEqual(seen.map(s => s.role), ['triage', 'fetch', 'respond', 'critique']);
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
