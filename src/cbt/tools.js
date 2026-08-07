// ==========================================================================
//  tools.js — ה-BCTs ככלים בדידים
//
//  **הסוכן בוחר כלי לפי מצב, לא לפי אחזור.** זו ההבחנה שמפרידה בין
//  "צ׳אט עם ספר" לבין פרוטוקול: אחזור מחזיר את מה שדומה לשאלה, וכלי
//  נבחר לפי מה שנכון עכשיו — גם כשהמשתמש לא שאל.
//
//  לכל כלי שלושה חלקים, וכולם ניתנים לבדיקה בלי AI:
//    appliesWhen — שער כניסה. מחזיר false כשאין למה להיאחז.
//    priority    — דירוג כששניים רלוונטיים. גבוה = דחוף יותר.
//    run         — מה נאמר ומה מצופה בחזרה.
//
//  **`mode` — ההבחנה שתיקנה טעות בתכנון.**
//
//  אמרתי בתחילה ש"ה-AI מעשיר את הניסוח". זה לא נכון: **התגובתיות היא
//  הטיפול**, לא ליטוש מעליו. סשן שמריץ שמונה שאלות כתובות מראש ואינו
//  מגיב לאף תשובה הוא טופס אינטייק — שימושי, אבל לא CBT.
//
//  אבל לא כל כלי זהה, ולכן שלושה מצבים:
//
//    fixed      — דטרמיניסטי ו**נכון ככה**. לכלל "אף לא שאיפה אחת" אין
//                 למה להגיב; הוא הצהרה, ו-AI לא ישפר אותו.
//    scale      — מבקש מספר. התשובה מובנית, והעיבוד הוא חישוב.
//    responsive — **דורש AI כדי להיות טיפול.** בלי מודל, `run` מחזיר
//                 מציין-מקום: השאלה נשאלת אבל אין המשך, אין גילוי
//                 מודרך, ואין חיבור לדפוס. זה נרשם כירידת דרגה ולא
//                 מוצג כסשן מלא.
// ==========================================================================

import { BCT } from './protocol.js';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/**
 * state שהכלים מקבלים — תמצית, לא נתונים גולמיים.
 *
 * זה גם מה שנשלח למודל בשלב 6, ולכן הוא מכיל **מספרים ולא טקסט חופשי**:
 * בלי שם, בלי יומן, בלי ציטוט ממה שנכתב. ההחלטה על הספק נפלה לטובת
 * יכולת על פני פרטיות, ודווקא לכן שווה לצמצם את מה שיוצא.
 */
export const EMPTY_STATE = {
  iso: null, dayNum: 0, cleanDays: 0,
  gum7: 0, gumTarget: 0, patchDays7: 0,
  mood: null, fatigue: null, waves7: 0, slips7: 0,
  triggers: [], pastAttempts: [], confidence: null,
  homework: null, sessionsDone: [], taperStarted: false,
};

// ==========================================================================
//  הכלים
// ==========================================================================

export const TOOLS = [
  {
    id: BCT.PROGRESS,
    name: 'בדיקת התקדמות',
    evidence: 'STP — פריט ראשון בכל סשן פוסט-גמילה',
    mode: 'responsive',
    appliesWhen: s => s.dayNum > 0,
    priority: () => 90,
    run: s => ({
      text: `יום ${s.dayNum}. ${s.cleanDays} ימים נקיים רצופים.`,
      ask: 'איך היה השבוע — במילה או שתיים?',
      expects: 'free',
    }),
  },

  {
    id: BCT.OBJECTIVE,
    name: 'אימות אובייקטיבי',
    evidence: 'STP — מחליף ניטור CO, שאינו רלוונטי לוויפ',
    mode: 'fixed',
    // דורש נתונים אמיתיים. בלעדיהם זה דיווח עצמי שמתחזה לאימות.
    appliesWhen: s => s.cleanDays > 0 && (s.gum7 > 0 || s.patchDays7 > 0),
    priority: () => 85,
    run: s => ({
      text: [
        `<b>מה שהמערכת רואה, ולא מה שנזכר:</b>`,
        `· ${s.cleanDays} ימים נקיים`,
        `· מדבקה ב-${s.patchDays7} מתוך 7 הימים`,
        `· ${(s.gum7 / 7).toFixed(1)} מנות מסטיק ליום${s.gumTarget ? ` (יעד ${s.gumTarget})` : ''}`,
      ].join('\n'),
      expects: 'ack',
    }),
  },

  {
    id: BCT.MEDS,
    name: 'בדיקת NRT',
    evidence: 'STP — "Enquire about medication use and ensure correct usage"',
    mode: 'responsive',
    appliesWhen: s => s.gumTarget > 0,
    // עולה כשהצריכה נופלת מהיעד — תת-שימוש הוא כשל ה-NRT המתועד
    priority: s => (s.gum7 / 7 < s.gumTarget - 1 ? 88 : 60),
    run: s => {
      const per = s.gum7 / 7;
      const under = per < s.gumTarget - 1;
      return {
        text: under
          ? `<b>${per.toFixed(1)} מנות ליום מול יעד ${s.gumTarget}.</b> תת-שימוש הוא הכשל הקלאסי של NRT — לא חוסר יעילות של התרופה.`
          : `המסטיק בקצב: ${per.toFixed(1)} ליום מול יעד ${s.gumTarget}.`,
        ask: under ? 'מה מפריע — טעם, שכחה, או שפשוט לא בא לך?' : null,
        expects: under ? 'free' : 'ack',
      };
    },
  },

  {
    id: BCT.WITHDRAWAL,
    name: 'תסמיני גמילה',
    evidence: 'STP — "Inform the client about withdrawal symptoms"',
    mode: 'responsive',   // ההסבר קבוע, אבל 'מה מהם עדיין נוכח אצלך' דורש מענה
    appliesWhen: s => s.dayNum > 0 && s.dayNum <= 42,
    priority: s => (s.dayNum <= 28 ? 70 : 45),
    run: s => ({
      text: s.dayNum <= 28
        ? 'תסמיני גמילה מגיעים לשיא סביב יום 3 ודועכים על פני 3–4 שבועות.'
        : 'מעבר לחודש, מה שנשאר הוא בדרך כלל אפיזודי — מופעל טריגר, לא רקע קבוע.',
      ask: 'מה מהם עדיין נוכח אצלך?',
      expects: 'free',
    }),
  },

  {
    id: BCT.CRAVINGS,
    name: 'דחפים',
    evidence: 'STP — "Discuss cravings / urges to smoke"',
    mode: 'responsive',
    appliesWhen: s => s.dayNum > 0,
    // דחפים שדווחו מעלים את הדחיפות; אפס דחפים עדיין שווה לשאול
    priority: s => (s.waves7 > 0 ? 80 : 55),
    run: s => ({
      text: s.waves7 > 0
        ? `${s.waves7} דחפים דווחו בשבוע האחרון.`
        : 'לא דווחו דחפים השבוע.',
      ask: 'היו רגעים שרצית, גם אם לא סימנת אותם?',
      expects: 'free',
    }),
  },

  {
    id: BCT.COPING,
    name: 'תוכנית התמודדות',
    evidence: 'STP + גולביצר — אם-אז, d=0.65',
    mode: 'responsive',
    // צריך טריגר מזוהה. בלי אחד, "תכנן התמודדות" הוא מופשט וחסר תועלת.
    appliesWhen: s => s.triggers.length > 0,
    priority: s => (s.waves7 > 0 || s.slips7 > 0 ? 82 : 65),
    run: s => ({
      text: `הטריגר שזיהינו: <b>${s.triggers[0]}</b>.`,
      ask: 'נסח אם-אז: "אם ___ אז אני ___". ההחלטה נקבעת עכשיו, לא ברגע.',
      expects: 'if-then',
    }),
  },

  {
    id: BCT.HIGHRISK,
    name: 'מצבי סיכון בשבוע הקרוב',
    evidence: 'STP — "Address any potential high-risk situations in the coming week"',
    mode: 'responsive',
    appliesWhen: s => s.dayNum > 0,
    priority: () => 75,
    run: () => ({
      text: 'מבט קדימה, לא אחורה.',
      ask: 'מה בשבוע הקרוב עלול להיות קשה? אירוע, אנשים, לחץ, אלכוהול.',
      expects: 'free',
    }),
  },

  {
    id: BCT.NAP,
    name: 'כלל "אף לא שאיפה אחת"',
    evidence: 'STP — the ‘not a puff’ rule · קאר פרק 24',
    mode: 'fixed',
    appliesWhen: s => s.dayNum > 0,
    // עולה חד אחרי מעידה — זה בדיוק הרגע שבו הכלל נשחק
    priority: s => (s.slips7 > 0 ? 95 : 50),
    run: s => ({
      text: s.slips7 > 0
        ? '<b>אף לא שאיפה אחת.</b> אחרי מעידה זה לא נוקשות — זה מה שמונע מהמעידה להפוך להישנות.'
        : '<b>אף לא שאיפה אחת.</b> לא "רק אחת", לא "רק בחוץ".',
      expects: 'ack',
    }),
  },

  {
    id: BCT.READINESS,
    name: 'ביטחון 0–10',
    evidence: 'STP + בנדורה — מסוגלות עצמית',
    mode: 'scale',
    appliesWhen: () => true,
    // ביטחון נמוך שנמדד קודם מעלה דחיפות
    priority: s => (s.confidence !== null && s.confidence <= 4 ? 86 : 68),
    run: () => ({
      text: 'עד כמה אתה בטוח שתישאר נקי בחודש הקרוב?',
      ask: '0 = בכלל לא · 10 = לגמרי',
      expects: 'scale-0-10',
    }),
  },

  {
    id: BCT.DEPENDENCE,
    name: 'הערכת תלות',
    evidence: 'STP — "assess nicotine dependence"',
    mode: 'responsive',
    appliesWhen: s => !s.sessionsDone.includes('intake'),
    priority: () => 72,
    run: () => ({
      text: 'שאלה אחת שמעריכה תלות טוב יותר מכל השאר:',
      ask: 'כמה זמן אחרי היקיצה הייתה השאיפה הראשונה, כשעוד ויפת?',
      expects: 'free',
    }),
  },

  {
    id: BCT.PASTQUITS,
    name: 'ניסיונות קודמים',
    evidence: 'STP — "Assess past quit attempts"',
    mode: 'responsive',
    appliesWhen: s => s.pastAttempts.length === 0,
    priority: () => 74,
    run: () => ({
      text: 'מה שהפיל פעם קודמת הוא המנבא הכי שימושי שיש.',
      ask: 'ניסית להפסיק לפני כן? מה קרה, ומה החזיר אותך?',
      expects: 'free',
    }),
  },

  {
    id: BCT.TRIGGERS,
    name: 'מיפוי טריגרים',
    evidence: 'STP + ברואר — לולאת טריגר→התנהגות→תגמול',
    mode: 'responsive',
    appliesWhen: s => s.triggers.length < 3,
    priority: s => (s.triggers.length === 0 ? 84 : 66),
    run: s => ({
      text: s.triggers.length
        ? `יש לנו ${s.triggers.length}: ${s.triggers.join(' · ')}.`
        : 'עוד לא מיפינו טריגרים.',
      ask: 'מתי הכי רצית? מקום, שעה, רגש, אנשים.',
      expects: 'free',
    }),
  },

  {
    id: BCT.ROUTINE,
    name: 'שינוי שגרה',
    evidence: 'STP — "Advise on changing routine"',
    mode: 'responsive',
    appliesWhen: s => s.triggers.length > 0 && s.dayNum <= 56,
    priority: () => 58,
    run: () => ({
      text: 'ההרגל נצמד להקשר, לא רק לחומר.',
      ask: 'איזה חלק בשגרה עדיין נראה בדיוק כמו כשוויפת?',
      expects: 'free',
    }),
  },

  {
    id: BCT.CONTACTS,
    name: 'סביבה מעשנת',
    evidence: 'STP — "the issue of the client’s smoking contacts"',
    mode: 'responsive',
    appliesWhen: s => s.dayNum <= 56,
    priority: () => 52,
    run: () => ({
      text: 'נוכחות של מעשנים היא מהטריגרים החזקים שנמדדו ב-EMA.',
      ask: 'מי בסביבה שלך עדיין מווייפ, ומתי אתה איתם?',
      expects: 'free',
    }),
  },

  {
    id: BCT.RELAPSE,
    name: 'מניעת הישנות',
    evidence: 'STP — הרחבה מעבר לשבוע 4 · מרלט',
    mode: 'responsive',
    appliesWhen: s => s.dayNum > 21,
    priority: s => (s.taperStarted ? 88 : 62),
    run: s => ({
      text: s.taperStarted
        ? 'הצמצום רץ — וזה השלב שבו הרשת מתחילה להידלל.'
        : 'ככל שעובר זמן, הסיכון עובר מגמילה פיזית להקשר.',
      ask: 'מה הכי מסוכן בשבועיים הקרובים?',
      expects: 'free',
    }),
  },

  {
    id: BCT.COMMIT,
    name: 'התחייבות',
    evidence: 'STP — "Prompt a commitment from the client"',
    mode: 'responsive',
    appliesWhen: () => true,
    priority: () => 40,
    run: () => ({
      text: 'התחייבות שנאמרת בקול מחזיקה טוב יותר מהחלטה שנשארת בראש.',
      ask: 'מה אתה מתחייב עליו עד המפגש הבא?',
      expects: 'free',
    }),
  },

  {
    id: BCT.SUMMARY,
    name: 'סיכום ושיעורי בית',
    evidence: 'STP — "Provide a summary" · בק — homework',
    mode: 'responsive',
    appliesWhen: () => true,
    // תמיד אחרון — הסיכום סוגר ולא פותח
    priority: () => 5,
    run: s => ({
      text: 'סיכום, ומשימה אחת עד הפעם הבאה.',
      ask: s.homework
        ? `בפעם שעברה: "${s.homework}". מה יצא?`
        : 'מה המשימה שאתה לוקח על עצמך?',
      expects: 'homework',
    }),
  },
];

// ==========================================================================
//  בחירה
// ==========================================================================

export const byId = id => TOOLS.find(t => t.id === id) || null;

/**
 * הכלי הבא בסשן.
 *
 * `remaining` = פריטי הצ׳קליסט שעוד לא בוצעו. הבחירה היא **חיתוך** של
 * מה שהפרוטוקול מבקש עם מה שהמצב מאפשר — כלי שהפרוטוקול דורש אבל
 * `appliesWhen` שולל אינו נבחר, והוא ידווח כנשמט. זה עדיף על להריץ
 * כלי שאין לו על מה להישען ולקבל שאלה מופשטת.
 */
export function nextTool(state, remaining = []) {
  const cands = remaining
    .map(byId)
    .filter(t => t && t.appliesWhen(state))
    .sort((a, b) => b.priority(state) - a.priority(state));
  return cands[0] || null;
}

/** כל הכלים שרלוונטיים עכשיו, מדורגים — לניפוי ולתצוגה */
export function applicable(state) {
  return TOOLS.filter(t => t.appliesWhen(state))
    .map(t => ({ id: t.id, name: t.name, priority: clamp(t.priority(state), 0, 100) }))
    .sort((a, b) => b.priority - a.priority);
}

// ==========================================================================
//  דיווח כן על מה שהסשן באמת היה
//
//  בלי AI, 13 מתוך 17 הכלים שואלים שאלה ואינם מגיבים לתשובה. זה טופס
//  אינטייק — שימושי (תיעוד עצמי הוא BCT מגובה), אבל לא CBT. הבוט חייב
//  לומר את זה ולא להציג צ׳קליסט שהושלם כאילו היה סשן.
// ==========================================================================

/** האם הסשן הזה יכול לרוץ כטיפול, או רק כבדיקה מובנית */
export function sessionMode(remainingBcts = [], aiAvailable = true) {
  const needAi = remainingBcts.map(byId).filter(t => t && t.mode === 'responsive');
  if (aiAvailable) return { mode: 'session', label: 'סשן', degraded: [] };
  return {
    mode: needAi.length ? 'checkin' : 'session',
    label: needAi.length ? 'בדיקה מובנית' : 'סשן',
    degraded: needAi.map(t => t.name),
    note: needAi.length
      ? `${needAi.length} כלים דורשים מענה מותאם ואין כרגע מודל זמין — ` +
        'השאלות יישאלו, אבל בלי המשך ובלי חיבור לדפוס.'
      : null,
  };
}
