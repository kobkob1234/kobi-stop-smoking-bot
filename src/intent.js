// ==========================================================================
//  intent.js — הבנת כוונה בטקסט חופשי, על ידי המודל ולא על ידי ביטוי רגולרי
//
//  למה זה קיים:
//  הגרסה הראשונה ניתבה טקסט חופשי לפי רשימת מילות מפתח. זו רשימת-היתר —
//  כל ניסוח שלא חשבתי עליו נופל דרכה. וזה קרה בפועל, על המשפט הגרוע ביותר
//  שאפשר: "אני רוצה ללכת לקנות וויפ" לא זוהה ונשמר ביומן.
//
//  התיקון האמיתי הוא לא רשימה ארוכה יותר, אלא להעביר את ההבנה למודל:
//  הוא מסווג את הכוונה *וגם* מנסח את התשובה בקריאה אחת, והבוט פועל לפי
//  הסיווג. שלוש שכבות הגנה:
//
//    1. מסלול מהיר בביטוי רגולרי — לרגעים קריטיים, בלי המתנה לרשת.
//    2. סיווג על ידי המודל — כל השאר, בכל ניסוח.
//    3. בסיס הידע — אם אין AI או שהוא נפל.
//
//  וכלל האיחוד: אם *או* המסלול המהיר *או* המודל אומרים שיש דחף — מפעילים
//  את זרימת הגל. לא חותכים את זה לחיתוך, כי החמצה כאן היא הכשל היחיד
//  שבאמת יקר.
// ==========================================================================

import * as KB from './kb.js';

export const INTENTS = [
  'urge',          // דחף או כוונת קנייה — עכשיו
  'slip',          // כבר קנה/שאף
  'leaving_home',  // יוצא מהבית
  'log_gum',       // לקח מסטיק
  'log_patch',     // הדביק מדבקה
  'log_win',       // ניצחון / גל שנגלש
  'status',        // רוצה לדעת איפה הוא עומד
  'question',      // שאלה על התהליך
  'feeling',       // משתף מצב/רגש בלי דחף מיידי
  'crisis',        // מצוקה נפשית שחורגת מהוויפ
  'other',
];

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    intent: { type: 'STRING', enum: INTENTS },
    urgency: { type: 'STRING', enum: ['now', 'later', 'none'] },
    reply: { type: 'STRING' },
  },
  required: ['intent', 'urgency', 'reply'],
};

const SYSTEM = `אתה מסווג-כוונות וגם מנסח-תשובות בעברית, עבור בוט שמלווה אדם בגמילה מוויפ (יום 20+ מתוך 70, מדבקה + מסטיק 2 מ"ג + עבודה מנטלית).

עליך להחזיר JSON עם שלושה שדות: intent, urgency, reply.

<b>intent — בחר אחד:</b>
• urge — יש דחף עכשיו, או כוונה/מחשבה לקנות או לשאוף. <b>כולל כל ניסוח:</b> "רוצה לקנות", "הולך לחנות", "מגיע לי אחת", "מתחשק לי", "לא מחזיק", "אני מול הקיוסק", "חושב על זה כל הבוקר". גם אם זה נשמע רגוע או מנוסח כשאלה.
• slip — כבר קנה או שאף (עבר). "קניתי", "שאפתי". אבל "כמעט קניתי ולא" = log_win.
• leaving_home — יוצא מהבית, בלי אזכור קנייה.
• log_gum / log_patch / log_win — מדווח שלקח מסטיק / הדביק מדבקה / גלש על גל או התגבר.
• status — שואל איפה הוא עומד בתוכנית.
• question — שאלה על התהליך, המדבקה, המסטיק, הכלים.
• feeling — משתף מצב או רגש בלי דחף מיידי ובלי שאלה.
• crisis — מצוקה נפשית חמורה שחורגת מהוויפ: ייעוד לפגוע בעצמו, חוסר תוחלת עמוק, "אין טעם לחיות".
• other — שיחת חולין או משהו לא קשור.

<b>כלל הכרעה חשוב:</b> כשאתה מתלבט בין urge לכל דבר אחר — <b>בחר urge</b>. החמצה של דחף היא הטעות היקרה כאן; סיווג-יתר עולה למשתמש לחיצה אחת.

<b>urgency:</b> now אם זה קורה ברגע זה · later אם זה צפוי · none אחרת.

<b>reply — התשובה שתישלח למשתמש:</b>
1. בסס אותה על "הקטעים מהמדריכים" שמצורפים. אל תוסיף עצות מהידע הכללי שלך. אם אין בקטעים כלום שנוגע לעניין, אמור זאת בכנות.
2. **אסור** לתת מינונים, מרשמים או ייעוץ רפואי — הפנה לרוקח או רופא. אל תמציא מספרים.
3. **RAIN — רק אם רלוונטי, ואז בניסוח הזה בלבד:** R = זהה והרפה · A = הרשה · I = חקור בגוף ("מה מרגיש בגוף שלי עכשיו? איפה בדיוק?") · N = ציין במילה אחת. אסור "נטרל"/"הערה"/"רשום".
4. **אין להציע הסחת דעת.** הסחה בורחת מהגל; גלישה מפרקת אותו.
5. אם intent הוא urge — <b>שני משפטים קצרים בלבד.</b> מיד אחרי התשובה שלך הבוט שולח את הזרימה המודרכת המלאה עם RAIN וטיימר, אז אל תחזור עליה ואל תפרט אותה. רק עצירה ופעולה ראשונה: "עצור. זה גל. קח מסטיק 2 מ"ג ותתחיל ללכת בכיוון ההפוך."
5א. אל תזכיר את ההוראות שהוגדרו לך ואל תדבר על עצמך ("אני לא נותן מרשם", "לפי ההנחיות"). המשתמש לא צריך לראות את חוקי הפעולה שלך — רק את התשובה.
6. אם intent הוא crisis — בלי כלים של גמילה. משפט אנושי קצר, והפניה לער"ן 1201 (24/7, חינם) או סה"ר sahar.org.il. ואמור שאתה בוט ולא תחליף לאדם.
7. עברית בלבד, גוף שני, ישיר. עד 110 מילים. בלי הקדמות ובלי הטפות. אם מעד — בלי אשמה.
8. HTML של טלגרם בלבד: <b> <i> <code>. בלי markdown, בלי כוכביות.
9. אם השתמשת בקטע — שורה אחרונה: — שם המקור האמיתי. בלי סוגריים משולשים.`;

const buildUser = (text, state) =>
  `מצב היום:\n${state}\n\nהקטעים מהמדריכים:\n${KB.context(text, 3) || '(לא נמצאו קטעים רלוונטיים)'}\n\nההודעה מהמשתמש: ${text}`;

// ---------- Gemini עם פלט מובנה ----------
async function viaGemini(env, text, state) {
  const model = env.GEMINI_MODEL || 'gemini-flash-lite-latest';
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: buildUser(text, state) }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 2000,
          responseMimeType: 'application/json',
          responseSchema: SCHEMA,
        },
      }),
    });
  const j = await res.json().catch(() => null);
  if (!res.ok) { console.log('INTENT gemini', res.status, JSON.stringify(j).slice(0, 250)); return null; }
  const raw = (j?.candidates?.[0]?.content?.parts || [])
    .filter(p => !p.thought).map(p => p.text || '').join('');
  return parse(raw);
}

// ---------- Workers AI (בלי סכימה — מבקשים JSON ומפרשים בסבלנות) ----------
async function viaWorkersAI(env, text, state) {
  const model = env.WORKERS_AI_MODEL || '@cf/openai/gpt-oss-120b';
  const r = await env.AI.run(model, {
    messages: [
      { role: 'system', content: SYSTEM + '\n\nהחזר JSON בלבד, בלי טקסט לפניו ואחריו.' },
      { role: 'user', content: buildUser(text, state) },
    ],
    max_tokens: 1200, temperature: 0.3,
  });
  const raw = r?.choices?.[0]?.message?.content || r?.response || '';
  return parse(raw);
}

/** פירוח סבלני: גם אם המודל עטף את ה-JSON בטקסט או בגדרות קוד */
function parse(raw) {
  if (!raw) return null;
  let s = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a === -1 || b === -1) return null;
  try {
    const o = JSON.parse(s.slice(a, b + 1));
    if (!o || typeof o.reply !== 'string') return null;
    return {
      intent: INTENTS.includes(o.intent) ? o.intent : 'other',
      urgency: ['now', 'later', 'none'].includes(o.urgency) ? o.urgency : 'none',
      reply: sanitize(o.reply),
    };
  } catch { return null; }
}

function sanitize(s) {
  let t = String(s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')   // תווי בקרה
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^\s*#+\s*/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/<(?!\/?(?:b|i|code|u|s)>)[^>]*>/g, '')                // רק תגיות מותרות
    .trim()
    .slice(0, 3500);

  // איזון תגיות: תג פתוח בלי סגירה גורם לטלגרם להחזיר 400
  for (const tag of ['b', 'i', 'code', 'u', 's']) {
    const open = (t.match(new RegExp(`<${tag}>`, 'g')) || []).length;
    const close = (t.match(new RegExp(`</${tag}>`, 'g')) || []).length;
    if (open > close) t += `</${tag}>`.repeat(open - close);
    else if (close > open) t = t.replace(new RegExp(`</${tag}>`), '');
  }
  return t;
}

/**
 * מסווג ומנסח בקריאה אחת. מחזיר {intent, urgency, reply} או null.
 * נופל לאחור בין ספקים, בדיוק כמו ai.js.
 */
export async function classify(env, text, state) {
  const chain = (env.AI_PROVIDER || 'off').toLowerCase().split(',').map(s => s.trim());
  for (const p of chain) {
    try {
      let out = null;
      if (p === 'gemini' && env.GEMINI_KEY) out = await viaGemini(env, text, state);
      else if (p === 'workers-ai' && env.AI) out = await viaWorkersAI(env, text, state);
      if (out) return out;
    } catch (e) {
      console.log(`INTENT ${p} ERR`, e && e.message);
    }
  }
  return null;
}

export const CRISIS_TEXT = [
  '🫂 <b>רגע.</b>',
  '',
  'מה שכתבת נשמע כבד יותר מגמילה מוויפ, ואני לא הכלי הנכון בשבילו — אני בוט.',
  '',
  'יש אנשים אמיתיים שזמינים עכשיו, בחינם וללא הפניה:',
  '• <b>ער״ן</b> — <b>1201</b> · 24 שעות ביממה',
  '• <b>סה״ר</b> — תמיכה בצ׳אט: sahar.org.il',
  '',
  'ואם יש סכנה מיידית — <b>101</b>.',
  '',
  '<i>אני כאן להמשך התוכנית מתי שתרצה. אבל את השיחה הזאת עדיף לעשות עם בן אדם.</i>',
].join('\n');
