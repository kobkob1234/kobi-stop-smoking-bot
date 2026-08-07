#!/usr/bin/env node
// ==========================================================================
//  check-refs.mjs — האם כל פונקציה שקוראים לה בכלל מוגדרת?
//
//  למה זה קיים: `node --check` בודק תחביר בלבד. החלפת-מחרוזת עיוורת לא
//  נכנסה, הקוד קרא ל-startPlanning() שלא הוגדר, כל הבדיקות עברו, והבאג
//  התגלה רק כשהמשתמש לחץ על הכפתור.
//
//  ובמכוון זה לא מנתח JS: ניסיון לפרסר תבניות מקוננות וליטרלים של regex
//  ייצר יותר התראות שווא מתועלת. במקום זה — בדיקת נוכחות פשוטה של
//  הגדרה כלשהי לאותו שם. תופס בדיוק את המקרה שכאב, בלי רעש.
// ==========================================================================
import { readFileSync, readdirSync, existsSync } from 'node:fs';

// מטרה: הפונקציות המקומיות של הפרויקט, לפי מוסכמות השמות שבו
const INTERESTING = /^(start|on|run|record|log|build|notify|alert|maybe|send|tick|guard|converse|prune)[A-Z]\w*$/;

let bad = 0;
for (const f of readdirSync('src').filter(x => x.endsWith('.js'))) {
  const src = readFileSync(`src/${f}`, 'utf8');
  const called = new Set();
  for (const m of src.matchAll(/(?<![.\w$])([a-z][\w$]*)\s*\(/g)) {
    if (INTERESTING.test(m[1])) called.add(m[1]);
  }
  for (const name of called) {
    const defined =
      new RegExp(`function\\s+${name}\\b`).test(src) ||
      new RegExp(`(?:const|let|var)\\s+${name}\\b`).test(src) ||
      new RegExp(`\\b${name}\\s*[,}]`).test(src.match(/import\s*\{[^}]*\}/g)?.join(' ') || '') ||
      new RegExp(`\\b${name}\\b`).test(src.match(/^import[\s\S]*?;$/gm)?.join(' ') || '');
    if (!defined) {
      const line = src.slice(0, src.indexOf(name + '(')).split('\n').length;
      console.error(`❌ src/${f}:${line} — ${name}() נקרא אבל לא מוגדר ולא מיובא`);
      bad++;
    }
  }
}
console.log(bad === 0 ? '✅ כל הפונקציות שנקראות מוגדרות' : `\n${bad} בעיות`);

// ==========================================================================
//  ההפניות למקורות — מה שהשם של הקובץ הבטיח ולא סיפק.
//
//  עד כה "refs" היה רק הפניות לפונקציות JS. שדה `src` של כל כרטיס ב-kb.js
//  נכתב ביד, מוזרק למודל כהקשר סמכותי, והמודל מתבקש להדהד אותו —
//  ואף בדיקה לא ודאה שהוא מפנה למשהו אמיתי. הבדיקה היחידה שהייתה
//  (test/kb.test.mjs) רק ודאה שהמחרוזת אינה ריקה.
//
//  זו לא אימות מול טקסט הספרים, אבל היא תופסת את מה שבאמת נשבר בפועל:
//  ייחוס לשם מקור שאינו קיים במערכת, וכרטיס בלי ייחוס בכלל.
// ==========================================================================
const SOURCES = ['קאר', 'ווסט', 'ברואר', 'מרלט', 'גולביצר', 'ACT',
                 'התוכנית', 'המדריך', 'יוצא', 'Cochrane',
                 // קווי סיוע — מקור לגיטימי לכרטיס המשבר
                 'ער', 'סה'];

const kb = readFileSync('src/kb.js', 'utf8');
let refBad = 0, refSeen = 0;
for (const m of kb.matchAll(/^\s*src:\s*'([^']+)'/gm)) {
  refSeen++;
  if (!SOURCES.some(s => m[1].includes(s))) {
    console.error(`❌ kb.js — ייחוס לא מוכר: "${m[1]}"`);
    refBad++;
  }
}
// כל כרטיס חייב ייחוס: מספר ה-src חייב להתאים למספר ה-id
const cards = (kb.match(/^\s*id:\s*'/gm) || []).length;
if (refSeen !== cards) {
  console.error(`❌ kb.js — ${cards} כרטיסים אבל ${refSeen} ייחוסים`);
  refBad++;
}
console.log(refBad === 0
  ? `✅ ${refSeen} ייחוסי מקור, כולם מוכרים`
  : `\n${refBad} בעיות ייחוס`);

// תרופות מרשם — נשללו מדעת, ואסור שיחזרו לטקסט שנשלח למשתמש או למודל
const RX_DRUGS = /וארניקלין|בופרופיון|ציטיזין|Champix|צמפיקס/;
let drugBad = 0;
for (const f of readdirSync('src').filter(x => x.endsWith('.js'))) {
  const src = readFileSync(`src/${f}`, 'utf8');
  src.split('\n').forEach((line, i) => {
    // שורת איסור בפרומפט היא בדיוק המקום שבו כן מותר להזכיר אותן
    if (RX_DRUGS.test(line) && !/נשללו|אל תציע|אסור/.test(line)) {
      console.error(`❌ src/${f}:${i + 1} — תרופת מרשם בטקסט: ${line.trim().slice(0, 70)}`);
      drugBad++;
    }
  });
}
console.log(drugBad === 0 ? '✅ אין המלצות על תרופות מרשם' : `\n${drugBad} אזכורים`);

// ==========================================================================
//  ציטוטים מילוליים — האם הם באמת בספר, ובפרק שאליו הם מיוחסים?
//
//  הבדיקה שמעל מאשרת רק ש**שם המקור מוכר**. היא לא בודקת שהמשפט קיים,
//  ולכן ציטוט שהומצא ויוחס ל"ווסט, פרק 10" עבר אותה בשלום — וזה קרה.
//
//  כאן נבדק רק מה שמסומן 'q' (מילולי). ערך 'p' הוא פרפרזה או ייחוס
//  רעיוני, מוצג בלי מרכאות, ואינו טוען שהמשפט נאמר כלשונו.
//
//  שתי מלכודות שנתפסו בדרך: מספור הקבצים אינו מספור הפרקים (אצל ברואר
//  קובץ 04 הוא פרק 1), וגרשים מסולסלים ומיקוף הכשילו התאמת מחרוזת —
//  ולכן ההשוואה על טקסט מנורמל, והמפה נבנית מהכותרות ולא משמות הקבצים.
// ==========================================================================
const BOOKS_DIR = '../books';
const HEB = { 'ברואר': 'judson-brewer', 'קאר': 'allen-carr', 'ווסט': 'robert-west' };

let quoteBad = 0, quoteOk = 0;
if (existsSync(BOOKS_DIR)) {
  // מפת פרקים אמיתית, מתוך הכותרת של כל קובץ
  const chapters = {};
  for (const dir of readdirSync(BOOKS_DIR, { withFileTypes: true })
                     .filter(d => d.isDirectory()).map(d => d.name)) {
    for (const f of readdirSync(`${BOOKS_DIR}/${dir}`).filter(x => x.endsWith('.md'))) {
      const body = readFileSync(`${BOOKS_DIR}/${dir}/${f}`, 'utf8');
      const m = body.slice(0, 300).match(/\*\*Chapter:\*\*\s*Chapter (\d+)/);
      if (m) chapters[`${dir}|${m[1]}`] = body;
    }
  }
  const norm = s => s.replace(/[\u2018\u2019']/g, '').replace(/[^\p{L}\p{N} ]/gu, ' ')
                     .replace(/\s+/g, ' ').trim().toLowerCase();

  // העוגן יושב **בתוך הערך** ולא בקובץ נפרד, כדי שלא יוכל להיפרד ממנו:
  //   ['טקסט עברי', 'ווסט, פרק 14', 'q', 'english anchor']
  // כך הוספת ציטוט מילולי בלי עוגן נתפסת מיד, ומחיקת ציטוט לא משאירה
  // עוגן יתום. (הגרסה הראשונה השתמשה בקובץ JSON נפרד, והוא כבר נפרד —
  // 14 עוגנים מול 13 ציטוטים.)
  const { MOOD_FEEDBACK } = await import('../src/content.js');
  const entries = [];
  for (const lvl of Object.keys(MOOD_FEEDBACK)) {
    for (const [text, src, kind, anchor] of MOOD_FEEDBACK[lvl].quotes) {
      if (kind !== 'q') continue;
      const m = src.match(/^(\S+), פרק (\d+)/);
      if (!m) { console.error(`❌ ציטוט מילולי בלי פרק: ${src}`); quoteBad++; continue; }
      if (!anchor) { console.error(`❌ ציטוט מילולי בלי עוגן: ${text.slice(0, 40)}`); quoteBad++; continue; }
      entries.push([text.slice(0, 34), { book: m[1], ch: m[2], anchor }]);
    }
  }
  for (const [key, { book, ch, anchor }] of entries) {
    const dirKey = Object.keys(chapters).find(k => k.startsWith(HEB[book]) && k.endsWith(`|${ch}`));
    if (!dirKey) {
      console.error(`❌ ציטוט "${key}" מיוחס ל${book} פרק ${ch} — פרק שלא קיים`);
      quoteBad++; continue;
    }
    if (!norm(chapters[dirKey]).includes(norm(anchor))) {
      console.error(`❌ ציטוט "${key}" לא נמצא ב${book} פרק ${ch}`);
      quoteBad++;
    } else quoteOk++;
  }
  console.log(quoteBad === 0
    ? `✅ ${quoteOk} ציטוטים מילוליים אומתו מול טקסט הספר`
    : `\n${quoteBad} ציטוטים לא אומתו`);
} else {
  console.log('⏭️  ספריית הספרים לא נמצאה — דילוג על אימות ציטוטים');
}

process.exit(bad + refBad + drugBad + quoteBad ? 1 : 0);
