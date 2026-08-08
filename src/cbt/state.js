// ==========================================================================
//  state.js — הרצף בין הסשנים
//
//  זה מה שמפריד בין "שיחה שבועית" לבין טיפול. סשן שנפתח מאפס שואל שוב
//  את מה שכבר נענה, ומאבד את הדפוס שנבנה. הרצף אינו נוחות — הוא
//  התנאי לפורמולציה.
//
//  **שתי צורות ל-state, ובכוונה:**
//
//    `meta.cbt`     — מה שנשמר. כולל **תוכן**: מה נאמר, מה היו שיעורי
//                     הבית, אילו טריגרים זוהו. בלי זה אין רצף.
//    `toolState()`  — מה שנשלח למודל. **מספרים בלבד**, בלי שם ובלי
//                     טקסט יומן. ההחלטה על הספק נפלה לטובת יכולת על
//                     פני פרטיות, ודווקא לכן מה שיוצא מצומצם.
//
//  הפרדה זו היא גם מה שמאפשר להחליף ספק בלי לגעת במה שנשמר.
// ==========================================================================

import { QUIT, diffDays } from '../plan.js';
import { byId, canComplete, fidelity } from './protocol.js';

export const CBT_VER = 1;

export const EMPTY_CBT = {
  ver: CBT_VER,
  startISO: null,
  sessionsDone: [],        // ['intake', 'wk3', 'maint:0']
  triggers: [],            // תוכן — מה שזוהה
  pastAttempts: [],        // תוכן
  dependence: null,        // זמן עד השאיפה הראשונה, כשעוד ויפ
  confidence: [],          // [{iso, v}] — היסטוריה, כי המגמה היא הסיגנל
  homework: null,          // {text, assignedISO, dueISO, done}
  // **היסטוריה ולא שדה יחיד.** שדה יחיד מוחק את הדפוס הקודם בכל
  // עדכון, ואז אי אפשר לראות איך הוא נע — וזו בדיוק התנועה שמעניינת.
  formulations: [],        // [{iso, text}] — הדפוס לאורך זמן
  notes: [],               // [{id, iso, bcts, score, missed}]
  active: null,            // סשן שרץ עכשיו
};

/**
 * רק השדות שמצב CBT באמת מכיל.
 *
 * `migrateCbt` הוא `{...EMPTY_CBT, ...cbt}` ולכן **משמר כל מפתח זר**.
 * דגל `force: true` שנשלח פעם אחת נכתב ל-KV, חזר ב-GET, ונשמר לקובץ
 * שבגיט — דגל חד-פעמי שהפך למצב קבוע. כל קלט חיצוני עובר דרך כאן.
 */
export const pickCbtFields = (o) => {
  const out = {};
  if (!o || typeof o !== 'object') return out;
  for (const k of Object.keys(EMPTY_CBT)) if (k in o) out[k] = o[k];
  return out;
};

/** מיגרציה — אותו דפוס כמו PLAN_VER, רץ בכל קריאה ולא רק בשדרוג */
export function migrateCbt(cbt) {
  if (!cbt) return { ...EMPTY_CBT };
  const out = { ...EMPTY_CBT, ...cbt, ver: CBT_VER };
  // שדות מערך שהגיעו כ-null מ-KV ישן היו מפילים כל .length בהמשך
  for (const k of ['sessionsDone', 'triggers', 'pastAttempts', 'confidence', 'notes', 'formulations']) {
    if (!Array.isArray(out[k])) out[k] = [];
  }
  return out;
}

// ==========================================================================
//  הגשר אל הכלים
// ==========================================================================

/**
 * ה-state המספרי שהכלים והמודל מקבלים.
 *
 * `days` הוא הפלט של ANL.collect — 14 הימים האחרונים, החדש ראשון.
 * שום שדה טקסט חופשי אינו עובר לכאן חוץ מטריגרים, שהם קצרים, נבחרים
 * במפורש, והם **הדבר היחיד שבלעדיו כלי ההתמודדות מייצר שאלה מופשטת**.
 */
export function toolState(cbt, days, plan, iso) {
  const last7 = days.slice(0, 7);
  const sum = k => last7.reduce((t, d) => t + (d[k] || 0), 0);
  const med = k => {
    const v = days.map(d => d[k] || 0).filter(x => x > 0).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : null;
  };
  const conf = cbt.confidence.length ? cbt.confidence[cbt.confidence.length - 1].v : null;
  return {
    iso,
    dayNum: Math.max(0, diffDays(QUIT, iso) + 1),
    cleanDays: plan?.clean ?? plan?.cleanDays ?? 0,
    gum7: sum('gum'),
    gumTarget: plan?.gumTarget ?? 0,
    patchDays7: last7.filter(d => d.patch).length,
    mood: med('mood'),
    fatigue: med('fatigue'),
    waves7: sum('waves'),
    slips7: sum('slips'),
    triggers: cbt.triggers.slice(0, 3),
    pastAttempts: cbt.pastAttempts.slice(0, 2),
    confidence: conf,
    homework: cbt.homework && !cbt.homework.done ? cbt.homework.text : null,
    sessionsDone: cbt.sessionsDone,
    taperStarted: !!plan?.confirmedTaper,
  };
}

// ==========================================================================
//  מחזור החיים של סשן
// ==========================================================================

export function startSession(cbt, sessionId, iso) {
  const s = byId(sessionId);
  if (!s) throw new Error(`סשן לא מוכר: ${sessionId}`);
  return {
    ...cbt,
    startISO: cbt.startISO || iso,
    active: {
      id: sessionId, iso,
      remaining: s.checklist.map(c => c.bct),
      done: [],
      captured: {},        // מה שנאמר, לפי כלי
    },
  };
}

/**
 * רישום כלי שרץ.
 *
 * `value` נשמר רק כשיש מה לשמור — תשובה שנקלטה. כלי הצהרתי מסומן
 * כבוצע בלי תוכן, וזה נכון: אין שם מה לזכור.
 */
export function recordBct(cbt, bct, value = null) {
  if (!cbt.active) return cbt;
  const a = cbt.active;
  const out = {
    ...cbt,
    active: {
      ...a,
      remaining: a.remaining.filter(b => b !== bct),
      done: a.done.includes(bct) ? a.done : [...a.done, bct],
      captured: value ? { ...a.captured, [bct]: value } : a.captured,
    },
  };
  return applyCapture(out, bct, value);
}

/**
 * תשובה שנקלטה מזינה את ה-state הקבוע, לא רק את הסשן.
 *
 * בלי זה טריגר שזוהה בסשן אחד נעלם בסשן הבא, וכלי ההתמודדות חוזר
 * לשאול "איזה טריגר" — כלומר הרצף נשבר בדיוק במקום שהוא נחוץ.
 */
function applyCapture(cbt, bct, value) {
  if (!value) return cbt;
  const txt = String(value).trim().slice(0, 200);
  if (!txt) return cbt;
  switch (bct) {
    case 'identify-triggers':
      return cbt.triggers.includes(txt) ? cbt : { ...cbt, triggers: [...cbt.triggers, txt].slice(-5) };
    case 'past-attempts':
      return { ...cbt, pastAttempts: [...cbt.pastAttempts, txt].slice(-3) };
    case 'assess-dependence':
      return { ...cbt, dependence: txt };
    case 'assess-readiness': {
      const v = parseInt(txt, 10);
      if (isNaN(v) || v < 0 || v > 10) return cbt;
      return { ...cbt, confidence: [...cbt.confidence, { iso: cbt.active?.iso, v }].slice(-12) };
    }
    case 'summary-and-homework':
      return { ...cbt, homework: { text: txt, assignedISO: cbt.active?.iso, done: false } };
    default:
      return cbt;
  }
}

/** סימון שיעורי הבית כבוצעו — נשאל בסשן הבא */
export const markHomeworkDone = cbt =>
  cbt.homework ? { ...cbt, homework: { ...cbt.homework, done: true } } : cbt;

/**
 * סגירת סשן.
 *
 * נסגר גם כשלא כל פריטי החובה בוצעו — אחרת סשן תקוע חוסם את כל הבאים
 * אחריו לנצח. אבל **הציון והחוסרים נרשמים**, וזו כל הנקודה: סשן חלקי
 * מותר, סשן חלקי שמתחזה לשלם — לא.
 */
export function completeSession(cbt, iso) {
  if (!cbt.active) return cbt;
  const s = byId(cbt.active.id);
  const f = fidelity(s, cbt.active.done);
  const note = {
    id: cbt.active.id, iso,
    bcts: cbt.active.done,
    score: f.score,
    missed: f.missed,
    complete: canComplete(s, cbt.active.done).ok,
  };
  // ═══ סגירה כפולה לא נספרת פעמיים ═══
  //
  // `finish` בסוכן בודק רק את ה-`active` המקומי. אם הסשן כבר נסגר
  // בטלגרם, הסגירה השנייה הוסיפה `maint:0` פעם נוספת — ו-`dueSession`
  // סופר לפי קידומת, כך שכל כפילות **דוחה את הסשן הבא בשבוע**.
  // `fidelityReport` גם ספר את ההערה פעמיים.
  const dup = cbt.sessionsDone.includes(cbt.active.id);
  return {
    ...cbt,
    sessionsDone: dup ? cbt.sessionsDone : [...cbt.sessionsDone, cbt.active.id],
    notes: dup ? cbt.notes : [...cbt.notes, note].slice(-20),
    active: null,
  };
}

// ==========================================================================
//  הפתיחה שמייצרת את תחושת הרצף
// ==========================================================================

/**
 * מה להזכיר בפתיחת הסשן.
 *
 * זה החלק שהופך רצף מנתון טכני לחוויה: הסשן נפתח בהתייחסות למה שנאמר
 * בפעם הקודמת ולמה שנשאר פתוח — ולא בשאלה גנרית.
 */
export function openingContext(cbt, iso) {
  const bits = [];
  const last = cbt.notes[cbt.notes.length - 1];
  if (last) {
    const gap = diffDays(last.iso, iso);
    bits.push({ kind: 'last', id: last.id, daysAgo: gap, score: last.score });
  }
  if (cbt.homework && !cbt.homework.done) {
    bits.push({ kind: 'homework', text: cbt.homework.text,
                daysAgo: diffDays(cbt.homework.assignedISO, iso) });
  }
  if (cbt.confidence.length >= 2) {
    const c = cbt.confidence;
    bits.push({ kind: 'confidence', from: c[c.length - 2].v, to: c[c.length - 1].v });
  }
  const f = latestFormulation(cbt);
  if (f) bits.push({ kind: 'formulation', text: f });
  if (last && last.missed.length) bits.push({ kind: 'missed', items: last.missed });
  return bits;
}

/**
 * שמירת דפוס חדש.
 *
 * הפורמולציה נבנתה ב-engine ו**מעולם לא נשמרה** — `formulate()` נקראה
 * רק מטסטים, ו-`cbt.formulation` הוצהר ולא נכתב. תרגיל שאיש לא קרא את
 * תוצאתו. זו הפונקציה שסוגרת את זה.
 */
export function recordFormulation(cbt, text, iso) {
  if (!text) return cbt;
  return { ...cbt, formulations: [...cbt.formulations, { iso, text }].slice(-8) };
}

/** הדפוס האחרון, או null */
export const latestFormulation = cbt =>
  cbt.formulations.length ? cbt.formulations[cbt.formulations.length - 1].text : null;

/** האם הפרוטוקול בכלל התחיל */
export const started = cbt => !!cbt.startISO;

// ==========================================================================
//  נאמנות לאורך זמן — הנתון שנרשם ואיש לא קרא
//
//  `notes` נכתב בסגירת כל סשן — ציון, פריטים שדולגו, האם הושלם — ואת
//  התוצאה קראה רק `openingContext`, ורק את האחרון. כלומר נאסף כאן מדד
//  איכות ולא הייתה שום דרך לראות אותו.
//
//  זה חשוב מעבר לתצוגה: **סשן שמדלג על פריטי חובה הוא סשן שנראה
//  כמו טיפול ואינו טיפול**, וירידה מתמשכת בציון היא בדיוק הסימן לכך.
//  לכן יש כאן גם סף שנכשל בקול ולא רק מספר.
// ==========================================================================

/** מתחת לזה הפרוטוקול אינו באמת רץ */
export const FIDELITY_FLOOR = 0.7;

/**
 * תמונת הנאמנות: ממוצע, מגמה, ומה נשמט הכי הרבה.
 *
 * המגמה נמדדת על שלושה אחרונים מול הקודמים — לא על שניים, כי סשן
 * חלש בודד הוא רעש ולא כיוון.
 */
export function fidelityReport(cbt) {
  const n = cbt.notes || [];
  if (!n.length) return null;
  const avg = a => a.reduce((t, x) => t + x.score, 0) / a.length;
  const recent = n.slice(-3);
  const prior = n.slice(0, -3);
  const missed = {};
  for (const x of n) for (const m of x.missed || []) missed[m] = (missed[m] || 0) + 1;
  return {
    sessions: n.length,
    last: n[n.length - 1].score,
    avg: +avg(n).toFixed(2),
    recentAvg: +avg(recent).toFixed(2),
    trend: prior.length ? +(avg(recent) - avg(prior)).toFixed(2) : null,
    below: avg(recent) < FIDELITY_FLOOR,
    topMissed: Object.entries(missed).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([bct, times]) => ({ bct, times })),
    incomplete: n.filter(x => !x.complete).length,
  };
}

/** משפט אחד לתצוגה, או null כשאין מספיק היסטוריה */
export function fidelityLine(cbt) {
  const r = fidelityReport(cbt);
  if (!r) return null;
  const pct = x => Math.round(x * 100) + '%';
  const bits = [`${r.sessions} סשנים · נאמנות ${pct(r.avg)}`];
  if (r.trend !== null && Math.abs(r.trend) >= 0.05) {
    bits.push(`${r.trend > 0 ? '↑' : '↓'} ${pct(Math.abs(r.trend))} לאחרונה`);
  }
  if (r.below) bits.push(`⚠️ ${pct(r.recentAvg)} בשלושה האחרונים — מתחת לסף`);
  if (r.topMissed.length && r.topMissed[0].times >= 2) {
    bits.push(`נשמט הכי הרבה: ${r.topMissed[0].bct}`);
  }
  return bits.join(' · ');
}

/**
 * ההחלטה של `/cbt-state` POST — **מחוץ ל-I/O, ולכן נבדקת**.
 *
 * ═══ למה זה חולץ ═══
 *
 * ההחלטה ישבה בתוך ה-handler, וה-worker המדומה בבדיקות שכפל אותה
 * במקום להריץ אותה. שתי מוטציות על ההגנה האמיתית עברו — כי מה שנבדק
 * היה ההעתק. מוק ששוכפל ממנו הקוד עובר בדיוק כשהמקור נשבר.
 *
 * מחזיר `{cbt}` לכתיבה, או `{conflict}` ל-409.
 */
export function applyCbtPush(current, body) {
  const cur = migrateCbt(current);
  if (!body || !Array.isArray(body.sessionsDone)) return { bad: true };
  // סשן פתוח בבוט אינו נדרס. התנאי הקודם בדק `!b.active` בלבד, כלומר
  // התיר **החלפה** של סשן פתוח וחסם רק מחיקה.
  const a = body.active;
  const clash = !!cur.active &&
    (!a || a.id !== cur.active.id || a.iso !== cur.active.iso);
  if (clash && !body.force) {
    return { conflict: true, why: 'סשן פתוח בבוט', active: cur.active.id };
  }
  // רק מפתחות מוכרים — אחרת `force` וכל שדה זר נשמרים לנצח.
  return { cbt: migrateCbt(pickCbtFields(body)) };
}
