// ==========================================================================
//  אחסון — זיכרון השיחה וניקוי המפתחות
// ==========================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeKV, makeEnv } from './helpers.mjs';
import { getDay, updateDay, getMeta, putMeta } from '../src/store.js';

// ==========================================================================
//  שכבת ה-KV — לא הייתה נבדקת כלל, ושם ישבו הבאגים החמורים.
// ==========================================================================

test('יום שלא נכתב מסומן כלא-קיים; יום שנכתב מסומן כקיים', async () => {
  const env = makeEnv();
  const missing = await getDay(env, '2026-08-01');
  assert.equal(missing._exists, false, 'זו ההבחנה שאבדה וגרמה לשבוע שקט להיראות מוצלח');
  assert.equal(missing.gum, 0, 'הערכים עדיין מאופסים — רק המשמעות שונה');

  await updateDay(env, '2026-08-01', d => { d.gum = 3; });
  const present = await getDay(env, '2026-08-01');
  assert.equal(present._exists, true);
  assert.equal(present.gum, 3);
});

test('_exists לא נשמר לרשומה עצמה', async () => {
  const env = makeEnv();
  await updateDay(env, '2026-08-01', d => { d.gum = 1; });
  const raw = JSON.parse(env.KV._store['d:2026-08-01']);
  assert.ok(!('_exists' in raw), 'דגלי _ הם request-scoped ואסור שיזלגו ל-KV');
});

test('רשומה פגומה לא מפילה את היום ולא זורקת', async () => {
  // בלי try/catch, רשומה פגומה אחת השביתה לצמיתות ובשקט כל
  // אינטראקציה בתאריך הזה — getDay נקרא בכל מסלול.
  const kv = makeKV({ 'd:2026-08-01': '{לא JSON' });
  const d = await getDay(makeEnv(kv), '2026-08-01');
  assert.equal(d.gum, 0);
  assert.equal(d._exists, false, 'רשומה שלא ניתן לקרוא אינה כיסוי');
});

test('putMeta לא שומר מפתחות שמתחילים ב-_', async () => {
  // `/trigger?dry=1` קבע partnerMute=true "רק לבדיקה", וזה נשמר ל-KV
  // דרך putMeta שבסוף startEnRoute — כלומר בדיקה אחת השביתה את ערוץ
  // ההתראה לשותפה לצמיתות ובשקט.
  const env = makeEnv();
  const m = await getMeta(env);
  m.chatId = 42;
  m._dryRun = true;
  await putMeta(env, m);

  assert.ok(!('_dryRun' in JSON.parse(env.KV._store.meta)), 'דגל הבדיקה נשמר');
  const back = await getMeta(env);
  assert.equal(back.chatId, 42, 'שאר השדות נשמרים כרגיל');
  assert.equal(back.partnerMute, false, 'ערוץ השותפה נשאר פעיל');
});

test('updateDay קורא-משנה-כותב, ושתי קריאות מצטברות', async () => {
  const env = makeEnv();
  await updateDay(env, '2026-08-01', d => { d.gum += 1; });
  await updateDay(env, '2026-08-01', d => { d.gum += 1; d.patch = true; });
  const d = await getDay(env, '2026-08-01');
  assert.equal(d.gum, 2);
  assert.equal(d.patch, true);
});
import * as S from '../src/store.js';

const fresh = () => ({ ...S.DEFAULT_META, hist: [], sent: {} });

test('זיכרון השיחה נחתך לגודל המרבי', () => {
  const m = fresh();
  for (let i = 0; i < 20; i++) S.pushHist(m, i % 2 ? 'a' : 'u', `הודעה ${i}`);
  assert.equal(m.hist.length, S.HIST_TURNS);
  assert.match(m.hist[m.hist.length - 1].t, /הודעה 19/);
});

test('תור ארוך נחתך באורך התווים', () => {
  const m = fresh();
  S.pushHist(m, 'u', 'א'.repeat(1000));
  assert.equal(m.hist[0].t.length, S.HIST_CHARS);
});

test('תגיות HTML מוסרות לפני השמירה', () => {
  const m = fresh();
  S.pushHist(m, 'a', '<b>שלום</b> <i>עולם</i>');
  assert.equal(m.hist[0].t, 'שלום עולם');
});

test('שיחה ישנה מה-TTL אינה מוחזרת', () => {
  const now = Date.now();
  const m = fresh();
  m.hist = [
    { r: 'u', t: 'אתמול', ts: now - S.HIST_TTL_MS - 1000 },
    { r: 'u', t: 'עכשיו', ts: now - 1000 },
  ];
  const h = S.recentHist(m, now);
  assert.equal(h.length, 1);
  assert.equal(h[0].t, 'עכשיו');
});

test('הודעה ריקה לא נכנסת לזיכרון', () => {
  const m = fresh();
  S.pushHist(m, 'u', '');
  S.pushHist(m, 'a', null);
  assert.equal(m.hist.length, 0);
});

test('pruneSent שומר את היום ואת הימים הסמוכים, וזורק ישן', () => {
  const m = fresh();
  m.sent = {
    '2026-08-15:morning': 1,
    '2026-08-14:morning': 1,
    '2026-07-01:morning': 1,
  };
  S.pruneSent(m, '2026-08-15');
  assert.ok(m.sent['2026-08-15:morning']);
  assert.ok(m.sent['2026-08-14:morning']);
  assert.ok(!m.sent['2026-07-01:morning'], 'מפתח בן חודש נשאר');
});

test('EMPTY_DAY מכיל את כל השדות שהקוד קורא להם', () => {
  for (const k of ['gum', 'gumSched', 'gumExtra', 'gumMissed', 'gumCovered',
                   'waves', 'surfed', 'slips', 'outs', 'ev',
                   'planning', 'chainStops', 'enroute']) {
    assert.ok(k in S.EMPTY_DAY, `חסר ${k}`);
  }
  assert.ok(Array.isArray(S.EMPTY_DAY.ev));
});

test('DEFAULT_META מכיל את שדות המסטיק והשותפה', () => {
  for (const k of ['gumPlan', 'gumRemindISO', 'gumRemindMin', 'gumSnoozeISO', 'gumSnoozeMin',
                   'partnerChatId', 'partnerMute', 'lastPartnerAlert', 'lastPartnerAlertLevel',
                   'hist', 'kbMode']) {
    assert.ok(k in S.DEFAULT_META, `חסר ${k}`);
  }
});
