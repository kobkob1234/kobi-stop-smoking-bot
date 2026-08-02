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
import { DOCTRINE, GROUNDING, withTimeout, timeoutSignal, sanitizeModelText } from './core.js';

export const provider = env => (env.AI_PROVIDER || 'off').toLowerCase();

const hasCreds = (p, env) =>
  p === 'workers-ai' ? !!env.AI :
  p === 'gemini' ? !!env.GEMINI_KEY :
  p === 'groq' ? !!env.GROQ_KEY : false;

export const enabled = env => {
  const p = provider(env);
  if (p === 'off') return false;
  return p.split(',').map(s => s.trim()).some(x => hasCreds(x, env));
};

const SYSTEM = `אתה "הליווי" — עוזר אישי בעברית של אדם בתהליך גמילה מוויפ — מדבקות ניקוטין + מסטיק 2 מ״ג + עבודה מנטלית. היום המדויק בתוכנית מופיע ב"מצב היום" שמצורף לך; קח אותו משם ולא מכאן.

חוקים מוחלטים:
1. ${GROUNDING}
2. **אל תמהר לומר שאין תשובה** — הדוקטרינה מכסה את רוב מה שיישאל, וקטע שלא נשלף אינו סימן שאין לך מה לומר. רק אם השאלה באמת מחוץ לתחום, אמור "זה לא מכוסה במדריכים שלך" והצע /כלים או *6800.
2א. **יש לך את השיחה עד כה.** המשך ("ולמה?", "כן", "אז מה עכשיו") מתייחס אליה — ענה בהקשר, אל תתחיל מחדש.
3. **אסור** לתת מינונים, מרשמים, או ייעוץ רפואי. שאלת מינון/תרופה/תופעת לוואי → הפנה לרוקח או רופא. אל תמציא מספרים.
3א. **תרופות מרשם נשללו על ידו מדעת** (וארניקלין/בופרופיון/ציטיזין). אל תציע אותן, אל תרמוז ואל תזכיר "בקצרה". אם קשה — ההסלמה היא בתוך NRT בלבד, כמו בדוקטרינה.
4. **RAIN — רק אם זה רלוונטי לשאלה, ואז בניסוח המדויק הזה בלבד:** R = זהה והרפה · A = הרשה · I = חקור בגוף ("מה מרגיש בגוף שלי עכשיו? איפה בדיוק?") · N = ציין במילה אחת. אסור לכתוב "נטרל", "הערה", "רשום", או כל גרסה אחרת. **ואל תדביק את השורה הזאת בראש התשובה כברירת מחדל** — אם השאלה לא על דחף עכשיו, אל תזכיר RAIN בכלל. ולא גולשים כדי שהגל יעבור — גולשים בסקרנות.
5. **בתוך גל — אין להציע הסחת דעת.** הסחה בורחת מהגל; גלישה מפרקת אותו. גם לא "תחשוב על משהו אחר" או "תראה סרט". (לתכנון מראש של שעות ריקות ביום — מותר וגם רצוי; ווסט ממליץ על זה. ההבדל הוא הזמן: מבנה היום כן, בריחה באמצע גל לא.)
6. אם המשתמש בדחף **עכשיו** — אל תנתח. פעולה מיידית: מסטיק 2 מ״ג, הליכה בכיוון ההפוך, RAIN, ולשלוח /גל.
7. עברית בלבד, גוף שני, ישיר. עד 120 מילים. בלי הקדמות, בלי "כמובן", בלי רשימות ממוספרות ארוכות.
8. בלי הטפות, בלי "אתה חייב", בלי התלהבות מוגזמת, בלי הבטחות. אם הוא מעד — בלי אשמה: מעידה אחת לא מוחקת כלום ולא מגדירה אותו.
9. מותר HTML פשוט של טלגרם בלבד: <b> <i> <code>. בלי markdown ובלי כוכביות.
10. בשורה האחרונה כתוב את שם המקור האמיתי מהקטע שהשתמשת בו, בפורמט: — שם המקור. אם לא השתמשת בקטע, אל תוסיף שורה כזאת. אסור לכתוב "<המקור>" או סוגריים משולשים.`;

const histBlock = hist =>
  (hist && hist.length)
    ? '\n\nהשיחה עד כה (ישן→חדש):\n' + hist.map(h => `${h.r === 'u' ? 'הוא' : 'אתה'}: ${h.t}`).join('\n')
    : '';

const fewShot = (question, ctx, state, hist) =>
  `${DOCTRINE}\n\nמצב היום:\n${state}\n\nהקטעים מהמדריכים:\n${ctx || '(אין קטע ייעודי — ענה מהדוקטרינה)'}`
  + `${histBlock(hist)}\n\nהשאלה: ${question}`;

// ---------- ספקים ----------
async function runWorkersAI(env, user) {
  // ברירת המחדל נבחרה אחרי בדיקת עברית מול כל המודלים החינמיים של
  // Workers AI. חלק מהמודלים מחזירים {response} וחלק מחזירים מבנה
  // בסגנון OpenAI ({choices}) — צריך לתמוך בשניהם.
  const model = env.WORKERS_AI_MODEL || '@cf/openai/gpt-oss-120b';
  const r = await withTimeout(env.AI.run(model, {
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
    max_tokens: 1200, temperature: 0.4,
  }), undefined, 'workers-ai');
  if (!r) return null;
  const fromChoices = r.choices?.[0]?.message?.content;
  return fromChoices || r.response || r.result?.response || null;
}

async function runGemini(env, user) {
  // gemini-flash-lite-latest נבחר אחרי מדידה: 0 טוקני "חשיבה", ~1 שנייה,
  // והעברית הכי טובה מבין החינמיים.
  //
  // שתי מלכודות שנבדקו בשטח:
  //  1. אל תשלח thinkingConfig — הכינויים ב-"-latest" דוחים אותו ב-400.
  //  2. מודלי 2.5 עם חשיבה שורפים את תקציב הטוקנים על מחשבות והתשובה
  //     נחתכת באמצע מילה. לכן maxOutputTokens נדיב, ומסננים חלקי thought.
  const model = env.GEMINI_MODEL || 'gemini-flash-lite-latest';
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 2000 },
      }),
      signal: timeoutSignal(),
    });
  const j = await res.json().catch(() => null);
  if (!res.ok) {
    // 429 = נגמרה המכסה החינמית להיום. לא חיוב — רק עצירה.
    console.log('GEMINI ERR', res.status, JSON.stringify(j).slice(0, 300));
    return null;
  }
  const parts = j?.candidates?.[0]?.content?.parts || [];
  const text = parts.filter(p => !p.thought).map(p => p.text || '').join('').trim();
  return text || null;
}

async function runGroq(env, user) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.GROQ_KEY}` },
    body: JSON.stringify({
      model: env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
      // 500 היה חריג מול 1200/2000 אצל האחרים, ותשובה בת 120 מילים
      // בעברית נחתכת שם באמצע משפט.
      temperature: 0.4, max_tokens: 1200,
    }),
    signal: timeoutSignal(),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok) { console.log('GROQ ERR', JSON.stringify(j)); return null; }
  return j?.choices?.[0]?.message?.content || null;
}

/** ניקוי משותף עם intent.js — ראה core.js */
const sanitize = s => sanitizeModelText(s) || null;

/**
 * שואל את המודל, מעוגן ב-KB ובמצב היום.
 * מחזיר null אם אין ספק, אם נגמרה המכסה היומית, או אם הקריאה נכשלה —
 * ואז המתקשר נופל בחזרה ל-KB.
 */
const RUNNERS = { 'workers-ai': runWorkersAI, gemini: runGemini, groq: runGroq };

/**
 * שרשרת נפילה־לאחור: מנסה את הספק הראשי, ואם הוא נכשל או שנגמרה
 * המכסה החינמית שלו — עובר לספק הבא, ובסוף מחזיר null והמתקשר נופל
 * ל-kb.js. ככה השיחה לא נשברת אף פעם, ולא נגרם חיוב אף פעם:
 * מכסה חינמית שנגמרה מחזירה 429, לא חשבון.
 *
 * AI_PROVIDER יכול להיות גם שרשרת: "gemini,workers-ai"
 */
export async function ask(env, question, stateText, hist, meter = null) {
  if (!enabled(env)) return null;
  const user = fewShot(question, KB.context(question, 3), stateText, hist);

  const chain = provider(env).split(',').map(s => s.trim()).filter(p => {
    if (!RUNNERS[p]) return false;
    if (p === 'workers-ai') return !!env.AI;
    if (p === 'gemini') return !!env.GEMINI_KEY;
    if (p === 'groq') return !!env.GROQ_KEY;
    return false;
  });

  for (const p of chain) {
    if (meter) meter.calls += 1;
    try {
      const out = sanitize(await RUNNERS[p](env, user));
      if (out) return out;
      console.log(`AI ${p} החזיר ריק — עובר לספק הבא`);
    } catch (e) {
      console.log(`AI ${p} ERR`, e && e.message);
    }
  }
  return null;
}

/** מכסה יומית רכה כדי לא לחרוג מהשכבה החינמית */
// היום מגיע כפרמטר ולא דרך meta._today. השדה ההוא היה זמני-לכאורה אבל
// נשמר ל-KV דרך putMeta, והנכונות הייתה תלויה בכך שכל קורא יזכור להציב
// אותו קודם — אחרת ההשוואה נכשלת, used יוצא 0, והמכסה פשוט לא נאכפת.
export function quotaLeft(meta, env, iso) {
  const cap = parseInt(env.AI_DAILY_CAP || '40', 10);
  const day = iso || meta._today;
  const used = meta.ai && day && meta.ai.date === day ? meta.ai.n : 0;
  return Math.max(0, cap - used);
}

/**
 * סופר **קריאות upstream**, לא תשובות.
 *
 * קודם לכן noteUse נקרא פעם אחת ורק בהצלחה, בזמן שהודעה אחת יכולה
 * לייצר עד ארבע קריאות: classify מנסה gemini ואז workers-ai, ואם שתיהן
 * החזירו null גם ask מנסה את שתיהן. כלומר המכסה הגבילה תשובות מוצלחות
 * ולא צריכה — ודווקא היום שבו הכול נכשל, שבו הצריכה הגבוהה ביותר,
 * נספר כאפס.
 */
export function noteUse(meta, iso, calls = 1) {
  if (!meta.ai || meta.ai.date !== iso) meta.ai = { date: iso, n: 0 };
  meta.ai.n += Math.max(1, calls);
}

// מיוצא לבדיקות בלבד — כדי שאפשר יהיה לוודא שהאיסורים באמת בפרומפט
export const SYSTEM_TEXT = SYSTEM;
