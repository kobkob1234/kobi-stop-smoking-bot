// ==========================================================================
//  gum.js — תוכנית המסטיק: תזכורות בשעות שהוא בחר, ותצמצום מדורג
//
//  שני עקרונות מסעיף ד2׳ בתוכנית המעודכנת:
//
//  1. תזמון לפי **הזדמנות**, לא לפי שיא. הניקוטין מהמסטיק לוקח 15–20
//     דקות להיספג, ולכן יחידה שנלקחת בשיא הגל לא עוצרת את הגל הזה.
//     התזכורות מכסות את הרגעים הידועים מראש — בוקר, טריגרים, ערב.
//
//  2. בתצמצום — **הבוקר יורד אחרון**. הוא מכסה את הפער הגדול ביותר,
//     הלילה בלי מדבקה. אבל סדר הנטישה מתחיל מ**אמצע-היום** ולא מהמאוחרים:
//     ראה dropOrderOf למטה. המדריך אומר "המאוחרים לפני המוקדמים", ואצלו
//     זה בדיוק הפוך — הגלים ב-17:00–21:00, ושם הכיסוי הכי צריך לשרוד.
//
//  ולמה אין כאן "יחידה כל שעה" קשיחה: Cochrane 2023 מדרג את ההשוואה
//  בין לוח קבוע לבין לפי-צורך בוודאות נמוכה עד נמוכה מאוד. הכיסוי
//  בהזדמנויות מבוסס; שעון קשיח הוא לא. לכן השעות נבחרות על ידו.
// ==========================================================================

import { addDaysISO, diffDays, QUIT, TOTAL_DAYS } from './plan.js';

// ==========================================================================
//  התוכנית המומלצת — נבחרה, לא מוצעת
//
//  הנימוק, ב-2 מ"ג ספציפית — ולא רק מספר:
//
//  • פרמקוקינטיקה: ניקוטין מהמסטיק נספג דרך רירית הפה ומגיע ל"שיא שטוח"
//    אחרי **כ-30 דקות** לעיסה. לכן יחידה נלקחת ~30 דק' *לפני* חלון סיכון,
//    לא בתוכו. זה גם למה מסטיק לא עוצר גל שכבר בשיא.
//  • כמות: **2 מ"ג מספק כשליש** מרמת הניקוטין של עישון רגיל; 4 מ"ג מספק
//    כשני-שלישים. מכיוון שהבחירה היא 2 מ"ג, הכמות היא מה שמפצה חלקית
//    על המינון הנמוך — ולכן 12 יחידות ולא 5.
//  • Cochrane 2023: יתרון ל-4 מ"ג על 2 מ"ג בוודאות **גבוהה**. הבחירה
//    ב-2 מ"ג היא שלו, מדעת; הכמות היא הפיצוי היחיד שנשאר.
//  • ווסט (ch.10) קובע רצפה מפורשת: 10+ יחידות ביום, 6 שבועות לפחות.
//  • **וזה הנימוק החזק ביותר לתזכורות עצמן:** בניסויים, שימוש בפועל היה
//    דרמטית מתחת למומלץ (ממוצע ~1.9 יחידות ביום; רק 1.4% השתמשו במדבקה
//    ובמסטיק לפי ההוראות), ו**היצמדות גבוהה יותר ב-6 השבועות הראשונים
//    נמצאה קשורה לשיעורי הימנעות גבוהים יותר עד שנה**. מה שהעלה את
//    ההיצמדות בניסויים היה ניטור ותזכורות — כלומר בדיוק זה.
//
//  והחישוב שמאחורי 12 ולא 10:
//  מנה 2 מ"ג מספקת ~0.9 מ"ג נספג בפועל, כלומר 12 מנות ≈ 10.8 מ"ג.
//  יחד עם מדבקת 21 מ"ג הרג׳ים מגיע ל-~32 מ"ג ליום, מול צריכת סאלט של
//  30–40+ מ"ג. ב-10 מנות זה היה בגבול התחתון ממש. המקסימום המסומן הוא
//  24–25 מנות, אז 12 יושב בבירור בתוך הטווח הבטוח.
//
//  ופריסת השעות אינה אחידה במכוון: **ארבע** מנות יושבות ב-17:00–21:00,
//  חלון הסיכון שלו, במרווחי שעה — צפוף יותר מאשר בשאר היום (75 דקות).
//  הצפיפות עוקבת אחרי הסיכון, לא אחרי השעון.
// ==========================================================================
//  היעד ירד מ-12 ל-9, ואחרי מדידה ולא אחרי ניחוש.
//
//  12 חושב תיאורטית: אם הצריכה הקודמת הייתה 30–40 מ"ג, צריך רג'ים
//  של ~30, ומדבקה 21 + 12 מנות מגיעה לשם. אבל **הנתונים סותרים את
//  החשבון**: הצריכה בפועל היא 8.1 מנות ליום, כלומר 21 + 7.3 = 28 מ"ג
//  — ובעשרה ימים לא היה ולו גל משמעותי אחד.
//
//  היעדר קראבינג הוא הראיה החזקה ביותר שההחלפה מספקת. החשבון היה
//  תיאורטי, התוצאה אמפירית, וכשהם מתנגשים התוצאה מנצחת.
//
//  9 ולא 8: מעט מעל הצריכה בפועל כדי לא לעודד ירידה, ומתחת ל-12 כדי
//  להפסיק לנדנד למי שכבר מכוסה. רצפת ווסט (10+) נשארת היעד לשאוף
//  אליו, לא מספר לנדנד עליו.
//
//  והשעות נגזרות מהמדידה שלו — 09:00–21:30, מרווח חציוני 91 דקות —
//  ולא מלוח תיאורטי שהתחיל ב-07:30 והסתיים ב-20:30 בזמן ש-20%
//  מהמנות נפלו מחוצה לו. הצפיפות עולה לקראת הערב, כי שם הצריכה
//  בפועל הגבוהה ביותר (20:30 הייתה המשבצת הכבדה ביותר בנתונים).
// ==========================================================================
export const RECOMMENDED = {
  key: 'nine',
  label: '9 ביום · לפי הקצב שלך',
  times: ['09:00', '10:45', '12:30', '14:15', '16:00', '17:30', '19:00', '20:15', '21:30'],
  why: '9 ביום — מעט מעל הצריכה הנמדדת (8.1) · השעות מהקצב שלך: 09:00–21:30, מרווח ~90 דק׳ · צפיפות גבוהה יותר בערב, שם הצריכה בפועל',
};

export const PRESETS = {
  nine:   { label: RECOMMENDED.label, times: RECOMMENDED.times },
  twelve: { label: '12 ביום · הלוח התיאורטי', times: ['07:30', '08:45', '10:00', '11:15', '12:30', '13:45', '15:00', '16:15', '17:15', '18:15', '19:15', '20:30'] },
  ten:   { label: '10 ביום · רצפת ווסט', times: ['07:30', '09:00', '10:30', '12:00', '13:30', '15:00', '16:30', '17:45', '19:00', '20:30'] },
  six:   { label: '6 ביום · כל ~2 שעות ערות', times: ['07:30', '10:00', '12:30', '15:00', '17:30', '20:00'] },
  five:  { label: '5 ביום',                     times: ['07:30', '10:30', '13:30', '17:00', '20:00'] },
  four:  { label: '4 ביום',                     times: ['07:30', '11:30', '15:30', '19:30'] },
  three: { label: '3 ביום · בוקר + שני מוקשים', times: ['07:30', '13:00', '18:30'] },
  two:   { label: '2 ביום · בוקר + חלון הסיכון', times: ['07:30', '18:00'] },
  one:   { label: '1 ביום · בוקר בלבד',          times: ['07:30'] },
};

// היום שאחרי המדבקה האחרונה. עד אז המסטיק הוא רשת הביטחון של ירידות
// המדבקה, ולא מורידים שתי רשתות במקביל. נגזר מ-plan.js ולא מקודד קשיח,
// כדי שלא יישבר בשינוי הבא בלוח.
export const TAPER_START = addDaysISO(QUIT, TOTAL_DAYS);

// רצפה זמנית: אם התנאי המצבי לא התקיים עד ~12 שבועות מהגמילה, מתחילים
// בכל זאת ובקצב איטי. תנאי-מצב פתוח לגמרי מסתכן בכך שהצמצום לא יתחיל
// לעולם, וזה כשל אמיתי בדיוק כמו לצמצם מוקדם מדי.
export const TAPER_BACKSTOP = addDaysISO(QUIT, 84);

/**
 * האם עבר מועד הרצפה הזמנית בלי שהצמצום התחיל.
 *
 * הקבוע היה מוגדר ו**אף אחד לא קרא אותו** — כלומר "אם לא התחלת עד
 * 17.10, התחל בכל זאת" היה הבטחה בתוכנית בלי מימוש בקוד, בדיוק
 * המחלקה שרדפנו אחריה כל הזמן. בלעדיו תנאי-מצב פתוח לגמרי אומר
 * שהצמצום עלול לא להתחיל לעולם, והיעד נשאר 12 לנצח מול צריכה של 8.
 */
export const backstopPassed = (plan, iso) =>
  !plan.confirmedTaper && iso >= TAPER_BACKSTOP;

// לוח ברירת המחדל הקודם — 10 מנות. שמור כאן כדי שאפשר יהיה לזהות
// משתמש שמעולם לא שינה אותו, ולשדרג אותו בלי לדרוס בחירה אישית.
export const LEGACY_TIMES_V1 = [
  '07:30', '09:00', '10:30', '12:00', '13:30', '15:00', '16:30', '17:45', '19:00', '20:30',
];
export const LEGACY_TIMES_V2 = [
  '07:30', '08:45', '10:00', '11:15', '12:30', '13:45',
  '15:00', '16:15', '17:15', '18:15', '19:15', '20:30',
];
export const PLAN_VER = 3;

/**
 * שדרוג תוכנית שמורה.
 *
 * בלי זה השינוי המרכזי פשוט לא היה חל: `{...DEFAULT_PLAN, ...meta.gumPlan}`
 * לוקח את `times` השמור, ולכן משתמש קיים היה נשאר על 10 מנות גם אחרי
 * הפריסה — היעד החדש קיים בקוד ולא בפועל.
 *
 * מי ששינה את השעות ידנית לא נדרס: משדרגים רק אם המערך זהה בדיוק
 * לברירת המחדל הישנה.
 */
export function migratePlan(plan) {
  if (!plan || plan.ver >= PLAN_VER) return plan;
  const cur = sortTimes(plan.times || []);
  const eq = ref => cur.length === ref.length && cur.every((t, i) => t === ref[i]);
  const wasDefault = eq(LEGACY_TIMES_V1) || eq(LEGACY_TIMES_V2);
  const out = { ...plan, ver: PLAN_VER };
  // רק אם באמת יש מה לשנות. השמה של `times: plan.times` כשהוא undefined
  // מוסיפה מפתח מפורש בערך undefined, והוא **גובר** על DEFAULT_PLAN
  // בפריסה — כלומר תוכנית בלי times הייתה מכבה את התזכורות לגמרי,
  // במקום ליפול לברירת המחדל כפי שקרה קודם.
  if (wasDefault) out.times = RECOMMENDED.times;
  return out;
}

export const DEFAULT_PLAN = {
  ver: PLAN_VER,
  on: true,
  times: RECOMMENDED.times,
  taperStartISO: TAPER_START,
  stepDays: 4,           // יחידה אחת פחות כל 4 ימים
  confirmedTaper: false, // האם אישר שהוא מוכן להתחיל לצמצם
  pausedISO: null,       // אם הצמצום הוקפא — התאריך שבו הוקפא
};

const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
export const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const sortTimes = ts => [...new Set(ts)].sort((a, b) => toMin(a) - toMin(b));

// ==========================================================================
//  סדר ההורדה — תוקן, וזה היה הפגם המהותי ביותר בצמצום.
//
//  הגרסה הקודמת הורידה מהמאוחר לכיוון הבוקר (`all.slice(1).reverse()`).
//  זה נשמע סביר, ובמדריך זה אפילו כתוב כ"המאוחרים לפני המוקדמים" — אבל
//  אצלו הגלים מרוכזים ב-17:00–21:00, ושם יושבות ארבע מנות **בכוונה**.
//  כלומר ארבע ההורדות הראשונות מחקו בדיוק את החלון המכוסה ביותר, בעוד
//  מנות אמצע-היום שרדו עד הסוף. "הכי מאוחר" ו"הכי קל" הם אותו דבר
//  במדריך ושני דברים הפוכים אצלו.
//
//  הכלל החדש, בשתי שורות:
//    • גוש היום (עד 17:00) יורד לפני גוש הערב.
//    • בתוך כל גוש — מהמרכז החוצה, כדי שהכיסוי יישאר פרוס ולא יתכווץ
//      לצד אחד. בפועל זה משאיר את קצוות הערב (17:15 ו-20:30) אחרונים,
//      כך שהחלון עדיין ממוסגר גם כשנשארו בו שתי מנות.
//    • 07:30 נופל **אחרון מכולם** — הוא מגשר על הלילה בלי מדבקה.
// ==========================================================================
const RISK_START = 17 * 60;
const RISK_END = 21 * 60;

// ==========================================================================
//  ייחוס מנה למשבצת, וסטטיסטיקת שימוש
//
//  **נגזר ולא נשמר**, וזו החלטה: שדה חדש היה מתחיל לצבור נתונים רק
//  מהיום, כלומר שבועיים של המתנה לפני שאפשר להסיק משהו. הגזירה עובדת
//  על כל ההיסטוריה שכבר ב-KV — ויש שם חודש של חותמות זמן.
//
//  ולמה זה נחוץ: סדר ההורדה היה קליני בלבד (אמצע-יום קודם, בוקר
//  אחרון). זה נכון כברירת מחדל, אבל הבוט יודע אילו משבצות באמת
//  בשימוש. משבצת שעקבית לא נלקחת אינה עושה עבודה — והיא זו שצריכה
//  ליפול ראשונה, לא זו שהלוח הצביע עליה.
// ==========================================================================

/** המשבצת הקרובה ביותר לשעה נתונה (בדקות), או null אם אין שעות */
export function nearestSlot(minute, times) {
  const all = sortTimes(times || []);
  if (!all.length) return null;
  let best = all[0], bestD = Infinity;
  for (const t of all) {
    const d = Math.abs(toMin(t) - minute);
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}

/**
 * שימוש בפועל לכל משבצת, על פני מספר ימים.
 *
 * `taken` — כמה מנות נזקפו למשבצת · `days` — בכמה ימים שונים ·
 * `adherence` — החלק מהימים המכוסים שבהם המשבצת קיבלה מנה.
 */
// מתחת לזה, ההבדלים בין המשבצות הם רעש דגימה ולא דפוס. ב-4 ימים כל
// יום שווה 25%, כלומר מנה אחת שהוחמצה הופכת משבצת מ"מלאה" ל"חלשה".
export const MIN_USAGE_DAYS = 10;

export function slotStats(daysArr, times) {
  const all = sortTimes(times || []);
  const stat = Object.fromEntries(all.map(t => [t, { taken: 0, days: new Set() }]));
  let covered = 0;
  for (const d of daysArr) {
    const gs = (d.ev || []).filter(e => e.k === 'g');
    if (!isLogged(d)) continue;
    covered++;
    for (const e of gs) {
      const s = nearestSlot(e.h * 60 + e.m, all);
      if (s && stat[s]) { stat[s].taken++; stat[s].days.add(d.iso || covered); }
    }
  }
  const out = {};
  for (const t of all) {
    out[t] = {
      taken: stat[t].taken,
      days: stat[t].days.size,
      adherence: covered ? +(stat[t].days.size / covered).toFixed(2) : 0,
    };
  }
  return { slots: out, covered, usable: covered >= MIN_USAGE_DAYS };
}

/**
 * הקצב בפועל, מהנתונים — לא מהלוח.
 *
 * זו המדידה שחושפת עד כמה המודל המתוכנן והמציאות התרחקו. על הנתונים
 * הנקיים: **8 מנות ליום מול יעד 12**, מרווח חציוני 91 דקות, מנה
 * ראשונה ב-09:00 ואחרונה ב-21:34 — בזמן שהחלון בבוט הוא 07:30–20:30,
 * כך ש-20% מהמנות נופלות מחוצה לו ולא נספרות בקצב.
 *
 * ומעל הכול: ~90% מהמנות נלקחות ביוזמה ולא בתגובה לתזכורת. כלומר
 * הורדת משבצת תזכורת אינה מורידה צריכה — היא מורידה את המספר שהבוט
 * מצפה לו. זו הסיבה שהמדידה הזאת קודמת לכל החלטה על צמצום.
 */
export function measureRhythm(daysArr) {
  const gaps = [], perDay = [], firsts = [], lasts = [];
  let outside = 0, total = 0;
  for (const d of daysArr) {
    const g = (d.ev || []).filter(e => e.k === 'g')
      .map(e => e.h * 60 + e.m).sort((a, b) => a - b);
    total += g.length;
    outside += g.filter(m => m < 7 * 60 + 30 || m > DAY_END).length;
    if (g.length < 2) continue;
    perDay.push(g.length);
    firsts.push(g[0]);
    lasts.push(g[g.length - 1]);
    for (let i = 1; i < g.length; i++) gaps.push(g[i] - g[i - 1]);
  }
  const med = a => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
  return {
    days: perDay.length,
    perDay: med(perDay),
    gap: med(gaps),
    first: med(firsts),
    last: med(lasts),
    outsideWindow: total ? +(outside / total).toFixed(2) : 0,
    total,
  };
}

/** מינימום ימים מדודים כדי לבסס עליהם מצב-מרווח */
export const RHYTHM_MIN_DAYS = 5;

/**
 * בחירת מצב הצמצום מתוך הקצב הנמדד — **ההחלטה היחידה בתהליך שנורית פעם
 * אחת ואינה חוזרת.** היא קובעת אם הצמצום יהיה לפי מרווח (מה שנבחר) או
 * לפי משבצות (הנפילה השמרנית).
 *
 * הייתה מועתקת בשני מקומות ב-index.js — נתיב האישור ונתיב הרצפה הזמנית —
 * ולכן לא הייתה ניתנת לבדיקה משום צד, ושני העותקים יכלו להיפרד בשקט.
 * כאן היא טהורה, ולכן נבדקת.
 *
 * מתחת ל-RHYTHM_MIN_DAYS נשארים במצב המשבצות: עדיף לוח שמרני מבסיס
 * שנשען על יומיים. הנפילה הזאת שקטה במכוון, אבל **חייבת להיות גלויה
 * בטקסט** — ראה `taperInfo().mode`.
 *
 * @returns {{mode:'interval'|'slot', reason:string}} ומשנה את plan במקום
 */
export function chooseTaperMode(plan, days14) {
  const rh = measureRhythm(days14 || []);
  if (rh.days >= RHYTHM_MIN_DAYS && rh.gap) {
    plan.mode = 'interval';
    plan.baseGap = rh.gap;
    plan.gapStepPct = GAP_STEP_PCT;
    plan.winStart = rh.first;
    plan.winEnd = rh.last;
    plan.rhythmBasis = `${rh.perDay} מנות ביום · מרווח ${rh.gap} דק׳ · ${rh.days} ימים`;
    return { mode: 'interval', reason: plan.rhythmBasis };
  }
  plan.mode = 'slot';
  plan.rhythmBasis = `רק ${rh.days} ימים מדודים — פחות מ-${RHYTHM_MIN_DAYS}`;
  return { mode: 'slot', reason: plan.rhythmBasis };
}

/**
 * שיהוי תזכורת→מנה, בדקות. חציון.
 * נמדד מאירוע 'r' (תזכורת נשלחה) עד אירוע ה-'g' הבא באותו יום.
 */
export function remindLatency(daysArr) {
  const lags = [];
  for (const d of daysArr) {
    const ev = [...(d.ev || [])].sort((a, b) => (a.h * 60 + a.m) - (b.h * 60 + b.m));
    for (let i = 0; i < ev.length; i++) {
      if (ev[i].k !== 'r') continue;
      const g = ev.slice(i + 1).find(e => e.k === 'g');
      if (g) lags.push((g.h * 60 + g.m) - (ev[i].h * 60 + ev[i].m));
    }
  }
  lags.sort((a, b) => a - b);
  return { n: lags.length, median: lags.length ? lags[Math.floor(lags.length / 2)] : null };
}

/**
 * סדר ההורדה: מספר נמוך = יורד מוקדם. הראשון בכל יום לעולם אחרון.
 *
 * @param usage אופציונלי — פלט slotStats().slots. כשהוא נמסר, בתוך
 *   כל גוש יורדות **המשבצות הפחות בשימוש קודם**, במקום לפי מרחק
 *   מהמרכז בלבד. המבנה הקליני נשמר: גוש היום לפני גוש הערב, והבוקר
 *   אחרון תמיד — הנתונים בוחרים בתוך הכלל, לא במקומו.
 */
export function dropOrderOf(all, usage = null) {
  // usage שהגיע כאובייקט מלא של slotStats — מכבדים את שער המדגם שלו.
  if (usage && usage.slots) usage = usage.usable ? usage.slots : null;
  const mins = all.map(toMin);
  const anchor = mins[0];
  // גבול הערב נמתח עד המנה האחרונה בפועל ולא נעצר ב-21:00 קשיח.
  // אחרת מנה ב-21:30 — שהיא הכבדה ביותר בנתונים — מסווגת כ"אמצע יום"
  // ויורדת מוקדם, בדיוק ההפך מהכוונה. הקבוע נכתב כשהלוח נגמר ב-20:30.
  const riskEnd = Math.max(RISK_END, mins[mins.length - 1] + 1);
  const band = m => (m >= RISK_START && m < riskEnd ? 1 : 0);
  const inBand = b => mins.filter(m => m !== anchor && band(m) === b);
  const centre = arr => (arr.length ? (Math.min(...arr) + Math.max(...arr)) / 2 : 0);
  const c = [centre(inBand(0)), centre(inBand(1))];

  return [...all].sort((x, y) => {
    const mx = toMin(x), my = toMin(y);
    if (mx === anchor) return 1;          // הבוקר תמיד אחרון
    if (my === anchor) return -1;
    const bx = band(mx), by = band(my);
    if (bx !== by) return bx - by;        // גוש היום לפני גוש הערב

    // בתוך הגוש: מה שפחות בשימוש יורד קודם. משבצת שעקבית לא נלקחת
    // אינה עושה עבודה, ואין סיבה להעדיף עליה משבצת שכן.
    if (usage) {
      const ax = usage[x] ? usage[x].adherence : 0;
      const ay = usage[y] ? usage[y].adherence : 0;
      // סף של 0.15 כדי שרעש דגימה לא יהפוך את הסדר. פחות מזה — נופלים
      // לכלל הקליני.
      if (Math.abs(ax - ay) >= 0.15) return ax - ay;
    }

    const dx = Math.abs(mx - c[bx]), dy = Math.abs(my - c[by]);
    if (dx !== dy) return dx - dy;        // מהמרכז החוצה
    // שוויון מרחק בקצוות — נופל המאוחר. מנה אחת שנשארת בחלון עדיף
    // שתהיה בתחילתו: ספיגה של ~30 דקות מ-17:15 מכסה את כל הערב,
    // ואילו 20:30 מכסה רק את הזנב שלו.
    return my - mx;
  });
}

/**
 * השעות הפעילות היום, אחרי החלת התצמצם.
 *
 * הרצפה היא **אפס** ולא אחת: המדריך מבטיח "תאריך סיום מוגדר — לא הרגל
 * פתוח", והקוד הקודם קיבע מנה אחת ביום לנצח וסתר אותו. מנת הבוקר עדיין
 * האחרונה שנופלת, אבל היא כן נופלת בסוף.
 */
export function activeTimes(plan, iso) {
  const all = sortTimes(plan.times || []);
  if (!all.length) return [];
  // התצמצום לא מתחיל מעצמו בתאריך. הוא דורש אישור מפורש שהמצב יציב,
  // כי התנאי בתוכנית הוא מצב ולא תאריך — "אם צריך להתאמץ כדי להפחית,
  // עוד לא הזמן". בלי אישור נשארים על המספר המלא, וזה הכשל הבטוח.
  if (!plan.taperStartISO || !plan.confirmedTaper) return all;

  // הקפאה: כשגלאי הניטור מזהה החמרה, הצמצום **באמת** נעצר. קודם לכן
  // הבוט הודיע "אני לא מוריד עוד יחידה עד שתחליט" וזה פשוט לא היה נכון —
  // activeTimes הייתה פונקציה טהורה של ימים שחלפו ולא התייעצה בכלום.
  const effective = plan.pausedISO && plan.pausedISO < iso ? plan.pausedISO : iso;

  const days = diffDays(plan.taperStartISO, effective);
  if (days < 0) return all;
  const drop = Math.floor(days / Math.max(1, plan.stepDays || 4));
  if (drop <= 0) return all;

  // סדר ההורדה נקבע **פעם אחת** באישור ונשמר בתוכנית. כך ההחלטה
  // גלויה, ניתנת להצגה למשתמש, ולא משתנה תחת רגליו כשנתונים חדשים
  // נכנסים באמצע הצמצום.
  const order = Array.isArray(plan.dropOrder) && plan.dropOrder.length
    ? plan.dropOrder.filter(x => all.includes(x))
    : dropOrderOf(all);
  const dropped = new Set(order.slice(0, Math.min(drop, all.length)));
  return all.filter(t => !dropped.has(t));
}

/** מתי תיפול היחידה הבאה, ולאיזה יעד — לתצוגה */
export function taperInfo(plan, iso) {
  if (!plan.taperStartISO) return null;
  if (!plan.confirmedTaper) {
    return { pending: true, mode: plan.mode === 'interval' ? 'interval' : 'slot',
             active: sortTimes(plan.times || []).length,
             start: sortTimes(plan.times || []).length, step: Math.max(1, plan.stepDays || 4),
             dropsSoFar: 0, atFloor: false, nextDropISO: null, nextToGo: null };
  }
  const all = sortTimes(plan.times || []);
  const step = Math.max(1, plan.stepDays || 4);
  // ספירת הצעדים מגיעה מהפונקציה המשותפת, ואינה מחושבת כאן מחדש.
  // כשהיו כאן שני מימושים — אחד שמניע את היעד ואחד שמניע את התצוגה —
  // הם יכלו להיפרד בשקט, ואז המסך היה מראה התקדמות אחת בזמן שהמינון
  // עוקב אחרי אחרת. (נתפס בבדיקת מוטציה: floor→round שינה רק אחד מהם.)
  const drops = dropsSoFar(plan, iso);
  const paused = !!plan.pausedISO;

  // ------------------------------------------------------------------
  //  מצב-מרווח — הסתעפות שלא הייתה כאן, וזה היה באג אמיתי.
  //
  //  taperInfo היה משבצתי בלבד, וכל ארבעת הצרכנים שלו הציגו מספרי
  //  משבצות. ההודעה שנשלחת ברגע תחילת התצמצום (index.js) אמרה
  //  "9 יחידות עכשיו · יחידה אחת פחות כל 4 ימים · הראשונה שנופלת 14:15"
  //  בזמן שבמצב-מרווח היעד ביום הראשון הוא 8, הוא **לא** יורד כל 4
  //  ימים, ושום משבצת אינה נופלת. שלוש טענות שגויות ביום החשוב ביותר.
  //
  //  במצב-מרווח היעד אינו מספר המשבצות אלא כמה מנות נכנסות בחלון
  //  במרווח היעד — ולכן הוא נגזר מ-dailyTarget, ו-nextToGo חסר משמעות.
  // ------------------------------------------------------------------
  const mode = plan.mode === 'interval' ? 'interval' : 'slot';
  if (mode === 'interval') {
    const cur = dailyTarget(plan, iso);
    return {
      mode, active: cur, start: dailyTarget(plan, plan.taperStartISO),
      step, dropsSoFar: drops, atFloor: cur === 0, paused,
      pausedISO: plan.pausedISO || null,
      gap: targetGap(plan, iso),
      nextGap: targetGap(plan, addDaysISO(plan.taperStartISO, (drops + 1) * step)),
      gapStepPct: plan.gapStepPct || GAP_STEP_PCT,
      nextDropISO: cur === 0 || paused
        ? null : addDaysISO(plan.taperStartISO, (drops + 1) * step),
      nextToGo: null,          // אין משבצת שנופלת — המרווח מתארך
    };
  }

  const active = activeTimes(plan, iso);
  const atFloor = active.length === 0;
  // המנה הבאה שתיפול נגזרת מסדר ההורדה, לא מ"האחרונה ברשימה" — אחרת
  // התצוגה הייתה מבטיחה שתיפול מנת ערב בזמן שבפועל נופלת מנת צהריים.
  const order = Array.isArray(plan.dropOrder) && plan.dropOrder.length
    ? plan.dropOrder.filter(x => all.includes(x))
    : dropOrderOf(all);
  const nextToGo = atFloor || paused ? null : order.find(t => active.includes(t)) || null;
  return {
    mode,
    active: active.length,
    start: all.length,
    step,
    dropsSoFar: drops,
    atFloor,
    paused,
    pausedISO: plan.pausedISO || null,
    nextDropISO: atFloor || paused ? null : addDaysISO(plan.taperStartISO, (drops + 1) * step),
    nextToGo,
  };
}

/**
 * דקות שעברו מאז המסטיק האחרון היום, או null אם לא היה.
 * משמש כדי לא להזכיר יחידה מתוזמנת דקות אחרי שנלקחה יחידה נוספת.
 */
export function minutesSinceLastGum(day, nowMinutes) {
  const gs = (day.ev || []).filter(e => e.k === 'g');
  if (!gs.length) return null;
  // לפי **הזמן המאוחר ביותר**, לא לפי האחרון במערך. `ev` אינו ממוין:
  // /trigger יכול להיכתב אחרי webhook מדקה מוקדמת יותר, ואז האיבר
  // האחרון הוא דווקא המוקדם. נמדד בפועל: פער של 360 דקות במקום 60,
  // כלומר MAX_GAP נחצה והבוט הזכיר שעה מוקדם מדי.
  const latest = Math.max(...gs.map(e => e.h * 60 + e.m));
  const diff = nowMinutes - latest;
  return diff < 0 ? null : diff;
}

// ==========================================================================
//  גלאי המוכנות לתצמצום
//
//  התנאי בתוכנית הוא מצב ולא תאריך: "מתחילים לצמצם כשצריכת המסטיק יורדת
//  מעצמה, וכשגלים עוברים בלי שנדרש כלום". שני חלקים — ולכן שני סוגי
//  פלט, ולא דגל בינארי אחד:
//
//  • חסמים — סיבות אמיתיות להמתין. אלה מכבים את ready.
//  • סימנים חיוביים — מה שהופך את הרגע לטוב ולא רק ל"לא-רע". אלה
//    קובעים confidence, ולא חוסמים. שקילת "לא יורד מעצמה" כחסם הייתה
//    נועלת לנצח מישהו יציב לגמרי שפשוט לוקח 10 ביום — וזה בדיוק מה
//    שהתצמצום נועד לפתור.
//
//  והחסם הראשון הוא כיסוי הנתונים. `collect` מחזיר יום חסר כיום מאופס,
//  ולכן שבוע בלי תיעוד נראה כמו 0 מסטיקים, 0 גלים, 0 מעידות — כלומר
//  מקבל ציון טוב יותר משבוע אמיתי מוצלח. זה הפוך מהמציאות: ניתוק מהבוט
//  הוא מה שקורה כשקשה. בלי כיסוי אין קביעה, לא "מצוין".
//
//  יחידות שנלקחו ביוזמתו אינן סימן שלילי ואינן נשקלות: בתזמון מסתגל זו
//  התנהגות תקינה, וספירתן כרעה הייתה מענישה על יוזמה.
// ==========================================================================

export const COVERAGE_MIN = 5;   // ימים מתועדים מתוך 7 — מתחת לזה אין קביעה
export const NOISE = 0.5;        // יחידות ליום; הפרש קטן מזה הוא רעש, לא מגמה
export const WAVES_HIGH = 14;    // 2 ביום בממוצע — עוד תכוף מדי

/** יום נחשב מתועד אם יש בו סימן חיים כלשהו, לא רק מסטיק */
export const isLogged = d =>
  (d.gum || 0) > 0 || ((d.ev || []).length > 0) || !!d.mDone || !!d.eDone ||
  !!d.patch || (d.waves || 0) > 0 || (d.slips || 0) > 0;

export function readiness(last7, prev7, target = 12) {
  const sum = (a, k) => a.reduce((t, d) => t + (d[k] || 0), 0);
  const avg = (a, k) => +(sum(a, k) / Math.max(1, a.length)).toFixed(1);

  const coverage = last7.filter(isLogged).length;
  const prevCoverage = prev7.filter(isLogged).length;

  // ממוצע על ימים מתועדים בלבד — אחרת יום לא-מתועד "מדלל" את הצריכה
  // כלפי מטה ונראה כמו שיפור.
  const loggedNow = last7.filter(isLogged);
  const loggedPrev = prev7.filter(isLogged);
  const nowAvg = loggedNow.length ? avg(loggedNow, 'gum') : 0;
  const prevAvg = loggedPrev.length ? avg(loggedPrev, 'gum') : 0;

  const extra = sum(last7, 'gumExtra');
  const waves = sum(last7, 'waves');
  const prevWaves = sum(prev7, 'waves');
  const surfed = sum(last7, 'surfed');
  const slips = sum(last7, 'slips');
  const passRate = waves > 0 ? Math.round((surfed / waves) * 100) : null;

  // ---- חסמים ----
  const reasons = [];
  if (coverage < COVERAGE_MIN)
    reasons.push(`רק ${coverage} מתוך 7 ימים מתועדים — אין מספיק נתונים כדי לקבוע`);
  if (slips > 0)
    reasons.push(`${slips} מעידות בשבוע האחרון`);
  // ספירת דחפים תלויה בחריצות הדיווח: מי שמדווח ביושר "צובר" יותר.
  // לחסום על הספירה לבדה זה להעניש על דיווח — אותה תקלה כמו שתיקה
  // שנקראת כהצלחה, רק הפוכה. לכן תדירות חוסמת רק כשגם האיכות ירודה.
  // `surfed > 0` הוא התנאי שהיה חסר, וזה לא ניואנס: בנתונים האמיתיים
  // שיעור השחרור הוא ~6% — 3 מתוך 47 — כי כפתור "הגל עבר" כמעט לא
  // נלחץ. זה **ארטיפקט דיווח ולא עובדה קלינית**: הוא מדווח על גלים
  // ולא חוזר לסמן שעברו. בלי התנאי, הבדיקה הזאת הייתה חוסמת את
  // הצמצום לנצח, אצל מישהו שאולי גולש מצוין ופשוט לא מתעד.
  //
  // ההערה שכמה שורות מעל מזהה בדיוק את הכשל הזה עבור קריטריון
  // התדירות ומגנה עליו — ושכחה שלקריטריון האיכות יש אותה תלות.
  const badQuality = passRate !== null && waves >= 4 && surfed > 0 && passRate < 60;
  if (badQuality)
    reasons.push(`מתוך ${waves} דחפים בשבוע, רק ${passRate}% עברו בלי שנדרש כלום`);
  // גם כאן `surfed > 0`, ומאותה סיבה. ההערה שלמעלה קובעת במפורש
  // שתדירות לבדה לא חוסמת — "לחסום על הספירה לבדה זה להעניש על
  // דיווח" — ואז מתנה על passRate, שנשען על אותו כפתור שלא נלחץ.
  // כלומר בלי אף סימון אחד, הבדיקה הזאת **כן** חסמה על הספירה לבדה,
  // בדיוק מה שההערה אמרה לא לעשות.
  else if (waves >= WAVES_HIGH && surfed > 0 && passRate < 80)
    reasons.push(`${waves} דחפים בשבוע ורק ${passRate}% עברו — עוד תכוף`);
  if (prevAvg > 0 && nowAvg > prevAvg + NOISE)
    reasons.push(`הצריכה עלתה (${prevAvg} → ${nowAvg} ביום)`);


  // ---- סימנים חיוביים ----
  // רק כשיש כיסוי. בלי זה "הצריכה ירדה מ-10 ל-0" הוא תיאור של שבוע
  // שלא תועד, לא של שבוע מוצלח — וזו בדיוק הטענה שהגלאי הזה נבנה
  // מחדש כדי לא להשמיע.
  const enough = coverage >= COVERAGE_MIN;
  const signals = [];
  const declining = enough && prevAvg > 0 && nowAvg <= prevAvg - NOISE;
  if (declining)        signals.push(`הצריכה יורדת מעצמה (${prevAvg} → ${nowAvg} ביום)`);
  // "כבר מתחת ליעד" **הוסר כסימן חיובי**, והוא היה הפוך.
  // רצפת ווסט היא 10+ ליום, וכל מנוע התזכורות קיים כדי לדחוף את
  // הצריכה *למעלה* אל היעד. לספור צריכה נמוכה כסימן מוכנות פירושו
  // לקרוא תת-מינון — הכשל הנפוץ ביותר ב-NRT — כהצלחה. עם יעד 12 זה
  // היה מסמן 11 ליום כ"מוכן לצמצם", וזה בדיוק הכיוון ההפוך.
  // ירידה **ספונטנית** (declining) עדיין נספרת, וזה הסימן הנכון:
  // הוא מודד מגמה, לא רמה.
  if (enough && prevWaves > 0 && waves <= prevWaves - 2)
    signals.push(`פחות דחפים משבוע שעבר (${prevWaves} → ${waves})`);
  if (enough && passRate !== null && passRate >= 80 && waves >= 3)
    signals.push(`${passRate}% מהדחפים עברו בלי שנדרש כלום`);
  if (coverage === 7 && prevCoverage >= COVERAGE_MIN)
    signals.push('שבועיים של תיעוד רציף');

  // גלים נרשמים אבל אף אחד לא מסומן כ"עבר" — אין מדד איכות בכלל.
  // לא חוסם (זה ארטיפקט דיווח), אבל גם לא מאפשר להכריז "מצוין":
  // בלי הנתון הזה אנחנו לא באמת יודעים אם הגלים עוברים.
  const unmeasured = enough && waves >= 4 && surfed === 0;

  const ready = reasons.length === 0;
  const rawConf = signals.length >= 3 ? 'strong' : signals.length >= 1 ? 'ok' : 'weak';
  return {
    nowAvg, prevAvg, extra, waves, prevWaves, surfed, slips, passRate,
    coverage, prevCoverage, declining, target, unmeasured,
    ready, reasons, signals,
    confidence: !ready ? 'none' : unmeasured ? 'weak' : rawConf,
  };
}

/**
 * ניטור *במהלך* התצמצום — מה שלא היה קיים קודם.
 * "אם צריך להתאמץ כדי להפחית, עוד לא הזמן" הוא תנאי מתמשך, אבל הוא
 * נבדק פעם אחת בלבד לפני ההתחלה, ומאותו רגע הסולם ירד כל 4 ימים בלי
 * קשר למה שקרה בפועל. כאן משווים את השבוע האחרון לקו-הבסיס שנשמר
 * ברגע האישור, ומציעים צעד אחורה כשהמצב מחמיר.
 */
export function taperWatch(last7, baseline) {
  if (!baseline) return null;
  const sum = (a, k) => a.reduce((t, d) => t + (d[k] || 0), 0);
  // כיסוי חסר **אינו** שקט. הגרסה הקודמת החזירה null, כלומר הניטור
  // נעלם בדיוק בשבוע שבו קשה — וזה השבוע שבו מפסיקים לדווח — בזמן
  // שהצמצום המשיך להוריד מנה כל 4 ימים. כשל שקט בכיוון המזיק.
  const coverage = last7.filter(isLogged).length;
  if (coverage < COVERAGE_MIN) {
    return { lowCoverage: true, coverage, worse: [
      `רק ${coverage} מתוך 7 ימים תועדו, ואני באמצע הורדת מנות — אז אני לא יודע אם זה עובד.`,
    ] };
  }

  const waves = sum(last7, 'waves');
  const slips = sum(last7, 'slips');
  const enroute = sum(last7, 'enroute');
  const planning = sum(last7, 'planning');

  const worse = [];
  if (slips > 0)                      worse.push(`${slips} מעידות`);
  if (enroute > 0)                    worse.push(`${enroute} פעמים בדרך לקנות`);
  if (waves >= (baseline.waves || 0) + 5) worse.push(`הדחפים עלו (${baseline.waves} → ${waves} בשבוע)`);
  if (planning >= 3)                  worse.push(`${planning} פעמים שהמחשבות חיפשו דרך לצאת`);

  // צריכת המסטיק — הסיגנל הישיר ביותר, והיחיד שקיים כשאין גלים
  // מתועדים. אם צריך **יותר** מסטיק אחרי הורדה, ההורדה הייתה מהירה
  // מדי; זו בדיוק ההגדרה של "תצמצם שמחזיר גלים". הקו-בסיס שמר את
  // הנתון הזה מלכתחילה ומעולם לא השווה אותו.
  const gum = sum(last7, 'gum');
  const baseGum = baseline.gum || 0;
  if (baseGum > 0 && gum >= baseGum * 1.25) {
    worse.push(`צריכת המסטיק עלתה (${Math.round(baseGum / 7 * 10) / 10} → ${Math.round(gum / 7 * 10) / 10} ליום)`);
  }

  return worse.length ? { worse, waves, slips, enroute, planning, baseline } : null;
}

// ==========================================================================
//  תזמון מסתגל — לפי הקצב בפועל, לא לפי שעון קשיח
//
//  הגרסה הראשונה הזכירה בעשר שעות קבועות. בפועל, ביום הראשון, כל
//  התזכורות יצאו בזמן והיחידות נלקחו כשעה אחרי כל אחת — כלומר הקצב
//  האמיתי לא היה הקצב שבלוח. שעון קשיח מייצר שני כשלים: תזכורת
//  שמגיעה כשכבר לקחת, ושתיקה כשנשארת מאחור.
//
//  לכן היעד הוא **כמות ליום** ופריסה סבירה, לא רשימת שעות:
//    • מזכירים רק אם אתה מתחת לקצב שנדרש כדי להגיע ליעד עד סוף החלון.
//    • ולעולם לא לפני MIN_GAP דקות מהיחידה האחרונה — לא משנה מי יזם אותה.
//  מכאן שיחידה שנלקחה מחוץ לתוכנית **דוחה את התזכורת הבאה מעצמה**,
//  ואם נשארת מאחור התזכורות מתקרבות כדי להשלים.
//
//  ורשימת השעות עוד משמשת לשני דברים: עוגן חלון היום (הראשונה
//  והאחרונה), והיעד היומי — שממנו התצמצום גורע יחידה כל כמה ימים.
// ==========================================================================

export const PACE_SLACK = 1;   // פיגור של מנה אחת הוא רעש, לא סטייה
export const MIN_GAP = 60;     // לא מזכירים בתוך שעה מהיחידה האחרונה
export const MAX_GAP = 150;    // ואחרי שעתיים וחצי בלי כלום — מזכירים בכל מקרה
export const GAP_REMIND = 60;  // מרווח מינימלי בין תזכורות שנענו
export const BACKOFF = 90;     // ואחרי תזכורת שלא נענתה — נסיגה ארוכה יותר

// ==========================================================================
//  מצב-מרווח — הצמצום שמתאים להתנהגות בפועל
//
//  למה זה קיים: 90% מהמנות נלקחות ביוזמה ולא בתגובה לתזכורת. לכן
//  הורדת משבצת תזכורת **אינה מורידה צריכה** — היא מורידה את המספר
//  שהבוט מצפה לו. הצמצום המשבצתי היה מעביר את היעד מ-12 ל-11 ל-10
//  בזמן שהצריכה בפועל היא 8, כלומר לא נוגע בהתנהגות בכלל.
//
//  במצב-מרווח היעד הוא **כמה זמן בין מנות**, וזה בדיוק הממד שבו הוא
//  כן מתנהג: מרווח חציוני נמדד של 91 דקות. הצמצום מאריך אותו.
//
//  והצעדים באחוזים ולא ב-1 קבוע: ברירת המחדל הישנה הורידה מנה שלמה
//  בכל צעד, כך ש-12→11 היה 8% ו-3→2 היה 33% — הצעדים הקשים ביותר היו
//  הגדולים ביותר. אחוז קבוע שומר על עוצמת צעד אחידה לכל האורך.
//  (הסייג: מבחינת ניקוטין הצעד קבוע ממילא — 0.9 מ"ג. הטיעון פסיכולוגי.)
// ==========================================================================

export const GAP_STEP_PCT = 10;     // הארכת המרווח בכל צעד
export const GAP_CEILING = 12 * 60; // מעבר לזה — מנת הבוקר בלבד
// וכמה צעדים נשארים על מנת הבוקר לפני האפס. בלי זה מצב-מרווח היה
// נתקע על 1 לנצח והמרווח היה מתנפח למספרים חסרי משמעות (מעל מיליון
// דקות) — כלומר "מנה אחת ביום לנצח" שתוקן במצב המשבצות, חוזר מהדלת
// האחורית. המדריך מבטיח "תאריך סיום מוגדר, לא הרגל פתוח".
export const FINAL_STEPS = 3;

/** מספר הצעדים שהושלמו, משותף לשני המצבים */
function dropsSoFar(plan, iso) {
  if (!plan.taperStartISO || !plan.confirmedTaper) return 0;
  const eff = plan.pausedISO && plan.pausedISO < iso ? plan.pausedISO : iso;
  const days = diffDays(plan.taperStartISO, eff);
  if (days < 0) return 0;
  return Math.max(0, Math.floor(days / Math.max(1, plan.stepDays || 4)));
}

/** המרווח היעד בדקות, או null אם התוכנית אינה במצב-מרווח */
export function targetGap(plan, iso) {
  if (plan.mode !== 'interval' || !plan.baseGap) return null;
  const pct = plan.gapStepPct || GAP_STEP_PCT;
  const gap = plan.baseGap * Math.pow(1 + pct / 100, dropsSoFar(plan, iso));
  return Math.round(gap);
}

/** אורך חלון הערות בדקות — נמדד אם יש, אחרת מהשעות */
export function windowLen(plan) {
  if (plan.winStart != null && plan.winEnd != null) return plan.winEnd - plan.winStart;
  const w = windowOf(plan);
  return w.end - w.start;
}

/**
 * היעד היומי.
 *
 * במצב משבצות — מספר המשבצות הפעילות.
 * במצב-מרווח — כמה מנות נכנסות בחלון במרווח היעד. מעל תקרת המרווח
 * נשארת מנת הבוקר בלבד, והיא גם האחרונה שנופלת: היא מגשרת על הלילה
 * בלי מדבקה, וזה נכון בשני המצבים.
 */
export function dailyTarget(plan, iso) {
  const gap = targetGap(plan, iso);
  if (gap == null) return activeTimes(plan, iso).length;
  if (gap >= GAP_CEILING) {
    // מנת הבוקר מחזיקה עוד כמה צעדים — היא מגשרת על הלילה בלי
    // מדבקה — ואז נגמר. סוף אמיתי, לא רצפה נצחית.
    const pct = plan.gapStepPct || GAP_STEP_PCT;
    const atCeiling = Math.ceil(
      Math.log(GAP_CEILING / plan.baseGap) / Math.log(1 + pct / 100));
    return dropsSoFar(plan, iso) >= atCeiling + FINAL_STEPS ? 0 : 1;
  }
  return Math.max(1, Math.round(windowLen(plan) / gap));
}

/**
 * חלון הערות: מהיחידה הראשונה בתוכנית ועד האחרונה.
 *
 * החריג היחיד הוא תוכנית של **משבצת אחת**. שם start===end, ולכן
 * `nowMinutes > end + 45` נכון מ-08:15 והלאה — בחירת הפריסט "1 ביום"
 * בתפריט השביתה את התזכורות לחלוטין, בשקט. מנה יחידה ליום אינה
 * אמורה להיתפס כ"היום נגמר ב-07:30"; היא אמורה להיות ניתנת לתזכורת
 * לאורך היום.
 *
 * תוכניות מרובות-משבצות **לא** מורחבות: אם המנה האחרונה ב-18:00, אין
 * סיבה להזכיר ב-19:00 — היעד כבר מכוסה, וזה שקט מכוון ולא באג.
 */
export const DAY_END = 20 * 60 + 30;

export function windowOf(plan) {
  // חלון נמדד גובר על הלוח. הלוח אומר 07:30–20:30 בזמן שהמדידה אומרת
  // 09:00–21:34, ולכן 20% מהמנות נפלו "אחרי סוף החלון" ולא נספרו —
  // והבוט שתק בדיוק בשעות שבהן הוא כן לוקח. האורך כמעט זהה (754 מול
  // 780 דקות); מה שהיה שגוי הוא המיקום, לא הגודל.
  if (plan.winStart != null && plan.winEnd != null && plan.winEnd > plan.winStart) {
    return { start: plan.winStart, end: plan.winEnd };
  }
  const all = sortTimes(plan.times || []);
  if (!all.length) return { start: 7 * 60 + 30, end: 21 * 60 };
  const start = toMin(all[0]);
  const end = all.length === 1 ? Math.max(start, DAY_END) : toMin(all[all.length - 1]);
  return { start, end };
}

/**
 * האם מגיעה תזכורת עכשיו — ולמה.
 * מחזיר גם את המספרים, כדי שההודעה תוכל להסביר את עצמה.
 */
/**
 * @param snoozedTo דקה שאליה נדחתה התזכורת במפורש ("⏰ עוד 20 דק׳"), או 0.
 *
 * הפרמטר הזה הוא התיקון לבאג שדווח מהשטח. הסנוז נאכף עד עכשיו **רק**
 * ב-index.js, כתנאי `now >= snoozedTo` — כלומר רצפה. אבל כאן, בצד השני
 * של התפר, יושבת תקרה: לחיצה על סנוז אינה רושמת מסטיק, ולכן בבדיקה
 * הבאה `gumSinceRemind` שקרי ו-`wait` הוא BACKOFF (90) ולא GAP_REMIND
 * (60). שתי המגבלות נכונות בנפרד, ומכפלתן היא שהבוט הבטיח 10:51 והיה
 * מזכיר ב-12:10 — 79 דקות באיחור.
 *
 * ההכרעה: סנוז מפורש **מחליף** את הנסיגה ולא מצטרף אליה. המשתמש אמר
 * מתי הוא רוצה שיזכירו לו; זו הבעת כוונה, לא התעלמות.
 */
export function dueNow(plan, iso, day, nowMinutes, lastRemindMin = null, softCap = 18, snoozedTo = 0) {
  const target = dailyTarget(plan, iso);
  const taken = day.gum || 0;
  const { start, end } = windowOf(plan);
  const since = minutesSinceLastGum(day, nowMinutes);
  const inRisk = nowMinutes >= RISK_START && nowMinutes < RISK_END;

  const base = { target, taken, since, start, end };
  if (!plan.on || target === 0)      return { ...base, due: false, why: 'off' };
  if (nowMinutes < start)            return { ...base, due: false, why: 'לפני תחילת החלון' };
  if (nowMinutes > end + 45)         return { ...base, due: false, why: 'אחרי סוף החלון' };

  // הגעה ליעד השתיקה את הבוט לשארית היום — כולל דרך כל חלון 17:00–21:00,
  // שהוא בדיוק החלון שבשבילו נבנתה הפריסה. יום שהתחיל קשה וצרך את היעד
  // עד 13:00 השאיר את הערב בלי כלום. עכשיו יש חריג צר: רק בחלון הסיכון,
  // רק אחרי פער ארוך באמת, ורק כשעוד רחוק מהתקרה הרכה (המקסימום המסומן
  // הוא 24–25, אז יש מרווח).
  if (taken >= target) {
    const topUp = inRisk && taken < softCap && since !== null && since >= MAX_GAP;
    if (!topUp) return { ...base, due: false, why: 'הושלם היעד' };
  }

  // אף פעם לא בתוך MIN_GAP מהיחידה האחרונה — גם אם היא נלקחה מחוץ לתוכנית
  if (since !== null && since < MIN_GAP) return { ...base, due: false, why: `נלקח לפני ${since} דק׳` };

  // סנוז מפורש שעוד לא פג — שקט, בלי קשר לכל השאר.
  if (snoozedTo && nowMinutes < snoozedTo) {
    return { ...base, due: false, why: `נדחה עד ${hhmm(snoozedTo)}` };
  }

  // נסיגה — לפני כל ענף שמחזיר due, כולל "פער ארוך מדי". אם מאז
  // התזכורת האחרונה לא נלקח כלום ממתינים BACKOFF במקום GAP_REMIND.
  // כשהבדיקה הזו ישבה *אחרי* ענף MAX_GAP, יום איטי עקף אותה וייצר 20
  // תזכורות — בדיוק מה שגורם לאנשים להשתיק בוט.
  if (lastRemindMin !== null && lastRemindMin !== undefined) {
    const gumSinceRemind = (day.ev || [])
      .some(e => e.k === 'g' && (e.h * 60 + e.m) >= lastRemindMin);
    // סנוז שפג **מדלג** על הנסיגה. בלי זה הרצפה שנקבעה ב-index.js
    // נבלעת בתקרה שכאן, והבטחת ה-"אזכיר ב-10:51" הופכת ל-12:10.
    const snoozeExpired = snoozedTo && nowMinutes >= snoozedTo;
    // הערה על GAP_REMIND: הענף הזה כמעט לעולם אינו נחתך בפועל.
    // `gumSinceRemind` אמיתי פירושו שיש מסטיק בזמן g >= lastRemind,
    // ולכן `since <= now - lastRemind` — כלומר MIN_GAP (60) תמיד חוסם
    // קודם. הוא נשאר כרשת למקרה היחיד שבו since הוא null בזמן שיש
    // אירוע (אירוע עם חותמת עתידית), ולא כדי לקבוע מרווח.
    const wait = gumSinceRemind ? GAP_REMIND : BACKOFF;
    if (!snoozeExpired && nowMinutes - lastRemindMin < wait) {
      return { ...base, due: false, why: gumSinceRemind ? 'תזכורת לפני פחות משעה' : 'ממתין — התזכורת הקודמת לא נענתה' };
    }
    if (snoozeExpired) return { ...base, due: true, why: 'הסנוז פג' };
  }

  // עבר יותר מדי זמן בלי כלום — מזכירים בלי קשר לקצב.
  //
  // במצב-מרווח הסף הזה **הוא** המרווח היעד, ולא 150 קבוע: אחרת
  // MAX_GAP היה יורה ב-150 דקות בזמן שהיעד כבר 236, כלומר הצמצום
  // היה מתקדם על הנייר והתזכורות היו נשארות בקצב ההתחלתי. שני
  // מנגנונים נכונים לחוד שמבטלים זה את זה — בדיוק כמו הסנוז והנסיגה.
  const maxGap = targetGap(plan, iso) ?? MAX_GAP;
  if (since !== null && since >= maxGap) {
    return { ...base, due: true, why: maxGap === MAX_GAP ? 'פער ארוך מדי' : `עברו ${since} דק׳, המרווח היעד ${maxGap}` };
  }

  // `since === null` אומר "אין אירוע מסטיק היום", אבל **לא** בהכרח
  // "לא נלקח מסטיק": המונה `day.gum` מתעדכן בשלושה מסלולים שלא כולם
  // כותבים אירוע, ו-`ev` נחתך ל-120 אירועים ביום. בלי בדיקת `taken`
  // יום עם 8 מסטיקים ורשימת אירועים ריקה ייצר ~9 תזכורות שכל אחת מהן
  // מכריזה "עוד לא היה מסטיק היום" — וסותרת את המונה שמופיע באותה
  // הודעה ממש. עם הבדיקה, יום כזה נופל לענף הקצב ונשפט לפי המספר.
  if (since === null && taken === 0 && nowMinutes >= start + MIN_GAP) {
    return { ...base, due: true, why: 'עוד לא היה מסטיק היום' };
  }

  // מצב-מרווח: הקצב **הוא** המרווח, ואין "כמה הספקתי עד עכשיו".
  // המקרה של since >= gap כבר טופל למעלה יחד עם MAX_GAP, ולכן כאן
  // נשאר רק השקט.
  const gap = targetGap(plan, iso);
  if (gap != null) {
    return { ...base, gap, due: false, why: `במרווח (${since}/${gap} דק׳)` };
  }

  // אחרת — רק אם אנחנו **משמעותית** מתחת לקצב הדרוש.
  //
  // ה-slack אינו קוסמטי. חלון של 13 שעות חלקי 12 מנות דורש מנה כל ~65
  // דקות; מי שלוקח כל 70 דקות נשאר בפיגור של מנה אחת כל היום, ובלי
  // סובלנות היה מקבל תזכורת כמעט בכל בדיקה — 12 ביום. פיגור של מנה
  // אחת הוא רעש, לא סטייה, וזה בדיוק מה שגורם לאנשים להשתיק בוט.
  const span = Math.max(1, end - start);
  const expected = Math.min(target, Math.floor(((nowMinutes - start) / span) * target) + 1);
  const behind = taken < expected - PACE_SLACK;
  return { ...base, expected, due: behind, why: behind ? `בקצב צריך ${expected}, יש ${taken}` : 'בקצב' };
}

/** התזכורת המסתגלת */
export function reminderText(time, plan, iso, day, index, total, nowMinutes = null) {
  // לפי **שעה**, לא לפי ספירה. קודם לכן `isMorning` היה `day.gum === 0`,
  // כך שהמנה הראשונה ביום שנלקחה ב-19:00 קיבלה את הטקסט "המדבקה הוסרה
  // בלילה ולוקח לה 1–2 שעות לעלות" — נכון קלינית בבוקר, שגוי בערב.
  const mins = nowMinutes != null ? nowMinutes
             : time ? toMin(time)
             : null;
  const isMorning = mins != null ? mins < 10 * 60 : (day.gum || 0) === 0;
  const L = [`🍬 <b>מסטיק 2 מ״ג</b>`];
  L.push(`<i>יחידה ${index + 1} מתוך ${total} להיום${time ? ` · ${time}` : ''}</i>`);
  L.push('─────────────');

  if (isMorning) {
    L.push('<b>זו היחידה הכי חשובה ביום.</b> המדבקה הוסרה בלילה ולוקח לה 1–2 שעות לעלות — היחידה הזאת היא הגשר.');
  } else {
    L.push('<b>לפני הטריגר, לא בשיא שלו.</b> השיא בדם מגיע אחרי ~30 דקות לעיסה — מה שאתה לוקח עכשיו מכסה את השעה הבאה.');
  }
  L.push('');
  L.push('<b>לעוס-והנח:</b> ללעוס 2–3 פעמים ← להניח בין החניכיים ללחי ← לחזור. ~30 דקות.');
  L.push('');
  L.push('<i>אשר למטה — הנתונים מתעדכנים לפי מה שתלחץ.</i>');

  const t = taperInfo(plan, iso);
  if (t && t.dropsSoFar > 0) L.push(`\n📉 <i>בתצמצום: ${t.active} יחידות ביום (מתוך ${t.start} בהתחלה).</i>`);

  return L.join('\n');
}
