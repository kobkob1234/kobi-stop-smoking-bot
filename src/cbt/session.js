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

/** כמה תורות סשן אחד יכול לקחת לפני שנעצרים. גדר בטיחות, לא יעד. */
export const MAX_TURNS = 24;

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
  const next = S.recordBct(cbt, tool.id, r.captured || null);
  return { cbt: next, reply: r.text, mode: r.mode, captured: r.captured || null,
           sources: r.sources || [], trace: r.trace || [] };
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

/** האם עברנו את גדר הבטיחות */
export const exhausted = turns => turns.length >= MAX_TURNS;
