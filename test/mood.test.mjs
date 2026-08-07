// ==========================================================================
//  מצב רוח ועייפות-גמילה — שני המדדים שלא נאספו
//
//  כל השאר ברשומת היום הוא התנהגות, כי התנהגות קלה לספור. אבל ב-EMA,
//  מכל המשתנים המצביים שנבדקו, **רק דפוס האפקט השלילי ניבא מעידה
//  ראשונה** — ועייפות-גמילה מנבאת הישנות מעל ומעבר לעוצמת הדחפים.
//
//  ובנוסף הם פותרים בעיה שנייה: קו-הבסיס נבנה על שבוע שעבר בלי גלים,
//  כלומר על אפסים. המדדים האלה קיימים גם כשאין גלים.
// ==========================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ANL from '../src/analytics.js';
import * as G from '../src/gum.js';
import { day } from './helpers.mjs';

const d = (o) => day(o);

// ---------- חציון שמכבד "לא נמדד" ----------

test('0 פירושו "לא נמדד" ואינו נספר כציון נמוך', () => {
  // אחרת שתיקה הייתה נראית כמו מצב רוח רע — בדיוק הטעות שכבר תוקנה
  // ב-_exists, במקום אחר במערכת.
  assert.equal(ANL.subjMedian([d({ mood: 4 }), d({ mood: 0 }), d({ mood: 4 })], 'mood'), 4);
  assert.equal(ANL.subjCount([d({ mood: 4 }), d({ mood: 0 })], 'mood'), 1);
});

test('בלי מדידות בכלל מחזיר null ולא 0', () => {
  assert.equal(ANL.subjMedian([d({}), d({})], 'mood'), null);
  assert.equal(ANL.analyse([d({}), d({})]).mood, null);
});

test('יום שדורג בו רק מצב רוח נחשב יום מתועד', () => {
  assert.equal(G.isLogged(d({ mood: 3 })), true);
  assert.equal(G.isLogged(d({ fatigue: 2 })), true);
  assert.equal(G.isLogged(d({})), false);
  assert.equal(ANL.analyse([d({ mood: 3 })]).coverage, 1);
});

// ---------- קו-הבסיס ----------

test('קו-בסיס על שבוע בלי גלים אינו ריק — יש בו מדדים סובייקטיביים', () => {
  // זה התרחיש שלו בפועל: 14 יום, אפס גלים, אפס מעידות.
  const days = Array.from({ length: 14 }, () => d({ gum: 8, patch: true, mood: 4 }));
  const b = ANL.buildBaseline(days, '2026-09-15');
  assert.equal(b.waves, 0, 'הנחת המוצא של הבדיקה נשברה');
  assert.equal(b.mood, 4, 'אין מדד סובייקטיבי — הקו-בסיס עדיין ריק');
  assert.equal(b.moodDays, 14);
});

test('קו-הבסיס נבנה על 14 יום ולא על 7', () => {
  const days = [
    ...Array.from({ length: 7 }, () => d({ mood: 5 })),
    ...Array.from({ length: 7 }, () => d({ mood: 1 })),
  ];
  const b = ANL.buildBaseline(days, '2026-09-15');
  // days סופר _exists, שקיים רק ברשומות KV אמיתיות — לא בפיקסצ׳ר.
  assert.equal(b.moodDays, 14, 'נלקחו רק שבעה ימים — החלון לא הורחב');
});

// ---------- taperWatch משתמש בהם ----------

const base = { iso: '2026-09-15', waves: 0, surfed: 0, gum: 56, mood: 4, fatigue: 2 };
const week = (o) => Array.from({ length: 7 }, () => d({ gum: 8, patch: true, ...o }));

test('ירידה במצב הרוח מתריעה גם כשאין גלים בכלל', () => {
  const r = G.taperWatch(week({ mood: 2 }), base);
  assert.ok(r.worse.some(x => x.includes('מצב הרוח')), JSON.stringify(r.worse));
});

test('עלייה בעייפות מתריעה', () => {
  const r = G.taperWatch(week({ mood: 4, fatigue: 4 }), base);
  assert.ok(r.worse.some(x => x.includes('עייפות')), JSON.stringify(r.worse));
});

test('עייפות גבוהה מתריעה גם בלי קו-בסיס למדד הזה', () => {
  // הרמה המוחלטת מנבאת הישנות מעל ומעבר לעוצמת הדחפים, ולכן אסור
  // שתהיה מותנית בכך שנמדד קו-בסיס.
  const r = G.taperWatch(week({ fatigue: 5 }), { ...base, fatigue: null });
  assert.ok(r.worse.some(x => x.includes('עייפות')), JSON.stringify(r.worse));
});

test('שבוע יציב אינו מתריע', () => {
  // taperWatch מחזיר null כשאין ממצא — זה החוזה, ולא רשימה ריקה.
  assert.equal(G.taperWatch(week({ mood: 4, fatigue: 2 }), base), null);
});

test('שבוע בלי מדידות סובייקטיביות אינו מייצר התרעת שווא', () => {
  // null פירושו "לא נמדד". אם הוא היה נקרא כ-0, כל שבוע שלא דורג בו
  // מצב רוח היה מתריע על ירידה — כלומר שתיקה הייתה מייצרת אזעקה.
  assert.equal(G.taperWatch(week({}), base), null);
});
