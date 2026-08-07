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
  formulation: null,       // הדפוס שזוהה — נבנה על פני סשנים
  notes: [],               // [{id, iso, bcts, score, missed}]
  active: null,            // סשן שרץ עכשיו
};

/** מיגרציה — אותו דפוס כמו PLAN_VER, רץ בכל קריאה ולא רק בשדרוג */
export function migrateCbt(cbt) {
  if (!cbt) return { ...EMPTY_CBT };
  const out = { ...EMPTY_CBT, ...cbt, ver: CBT_VER };
  // שדות מערך שהגיעו כ-null מ-KV ישן היו מפילים כל .length בהמשך
  for (const k of ['sessionsDone', 'triggers', 'pastAttempts', 'confidence', 'notes']) {
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
  return {
    ...cbt,
    sessionsDone: [...cbt.sessionsDone, cbt.active.id],
    notes: [...cbt.notes, note].slice(-20),
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
  if (last && last.missed.length) bits.push({ kind: 'missed', items: last.missed });
  return bits;
}

/** האם הפרוטוקול בכלל התחיל */
export const started = cbt => !!cbt.startISO;
