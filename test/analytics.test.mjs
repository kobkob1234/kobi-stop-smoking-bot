// ==========================================================================
//  analytics — כיסוי נתונים והסלמה
//
//  זה הקובץ שלא היה קיים, ובדיוק בחור שהוא משאיר ישב הבאג המסוכן
//  ביותר במערכת: `getDay` החזיר יום חסר כיום מאופס, בלי שום סימן קיום.
//  התוצאה הייתה ששבוע של שתיקה מוחלטת — 0 דחפים, 0 מעידות, 0 מסטיקים —
//  נראה טוב יותר משבוע אמיתי מוצלח, וייצר בדיוק **דגל הסלמה אחד**
//  (חוסר מדבקה, כי יום חסר הוא patch:false) בזמן ש-maybeEscalate דורש
//  שניים. כלומר ניתוק מהבוט, שהוא הסימן המובהק ביותר למצוקה, היה
//  בלתי-נראה לגמרי — והשותפה קיבלה באותו שבוע "✅ בלי מעידות".
//
//  הבדיקות כאן נכתבו כדי שהמצב הזה לא יחזור בשקט.
// ==========================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ANL from '../src/analytics.js';
import { makeKV, makeEnv, seedRecent, day } from './helpers.mjs';

const TODAY = '2026-08-01';
const meta = { gumSoftCap: 18 };

const flagsFor = async kv =>
  ANL.escalationFlags(await ANL.collect(makeEnv(kv), TODAY, 7), meta);

// ---------- כיסוי ----------

test('יום שלא נכתב אינו נספר ככיסוי', async () => {
  const { stats } = await flagsFor(makeKV());
  assert.equal(stats.coverage, 0);
  assert.equal(stats.n, 7, 'עדיין 7 ימים במערך — רק הכיסוי הוא 0');
});

test('יום שנכתב עם ערכי אפס כן נספר ככיסוי', async () => {
  // ההבחנה שאבדה בקוד: "נכתב ואין בו כלום" ≠ "לא נכתב".
  const kv = seedRecent(makeKV(), TODAY, 7, { patch: true });
  const { stats } = await flagsFor(kv);
  assert.equal(stats.coverage, 7);
});

test('ממוצעים מחושבים על ימים מכוסים בלבד', async () => {
  // 2 ימים מתועדים עם 10 מסטיקים כל אחד. חלוקה ב-7 הייתה נותנת 2.9
  // ליום — כלומר פחות דיווח היה נראה כמו פחות שימוש, וזה הפוך.
  const kv = seedRecent(makeKV(), TODAY, 2, { gum: 10, patch: true });
  const { stats } = await flagsFor(kv);
  assert.equal(stats.coverage, 2);
  assert.equal(stats.gumPerDay, 10);
});

// ---------- ההסלמה ----------

test('שבוע של שתיקה מוחלטת מפעיל הסלמה', async () => {
  const { flags, blind } = await flagsFor(makeKV());
  assert.equal(blind, true, 'זה הדגל שהיה חסר לגמרי');
  assert.ok(flags.length >= 1);
});

test('כיסוי חסר עומד בפני עצמו ואינו דורש דגל שני', async () => {
  // maybeEscalate מתנה על `!blind && flags.length < 2`. אם blind יפסיק
  // לעמוד לבדו, שבוע שקט יחזור להיות בלתי-נראה — וזה בדיוק הבאג.
  const { flags, blind } = await flagsFor(makeKV());
  assert.equal(blind, true);
  assert.ok(blind || flags.length >= 2, 'שבוע שקט חייב לעבור את הסף');
});

test('שבוע מתועד ומוצלח אינו מפעיל הסלמה', async () => {
  const kv = seedRecent(makeKV(), TODAY, 7, {
    patch: true, gum: 12, waves: 2, surfed: 2, ev: [{ k: 'g', h: 9, m: 0 }],
  });
  const { flags, blind } = await flagsFor(kv);
  assert.equal(blind, false);
  assert.equal(flags.length, 0, flags.join(' | '));
});

test('ימים חסרים אינם נספרים כדילוג על מדבקה', async () => {
  // קודם לכן זה היה הדגל היחיד שנדלק על שתיקה — כלומר הדגל היחיד
  // שעבד היה גם הדגל הלא-נכון.
  const kv = seedRecent(makeKV(), TODAY, 2, { patch: true, gum: 10 });
  const { flags } = await flagsFor(kv);
  assert.ok(!flags.some(f => f.includes('בלי סימון מדבקה')),
    'יום שלא תועד אינו "יום בלי מדבקה"');
});

test('דילוגי מדבקה אמיתיים כן נספרים', async () => {
  const kv = seedRecent(makeKV(), TODAY, 7, { patch: false, gum: 10 });
  const { flags } = await flagsFor(kv);
  assert.ok(flags.some(f => f.includes('בלי סימון מדבקה')));
});

test('מעידה + דילוגי מדבקה = שני דגלים, בלי קשר לכיסוי', async () => {
  const kv = seedRecent(makeKV(), TODAY, 7, {
    patch: false, gum: 5, waves: 1, slips: 1, ev: [{ k: 'x', h: 20, m: 0 }],
  });
  const { flags, blind } = await flagsFor(kv);
  assert.equal(blind, false);
  assert.ok(flags.length >= 2, flags.join(' | '));
});

test('תקרת המסטיק נמדדת מול הסף החדש ולא מול 12', async () => {
  // היעד הוא 12 ליום. אם הסף נשאר 12, משתמש שעומד ביעד מייצר דגל
  // הסלמה שבועי — כלומר ציות מלא נקרא כמצוקה.
  const kv = seedRecent(makeKV(), TODAY, 7, { patch: true, gum: 12 });
  const { flags } = await flagsFor(kv);
  assert.ok(!flags.some(f => f.includes('תקרת המסטיק')),
    '12 ליום הוא היעד, לא חריגה');
});

// ---------- טקסט ההסלמה ----------

test('הסלמה על כיסוי חסר מקבלת פנייה אחרת, בלי סולם הידיות', async () => {
  const { flags, stats, blind } = await flagsFor(makeKV());
  const txt = ANL.escalationText(flags, stats, blind);
  assert.ok(txt.includes('בדיקה קצרה'));
  assert.ok(!txt.includes('להעלות מספר מנות'),
    'אין טעם לדחוף סולם שנבנה על נתונים במי שפשוט הפסיק לדווח');
});

test('טקסט ההסלמה לא מזכיר תרופות מרשם', async () => {
  const kv = seedRecent(makeKV(), TODAY, 7, {
    patch: false, gum: 5, waves: 1, slips: 1, ev: [{ k: 'x', h: 20, m: 0 }],
  });
  const { flags, stats, blind } = await flagsFor(kv);
  const txt = ANL.escalationText(flags, stats, blind);
  for (const w of ['וארניקלין', 'בופרופיון', 'ציטיזין', 'Champix', 'מרשם']) {
    assert.ok(!txt.includes(w), `"${w}" חזר לטקסט ההסלמה`);
  }
});

// ---------- ניתוח דפוסים ----------

test('analyse סופר דחפים, שחרורים ומסטיק', () => {
  const a = ANL.analyse([
    day({ waves: 2, surfed: 1, gum: 8, patch: true, ev: [{ k: 'w', h: 19, m: 0, tag: 'out' }] }),
    day({ waves: 1, surfed: 1, gum: 10, patch: true, ev: [{ k: 'w', h: 20, m: 0, tag: 'out' }] }),
  ]);
  assert.equal(a.waves, 3);
  assert.equal(a.surfed, 2);
  assert.equal(a.gum, 18);
  assert.equal(a.patchDays, 2);
  assert.equal(a.surfRate, 67);
  assert.equal(a.topBucket[0], 'ערב (17–21)');
  assert.equal(a.topTag[0], 'בחוץ');
});

test('suggestIfThen מפיק שורה מהמכנה המשותף', () => {
  const a = ANL.analyse(Array.from({ length: 3 }, () =>
    day({ waves: 1, ev: [{ k: 'w', h: 19, m: 0, tag: 'out' }] })));
  const s = ANL.suggestIfThen(a);
  assert.ok(s && s.includes('אם') && s.includes('אז'));
});

test('reportText לא קורס על נתונים ריקים', () => {
  const a = ANL.analyse([day(), day()]);
  assert.ok(ANL.reportText(a, null, 2).includes('אין עדיין מספיק נתונים'));
});

// ---------- משך הגל ----------

test('משך הגל נאסף מאירועי v ומחושב חציון', () => {
  // sos.startedAt נמדד בכל פתיחת גל ונזרק בכל סגירה — הקוד פשוט קבע
  // sos = null. זו הטענה האמפירית המרכזית של ברואר, והיא נמדדת בחינם.
  const wave = sec => day({ waves: 1, surfed: 1, ev: [{ k: 'v', h: 19, m: 0, sec }] });
  const a = ANL.analyse([wave(60), wave(300), wave(120)]);
  assert.equal(a.waveSamples, 3);
  assert.equal(a.medianWaveSec, 120);
});

test('בלי מדידות אין חציון ואין שורה בדוח', () => {
  const a = ANL.analyse([day({ waves: 1, surfed: 1, gum: 5 })]);
  assert.equal(a.medianWaveSec, null);
  assert.ok(!ANL.reportText(a, null, 7).includes('אורך הגל'));
});

test('הדוח מציג את אורך הגל רק ממדגם של 3 ומעלה', () => {
  const wave = sec => day({ waves: 1, surfed: 1, ev: [{ k: 'v', h: 19, m: 0, sec }] });
  const few = ANL.analyse([wave(90), wave(110)]);
  assert.ok(!ANL.reportText(few, null, 7).includes('אורך הגל'), 'מדגם 2 — עוד לא');
  const enough = ANL.analyse([wave(90), wave(110), wave(130)]);
  assert.ok(ANL.reportText(enough, null, 7).includes('אורך הגל'));
});

// ---------- collect ----------

test('collect מחזיר את הימים בסדר יורד גם כשהוא קורא במנות', async () => {
  // הקריאה עברה למקבילית במנות של 20; הסדר חייב להישמר, אחרת
  // slice(0,7) ב-escalationFlags היה לוקח ימים אקראיים.
  const kv = makeKV();
  const got = await ANL.collect(makeEnv(kv), TODAY, 45);
  assert.equal(got.length, 45);
  assert.equal(got[0].iso, TODAY);
  for (let i = 1; i < got.length; i++) {
    assert.ok(got[i].iso < got[i - 1].iso, `סדר נשבר ב-${i}: ${got[i].iso}`);
  }
});
