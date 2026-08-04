// ==========================================================================
//  ב3 — נתיב בת הזוג
//
//  הקוד היחיד בבוט ששולח הודעה לאדם אחר, ולכן היחיד שטעות בו אינה
//  הפיכה: אי אפשר לבטל התראה שנשלחה, ואי אפשר לפצות על אחת שלא.
//
//  עד עכשיו הוא ישב בתוך index.js בלי ייצוא — כלומר **אפס בדיקות**,
//  למרות ששני באגים אמיתיים כבר תוקנו בו. הבדיקות כאן עוברות דרך
//  telegram.js האמיתי ועוצרות ב-fetch, ולכן הן בודקות את הנתיב כולו
//  ולא מוק של עצמו.
// ==========================================================================
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { alertPartner, notifyPartner, SAME_LEVEL_DEBOUNCE_MS } from '../src/partner.js';

const realFetch = globalThis.fetch;
let sent;   // כל קריאה ל-Telegram שיצאה בפועל

/** משתיל fetch שמתעד ומחזיר ok, או נכשל לפי הצורך */
function stubFetch({ ok = true, description = '' } = {}) {
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(init.body) });
    return { json: async () => (ok ? { ok: true, result: {} } : { ok: false, description }) };
  };
}

const meta = (over = {}) => ({ partnerChatId: 999, ...over });
const env = { BOT_TOKEN: 'T' };

beforeEach(() => { sent = []; stubFetch(); });
afterEach(() => { globalThis.fetch = realFetch; });

// ==========================================================================
//  מי מקבל, ומי לא
// ==========================================================================

test('ב3 · דרגה 1 לעולם אינה מגיעה אליה', async () => {
  // דחף רגיל הוא חלק מהיום. אם זה ישבר, היא תקבל עשרות הודעות ביום
  // והיא תשתיק את הבוט — ואז גם דרגה 3 לא תגיע.
  for (const lvl of [0, 1]) {
    assert.equal(await alertPartner(env, meta(), lvl), false);
  }
  assert.equal(sent.length, 0, 'יצאה הודעה בדרגה נמוכה');
});

test('ב3 · דרגות 2 ו-3 מגיעות, וכל אחת בטקסט שלה', async () => {
  const m2 = meta(); assert.equal(await alertPartner(env, m2, 2), true);
  assert.equal(sent.length, 1);
  assert.match(sent[0].body.text, /מחשבות שמייצרות תירוצים/);
  assert.equal(sent[0].body.chat_id, 999);

  sent = [];
  const m3 = meta(); assert.equal(await alertPartner(env, m3, 3), true);
  assert.match(sent[0].body.text, /תתקשרי אליו עכשיו/);
});

test('ב3 · שני הטקסטים אוסרים במפורש להציע סיגריה', async () => {
  for (const lvl of [2, 3]) {
    sent = [];
    await alertPartner(env, meta(), lvl);
    assert.match(sent[0].body.text, /לעולם לא להציע/, `דרגה ${lvl}`);
  }
});

// ==========================================================================
//  המגרה — הבאג שכבר היה כאן
// ==========================================================================

test('ב3 · הסלמה 2→3 עוברת גם בתוך המגרה', async () => {
  // זה הבאג המקורי: מגרה שחסמה גם "כלפי מטה", כך שלחיצה על "אני בדרך
  // לקנות" לא הגיעה אליה בכלל אם קדמה לה דרגה 2. זו הבדיקה החשובה
  // ביותר בקובץ.
  const m = meta();
  await alertPartner(env, m, 2);
  sent = [];
  assert.equal(await alertPartner(env, m, 3), true, 'הסלמה נחסמה');
  assert.equal(sent.length, 1);
  assert.match(sent[0].body.text, /תתקשרי אליו עכשיו/);
});

test('ב3 · כפילות באותה דרגה נחסמת — אבל מדווחת כנמסרה', async () => {
  const m = meta();
  await alertPartner(env, m, 2);
  sent = [];
  // true, כי היא **כן** קיבלה את ההודעה לפני שניות ספורות.
  assert.equal(await alertPartner(env, m, 2), true);
  assert.equal(sent.length, 0, 'נשלחה כפילות');
});

test('ב3 · אחרי שהמגרה פגה — נשלח שוב', async () => {
  const m = meta();
  await alertPartner(env, m, 2);
  m.lastPartnerAlert = Date.now() - SAME_LEVEL_DEBOUNCE_MS - 1000;
  sent = [];
  assert.equal(await alertPartner(env, m, 2), true);
  assert.equal(sent.length, 1);
});

test('ב3 · ירידה 3→2 אינה נחסמת על ידי המגרה של 3', async () => {
  const m = meta();
  await alertPartner(env, m, 3);
  sent = [];
  assert.equal(await alertPartner(env, m, 2), true);
  assert.equal(sent.length, 1);
});

// ==========================================================================
//  כשל שליחה
// ==========================================================================

test('ב3 · כישלון אינו מסמן "דווח" — הבאג השני שכבר היה כאן', async () => {
  stubFetch({ ok: false, description: 'chat not found' });
  const m = meta();
  assert.equal(await alertPartner(env, m, 3), false, 'כישלון דווח כהצלחה');
  assert.equal(m.lastPartnerAlert, undefined, 'חותמת נכתבה למרות שלא נשלח');
  assert.equal(m.lastPartnerAlertLevel, undefined);
});

test('ב3 · כישלון אינו חוסם את הניסיון הבא', async () => {
  // אילו הכישלון היה כותב את החותמת, הוא היה פותח מגרה של 90 שניות
  // ומנציח את עצמו — בדיוק ברגע הכי גרוע.
  const m = meta();
  stubFetch({ ok: false, description: 'timeout' });
  await alertPartner(env, m, 3);
  stubFetch({ ok: true });
  sent = [];
  assert.equal(await alertPartner(env, m, 3), true, 'הכישלון חסם את הניסיון הבא');
  assert.equal(sent.length, 1);
});

// ==========================================================================
//  החסימות
// ==========================================================================

test('ב3 · כל חסימה עוצרת לפני השליחה', async () => {
  const cases = [
    ['בלי partnerChatId', { partnerChatId: null }],
    ['partnerMute',       { partnerMute: true }],
    ['_dryRun',           { _dryRun: true }],
  ];
  for (const [name, over] of cases) {
    sent = [];
    assert.equal(await alertPartner(env, meta(over), 3), false, name);
    assert.equal(sent.length, 0, `${name}: יצאה הודעה`);
  }
});

test('ב3 · dry עוצר לפני כל דבר אחר', async () => {
  // /trigger?dry=1 חייב לאמת את הזרימה בלי להפעיל אותה על אדם שלישי.
  const m = meta();
  assert.equal(await alertPartner(env, m, 3, true), false);
  assert.equal(sent.length, 0);
  assert.equal(m.lastPartnerAlert, undefined, 'dry עדכן מצב');
});

test('ב3 · notifyPartner מכבד את אותן חסימות', async () => {
  assert.equal(await notifyPartner(env, meta({ partnerMute: true }), 'x'), false);
  assert.equal(await notifyPartner(env, meta({ _dryRun: true }), 'x'), false);
  assert.equal(sent.length, 0);
  assert.equal(await notifyPartner(env, meta(), 'שלום'), true);
  assert.equal(sent[0].body.text, 'שלום');
});
