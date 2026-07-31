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
//     הלילה בלי מדבקה. לכן סדר הנטישה מתחיל מהחלונות המאוחרים.
//
//  ולמה אין כאן "יחידה כל שעה" קשיחה: Cochrane 2023 מדרג את ההשוואה
//  בין לוח קבוע לבין לפי-צורך בוודאות נמוכה עד נמוכה מאוד. הכיסוי
//  בהזדמנויות מבוסס; שעון קשיח הוא לא. לכן השעות נבחרות על ידו.
// ==========================================================================

import { addDaysISO, diffDays } from './plan.js';

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
//    על המינון הנמוך — ולכן 10 יחידות ולא 5.
//  • Cochrane 2023: יתרון ל-4 מ"ג על 2 מ"ג בוודאות **גבוהה**. הבחירה
//    ב-2 מ"ג היא שלו, מדעת; הכמות היא הפיצוי היחיד שנשאר.
//  • ווסט (ch.10) קובע רצפה מפורשת: 10+ יחידות ביום, 6 שבועות לפחות.
//  • **וזה הנימוק החזק ביותר לתזכורות עצמן:** בניסויים, שימוש בפועל היה
//    דרמטית מתחת למומלץ (ממוצע ~1.9 יחידות ביום; רק 1.4% השתמשו במדבקה
//    ובמסטיק לפי ההוראות), ו**היצמדות גבוהה יותר ב-6 השבועות הראשונים
//    נמצאה קשורה לשיעורי הימנעות גבוהים יותר עד שנה**. מה שהעלה את
//    ההיצמדות בניסויים היה ניטור ותזכורות — כלומר בדיוק זה.
//
//  ופריסת השעות אינה אחידה במקרה: רוב הגלים בנתונים שלו נופלים בין
//  17:00 ל-21:00, וההקשר החוזר הוא "בחוץ". לכן שלוש יחידות יושבות
//  לפני החלון ובתוכו (16:30 · 17:45 · 19:00) — כיסוי לפניו, לא אחריו.
// ==========================================================================
export const RECOMMENDED = {
  key: 'ten',
  label: '10 ביום · מומלץ',
  times: ['07:30', '09:00', '10:30', '12:00', '13:30', '15:00', '16:30', '17:45', '19:00', '20:30'],
  why: '10+ ביום (רצפת ווסט) · 2 מ"ג = ~⅓ מרמת עישון ליחידה, ולכן כמות מפצה · שיא ספיגה ~30 דק׳ ולכן לפני החלון · והיצמדות היא מה שנמצא קשור להימנעות',
};

export const PRESETS = {
  ten:   { label: RECOMMENDED.label, times: RECOMMENDED.times },
  six:   { label: '6 ביום · כל ~2 שעות ערות', times: ['07:30', '10:00', '12:30', '15:00', '17:30', '20:00'] },
  five:  { label: '5 ביום',                     times: ['07:30', '10:30', '13:30', '17:00', '20:00'] },
  four:  { label: '4 ביום',                     times: ['07:30', '11:30', '15:30', '19:30'] },
  three: { label: '3 ביום · בוקר + שני מוקשים', times: ['07:30', '13:00', '18:30'] },
  two:   { label: '2 ביום · בוקר + חלון הסיכון', times: ['07:30', '18:00'] },
  one:   { label: '1 ביום · בוקר בלבד',          times: ['07:30'] },
};

export const DEFAULT_PLAN = {
  on: true,
  times: RECOMMENDED.times,
  // התצמצום נקבע ל-15.9 — היום שאחרי המדבקה האחרונה. עד אז המסטיק הוא
  // רשת הביטחון של ירידות המדבקה, ולא מורידים שתי רשתות במקביל.
  // ב-15.9 הבוט שואל אם המצב יציב, ומאפשר לדחות.
  taperStartISO: '2026-09-15',
  stepDays: 4,           // יחידה אחת פחות כל 4 ימים
  confirmedTaper: false, // האם אישר שהוא מוכן להתחיל לצמצם
};

const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
export const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const sortTimes = ts => [...new Set(ts)].sort((a, b) => toMin(a) - toMin(b));

/**
 * השעות הפעילות היום, אחרי החלת התצמצם.
 * סדר הנטישה: מהמאוחר לכיוון הבוקר — והבוקר לעולם לא נופל.
 */
export function activeTimes(plan, iso) {
  const all = sortTimes(plan.times || []);
  if (!all.length) return [];
  // התצמצום לא מתחיל מעצמו בתאריך. הוא דורש אישור מפורש שהמצב יציב,
  // כי התנאי בתוכנית הוא מצב ולא תאריך — "אם צריך להתאמץ כדי להפחית,
  // עוד לא הזמן". בלי אישור נשארים על המספר המלא, וזו הכשל הבטוח.
  if (!plan.taperStartISO || !plan.confirmedTaper) return all;

  const days = diffDays(plan.taperStartISO, iso);
  if (days < 0) return all;
  const drop = Math.floor(days / Math.max(1, plan.stepDays || 4));
  if (drop <= 0) return all;

  const dropOrder = all.slice(1).reverse();               // הבוקר לא ברשימה
  const dropped = new Set(dropOrder.slice(0, Math.min(drop, all.length - 1)));
  return all.filter(t => !dropped.has(t));
}

/** מתי תיפול היחידה הבאה, ולאיזה יעד — לתצוגה */
export function taperInfo(plan, iso) {
  if (!plan.taperStartISO) return null;
  if (!plan.confirmedTaper) {
    return { pending: true, active: sortTimes(plan.times || []).length,
             start: sortTimes(plan.times || []).length, step: Math.max(1, plan.stepDays || 4),
             dropsSoFar: 0, atFloor: false, nextDropISO: null, nextToGo: null };
  }
  const all = sortTimes(plan.times || []);
  const active = activeTimes(plan, iso);
  const step = Math.max(1, plan.stepDays || 4);
  const days = Math.max(0, diffDays(plan.taperStartISO, iso));
  const dropsSoFar = Math.floor(days / step);
  const atFloor = active.length <= 1;
  return {
    active: active.length,
    start: all.length,
    step,
    dropsSoFar,
    atFloor,
    nextDropISO: atFloor ? null : addDaysISO(plan.taperStartISO, (dropsSoFar + 1) * step),
    nextToGo: atFloor ? null : active[active.length - 1],
  };
}

/**
 * דקות שעברו מאז המסטיק האחרון היום, או null אם לא היה.
 * משמש כדי לא להזכיר יחידה מתוזמנת דקות אחרי שנלקחה יחידה נוספת.
 */
export function minutesSinceLastGum(day, nowMinutes) {
  const gs = (day.ev || []).filter(e => e.k === 'g');
  if (!gs.length) return null;
  const last = gs[gs.length - 1];
  const diff = nowMinutes - (last.h * 60 + last.m);
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

export function readiness(last7, prev7, target = 10) {
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
  const badQuality = passRate !== null && waves >= 4 && passRate < 60;
  if (badQuality)
    reasons.push(`מתוך ${waves} דחפים בשבוע, רק ${passRate}% עברו בלי שנדרש כלום`);
  else if (waves >= WAVES_HIGH && (passRate === null || passRate < 80))
    reasons.push(`${waves} דחפים בשבוע${passRate === null ? '' : ` ורק ${passRate}% עברו`} — עוד תכוף`);
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
  if (enough && nowAvg <= target - 1 && nowAvg > 0)
    signals.push(`${nowAvg} ביום — כבר מתחת ליעד ${target}`);
  if (enough && prevWaves > 0 && waves <= prevWaves - 2)
    signals.push(`פחות דחפים משבוע שעבר (${prevWaves} → ${waves})`);
  if (enough && passRate !== null && passRate >= 80 && waves >= 3)
    signals.push(`${passRate}% מהדחפים עברו בלי שנדרש כלום`);
  if (coverage === 7 && prevCoverage >= COVERAGE_MIN)
    signals.push('שבועיים של תיעוד רציף');

  const ready = reasons.length === 0;
  return {
    nowAvg, prevAvg, extra, waves, prevWaves, surfed, slips, passRate,
    coverage, prevCoverage, declining, target,
    ready, reasons, signals,
    confidence: !ready ? 'none' : signals.length >= 3 ? 'strong' : signals.length >= 1 ? 'ok' : 'weak',
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
  const coverage = last7.filter(isLogged).length;
  if (coverage < COVERAGE_MIN) return null;   // בלי כיסוי לא מסיקים החמרה

  const waves = sum(last7, 'waves');
  const slips = sum(last7, 'slips');
  const enroute = sum(last7, 'enroute');
  const planning = sum(last7, 'planning');

  const worse = [];
  if (slips > 0)                      worse.push(`${slips} מעידות`);
  if (enroute > 0)                    worse.push(`${enroute} פעמים בדרך לקנות`);
  if (waves >= (baseline.waves || 0) + 5) worse.push(`הדחפים עלו (${baseline.waves} → ${waves} בשבוע)`);
  if (planning >= 3)                  worse.push(`${planning} פעמים שהמחשבות חיפשו דרך לצאת`);

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

export const MIN_GAP = 60;     // לא מזכירים בתוך שעה מהיחידה האחרונה
export const MAX_GAP = 150;    // ואחרי שעתיים וחצי בלי כלום — מזכירים בכל מקרה
export const GAP_REMIND = 60;  // מרווח מינימלי בין תזכורות שנענו
export const BACKOFF = 90;     // ואחרי תזכורת שלא נענתה — נסיגה ארוכה יותר

/** היעד היומי: מספר היחידות הפעילות אחרי התצמצם */
export const dailyTarget = (plan, iso) => activeTimes(plan, iso).length;

/** חלון הערות: מהיחידה הראשונה בתוכנית ועד האחרונה */
export function windowOf(plan) {
  const all = sortTimes(plan.times || []);
  if (!all.length) return { start: 7 * 60 + 30, end: 21 * 60 };
  return { start: toMin(all[0]), end: toMin(all[all.length - 1]) };
}

/**
 * האם מגיעה תזכורת עכשיו — ולמה.
 * מחזיר גם את המספרים, כדי שההודעה תוכל להסביר את עצמה.
 */
export function dueNow(plan, iso, day, nowMinutes, lastRemindMin = null) {
  const target = dailyTarget(plan, iso);
  const taken = day.gum || 0;
  const { start, end } = windowOf(plan);
  const since = minutesSinceLastGum(day, nowMinutes);

  const base = { target, taken, since, start, end };
  if (!plan.on || target === 0)      return { ...base, due: false, why: 'off' };
  if (taken >= target)               return { ...base, due: false, why: 'הושלם היעד' };
  if (nowMinutes < start)            return { ...base, due: false, why: 'לפני תחילת החלון' };
  if (nowMinutes > end + 45)         return { ...base, due: false, why: 'אחרי סוף החלון' };

  // אף פעם לא בתוך MIN_GAP מהיחידה האחרונה — גם אם היא נלקחה מחוץ לתוכנית
  if (since !== null && since < MIN_GAP) return { ...base, due: false, why: `נלקח לפני ${since} דק׳` };

  // נסיגה — לפני כל ענף שמחזיר due, כולל "פער ארוך מדי". תזכורת שלא
  // הובילה ליחידה לא חוזרת אחרי 45 דקות; אם מאז התזכורת האחרונה לא
  // נלקח כלום ממתינים BACKOFF במקום GAP_REMIND. כשהבדיקה הזו ישבה
  // *אחרי* ענף MAX_GAP, יום איטי עקף אותה וייצר 20 תזכורות — בדיוק מה
  // שגורם לאנשים להשתיק בוט.
  if (lastRemindMin !== null && lastRemindMin !== undefined) {
    const gumSinceRemind = (day.ev || [])
      .some(e => e.k === 'g' && (e.h * 60 + e.m) >= lastRemindMin);
    const wait = gumSinceRemind ? GAP_REMIND : BACKOFF;
    if (nowMinutes - lastRemindMin < wait) {
      return { ...base, due: false, why: gumSinceRemind ? 'תזכורת לפני פחות משעה' : 'ממתין — התזכורת הקודמת לא נענתה' };
    }
  }

  // עבר יותר מדי זמן בלי כלום — מזכירים בלי קשר לקצב
  if (since !== null && since >= MAX_GAP) return { ...base, due: true, why: 'פער ארוך מדי' };
  if (since === null && nowMinutes >= start + MIN_GAP) return { ...base, due: true, why: 'עוד לא היה מסטיק היום' };

  // אחרת — רק אם אנחנו מתחת לקצב הדרוש
  const span = Math.max(1, end - start);
  const expected = Math.min(target, Math.floor(((nowMinutes - start) / span) * target) + 1);
  return { ...base, expected, due: taken < expected, why: taken < expected ? `בקצב צריך ${expected}, יש ${taken}` : 'בקצב' };
}

/** התזכורת המסתגלת */
export function reminderText(time, plan, iso, day, index, total) {
  const isMorning = (day.gum || 0) === 0;
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
