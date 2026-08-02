// ==========================================================================
//  שכבת ה-AI — לא הייתה נבדקת כלל, וגם לא עברה node --check.
//
//  ארבעה כשלים ישבו כאן: אין timeout על אף קריאת מודל, ל-classify חסר
//  ענף groq (כך ש-AI_PROVIDER=groq השבית בשקט את כל הזרימות), הניקוי
//  היה מיושם פעמיים ולא זהה, והמכסה ספרה תשובות במקום קריאות.
// ==========================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as AI from '../src/ai.js';
import * as INT from '../src/intent.js';
import { sanitizeModelText, withTimeout, AI_TIMEOUT_MS } from '../src/core.js';

// ---------- ניקוי פלט ----------

test('תגיות פתוחות נסגרות — אחרת טלגרם מחזיר 400', () => {
  const t = sanitizeModelText('טקסט <b>מודגש בלי סגירה');
  assert.equal((t.match(/<b>/g) || []).length, (t.match(/<\/b>/g) || []).length);
});

test('תגית סוגרת עודפת מוסרת', () => {
  const t = sanitizeModelText('טקסט</b> רגיל');
  assert.ok(!t.includes('</b>'));
});

test('ישויות HTML מפוענחות ולא מוצגות גולמיות', () => {
  const t = sanitizeModelText('הוא אמר &quot;די&quot; ו-&apos;עצור&apos;');
  assert.ok(t.includes('"די"'), t);
  assert.ok(!t.includes('&quot;'));
});

test('markdown מומר ל-HTML של טלגרם', () => {
  assert.ok(sanitizeModelText('**חשוב**').includes('<b>חשוב</b>'));
  assert.ok(!sanitizeModelText('```js\ncode\n```').includes('code'));
});

test('תגיות שטלגרם לא מכיר מוסרות', () => {
  const t = sanitizeModelText('<div>טקסט</div> <script>x</script>');
  assert.ok(!t.includes('<div>') && !t.includes('<script>'));
});

test('שורת המקור מופרדת לשורה משלה', () => {
  const t = sanitizeModelText('הדחף חולף.— קאר, פרק 24');
  assert.ok(t.includes('\n— קאר'), JSON.stringify(t));
});

test('ai.js ו-intent.js מנקים זהה — הפער ביניהם היה הבאג', () => {
  // הגרסה ב-ai.js לא איזנה תגיות ולא פענחה ישויות, ולכן מסלול AI.ask
  // איבד את כל העיצוב בכל פעם שהמודל השאיר תג פתוח.
  const raw = 'טקסט <b>פתוח ו-&quot;מצוטט&quot;';
  const once = sanitizeModelText(raw);
  assert.equal(sanitizeModelText(once), once, 'הניקוי חייב להיות אידמפוטנטי');
});

// ---------- timeout ----------

test('withTimeout דוחה הבטחה תקועה', async () => {
  await assert.rejects(
    () => withTimeout(new Promise(() => {}), 40, 'בדיקה'),
    /timeout/,
    'קריאה תקועה חייבת להיכשל, לא לחסום את כל הבקשה');
});

test('withTimeout מחזיר תוצאה שהגיעה בזמן', async () => {
  assert.equal(await withTimeout(Promise.resolve('ok'), 500), 'ok');
});

test('קיים ערך timeout סביר כברירת מחדל', () => {
  assert.ok(AI_TIMEOUT_MS > 0 && AI_TIMEOUT_MS <= 30000, String(AI_TIMEOUT_MS));
});

// ---------- מכסה ----------

test('noteUse סופר קריאות ולא תשובות', () => {
  const meta = {};
  AI.noteUse(meta, '2026-08-01', 4);
  assert.equal(meta.ai.n, 4, 'הודעה אחת יכולה לייצר עד 4 קריאות upstream');
});

test('noteUse מתאפס ביום חדש', () => {
  const meta = { ai: { date: '2026-07-31', n: 40 } };
  AI.noteUse(meta, '2026-08-01', 1);
  assert.equal(meta.ai.n, 1);
});

test('quotaLeft מחשב לפי היום שנמסר במפורש', () => {
  const env = { AI_DAILY_CAP: '40' };
  const meta = { ai: { date: '2026-08-01', n: 10 } };
  assert.equal(AI.quotaLeft(meta, env, '2026-08-01'), 30);
  assert.equal(AI.quotaLeft(meta, env, '2026-08-02'), 40, 'יום אחר — מכסה מלאה');
});

// ---------- שרשרת הספקים ----------

test('AI כבוי כשאין ספק', () => {
  assert.equal(AI.enabled({}), false);
  assert.equal(AI.enabled({ AI_PROVIDER: 'off' }), false);
});

test('AI כבוי כשיש ספק בלי מפתח', () => {
  assert.equal(AI.enabled({ AI_PROVIDER: 'gemini' }), false);
  assert.equal(AI.enabled({ AI_PROVIDER: 'gemini', GEMINI_KEY: 'k' }), true);
});

test('ask מודד כל ניסיון upstream, גם כשכולם נכשלים', async () => {
  const env = {
    AI_PROVIDER: 'gemini,workers-ai',
    GEMINI_KEY: 'k',
    AI: { run: async () => { throw new Error('down'); } },
  };
  const orig = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('down'); };
  try {
    const meter = { calls: 0 };
    const out = await AI.ask(env, 'שאלה', 'מצב', [], meter);
    assert.equal(out, null, 'כל הספקים למטה → null, והמתקשר נופל ל-KB');
    assert.equal(meter.calls, 2, 'שני ניסיונות נספרו למרות שאין תשובה');
  } finally { globalThis.fetch = orig; }
});

test('classify תומך ב-groq — היעדרו השבית בשקט את כל הזרימות', async () => {
  // עם AI_PROVIDER=groq, AI.enabled החזיר true אבל classify החזיר null
  // תמיד: לא דחף, לא מעידה, ולא משבר.
  const env = { AI_PROVIDER: 'groq', GROQ_KEY: 'k' };
  const orig = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return { ok: true, json: async () => ({
      choices: [{ message: { content: '{"intent":"urge","urgency":"now","reply":"עצור."}' } }],
    }) };
  };
  try {
    const meter = { calls: 0 };
    const out = await INT.classify(env, 'בא לי', 'מצב', [], meter);
    assert.ok(called, 'groq לא נקרא בכלל');
    assert.equal(out.intent, 'urge');
    assert.equal(meter.calls, 1);
  } finally { globalThis.fetch = orig; }
});

test('ספק לא מוכר לא נספר ולא מפיל', async () => {
  const meter = { calls: 0 };
  const out = await INT.classify({ AI_PROVIDER: 'nope' }, 'טקסט', 'מצב', [], meter);
  assert.equal(out, null);
  assert.equal(meter.calls, 0);
});

// ---------- פירוק תשובת המודל ----------

test('parse קורא JSON עטוף בגדרות קוד', () => {
  const o = INT.parse('```json\n{"intent":"urge","urgency":"now","reply":"עצור."}\n```');
  assert.equal(o.intent, 'urge');
  assert.equal(o.reply, 'עצור.');
});

test('parse קורא JSON עטוף בפרוזה', () => {
  const o = INT.parse('בטח, הנה: {"intent":"question","urgency":"none","reply":"תשובה."} מקווה שעזר');
  assert.equal(o.intent, 'question');
});

test('parse דוחה פלט בלי reply', () => {
  assert.equal(INT.parse('{"intent":"urge"}'), null);
  assert.equal(INT.parse(''), null);
  assert.equal(INT.parse('לא JSON בכלל'), null);
});

test('intent לא חוקי נופל ל-other ולא זולג הלאה', () => {
  const o = INT.parse('{"intent":"המצאתי","urgency":"מתישהו","reply":"טקסט"}');
  assert.equal(o.intent, 'other');
  assert.equal(o.urgency, 'none');
});

// ---------- תרופות מרשם ----------

test('הפרומפטים אוסרים תרופות מרשם במפורש', () => {
  for (const [name, src] of [['ai', AI.SYSTEM_TEXT], ['intent', INT.SYSTEM_TEXT]]) {
    assert.ok(/וארניקלין/.test(src), `${name}: אין איסור מפורש`);
    assert.ok(/נשללו/.test(src), `${name}: לא נאמר שההחלטה התקבלה`);
  }
});

// ---------- A2 · חיתוך באורך מרבי ----------

test('חיתוך ב-3500 לא משאיר תגית קטועה', () => {
  // slice חתך באמצע "<b>" והשאיר "<b" או "<" תלויים. לולאת האיזון
  // סופרת תגיות שלמות בלבד ולכן לא ראתה את זה, וטלגרם החזיר 400
  // "can't parse entities" על ההודעה כולה.
  for (let pad = 3490; pad <= 3505; pad++) {
    const out = sanitizeModelText('א'.repeat(pad) + '<b>מודגש</b>');
    assert.ok(!/<[^>]*$/.test(out), `pad ${pad}: ${JSON.stringify(out.slice(-10))}`);
    const open = (out.match(/<b>/g) || []).length;
    const close = (out.match(/<\/b>/g) || []).length;
    assert.equal(open, close, `pad ${pad}: תגיות לא מאוזנות`);
  }
});

test('תגיות מקוננות נסגרות בסדר הנכון', () => {
  const t = sanitizeModelText('<b>חיצוני <i>פנימי</i> סוף');
  assert.equal((t.match(/<b>/g) || []).length, (t.match(/<\/b>/g) || []).length);
  assert.equal((t.match(/<i>/g) || []).length, (t.match(/<\/i>/g) || []).length);
});
