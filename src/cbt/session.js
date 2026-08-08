// ==========================================================================
//  session.js — הסשן כפי שהוא רץ בבוט
//
//  זה החוליה שחסרה: `protocol` יודע מה צריך לרוץ, `tools` יודע מה
//  לשאול, `engine` יודע איך להגיב — ואף אחד מהם לא ידע **מתי תור
//  מסתיים ומתי הסשן נגמר**. הלוגיקה הזו ישבה עד עכשיו רק בסקריפט
//  של הסוכן, כלומר בבוט לא היה סשן בכלל.
//
//  **בלי I/O.** כל פונקציה כאן מקבלת מצב ומחזירה מצב + מה לשלוח.
//  זה מה שמאפשר לבדוק סשן שלם בלי טלגרם, בלי KV ובלי מפתח.
// ==========================================================================

import * as P from './protocol.js';
import * as T from './tools.js';
import * as S from './state.js';
import { runTurn, describeOpening, formulate } from './engine.js';

/**
 * כמה פעמים מנסים כלי שהמודל נכשל עליו לפני שמוותרים.
 *
 * שתי דרישות מתנגשות: כשל חולף לא אמור לשרוף פריט צ׳קליסט, וכשל קבוע
 * לא אמור לתקוע את הסשן על אותה שאלה לנצח.
 */
export const MAX_TRIES = 2;

/** מונה ניסיונות לכלי — בתוך `active`, ולכן נמחק עם סגירת הסשן */
const withTry = (cbt, id, n) => (cbt.active
  ? { ...cbt, active: { ...cbt.active, tries: { ...(cbt.active.tries || {}), [id]: n } } }
  : cbt);

/** פתיחה: מה להגיד כשהסשן מתחיל */
export function openSession(cbt, iso) {
  if (cbt.active) return { error: 'active', id: cbt.active.id };
  const due = P.dueSession(iso, cbt.sessionsDone, cbt.startISO || iso);
  if (!due) {
    const next = P.scheduleFor(cbt.startISO || iso)
      .find(s => !cbt.sessionsDone.includes(s.id));
    return { error: 'none-due', nextISO: next ? next.dueISO : null };
  }
  const out = S.startSession(cbt, due.id, iso);
  return {
    cbt: out,
    session: due,
    opening: S.openingContext(out, iso).map(describeOpening).filter(Boolean),
  };
}

/**
 * הכלי הבא, או null אם הסשן מיצה את הצ׳קליסט.
 *
 * `state` הוא הפלט של `toolState` — מספרים בלבד.
 */
export function nextStep(cbt, state) {
  if (!cbt.active) return null;
  return T.nextTool(state, cbt.active.remaining) || null;
}

/**
 * תור אחד: מריץ את הכלי, רושם את מה שנקלט, ומחזיר מצב חדש.
 *
 * `call` ו-`retrieve` מוזרקים — בבוט זה ג׳מיני ו-KV, בבדיקות זה כלום.
 *
 * **הרישום קורה גם כשהמודל נכשל.** תור שלא נרשם משאיר את הכלי
 * ב-`remaining` לנצח, והסשן נתקע על אותה שאלה — כישלון רשת שהופך
 * לסשן שאי אפשר לסיים.
 */
export async function runStep(cbt, tool, state, userText, { call, retrieve = null,
                                                            turns = [] } = {}) {
  const r = await runTurn({
    tool, state, userText, call, retrieve, turns,
    opening: S.openingContext(cbt, state.iso),
    formulation: S.latestFormulation(cbt),
  });
  // ═══ מה נחשב "הכלי בוצע" ═══
  //
  //  `halt`   — עצירת בטיחות. לא תשובה, ולכן לא נרשם.
  //  `failed` — המודל לא החזיר ניסוח. הפריט נרשם כבוצע ו-`fidelity`
  //             דיווח 100% על סשן שלא נאמר בו דבר: מפתח מבוטל ⇒ שבע
  //             הודעות "לא הצלחתי לנסח תגובה" ⇒ "נאמנות 100%".
  //
  // **אבל לא לולאה.** אי-רישום לבדו מחזיר את אותו כלי לנצח כשהמודל
  // מושבת. לכן נספרים ניסיונות, ואחרי `MAX_TRIES` הכלי מסומן כבוצע
  // עם `partial` — כלומר מדולג ביודעין ולא מוסתר.
  const tries = (cbt.active?.tries?.[tool.id] || 0) + 1;
  let next;
  if (r.mode === 'halt') {
    next = cbt;                                  // עצירת בטיחות — כלום לא זז
  } else if (r.mode === 'failed') {
    // ניסיון נוסף, ואחרי `MAX_TRIES` **מדלגים בלי לסמן כבוצע** — אחרת
    // `fidelity` סופר אותו כהושלם וההודעה "יסומן כנשמט" היא שקר.
    next = tries < MAX_TRIES
      ? withTry(cbt, tool.id, tries)
      : S.skipBct(withTry(cbt, tool.id, tries), tool.id);
  } else {
    next = S.recordBct(cbt, tool.id, r.captured || null);
  }
  // `revised`/`verified`/`kind` חושבו במנוע ונזרקו כאן — כלומר הביקורת
  // השנייה ו-שלוש מארבע קטגוריות ה-triage היו קריאות מודל בלי צרכן.
  return { cbt: next, reply: r.text, mode: r.mode, tries, captured: r.captured || null,
           sources: r.sources || [], trace: r.trace || [],
           revised: !!r.revised, verified: r.verified !== false, kind: r.kind || null };
}

/**
 * סגירה. מנסח דפוס אם יש ממה, ותמיד רושם ציון נאמנות.
 *
 * **נסגר גם בלי פורמולציה ובלי כל פריטי החובה** — אחרת סשן תקוע חוסם
 * את כל הבאים אחריו. אבל הציון והחוסרים נרשמים, וזו כל הנקודה.
 */
export async function closeSession(cbt, state, { call = null, turns = [] } = {}) {
  if (!cbt.active) return { error: 'no-active' };
  const sess = P.byId(cbt.active.id);
  const fid = P.fidelity(sess, cbt.active.done);
  let pattern = null;
  if (call && turns.length >= 3) {
    try {
      const f = await formulate({ state, turns, call,
                                  priorFormulation: S.latestFormulation(cbt) });
      pattern = f && !/^NONE\b/i.test(String(f).trim()) ? String(f).trim().slice(0, 240) : null;
    } catch { pattern = null; }
  }
  let out = pattern ? S.recordFormulation(cbt, pattern, state.iso) : cbt;
  out = S.completeSession(out, state.iso);
  return { cbt: out, fidelity: fid, formulation: pattern, id: sess.id };
}

/**
 * גדר הבטיחות של אורך הסשן.
 *
 * נספר מול `captured`, שהוא אובייקט לפי מזהה כלי וחסום בגודל הצ׳קליסט
 * (6–8) — כלומר 24 היה בלתי-מושג והגדר מעולם לא יכלה לירות. עכשיו
 * נספרים גם הניסיונות החוזרים, שהם המקרה היחיד שבו תור אינו מקדם.
 */
export const exhausted = (turns, cbt = null) => {
  const retries = Object.values(cbt?.active?.tries || {}).reduce((t, n) => t + n, 0);
  return turns.length + retries >= MAX_TURNS;
};

/** כמה תורות סשן אחד יכול לקחת לפני שנעצרים */
export const MAX_TURNS = 24;
