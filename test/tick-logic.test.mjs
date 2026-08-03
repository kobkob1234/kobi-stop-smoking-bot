// ==========================================================================
//  ז׳ · G3 — ההחלטות של הקרון
//
//  tick היה 237 שורות בלי אף בדיקה, ושני הבאגים שנמצאו בו לא היו
//  ב-I/O אלא בהחלטות שהיו קבורות בתוכו. הן חולצו ל-tick-logic.js
//  ונבדקות כאן; ה-I/O נשאר במקומו כי הזזתו לא הייתה מוסיפה כיסוי.
// ==========================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SLOTS, slotAction, slotsDue, mergeTickMeta, taperAskDue, taperWatchDue }
  from '../src/tick-logic.js';

const ISO = '2026-08-03';
const at = (h, m = 0) => h * 60 + m;
const morning = SLOTS.find(s => s.id === 'morning');

// ---------- slotAction ----------

test('לפני היעד — לא נוגעים', () => {
  assert.equal(slotAction(morning, at(6, 59), {}, ISO), 'early');
});

test('בדיוק ביעד — נשלח', () => {
  assert.equal(slotAction(morning, at(7, 0), {}, ISO), 'sent');
});

test('בתוך חלון החסד — נשלח', () => {
  assert.equal(slotAction(morning, at(10, 59), {}, ISO), 'sent', 'grace=240');
});

test('אחרי חלון החסד — late, ולא sent', () => {
  // late מסמן שנשלח **בלי לשלוח**. בלי ההבחנה הזאת וורקר שהיה למטה
  // שעתיים היה יורה את כל הודעות הבוקר בבת אחת.
  assert.equal(slotAction(morning, at(11, 1), {}, ISO), 'late');
});

test('כבר נשלח היום — done, גם בתוך החלון', () => {
  assert.equal(slotAction(morning, at(8), { [`${ISO}:morning`]: 1 }, ISO), 'done');
});

test('מפתח של יום אחר לא חוסם את היום', () => {
  assert.equal(slotAction(morning, at(8), { '2026-08-02:morning': 1 }, ISO), 'sent');
});

test('כל סלוט נשלח פעם אחת בדיוק לאורך היום', () => {
  const sent = {};
  const counts = {};
  for (let t = 0; t < 24 * 60; t += 10) {
    for (const s of SLOTS) {
      const act = slotAction(s, t, sent, ISO);
      if (act === 'sent' || act === 'late') sent[`${ISO}:${s.id}`] = 1;
      if (act === 'sent') counts[s.id] = (counts[s.id] || 0) + 1;
    }
  }
  for (const s of SLOTS) assert.equal(counts[s.id], 1, `${s.id} נשלח ${counts[s.id]} פעמים`);
});

test('וורקר שהתעורר בערב לא יורה את כל היום בבת אחת', () => {
  const due = slotsDue(at(22, 0), {}, ISO);
  assert.deepEqual(due.map(s => s.id), ['evening'],
    `נשלחו ${due.map(s => s.id).join(',')} — הצפה אחרי השבתה`);
});

test('כל הסלוטים בלוח מסודרים לפי שעה ובלי כפילות', () => {
  const mins = SLOTS.map(s => s.h * 60 + s.m);
  assert.deepEqual(mins, [...mins].sort((a, b) => a - b), 'הלוח לא ממוין');
  assert.equal(new Set(SLOTS.map(s => s.id)).size, SLOTS.length, 'id כפול');
});

// ---------- mergeTickMeta ----------

test('רק שדות שסומנו כנגועים מוחלים', () => {
  const fresh = { a: 'חדש', b: 'חדש', sent: {} };
  const tickMeta = { a: 'ישן', b: 'ישן', sent: {} };
  const out = mergeTickMeta(fresh, tickMeta, new Set(['a']));
  assert.equal(out.a, 'ישן', 'שדה שהקרון שינה לא הוחל');
  assert.equal(out.b, 'חדש', 'שדה שהקרון לא נגע בו נדרס');
});

test('sent תמיד מתמזג משני הצדדים', () => {
  // איבוד מפתח מ-sent פירושו שליחה כפולה של הודעת הבוקר.
  const out = mergeTickMeta(
    { sent: { 'a:morning': 1 } },
    { sent: { 'a:evening': 1 } },
    new Set());
  assert.deepEqual(Object.keys(out.sent).sort(), ['a:evening', 'a:morning']);
});

test('קליק באמצע tick לא נדרס', () => {
  // התרחיש שנשבר: המשתמש לחץ "יש לי דחף" בזמן שה-tick רץ. הקרון
  // קרא meta עם sos:null, שלח הודעות, וכתב בחזרה — ואיתו את ה-null.
  // התוצאה: צ׳ק-אין 10 הדקות לא יצא, evIdx אבד, ו-reported אבד כך
  // שגם "הגל נשבר" לא הגיע לשותפה.
  const fresh = { sos: { startedAt: 111, evIdx: 3, reported: true }, sent: {} };
  const tickMeta = { sos: null, sent: {} };
  const out = mergeTickMeta(fresh, tickMeta, new Set(['gumRemindMin']));
  assert.deepEqual(out.sos, fresh.sos, 'ה-sos של המשתמש נמחק');
});

test('כשהקרון כן נגע ב-sos, הערך שלו כן מנצח', () => {
  const out = mergeTickMeta({ sos: { old: 1 }, sent: {} }, { sos: null, sent: {} }, new Set(['sos']));
  assert.equal(out.sos, null);
});

test('lastPartnerAlert לא נכתב בחזרה על ידי הקרון', () => {
  // alertPartner רץ ממסלולי המשתמש. כתיבה בחזרה של ערך ישן מאפסת
  // את מגרת 30 הדקות ומאפשרת דיווח כפול לשותפה.
  const fresh = { lastPartnerAlert: 9999, sent: {} };
  const out = mergeTickMeta(fresh, { lastPartnerAlert: 1, sent: {} }, new Set(['gumRemindISO']));
  assert.equal(out.lastPartnerAlert, 9999);
});

// ---------- שאלת הצמצום והניטור ----------

test('שאלת הצמצום חוזרת כל 3 ימים, ולא לפני 9:00', () => {
  const plan = { on: true, taperStartISO: '2026-09-15', confirmedTaper: false };
  assert.equal(taperAskDue(plan, 0, at(9), false), true, 'יום ההתחלה');
  assert.equal(taperAskDue(plan, 3, at(9), false), true);
  assert.equal(taperAskDue(plan, 1, at(9), false), false, 'יום שאינו כפולה של 3');
  assert.equal(taperAskDue(plan, 0, at(8), false), false, 'לפני 9:00');
  assert.equal(taperAskDue(plan, 0, at(9), true), false, 'כבר נשלח היום');
  assert.equal(taperAskDue(plan, -2, at(9), false), false, 'לפני תאריך ההתחלה');
});

test('שאלת הצמצום נעצרת אחרי אישור', () => {
  const confirmed = { on: true, taperStartISO: '2026-09-15', confirmedTaper: true };
  assert.equal(taperAskDue(confirmed, 3, at(9), false), false);
});

test('הניטור רץ כל 7 ימים ורק אחרי אישור ועם קו-בסיס', () => {
  const p = { confirmedTaper: true, baseline: { waves: 5 } };
  assert.equal(taperWatchDue(p, 7, at(9), false), true);
  assert.equal(taperWatchDue(p, 14, at(9), false), true);
  assert.equal(taperWatchDue(p, 0, at(9), false), false, 'יום ההתחלה עצמו');
  assert.equal(taperWatchDue(p, 5, at(9), false), false);
  assert.equal(taperWatchDue({ ...p, baseline: null }, 7, at(9), false), false, 'בלי קו-בסיס');
  assert.equal(taperWatchDue({ ...p, confirmedTaper: false }, 7, at(9), false), false);
});
