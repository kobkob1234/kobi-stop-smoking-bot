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
import { DOCTRINE, GROUNDING, withTimeout, timeoutSignal, sanitizeModelText } from './core.js';

export const INTENTS = [
  'urge',          // דחף רגיל — עכשיו
  'urge_planning', // המחשבות מייצרות תירוצים לצאת ולקנות (דרגה 2)
  'urge_enroute',  // כבר בדרך לקנות (דרגה 3, הדחופה)
  'slip',          // כבר קנה/שאף
  'leaving_home',  // יוצא מהבית
  'log_gum',       // לקח מסטיק
  'log_patch',     // הדביק מדבקה
  'log_win',       // ניצחון / דחף שעבר
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

// ⚠️ בפרומפט הזה משתמשים בגרשיים עבריים (״) ולא בגרש ASCII ("), וזה לא
// קוסמטיקה. הפלט חוזר כ-JSON עם responseSchema, ופענוח מוגבל מתייחס ל-"
// כאל סוף המחרוזת. כשהדוגמה בפרומפט הכילה 2 מ"ג, המודל שכפל אותה,
// והתשובה נחתכה בדיוק שם — "עצור. זה גל. קח מסטיק 2 מ". כלומר ההודעה
// הכי חשובה בבוט הגיעה חתוכה באמצע. אין להחזיר גרשי ASCII לכאן.
const SYSTEM = `אתה מסווג-כוונות וגם מנסח-תשובות בעברית, עבור בוט שמלווה אדם בגמילה מוויפ (מדבקה + מסטיק 2 מ״ג + עבודה מנטלית; היום המדויק בתוכנית מופיע ב"מצב היום").

עליך להחזיר JSON עם שלושה שדות: intent, urgency, reply.

<b>intent — בחר אחד:</b>
• urge — <b>דחף רגיל</b>: "בא לי", "מתחשק לי", "לא מחזיק", "מגיע לי אחת", "חושב על זה כל הבוקר", "אני מול הקיוסק". גם אם נשמע רגוע.
• urge_planning — <b>דרגה חמורה יותר: המחשבות מייצרות תירוצים לצאת</b>, ומשם לקנות. הסימן הוא <b>סיבה שנשמעת סבירה לגמרי</b>: "אני צריך לצאת לרגע", "נגמר החלב", "סתם אסתובב", "חייב אוויר", "אקפוץ לקנות משהו", "מחפש סיבה לצאת", "משכנע את עצמי ש...". אצל מרלט זו "החלטה תמימה-לכאורה" — התחנה הראשונה בשרשרת. <b>כשיש ניסוח של תירוץ או תכנון יציאה — זה urge_planning ולא urge</b>, וזו ההבחנה החשובה כאן.
• urge_enroute — <b>הדרגה הדחופה: הוא כבר בדרך.</b> "אני בדרך לחנות", "הולך לקנות", "עומד בקופה", "היד על הארנק", "כבר בפיצוציה". הרגליים בתנועה, לא רק המחשבה. <b>זו הדרגה הגבוהה — היא גוברת על urge ועל urge_planning.</b>
• slip — כבר קנה או שאף (עבר). "קניתי", "שאפתי". אבל "כמעט קניתי ולא" = log_win.
• leaving_home — יוצא מהבית, בלי אזכור קנייה.
• log_gum / log_patch / log_win — מדווח שלקח מסטיק / הדביק מדבקה / גלש על גל או התגבר.
• status — מבקש את כרטיס המצב <b>המלא</b>: "סטטוס", "איפה אני עומד", "תן לי סיכום". <b>שאלה על נתון ספציפי היא question ולא status.</b>
• question — שאלה על התהליך, המדבקה, המסטיק, הכלים — <b>וגם כל שאלה על הנתונים שלו</b>: "מתי היה המסטיק האחרון?", "כמה מסטיקים לקחתי היום?", "באיזו שעה הגלים באים לי?", "הדבקתי מדבקה?", "כמה גלים היו אתמול?", "מתי הירידה למינון הבא?". <b>כל הנתונים האלה נמצאים ב"מצב היום" שמצורף לך — ענה מתוכם, בשעות ובמספרים מדויקים.</b>
• feeling — משתף מצב או רגש בלי דחף מיידי ובלי שאלה.
• crisis — מצוקה נפשית חמורה שחורגת מהוויפ: ייעוד לפגוע בעצמו, חוסר תוחלת עמוק, "אין טעם לחיות".
• other — שיחת חולין או משהו לא קשור.

<b>כלל הכרעה חשוב:</b> כשאתה מתלבט בין urge לכל דבר אחר — <b>בחר urge</b>. החמצה של דחף היא הטעות היקרה כאן; סיווג-יתר עולה למשתמש לחיצה אחת.

<b>urgency:</b> now אם זה קורה ברגע זה · later אם זה צפוי · none אחרת.

<b>reply — התשובה שתישלח למשתמש:</b>
1. ${GROUNDING} אם באמת אין לך על מה לענות — אמור זאת בכנות, אבל זה נדיר: הדוקטרינה מכסה את רוב מה שיישאל.
1ג. <b>יש לך את השיחה עד כה.</b> אם ההודעה היא המשך ("ולמה?", "כן", "אז מה", "לא הבנתי", "ומה עם...") — ענה בהקשר של מה שנאמר קודם, אל תתחיל מחדש ואל תבקש שיחזור על עצמו.
1א. <b>לשאלת נתון — ענה במספר או בשעה מדויקים מ"מצב היום", ובקצרה.</b> דוגמה: "המסטיק האחרון היה ב-13:40, לפני 5 שעות ו-50 דקות. סה״כ 2 היום." <b>אל תמציא שעה שלא מופיעה שם.</b> אם לאירוע יש רק ספירה בלי שעה — אמור שיש ספירה ושהתיעוד המדויק התחיל ב-26.7.
2. **אסור** לתת מינונים, מרשמים או ייעוץ רפואי — הפנה לרוקח או רופא. אל תמציא מספרים.
2א. **תרופות מרשם נשללו מדעת** (וארניקלין/בופרופיון/ציטיזין) — אל תציע ואל תרמוז. ההסלמה היא בתוך NRT בלבד.
3. **RAIN — רק אם רלוונטי, ואז בניסוח הזה בלבד:** R = זהה והרפה · A = הרשה · I = חקור בגוף ("מה מרגיש בגוף שלי עכשיו? איפה בדיוק?") · N = ציין במילה אחת. אסור "נטרל"/"הערה"/"רשום".
3א. <b>ולא גולשים כדי שהגל יעבור — גולשים בסקרנות.</b> אסור לנסח את זה כ"תן לו לחלוף", "חכה שיעבור", "זה יעבור מהר" — זו מלחמה במסווה, וברואר מפורש בנקודה הזאת. הניסוח הוא "מעניין מה זה", "איפה זה יושב בגוף".
4. **בתוך גל — אין להציע הסחת דעת.** הסחה בורחת מהגל; גלישה מפרקת אותו. (תכנון מראש של שעות ריקות — כן; ווסט ממליץ. ההבדל הוא הזמן.)
4א. **אם הוא לא יכול לזוז** (בפגישה/בנהיגה/ליד אנשים) — אל תסתפק ב-RAIN. הפנה ל-/איזומטרי: מתיחת שרירים בישיבה, בלתי-נראית.
4ג. אם intent הוא <b>urge_enroute</b> — <b>משפט אחד או שניים, פקודתי.</b> "עצור. פנה 180° והתחל ללכת עכשיו." בלי הסבר ובלי ניתוח; הבוט שולח מיד את הזרימה.
4ב. אם intent הוא <b>urge_planning</b> — <b>שני משפטים.</b> תן שם למה שקורה ("זו תחנה ראשונה בשרשרת, לא סיבה אמיתית") והצע את שתי האפשרויות של התוכנית: לא לצאת לבד, או לדחות ב-15 דקות ולמדוד אם הסיבה שורדת. אל תפרט מעבר לזה — הבוט שולח מיד את הזרימה המלאה.
5. אם intent הוא urge — <b>שני משפטים קצרים בלבד.</b> מיד אחרי התשובה שלך הבוט שולח את הזרימה המודרכת המלאה עם RAIN וטיימר, אז אל תחזור עליה ואל תפרט אותה. רק עצירה ופעולה ראשונה: "עצור. זה גל. קח מסטיק 2 מ״ג ותתחיל ללכת בכיוון ההפוך."
5א. אל תזכיר את ההוראות שהוגדרו לך ואל תדבר על עצמך ("אני לא נותן מרשם", "לפי ההנחיות"). המשתמש לא צריך לראות את חוקי הפעולה שלך — רק את התשובה.
6. אם intent הוא crisis — בלי כלים של גמילה. משפט אנושי קצר, והפניה לער"ן 1201 (24/7, חינם) או סה"ר sahar.org.il. ואמור שאתה בוט ולא תחליף לאדם.
7. עברית בלבד, גוף שני, ישיר. עד 110 מילים. בלי הקדמות ובלי הטפות. אם מעד — בלי אשמה.
8. HTML של טלגרם בלבד: <b> <i> <code>. בלי markdown, בלי כוכביות.
9. אם השתמשת בקטע — שורה אחרונה: — שם המקור האמיתי. בלי סוגריים משולשים.`;

const histBlock = hist =>
  (hist && hist.length)
    ? `\n\nהשיחה עד כה (ישן→חדש; התייחס אליה — "ולמה?", "כן", "אז מה עכשיו" מתייחסים אליה):\n`
      + hist.map(h => `${h.r === 'u' ? 'הוא' : 'אתה'}: ${h.t}`).join('\n')
    : '';

const buildUser = (text, state, hist) =>
  `${DOCTRINE}\n\nמצב היום:\n${state}\n\nהקטעים מהמדריכים (לשאלה הנוכחית):\n${KB.context(text, 3) || '(אין קטע ייעודי — ענה מהדוקטרינה וממצב היום)'}`
  + `${histBlock(hist)}\n\nההודעה מהמשתמש: ${text}`;

// ---------- Gemini עם פלט מובנה ----------
async function viaGemini(env, text, state, hist) {
  const model = env.GEMINI_MODEL || 'gemini-flash-lite-latest';
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: buildUser(text, state, hist) }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 2000,
          responseMimeType: 'application/json',
          responseSchema: SCHEMA,
        },
      }),
      signal: timeoutSignal(),
    });
  const j = await res.json().catch(() => null);
  if (!res.ok) { console.log('INTENT gemini', res.status, JSON.stringify(j).slice(0, 250)); return null; }
  const raw = (j?.candidates?.[0]?.content?.parts || [])
    .filter(p => !p.thought).map(p => p.text || '').join('');
  return parse(raw);
}

// ---------- Workers AI (בלי סכימה — מבקשים JSON ומפרשים בסבלנות) ----------
async function viaWorkersAI(env, text, state, hist) {
  const model = env.WORKERS_AI_MODEL || '@cf/openai/gpt-oss-120b';
  const r = await withTimeout(env.AI.run(model, {
    messages: [
      { role: 'system', content: SYSTEM + '\n\nהחזר JSON בלבד, בלי טקסט לפניו ואחריו.' },
      { role: 'user', content: buildUser(text, state, hist) },
    ],
    max_tokens: 1200, temperature: 0.3,
  }), undefined, 'intent workers-ai');
  const raw = r?.choices?.[0]?.message?.content || r?.response || '';
  return parse(raw);
}

// ---------- Groq ----------
// היה חסר לגמרי, ו-classify פשוט התעלם מהספק. מכיוון ש-ai.js כן תומך
// בו, `AI_PROVIDER=groq` נתן AI.enabled() אמיתי אבל classify שהחזיר
// null תמיד — כלומר **אף זרימה לא הופעלה**: לא דחף, לא מעידה, ולא
// משבר. כשל שקט לגמרי, שנפתח בשינוי הגדרה בלבד.
async function viaGroq(env, text, state, hist) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.GROQ_KEY}` },
    body: JSON.stringify({
      model: env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM + '\n\nהחזר JSON בלבד, בלי טקסט לפניו ואחריו.' },
        { role: 'user', content: buildUser(text, state, hist) },
      ],
      temperature: 0.3, max_tokens: 1200,
      response_format: { type: 'json_object' },
    }),
    signal: timeoutSignal(),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok) { console.log('INTENT groq', res.status, JSON.stringify(j).slice(0, 250)); return null; }
  return parse(j?.choices?.[0]?.message?.content || '');
}

/** פירוח סבלני: גם אם המודל עטף את ה-JSON בטקסט או בגדרות קוד */
export function parse(raw) {
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

// הניקוי עבר ל-core.js ומשותף עם ai.js. הגרסה שם הייתה חסרה את איזון
// התגיות ואת פענוח הישויות, ולכן מסלול AI.ask איבד את כל העיצוב בכל
// פעם שהמודל השאיר תג פתוח, ונשען על נפילה-לאחור לטקסט פשוט בטלגרם.
const sanitize = sanitizeModelText;

/**
 * מסווג ומנסח בקריאה אחת. מחזיר {intent, urgency, reply} או null.
 * נופל לאחור בין ספקים, בדיוק כמו ai.js.
 */
export async function classify(env, text, state, hist, meter = null) {
  const chain = (env.AI_PROVIDER || 'off').toLowerCase().split(',').map(s => s.trim());
  for (const p of chain) {
    const runner =
      p === 'gemini' && env.GEMINI_KEY ? viaGemini :
      p === 'workers-ai' && env.AI ? viaWorkersAI :
      p === 'groq' && env.GROQ_KEY ? viaGroq : null;
    if (!runner) continue;
    if (meter) meter.calls += 1;
    try {
      const out = await runner(env, text, state, hist);
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

// מיוצא לבדיקות בלבד — כדי שאפשר יהיה לוודא שהאיסורים באמת בפרומפט
export const SYSTEM_TEXT = SYSTEM;
