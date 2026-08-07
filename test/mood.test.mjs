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

// ==========================================================================
//  המשוב, והשאלה שחייבת להישאל גם בלי לחיצה
// ==========================================================================
import * as C from '../src/content.js';
import { moodAskDue, MOOD_ASK_MIN, MOOD_ASK_MAX } from '../src/tick-logic.js';

test('לכל רמה יש משוב משלה — לא שתי קבוצות', () => {
  const heads = new Set();
  for (const v of [1, 2, 3, 4, 5]) {
    const f = C.MOOD_FEEDBACK[v];
    assert.ok(f && f.head && f.body, `רמה ${v} חסרה`);
    assert.ok(f.quotes.length >= 1, `רמה ${v} בלי ציטוט`);
    heads.add(f.head);
  }
  assert.equal(heads.size, 5, 'שתי רמות חולקות אותו משוב');
});

test('כל ציטוט מיוחס לספר מוכר', () => {
  const OK = ['קאר', 'ווסט', 'ברואר'];
  for (const v of [1, 2, 3, 4, 5]) {
    for (const [q, src] of C.MOOD_FEEDBACK[v].quotes) {
      assert.ok(q.length > 20, `ציטוט קצר מדי ברמה ${v}`);
      assert.ok(OK.some(s => src.includes(s)), `ייחוס לא מוכר: ${src}`);
    }
  }
});

test('ציטוטים עוקבים תמיד שונים — גם באותה דרגה ובאותו יום', () => {
  // עם 3 בדיקות ביום, אינדקס לפי מספר היום בלבד היה מחזיר את אותו
  // ציטוט שלוש פעמים באותו ערב. המונה רץ, ולכן אין חזרה ברצף.
  for (const level of [1, 2, 3, 4, 5]) {
    const n = C.MOOD_FEEDBACK[level].quotes.length;
    assert.ok(n >= 5, `רמה ${level}: רק ${n} ציטוטים — מעט מדי לרוטציה`);
    for (let s = 0; s < 12; s++) {
      assert.notDeepEqual(C.moodQuote(level, s), C.moodQuote(level, s + 1),
        `רמה ${level}: ציטוט חוזר ברצף באינדקס ${s}`);
    }
    // חזרה מותרת — אבל רק אחרי מחזור מלא
    assert.deepEqual(C.moodQuote(level, 0), C.moodQuote(level, n));
  }
});

test('משפטי העידוד מגובים במקור, ולא חוזרים ברצף', () => {
  assert.ok(C.ENCOURAGEMENT.length >= 5);
  for (const [txt, src] of C.ENCOURAGEMENT) {
    assert.ok(txt.length > 30, `משפט קצר מדי: ${txt}`);
    assert.ok(/מרלט|גולביצר|בנדורה|ווסט/.test(src), `בלי מקור מחקרי: ${src}`);
  }
  for (let i = 0; i < 10; i++) {
    assert.notDeepEqual(C.encouragement(i), C.encouragement(i + 1), `עידוד חוזר ברצף ב-${i}`);
  }
});

test('לכל רמת עייפות יש משוב, והגבוהות אומרות להאט', () => {
  for (const v of [1, 2, 3, 4, 5]) assert.ok(C.FATIGUE_FEEDBACK[v]);
  for (const v of [4, 5]) {
    assert.match(C.FATIGUE_FEEDBACK[v], /להאט|עוצרים|אחורה/, `רמה ${v} לא ממליצה להאט`);
  }
});

// ---------- התזכורת היחידה ----------

const d0 = day({ mood: 0 });

test('התזכורת יוצאת בחלון, פעם אחת בלבד', () => {
  assert.equal(moodAskDue(d0, MOOD_ASK_MIN, undefined), true);
  assert.equal(moodAskDue(d0, MOOD_ASK_MIN, 1), false, 'נשלחה פעמיים');
});

test('לא לפני החלון, ולא אחרי שנסגר', () => {
  assert.equal(moodAskDue(d0, MOOD_ASK_MIN - 30, undefined), false, 'הקדימה את הודעת הערב');
  assert.equal(moodAskDue(d0, 2 * 60, undefined), false, 'דירוג רטרוספקטיבי ב-02:00');
});

test('אחרי חצות עדיין בתוך החלון', () => {
  assert.equal(moodAskDue(d0, 15, undefined), true, '00:15 נפל מחוץ לחלון');
});

test('מי שכבר ענה אינו מקבל תזכורת', () => {
  assert.equal(moodAskDue(day({ mood: 3 }), MOOD_ASK_MIN, undefined), false);
});

// ---------- שלוש בדיקות ביום ----------
import { moodAnchorAt, moodCheckDue, MOOD_ANCHORS } from '../src/tick-logic.js';
import * as S from '../src/store.js';
import { makeKV, makeEnv } from './helpers.mjs';

const hm = (h, m = 0) => h * 60 + m;

test('שלושה עוגנים, ולא חופפים', () => {
  assert.equal(MOOD_ANCHORS.length, 3);
  for (let i = 1; i < MOOD_ANCHORS.length; i++) {
    assert.ok(MOOD_ANCHORS[i].from > MOOD_ANCHORS[i - 1].to, `עוגן ${i} חופף לקודם`);
  }
});

test('העוגן הנכון לכל שעה, וחצות שייך לערב', () => {
  assert.equal(moodAnchorAt(hm(11)).id, 'am');
  assert.equal(moodAnchorAt(hm(17)).id, 'pm');
  assert.equal(moodAnchorAt(hm(22)).id, 'eve');
  assert.equal(moodAnchorAt(hm(0, 15)).id, 'eve', '00:15 אינו שייך לערב');
  assert.equal(moodAnchorAt(hm(8)), null, 'שאלה מוקדם מדי בבוקר');
  assert.equal(moodAnchorAt(hm(14)), null);
});

test('לא יותר משלוש ביום, ואחת לכל עוגן', () => {
  assert.equal(moodCheckDue(hm(11), 0, undefined), true);
  assert.equal(moodCheckDue(hm(11), 0, 1), false, 'נשאל פעמיים באותו עוגן');
  assert.equal(moodCheckDue(hm(11), 3, undefined), false, 'עבר את התקרה היומית');
  assert.equal(moodCheckDue(hm(14), 0, undefined), false, 'נשאל מחוץ לעוגן');
});

test('דירוגים מרובים נשמרים, ו-mood הוא החציון', async () => {
  const env = makeEnv(makeKV());
  await S.recordMood(env, '2026-08-07', 11, 0, 2);
  await S.recordMood(env, '2026-08-07', 17, 0, 4);
  await S.recordMood(env, '2026-08-07', 22, 0, 5);
  const d = await S.getDay(env, '2026-08-07');
  assert.equal(S.moodReadings(d).length, 3);
  assert.deepEqual(S.moodReadings(d).map(e => e.v), [2, 4, 5]);
  assert.equal(d.mood, 4, 'mood אינו החציון — ניתוחים קיימים יישברו');
});

test('דירוגי מצב רוח אינם מתערבבים באירועי המסטיק', async () => {
  const env = makeEnv(makeKV());
  await S.updateDay(env, '2026-08-07', d => { d.ev = [{ k: 'g', h: 9, m: 0 }]; });
  await S.recordMood(env, '2026-08-07', 11, 0, 3);
  const d = await S.getDay(env, '2026-08-07');
  assert.equal(G.measureRhythm([d]).total, 1, 'דירוג נספר כמנת מסטיק');
  assert.equal(S.moodReadings(d).length, 1);
});
