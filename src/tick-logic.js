// ==========================================================================
//  tick-logic.js — ההחלטות של הקרון, בלי ה-I/O
//
//  למה חילוץ חלקי ולא העברת tick כולו: tick הוא 237 שורות שרובן
//  שליחה, קריאה וכתיבה. מה שנשבר בו בפועל לא היה ה-I/O אלא **שתי
//  החלטות טהורות** שהיו קבורות בתוכו:
//
//    • איזה סלוט נשלח עכשיו, ומתי מאוחר מדי — כולל ההבחנה בין
//      "לא הגיע הזמן" לבין "עבר החלון", ששתיהן מדלגות אבל רק אחת
//      מהן צריכה לסמן שנשלח.
//    • אילו שדות נכתבים בחזרה בסוף. הגרסה הקודמת החילה רשימה קבועה
//      ללא תנאי, ולכן ערך שנקרא בתחילת ה-tick דרס שינוי שהמשתמש
//      עשה בשניות שביניהם — קליק "יש לי דחף" באמצע tick ביטל את
//      צ׳ק-אין 10 הדקות ואת הדיווח לשותפה.
//
//  העברת ה-I/O גם היא לא הייתה מוסיפה כיסוי — היא רק הייתה מזיזה
//  קוד. אלה שתי הפונקציות שבאמת צריך לבדוק.
// ==========================================================================

/** לוח הסלוטים היומי. grace = כמה דקות אחרי היעד עוד שווה לשלוח. */
export const SLOTS = [
  { id: 'morning', h: 7,  m: 0,  grace: 240 },
  { id: 'micro1',  h: 10, m: 0,  grace: 90  },
  { id: 'noon',    h: 12, m: 30, grace: 120 },
  { id: 'micro2',  h: 15, m: 0,  grace: 90  },
  { id: 'risk',    h: 17, m: 30, grace: 150 },
  { id: 'evening', h: 21, m: 30, grace: 210 },
];

/**
 * מה לעשות עם סלוט ברגע נתון.
 *
 * שלוש תוצאות ולא שתיים, וזו הנקודה: 'late' **מסמן שנשלח** בלי לשלוח.
 * בלי ההבחנה הזאת, וורקר שהיה למטה שעתיים היה מתעורר ויורה את כל
 * הודעות הבוקר בבת אחת — או לחלופין היה מדלג עליהן לנצח.
 *
 * @returns 'sent' | 'late' | 'early' | 'done'
 */
export function slotAction(slot, nowMinutes, sent, iso) {
  if (sent[`${iso}:${slot.id}`]) return 'done';
  const target = slot.h * 60 + slot.m;
  if (nowMinutes < target) return 'early';
  return nowMinutes - target > slot.grace ? 'late' : 'sent';
}

/** כל הסלוטים שצריך לשלוח עכשיו, לפי הסדר */
export const slotsDue = (nowMinutes, sent, iso, slots = SLOTS) =>
  slots.filter(s => slotAction(s, nowMinutes, sent, iso) === 'sent');

/**
 * מיזוג meta בסוף ה-tick.
 *
 * הקרון רץ במקביל להודעות: הוא קורא meta, שולח הודעות (שניות), וכותב.
 * אם בזמן הזה הגיעה הודעה ו-converse כתב meta, כתיבה גורפת כאן הייתה
 * מוחקת אותה. לכן מוחלים **רק** שדות שה-tick באמת נגע בהם.
 *
 * `sent` תמיד מתמזג ולא נדרס — שני הצדדים יכולים להוסיף לו מפתחות,
 * ואיבוד מפתח פירושו שליחה כפולה של הודעת הבוקר.
 *
 * ובמפורש **לא** ברשימה: lastPartnerAlert. הוא נכתב ב-alertPartner
 * שרץ ממסלולי המשתמש, ולכן כתיבה בחזרה של ערך ישן הייתה מאפסת את
 * מגרת 30 הדקות ומאפשרת דיווח כפול לשותפה.
 */
export function mergeTickMeta(fresh, tickMeta, touched) {
  const out = { ...fresh, sent: { ...fresh.sent, ...tickMeta.sent } };
  for (const k of touched) out[k] = tickMeta[k];
  return out;
}

/**
 * האם להציג היום את שאלת הצמצום.
 * חוזרת כל 3 ימים כדי שדחייה לא תהפוך לשכחה.
 */
export function taperAskDue(plan, daysSinceStart, nowMinutes, sentToday) {
  return !!plan.on && !!plan.taperStartISO && !plan.confirmedTaper
    && daysSinceStart >= 0 && daysSinceStart % 3 === 0
    && nowMinutes >= 9 * 60 && !sentToday;
}

/** האם להריץ היום את ניטור הצמצום — כל 7 ימים מנקודת ההתחלה */
export function taperWatchDue(plan, daysSinceStart, nowMinutes, sentToday) {
  return !!plan.confirmedTaper && !!plan.baseline
    && daysSinceStart > 0 && daysSinceStart % 7 === 0
    && nowMinutes >= 9 * 60 && !sentToday;
}

// ==========================================================================
//  תזכורת יחידה לשאלת מצב הרוח
//
//  הודעת הערב יוצאת ב-21:30 ונושאת את השאלה. אם לא ענית — עד עכשיו
//  זה היה סופי, והיום פשוט לא נאסף. אבל **יום שלא בא לך לענות בו הוא
//  בדיוק היום שהמדד נועד לתפוס**: אפקט שלילי הוא המנבא היחיד שניבא
//  מעידה ראשונה.
//
//  ולכן תזכורת אחת, ורק אחת. כל התראה מיותרת מקרבת להשתקת הבוט, ומדד
//  שגורם להשתקה גרוע ממדד חסר. החלון נסגר ב-00:30 כי דירוג רטרוספקטיבי
//  של יום שכבר הסתיים הוא נתון גרוע.
// ==========================================================================
export const MOOD_ASK_MIN = 22 * 60 + 45;   // 22:45
export const MOOD_ASK_MAX = 24 * 60 + 30;   // 00:30 למחרת

export function moodAskDue(day, nowMinutes, sentToday) {
  if (sentToday) return false;
  if (day.mood) return false;
  const m = nowMinutes < 4 * 60 ? nowMinutes + 24 * 60 : nowMinutes;
  return m >= MOOD_ASK_MIN && m <= MOOD_ASK_MAX;
}

// ==========================================================================
//  שלוש בדיקות מצב רוח ביום
//
//  מדידה אחת בערב היא שחזור של יום שלם, וצבועה לפי איך שהוא הסתיים.
//  שלוש נקודות פרוסות תופסות את **התנועה**, וזו התנועה שמנבאת.
//
//  לכל עוגן חלון משלו, ובכל חלון נשאלת שאלה אחת בלבד — ההגבלה חשובה
//  לא פחות מהתדירות עצמה: בוט שמציף נמצא בדרך להשתקה, ומדד שגורם
//  להשתקה גרוע ממדד חסר.
// ==========================================================================
export const MOOD_ANCHORS = [
  { id: 'am',  from: 10 * 60,          to: 13 * 60 },          // 10:00–13:00
  { id: 'pm',  from: 16 * 60,          to: 18 * 60 + 30 },     // 16:00–18:30
  { id: 'eve', from: 21 * 60 + 30,     to: 24 * 60 + 30 },     // 21:30–00:30
];

/** איזה עוגן פעיל עכשיו, או null */
export function moodAnchorAt(nowMinutes) {
  const m = nowMinutes < 4 * 60 ? nowMinutes + 24 * 60 : nowMinutes;
  return MOOD_ANCHORS.find(a => m >= a.from && m <= a.to) || null;
}

/**
 * האם לשאול עכשיו.
 * @param readings מספר הדירוגים שכבר נרשמו היום
 */
export function moodCheckDue(nowMinutes, readings, sentThisAnchor, maxPerDay = 3) {
  if (readings >= maxPerDay) return false;
  if (sentThisAnchor) return false;
  return !!moodAnchorAt(nowMinutes);
}


// ==========================================================================
//  תזכורת לסשן CBT
// ==========================================================================

/** 20:30 — אחרי בדיקת הערב, לפני שהוא נרדם. רבע שעה עוד אפשרי. */
export const CBT_REMIND_MIN = 20 * 60 + 30;

/**
 * האם להזכיר עכשיו על סשן.
 *
 * קורא את `meta.cbt` — **המצב עצמו**, לא מראה שלו. התכנון הראשון החזיק
 * כאן עותק נפרד מתוך הנחה שהסשנים רצים רק בסוכן; משהתווסף `/טיפול`
 * יש שני מקומות שמריצים סשן, ועותק עם שני כותבים מתפצל בהגדרה.
 *
 * **מראה חסרה = מזכירים.** זו ברירת המחדל הנכונה: תזכורת מיותרת עולה
 * הודעה אחת, תזכורת שנחסמה בטעות עולה סשן שלם. הכיוון ההפוך — לשתוק
 * כשלא יודעים — הופך כל תקלת סנכרון להיעלמות שקטה של הטיפול.
 */
export function cbtRemindDue(minutes, meta, iso, dueSession) {
  if (meta.quiet) return null;
  if (minutes < CBT_REMIND_MIN) return null;
  if (meta.sent && meta.sent[`${iso}:cbt`]) return null;
  const cbt = meta.cbt || {};
  // סשן שכבר פתוח אינו "אמור לרוץ" — הוא רץ. תזכורת עליו היא רעש.
  if (cbt.active) return null;
  // עוגן המרווח — אחרת התזכורת יורה על סשן שאי אפשר לפתוח.
  const lastISO = cbt.notes && cbt.notes.length ? cbt.notes[cbt.notes.length - 1].iso : null;
  const due = dueSession(iso, cbt.sessionsDone || [], cbt.startISO || iso, lastISO);
  if (!due) return null;

  // ═══ נסיגה ═══
  //
  // סשן שלא רץ נשאר "אמור לרוץ" לנצח, ולכן התזכורת הייתה יוצאת כל
  // ערב בלי סוף. תזכורת יומית שמתעלמים ממנה גרועה מאין תזכורת: היא
  // מאמנת להתעלם גם מהבאות, כולל אלה שכן חשובות.
  //
  // שלושה ימים ראשונים כל יום — שם עוד סביר שזה עניין של תזמון.
  // אחר כך פעם בשבוע, כי בשלב הזה זו כבר החלטה, ותזכורת שבועית
  // מכבדת אותה ועדיין משאירה דלת פתוחה.
  const late = daysBetween(due.dueISO, iso);
  if (late <= 2) return due;
  return late % 7 === 0 ? due : null;
}

/** ימים בין שני ISO — מקומי, כדי ש-tick-logic לא ייקשר ל-plan */
function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
}
