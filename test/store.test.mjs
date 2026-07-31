// ==========================================================================
//  אחסון — זיכרון השיחה וניקוי המפתחות
// ==========================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
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
