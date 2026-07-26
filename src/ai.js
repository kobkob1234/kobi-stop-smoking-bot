// ==========================================================================
//  ai.js — שכבת שיחה חופשית, אופציונלית ובחינם
//
//  כבויה כברירת מחדל. הבוט עובד מלא בלעדיה (src/kb.js עונה על שאלות
//  מהמדריכים בלי שום AI). מדליקים על ידי הגדרת AI_PROVIDER:
//
//    workers-ai  — Cloudflare Workers AI. 10,000 נוירונים/יום חינם (~80 תשובות),
//                  בלי חשבון נוסף ובלי מפתח, והנתונים לא יוצאים מ-Cloudflare.
//    gemini      — Google Gemini. 2.5-flash-lite: 15 בקשות/דקה, 1,000/יום חינם,
//                  בלי כרטיס אשראי. העברית הכי טובה מבין החינמיים.
//                  ⚠️ בשכבה החינמית גוגל עשויה להשתמש בפרומפטים לשיפור מוצריה.
//    groq        — Groq. חינמי ומהיר מאוד, עברית בינונית.
//
//  בכל המקרים: התשובה מעוגנת בקטעים מהמדריכים בלבד + מצב היום,
//  ואסור לה להמציא מינונים או ייעוץ רפואי.
// ==========================================================================

import * as KB from './kb.js';

export const provider = env => (env.AI_PROVIDER || 'off').toLowerCase();
export const enabled = env => {
  const p = provider(env);
  if (p === 'off') return false;
  if (p === 'workers-ai') return !!env.AI;
  if (p === 'gemini') return !!env.GEMINI_KEY;
  if (p === 'groq') return !!env.GROQ_KEY;
  return false;
};

const SYSTEM = `אתה "הליווי" — עוזר אישי בעברית של אדם בתהליך גמילה מוויפ, ביום 20+ מתוך תוכנית 70 ימים של מדבקות ניקוטין + מסטיק 2 מ"ג + עבודה מנטלית.

חוקים מוחלטים:
1. ענה **רק** על בסיס "הקטעים מהמדריכים" ו"מצב היום" שמצורפים לך. אם התשובה לא נמצאת שם — אמור בפירוש "זה לא מכוסה במדריכים שלך" והצע /כלים או את קו *6800. אל תשלים מהידע הכללי שלך.
2. **אסור** לתת מינונים, מרשמים, או ייעוץ רפואי. שאלת מינון/תרופה/תופעת לוואי → הפנה לרוקח או רופא, וצטט רק מה שכתוב במדריכים.
3. אם המשתמש בדחף **עכשיו** — אל תנתח. תן פעולה מיידית: מסטיק, לצאת להליכה בכיוון ההפוך, RAIN, ואמור לו לשלוח /גל.
4. עברית בלבד, גוף שני, ישיר. עד 120 מילים. בלי הקדמות ובלי "כמובן".
5. בלי הטפות, בלי "אתה חייב", בלי התלהבות מוגזמת, בלי הבטחות. אם הוא מעד — בלי אשמה: מעידה אחת לא מוחקת כלום.
6. מותר HTML פשוט של טלגרם בלבד: <b> <i> <code>. בלי markdown ובלי כוכביות.
7. בסוף, אם השתמשת בקטע — הוסף שורה: — <המקור>`;

const fewShot = (question, ctx, state) =>
  `מצב היום:\n${state}\n\nהקטעים מהמדריכים:\n${ctx || '(לא נמצאו קטעים רלוונטיים)'}\n\nהשאלה: ${question}`;

// ---------- ספקים ----------
async function runWorkersAI(env, user) {
  const r = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
    max_tokens: 500, temperature: 0.4,
  });
  return (r && (r.response || r.result?.response)) || null;
}

async function runGemini(env, user) {
  const model = env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 700 },
      }),
    });
  const j = await res.json().catch(() => null);
  if (!res.ok) { console.log('GEMINI ERR', JSON.stringify(j)); return null; }
  return j?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || null;
}

async function runGroq(env, user) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.GROQ_KEY}` },
    body: JSON.stringify({
      model: env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
      temperature: 0.4, max_tokens: 500,
    }),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok) { console.log('GROQ ERR', JSON.stringify(j)); return null; }
  return j?.choices?.[0]?.message?.content || null;
}

/** ניקוי: מונע markdown ותגיות שטלגרם ידחה */
function sanitize(s) {
  if (!s) return null;
  return s
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^\s*#+\s*/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(?<!\w)\*(?!\s)(.+?)(?<!\s)\*(?!\w)/g, '<i>$1</i>')
    .replace(/<(?!\/?(b|i|code|u|s)>)[^>]*>/g, '')
    .trim()
    .slice(0, 3500);
}

/**
 * שואל את המודל, מעוגן ב-KB ובמצב היום.
 * מחזיר null אם אין ספק, אם נגמרה המכסה היומית, או אם הקריאה נכשלה —
 * ואז המתקשר נופל בחזרה ל-KB.
 */
export async function ask(env, question, stateText) {
  if (!enabled(env)) return null;
  const user = fewShot(question, KB.context(question, 3), stateText);
  const p = provider(env);
  try {
    let out = null;
    if (p === 'workers-ai') out = await runWorkersAI(env, user);
    else if (p === 'gemini') out = await runGemini(env, user);
    else if (p === 'groq') out = await runGroq(env, user);
    return sanitize(out);
  } catch (e) {
    console.log('AI ERR', e && e.message);
    return null;
  }
}

/** מכסה יומית רכה כדי לא לחרוג מהשכבה החינמית */
export function quotaLeft(meta, env) {
  const cap = parseInt(env.AI_DAILY_CAP || '40', 10);
  const used = meta.ai && meta.ai.date === meta._today ? meta.ai.n : 0;
  return Math.max(0, cap - used);
}

export function noteUse(meta, iso) {
  if (!meta.ai || meta.ai.date !== iso) meta.ai = { date: iso, n: 0 };
  meta.ai.n += 1;
}
