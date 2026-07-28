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
import { readFileSync, readdirSync } from 'node:fs';

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
process.exit(bad ? 1 : 0);
