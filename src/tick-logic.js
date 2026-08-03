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
