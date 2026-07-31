#!/usr/bin/env node
// ==========================================================================
//  בדיקה חיה מול הבוט הפרוס — סיווג כוונות והמשכיות שיחה.
//
//  זו *לא* חלק מ-npm test: היא דורשת רשת, שורפת ממכסת ה-AI החינמית,
//  ותלויה במודל חיצוני שאינו דטרמיניסטי. מריצים אותה ידנית אחרי שינוי
//  בפרומפט או בדוקטרינה:  npm run test:live
// ==========================================================================
import { readFileSync } from 'node:fs';

const KEY = process.env.WEBHOOK_SECRET
  || readFileSync(new URL('../.webhook-secret', import.meta.url), 'utf8').trim();
const BASE = process.env.BOT_URL || 'https://kobi-stop-smoking-bot.kobiamit.workers.dev';

const ask = async (q, h) => {
  const u = new URL(BASE + '/ask');
  u.searchParams.set('q', q);
  u.searchParams.set('key', KEY);
  if (h) u.searchParams.set('h', h);
  const r = await fetch(u);
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
};

// כוונה → הפעולה שהבוט יבצע. כשל כאן אינו קוסמטי:
// urge_planning ו-urge_enroute מדווחים לבת הזוג, urge לא.
const CASES = [
  ['אני בדרך לחנות עכשיו', 'urge_enroute'],
  ['אני עומד בקופה עם הארנק', 'urge_enroute'],
  ['נגמר החלב אני קופץ לסופר', 'urge_planning'],
  ['אני חושב שאני צריך לצאת לרגע לאוויר', 'urge_planning'],
  ['מחפש תירוץ לצאת החוצה', 'urge_planning'],
  ['בא לי נורא עכשיו', 'urge'],
  ['אני בטוח שאחת לא תזיק', 'urge'],
  ['קניתי ושאפתי', 'slip'],
  ['יוצא מהבית', 'leaving_home'],
  ['לקחתי מסטיק', 'log_gum'],
  ['הדבקתי מדבקה', 'log_patch'],
  ['היה לי גל והוא עבר', 'log_win'],
  ['איפה אני עומד', 'status'],
  ['כמה מסטיקים לקחתי היום', 'question'],
  ['אין לי טעם לחיות', 'crisis'],
  ['היה לי יום ארוך', 'feeling'],
];

// ניסוחים שהמודל אסור לו לייצר — נבדקים על התשובה עצמה
const FORBIDDEN = [
  [/תן ל(ו|גל) (לעבור|לחלוף)|חכה שיעבור|זה יעבור מהר/, 'גלישה "כדי שיעבור" — ברואר מפורש נגד'],
  [/\*\*|##|```/, 'markdown שטלגרם לא מרנדר'],
  [/<המקור>|<source>/, 'מציין מקום במקום מקור אמיתי'],
];

let pass = 0, fail = 0;
const bad = [];

console.log(`\nבדיקה חיה · ${BASE}\n`);
for (const [q, expected] of CASES) {
  try {
    const r = await ask(q);
    const ok = r.intent === expected;
    ok ? pass++ : fail++;
    if (!ok) bad.push(`${q} — ציפיתי ${expected}, קיבלתי ${r.intent}`);
    console.log(` ${ok ? '✅' : '❌'} ${q.padEnd(34)} ${r.intent}`);
    for (const [re, why] of FORBIDDEN) {
      if (r.reply && re.test(r.reply)) { fail++; bad.push(`${q} — ${why}: "${r.reply.slice(0, 80)}"`); }
    }
  } catch (e) {
    fail++; bad.push(`${q} — ${e.message}`);
    console.log(` ❌ ${q.padEnd(34)} ${e.message}`);
  }
}

console.log('\nהמשכיות שיחה:');
const follow = await ask('ולמה?', 'אני בטוח שאחת לא תזיק||אין דבר כזה רק אחת. זו פתיחת השרשרת מחדש.');
const continuous = !/על מה|לא הבנתי|תוכל להסביר|למה מה/.test(follow.reply || '');
continuous ? pass++ : fail++;
if (!continuous) bad.push(`"ולמה?" לא נענה בהקשר: "${follow.reply}"`);
console.log(` ${continuous ? '✅' : '❌'} "ולמה?" → ${(follow.reply || '').slice(0, 90)}`);

console.log(`\n${pass} עברו · ${fail} נכשלו`);
if (bad.length) { console.log('\nכשלים:'); bad.forEach(b => console.log('  •', b)); }
process.exit(fail ? 1 : 0);
