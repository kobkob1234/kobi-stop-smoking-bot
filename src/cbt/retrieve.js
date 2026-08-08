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

import { LIBRARY, BM25 } from './library.js';

/**
 * תקציב מילים לאחזור.
 *
 * "מעבירים 2–4 פרקים במלואם" הניח פיזור אחיד. בפועל המקטעים נעים בין
 * 138 ל-26,844 מילים, וארבעה גדולים הם ~140k טוקנים בקריאה אחת — בתוך
 * החלון, אבל איטי ומטביע את השאלה עצמה ברעש.
 */
export const WORD_BUDGET = 6000;
export const MAX_SECTIONS = 3;
/** לכל היותר שני קטעים מאותו פרק — אחרת מקבלים אותו דבר שלוש פעמים */
export const MAX_PER_SOURCE = 2;

/**
 * רצפה יחסית לציון.
 *
 * הרצה חיה החזירה, מתחת למקטע רלוונטי, דף עבודה על OCD ודיאלוג
 * שכותרתו זבל — שניהם על סמך תג ה-BCT לבדו, בציון 10 מול 16 של
 * הראשון. מקטע חלש בהרבה מהמוביל אינו מבסס אלא מרעיש, והרעש הזה
 * נכנס לאותו פרומפט שאמור לייצר שאלה ממוקדת.
 *
 * יחסי ולא מוחלט: כשאין התאמה חזקה בכלל, עדיין מוחזר מה שיש.
 *
 * כוונן מחדש אחרי המעבר ל-BM25. הגבול נקבע משתי דרישות מתנגשות:
 * מקטע שכל הסיגנל שלו הוא התג (10) חייב ליפול מול התאמה מלאה (24),
 * ומקטע עם תג + ספר ייעודי (16) חייב לעבור. 0.65 עומד בשתיהן,
 * ובמדידה חוזרים 1.6 מקטעים לשאילתה — **100% מהם נושאים את התג**.
 */
export const SCORE_FLOOR = 0.65;

/**
 * הניקוד.
 *
 * ═══ מה נמדד לפני שזה נכתב ═══
 *
 * הגרסה הקודמת דירגה לפי חפיפה עם 14 המונחים **השכיחים** בכל מקטע.
 * זו הבחירה ההפוכה מהנכונה: השכיחים הם הכי פחות מבחינים —
 * "thoughts" הופיע ב-46 מקטעים מ-121, "client" ב-37. סך הכול 567
 * מונחים ייחודיים, 0.16% מאוצר המילים של הקורפוס.
 *
 * שתי מערכות מבחנים, מוטות לכיוונים הפוכים בכוונה:
 *
 *                     שאילתה מהגוף   שאילתה מהכותרת   ממוצע@3
 *   14 מונחים             56%            97%           76%
 *   BM25 בלבד            100%            89%           95%
 *   **היברידי**          100%            99%          100%
 *
 * BM25 לבדו מנצח כשהשאילתה נגזרת מהגוף ומפסיד כשהיא הכותרת; הקודם
 * להפך. אף אחד לא מספיק לבדו — ולכן משלבים.
 *
 * `bm` מנורמל ל-0..10 מול המוביל, כדי שהמשקלים הסמנטיים (תג הטכניקה,
 * ספר ייעודי) יישארו באותו סדר גודל ולא יוצפו על ידי ציון BM25 גולמי.
 */
export const W = { bm: 8, bct: 10, smoking: 6, title: 4, kind: 1.5 };

/** פרמטרי BM25 הסטנדרטיים */
const K1 = 1.5, B = 0.75;

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

/**
 * מילות עצירה — **חייבות להיות זהות לאלה של הבנאי**, אחרת מונח
 * שנגזם בבנייה ייחפש בשאילתה ולא יימצא לעולם.
 */
const STOP = new Set(('the a an and or but if of to in on at for with from by as is are was were be been being it its this that ' +
 'these those you your they them he she his her we our us not no do does did what when where which who how why can could would ' +
 'should will shall may might must about into over under than then there their have has had here more most other some such only ' +
 'own same so too very one two three page chapter figure table copyright press guilford reproduced permission personal use book ' +
 'form clients purchasers see also photocopy').split(' '));

/** מונחי החיפוש מתוך תשובת המודל — מילים באנגלית באורך סביר */
export function queryTerms(want) {
  return [...new Set((norm(want).match(/[a-z][a-z'-]{3,}/g) || [])
    .filter(w => !STOP.has(w) && w.length < 18))].slice(0, 16);
}

/**
 * ציוני BM25 לכל המקטעים, באותו סדר כמו `LIBRARY`.
 *
 * מוחזר מערך גולמי ולא ממוין — הנרמול והשילוב קורים ב-`pickSections`.
 */
export function bm25Scores(q, index = BM25, n = LIBRARY.length) {
  const out = new Float64Array(n);
  if (!index || !index.post) return out;
  for (const w of q) {
    const p = index.post[w];
    if (!p) continue;
    const idf = Math.log(1 + (n - p.length + 0.5) / (p.length + 0.5));
    for (const [i, tf] of p) {
      out[i] += idf * (tf * (K1 + 1)) /
                (tf + K1 * (1 - B + B * (index.len[i] || index.avg) / index.avg));
    }
  }
  return out;
}

/**
 * הדירוג. **טהור** — בלי KV ובלי רשת, ולכן נבדק ישירות.
 *
 * `bct` הוא הטכניקה שרצה עכשיו; `kindWanted` הוא סוג המקטע שמתאים
 * לשלב (תרגיל בסשן עבודה, תיאוריה בהסבר).
 */
export function pickSections(want, { bct = null, kindWanted = null,
                                     budget = WORD_BUDGET, max = MAX_SECTIONS,
                                     library = LIBRARY, floor: floorPct = SCORE_FLOOR } = {}) {
  const q = queryTerms(want);
  // BM25 רץ רק כשהספרייה היא האמיתית — הבדיקות מזריקות ספריות קטנות
  // שהאינדקס אינו מיושר איתן.
  const bm = library === LIBRARY ? bm25Scores(q) : new Float64Array(library.length);
  const top = Math.max(...bm, 0) || 1;
  const scored = [];
  for (let i = 0; i < library.length; i++) {
    const e = library[i];
    let sc = (bm[i] / top) * W.bm;
    if (bct && e.bcts.includes(bct)) sc += W.bct;
    if (sc && SMOKING_BOOKS.has(e.book)) sc += W.smoking;
    for (const t of q) if (norm(e.title).includes(t)) sc += W.title;
    if (kindWanted && e.kind === kindWanted) sc += W.kind;
    // רעש BM25 זעיר בלי שום סיגנל אחר אינו התאמה
    if (sc > 0.5) scored.push({ e, sc });
  }
  // דירוג משני לפי אורך: בציון שווה, מקטע קצר יותר משאיר מקום לעוד
  // אחד בתוך התקציב — כלומר יותר כיסוי באותו מחיר.
  scored.sort((a, b) => b.sc - a.sc || a.e.words - b.e.words);

  const out = [];
  const floor = scored.length ? scored[0].sc * floorPct : 0;
  // כמה קטעים מאותו מקור. פיצול-המשנה יצר אחים, ובלי התקרה הזו שלוש
  // התוצאות היו שלוש פרוסות של אותו פרק — יותר מאותו דבר במקום זווית
  // שנייה. שניים מספיקים כדי לתת את הפרוצדורה בשלמותה.
  const perParent = new Map();
  const parentOf = id => id.split('#')[0];
  let spent = 0;
  for (const { e, sc } of scored) {
    if (out.length >= max) break;
    if (sc < floor) break;                     // מדורג — הראשון שנופל סוגר
    const par = parentOf(e.id);
    if ((perParent.get(par) || 0) >= MAX_PER_SOURCE) continue;
    // מקטע שחורג לבדו עדיין נבחר — הוא ייחתך בקריאה. לדלג עליו היה
    // אומר שהמקטע החזק ביותר בקורפוס אף פעם לא נבחר רק בגלל אורכו.
    if (spent && spent + e.words > budget) continue;
    out.push({ ...e, score: sc });
    perParent.set(par, (perParent.get(par) || 0) + 1);
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
