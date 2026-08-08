// ==========================================================================
//  protocol.js — הפרוטוקול הקליני כמבנה נתונים
//
//  נגזר מ-NCSCT Standard Treatment Programme (McEwen, Montgomery, Papadakis),
//  מסמך חופשי ורשמי. הצ׳קליסט הקליני שלו הוא גם ה-fidelity checklist —
//  לא המצאנו אותו, הוא כבר שם.
//
//  **למה מבנה נתונים ולא טקסט:** פרוטוקול שכתוב כפרוזה בתוך פרומפט אינו
//  ניתן לאכיפה ואינו ניתן לבדיקה. כאן כל פריט הוא רשומה עם `required`,
//  ולכן אפשר לשאול אחרי הסשן "מה לא נעשה" ולקבל תשובה — וזו כל הנקודה
//  של סעיף 5.
//
//  שלוש התאמות למקרה הזה, וכל אחת מסומנת `adapted` עם הסיבה:
//
//  1. **נכנסים באמצע.** ה-STP מתחיל שבוע לפני הגמילה; אנחנו ביום 14
//     אחריה. סשנים 1–2 עברו בזמן אמת, ולכן יש סשן קליטה שסוגר אחורה
//     את הפריטים שעדיין חסרים (טריגרים, ניסיונות קודמים, תלות, ביטחון).
//
//  2. **CO אינו רלוונטי.** "Measure carbon monoxide levels" מופיע בכל
//     סשן — אבל ויפ אינו שורף ואינו מייצר CO, ואין מד. התחליף ממלא את
//     אותה פונקציה (אימות אובייקטיבי ולא דיווח עצמי) בנתונים שכבר
//     נאספים: ימים נקיים רצופים, היצמדות מדבקה, קצב מסטיק.
//
//  3. **לא נגמר בשבוע 4.** ה-STP קובע מינימום של 4 שבועות ואומר במפורש
//     שאפשר להרחיב. אצלנו הצמצום רץ עד 15.10, ולכן סשנים 7+ הם מניעת
//     הישנות בתדירות יורדת — ומסתיימים עם הצמצום ולא לפניו.
// ==========================================================================

import { QUIT, addDaysISO, diffDays } from '../plan.js';

/** מזהי BCT — חייבים להתאים ל-tools.js. שם שאין לו כלי הוא באג. */
export const BCT = {
  READINESS: 'assess-readiness',
  PROGRESS: 'review-progress',
  OBJECTIVE: 'objective-verification',   // מחליף CO
  WITHDRAWAL: 'discuss-withdrawal',
  CRAVINGS: 'discuss-cravings',
  COPING: 'coping-plan',
  HIGHRISK: 'high-risk-ahead',
  ROUTINE: 'change-routine',
  CONTACTS: 'smoking-contacts',
  NAP: 'not-a-puff',
  MEDS: 'check-nrt',
  DEPENDENCE: 'assess-dependence',
  PASTQUITS: 'past-attempts',
  TRIGGERS: 'identify-triggers',
  COMMIT: 'prompt-commitment',
  SUMMARY: 'summary-and-homework',
  RELAPSE: 'relapse-prevention',
};

const item = (bct, label, required = true, adapted = null) =>
  ({ bct, label, required, adapted });

// ==========================================================================
//  הסשנים
// ==========================================================================

export const SESSIONS = [
  {
    id: 'intake',
    title: 'קליטה — סגירת הפערים',
    stpRef: 'Session 1 (adapted)',
    adapted: 'נכנסים ביום 14 אחרי הגמילה. סשן 1 של ה-STP הוא טרום-גמילה ' +
             'ולכן עבר; מה שנשאר ממנו רלוונטי הוא ההערכה, והיא נעשית כאן אחורה.',
    minMinutes: 20,
    checklist: [
      item(BCT.PASTQUITS,  'ניסיונות גמילה קודמים — מה קרה ומה הפיל'),
      item(BCT.TRIGGERS,   'מיפוי טריגרים'),
      item(BCT.DEPENDENCE, 'הערכת תלות'),
      item(BCT.READINESS,  'ביטחון ביכולת להימנע — 0 עד 10'),
      item(BCT.MEDS,       'סקירת המדבקה והמסטיק'),
      item(BCT.SUMMARY,    'סיכום ושיעורי בית'),
    ],
  },
  {
    id: 'wk3',
    title: 'שבוע 3 אחרי הגמילה',
    stpRef: 'Sessions 3, 4, 5',
    minMinutes: 15,
    checklist: [
      item(BCT.PROGRESS,   'בדיקת התקדמות'),
      item(BCT.OBJECTIVE,  'אימות אובייקטיבי: ימים נקיים · מדבקה · קצב מסטיק', true,
           'מחליף "Measure carbon monoxide levels" — ויפ אינו מייצר CO'),
      item(BCT.MEDS,       'שימוש ב-NRT — מספיק? נכון?'),
      item(BCT.WITHDRAWAL, 'תסמיני גמילה ודחפים'),
      item(BCT.COPING,     'מצבים קשים שהיו, ואיך התמודדת'),
      item(BCT.HIGHRISK,   'מצבי סיכון בשבוע הקרוב'),
      item(BCT.NAP,        'כלל "אף לא שאיפה אחת"'),
      item(BCT.SUMMARY,    'סיכום ושיעורי בית'),
    ],
  },
  {
    id: 'wk4',
    title: 'שבוע 4 — נקודת המעקב',
    stpRef: 'Session 6',
    minMinutes: 15,
    checklist: [
      item(BCT.PROGRESS,   'בדיקת התקדמות'),
      item(BCT.OBJECTIVE,  'אימות אובייקטיבי', true,
           'מחליף "Measure carbon monoxide levels" — ויפ אינו שורף, אינו מייצר CO, ואין מד'),
      item(BCT.MEDS,       'המשך NRT — כמה זמן עוד'),
      item(BCT.CRAVINGS,   'דחפים שהיו מאז'),
      item(BCT.COPING,     'מצבים קשים ושיטות התמודדות'),
      item(BCT.NAP,        'כלל "אף לא שאיפה אחת"'),
      item(BCT.SUMMARY,    'סיכום'),
    ],
  },
  {
    id: 'maint',
    title: 'תחזוקה ומניעת הישנות',
    stpRef: 'הרחבה מעבר ל-4 שבועות',
    adapted: 'ה-STP קובע מינימום 4 שבועות ומתיר הרחבה במפורש. הצמצום כאן ' +
             'רץ עד 15.10, ולכן התחזוקה מלווה אותו ולא נעצרת לפניו.',
    repeats: true,
    everyDays: 7,
    minMinutes: 12,
    checklist: [
      item(BCT.PROGRESS,   'בדיקת התקדמות'),
      item(BCT.OBJECTIVE,  'אימות אובייקטיבי', true,
           'מחליף "Measure carbon monoxide levels" — ויפ אינו שורף, אינו מייצר CO, ואין מד'),
      item(BCT.CRAVINGS,   'דחפים מאז הפעם הקודמת'),
      item(BCT.RELAPSE,    'מניעת הישנות — מה הכי מסוכן עכשיו'),
      item(BCT.HIGHRISK,   'מצבי סיכון בשבוע הקרוב'),
      item(BCT.COPING,     'תוכנית התמודדות לטריגר שזוהה', false),
      item(BCT.SUMMARY,    'סיכום ושיעורי בית'),
    ],
  },
];

// ==========================================================================
//  לוח הזמנים
// ==========================================================================

/** תאריך היעד של כל סשן, נגזר מהגמילה — לא מקודד קשיח */
export function scheduleFor(startISO) {
  const day = n => addDaysISO(QUIT, n);
  return [
    { id: 'intake', dueISO: startISO },
    { id: 'wk3',    dueISO: day(21) },
    { id: 'wk4',    dueISO: day(28) },
  ];
}

/**
 * מרווח מינימלי בין סשנים.
 *
 * בלי זה משתמש שפתח `/טיפול` אחרי חודשיים יכול להריץ **עשרה סשנים
 * ברצף באותו ערב** — כל אחד נסגר ומיד חושף את הבא. פרוטוקול שכל
 * הפואנטה שלו היא מרווח שבועי בין מפגשים.
 */
export const MIN_GAP_DAYS = 5;

/**
 * הסשן שאמור לרוץ עכשיו, או null.
 *
 * `lastISO` — התאריך שבו רץ הסשן האחרון בפועל. הוא גם אוכף את המרווח
 * וגם משמש עוגן לתחזוקה, במקום תאריך לוח קבוע שממנו נגזר בק-לוג של
 * מפגשים שכולם "אמורים לרוץ" בבת אחת.
 */
export function dueSession(iso, done = [], startISO = null, lastISO = null) {
  if (lastISO && diffDays(lastISO, iso) < MIN_GAP_DAYS) return null;
  const sched = scheduleFor(startISO || iso);
  for (const s of sched) {
    if (done.includes(s.id)) continue;
    if (iso >= s.dueISO) return { ...byId(s.id), dueISO: s.dueISO };
  }
  // אחרי הסשנים הקבועים — תחזוקה כל 7 ימים.
  //
  // **המרווח הראשון נספר מ-wk4, לא ממנו.** העוגן הוא יום ה-wk4 עצמו,
  // ולכן חישוב שמתיר `weeks >= lastMaint` הפך את maint:0 לזמין באותו
  // היום שבו wk4 זמין — שני סשנים באותו תאריך, והשני יוצא יום אחרי
  // הראשון במקום שבוע. תחזוקה שרצה יום אחרי סשן המעקב אינה תחזוקה.
  const maint = byId('maint');
  const lastMaint = done.filter(d => d.startsWith('maint')).length;
  // **העוגן הוא הסשן האחרון בפועל**, לא תאריך לוח. עוגן קבוע ייצר
  // בק-לוג: אחרי הפסקה של חודש, כל מפגש שבועי שפוספס היה "אמור לרוץ"
  // רטרואקטיבית, והשלמת אחד חשפה מיד את הבא.
  const anchor = lastISO || addDaysISO(QUIT, 28);
  const dueISO = addDaysISO(anchor, maint.everyDays);
  return iso >= dueISO ? { ...maint, id: `maint:${lastMaint}`, dueISO } : null;
}

export const byId = id => SESSIONS.find(s => s.id === (id || '').split(':')[0]) || null;

/**
 * קריטריון המעבר — מפורש, ולא "המטפל מרגיש שסיימנו".
 *
 * מעבר דורש שכל הפריטים המסומנים `required` בוצעו. פריט אופציונלי
 * שנדלג עליו אינו חוסם, אבל כן נרשם — אחרת "אופציונלי" הופך ל"בלתי
 * נראה", ואז הצ׳קליסט מודד רק את מה שקל.
 */
export function canComplete(session, doneBcts = []) {
  const req = session.checklist.filter(c => c.required);
  const missing = req.filter(c => !doneBcts.includes(c.bct));
  return { ok: missing.length === 0, missing: missing.map(c => c.bct) };
}

/** ציון נאמנות 0–1 על פריטי החובה, ורשימת מה שנשמט */
export function fidelity(session, doneBcts = []) {
  const req = session.checklist.filter(c => c.required);
  const hit = req.filter(c => doneBcts.includes(c.bct));
  const opt = session.checklist.filter(c => !c.required);
  return {
    score: req.length ? +(hit.length / req.length).toFixed(2) : 1,
    required: req.length,
    done: hit.length,
    missed: req.filter(c => !doneBcts.includes(c.bct)).map(c => c.label),
    skippedOptional: opt.filter(c => !doneBcts.includes(c.bct)).map(c => c.label),
  };
}

/** כל מזהי ה-BCT שהפרוטוקול מבקש — מקור האמת ל-tools.js */
export const requiredBcts = () =>
  [...new Set(SESSIONS.flatMap(s => s.checklist.map(c => c.bct)))];


/**
 * מתי הסשן הבא, גם כשאין סשן להיום.
 *
 * `session.js` חישב את זה משלושת הקבועים בלבד, ולכן אחרי `wk4` תמיד
 * החזיר `null` — והבוט אמר "אין סשן שאמור לרוץ היום" בלי תאריך, לנצח,
 * בזמן שהתחזוקה היא כל השלב הזה של התוכנית.
 */
export function nextDueISO(iso, done = [], startISO = null, lastISO = null) {
  const gapUntil = lastISO ? addDaysISO(lastISO, MIN_GAP_DAYS) : null;
  const later = d => (gapUntil && gapUntil > d ? gapUntil : d);
  for (const s of scheduleFor(startISO || iso)) {
    if (!done.includes(s.id)) return later(s.dueISO);
  }
  const maint = byId('maint');
  const anchor = lastISO || addDaysISO(QUIT, 28);
  return later(addDaysISO(anchor, maint.everyDays));
}
