// ==========================================================================
//  retrieve.js — בחירת מקטעים מהספרייה
//
//  **מה שונה כאן מ-RAG רגיל: המערכת יודעת איזו טכניקה היא מפעילה
//  ברגע זה.** הפרוטוקול מחזיק את ה-BCT של הכלי הפעיל ממילא, והאינדקס
//  מתייג את המקטעים באותה טקסונומיה. זה סיגנל חזק בהרבה מחפיפת
//  מילים, וזמין בלי אף חישוב.
//
//  חפיפת מילים לבדה גם לא הייתה עובדת: השיחה בעברית, הקורפוס
//  באנגלית. לכן שלב ה-fetch מתבקש במפורש להחזיר מונחים באנגלית —
//  ראו `FETCH_ASK`. בלי זה החפיפה תמיד אפס, והדירוג היה נשען על
//  ה-BCT בלבד בלי שאיש היה מבחין.
//
//  **שתי שכבות, כפי שתוכנן:** האינדקס (58KB) נטען תמיד ומאפשר לבחור
//  בלי אף קריאת רשת. רק המקטעים שנבחרו נקראים מ-KV.
// ==========================================================================

import { LIBRARY } from './library.js';

/**
 * תקציב מילים לאחזור.
 *
 * "מעבירים 2–4 פרקים במלואם" הניח פיזור אחיד. בפועל המקטעים נעים בין
 * 138 ל-26,844 מילים, וארבעה גדולים הם ~140k טוקנים בקריאה אחת — בתוך
 * החלון, אבל איטי ומטביע את השאלה עצמה ברעש.
 */
export const WORD_BUDGET = 6000;
export const MAX_SECTIONS = 3;

/** ניקוד: BCT כבד · ספר ייעודי כבד · חפיפת מונחים בינונית · סוג קל */
export const W = { bct: 10, smoking: 6, term: 2, kind: 1.5, title: 4 };

/**
 * הספרים שנכתבו על גמילה, להבדיל מ-CBT כללי.
 *
 * בלי ההבחנה הזו `identify-triggers` החזיר דף עבודה על OCD ומילון
 * מונחים: "trigger" הוא מונח קליני נפוץ, והתג לבדו קשר את כולם באותו
 * ציון. ההטיה כאן אינה העדפה שרירותית — זו התערבות לגמילה, וספרות
 * ה-CBT הכללית היא הרובד המשלים ולא הראשי.
 *
 * המשקל מכוון שלא להכריע: מקטע כללי עם חפיפת מונחים טובה עדיין מנצח
 * מקטע ייעודי שרק נושא את התג.
 */
export const SMOKING_BOOKS = new Set(['ncsct-stp', 'green-lynn-smoking']);

/** מה לבקש מהמודל בשלב ה-fetch — באנגלית, כי הקורפוס באנגלית */
export const FETCH_ASK =
  'אילו מושגים מספרות ה-CBT יעזרו לענות? החזר 2–4 מונחי חיפוש ' +
  '**באנגלית בלבד**, מופרדים בפסיק, בלי הסבר. הספרייה באנגלית ולכן ' +
  'מונחים בעברית לא ימצאו דבר.';

const norm = s => String(s || '').toLowerCase();

/** מונחי החיפוש מתוך תשובת המודל — מילים באנגלית באורך סביר */
export function queryTerms(want) {
  return [...new Set(norm(want).match(/[a-z][a-z'-]{2,}/g) || [])].slice(0, 12);
}

/**
 * הדירוג. **טהור** — בלי KV ובלי רשת, ולכן נבדק ישירות.
 *
 * `bct` הוא הטכניקה שרצה עכשיו; `kindWanted` הוא סוג המקטע שמתאים
 * לשלב (תרגיל בסשן עבודה, תיאוריה בהסבר).
 */
export function pickSections(want, { bct = null, kindWanted = null,
                                     budget = WORD_BUDGET, max = MAX_SECTIONS,
                                     library = LIBRARY } = {}) {
  const q = queryTerms(want);
  const scored = [];
  for (const e of library) {
    let sc = 0;
    if (bct && e.bcts.includes(bct)) sc += W.bct;
    if (sc && SMOKING_BOOKS.has(e.book)) sc += W.smoking;
    for (const t of q) {
      if (e.terms.includes(t)) sc += W.term;
      if (norm(e.title).includes(t)) sc += W.title;
    }
    if (kindWanted && e.kind === kindWanted) sc += W.kind;
    if (sc > 0) scored.push({ e, sc });
  }
  // דירוג משני לפי אורך: בציון שווה, מקטע קצר יותר משאיר מקום לעוד
  // אחד בתוך התקציב — כלומר יותר כיסוי באותו מחיר.
  scored.sort((a, b) => b.sc - a.sc || a.e.words - b.e.words);

  const out = [];
  let spent = 0;
  for (const { e, sc } of scored) {
    if (out.length >= max) break;
    // מקטע שחורג לבדו עדיין נבחר — הוא ייחתך בקריאה. לדלג עליו היה
    // אומר שהמקטע החזק ביותר בקורפוס אף פעם לא נבחר רק בגלל אורכו.
    if (spent && spent + e.words > budget) continue;
    out.push({ ...e, score: sc });
    spent += e.words;
  }
  return out;
}

/**
 * חיתוך בגבול פסקה.
 *
 * חיתוך באמצע משפט בתוך פרוצדורה מייצר הוראה חלקית שנראית שלמה —
 * וזה בדיוק הכשל שאחזור ברזולוציית מקטע נועד למנוע.
 */
export function clip(text, words) {
  const w = text.split(/\s+/);
  if (w.length <= words) return text;
  const cut = w.slice(0, words).join(' ');
  const i = cut.lastIndexOf('\n\n');
  return (i > cut.length * 0.5 ? cut.slice(0, i) : cut) + '\n[…]';
}

/**
 * הפונקציה שמוזרקת ל-`runTurn`.
 *
 * נכשלת בשקט ומחזירה [] — אחזור הוא **ביסוס** לניסוח, לא תנאי לו.
 * סשן שנעצר כי KV לא ענה גרוע מסשן בלי מקורות.
 */
export function retrieverFor(env, { bct = null, kindWanted = null } = {}) {
  return async (want) => {
    let picks;
    try {
      picks = pickSections(want, { bct, kindWanted });
    } catch { return []; }
    if (!picks.length) return [];

    const budget = WORD_BUDGET;
    const each = Math.max(600, Math.floor(budget / picks.length));
    const out = [];
    for (const p of picks) {
      try {
        const txt = await env.KV.get(`cbt:${p.id}`);
        if (txt) out.push({ src: `${p.src} — ${p.title}`, id: p.id,
                            text: clip(txt, each), score: p.score });
      } catch { /* מקטע חסר לא מפיל את התור */ }
    }
    return out;
  };
}
