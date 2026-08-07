// ==========================================================================
//  B — שכבת ההתמדה לעומק
//
//  store.test.mjs מכסה את המקרים שנשברו בעבר. כאן טבלת הענפים המלאה:
//  מיזוגים חלקיים, רשומות פגומות, מיגרציות, וריפליי על ה-meta האמיתי.
// ==========================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as S from '../src/store.js';
import * as P from '../src/plan.js';
import * as G from '../src/gum.js';
import { makeKV, makeEnv } from './helpers.mjs';

// ---------- getDay ----------

test('getDay ממלא ברירות מחדל לרשומה חלקית', async () => {
  const kv = makeKV({ 'd:2026-08-02': JSON.stringify({ gum: 3 }) });
  const d = await S.getDay(makeEnv(kv), '2026-08-02');
  assert.equal(d.gum, 3);
  assert.equal(d.waves, 0, 'שדה חסר לא קיבל ברירת מחדל');
  assert.equal(d.patch, false);
  assert.ok(Array.isArray(d.ev));
});

test('ev שאינו מערך מתוקן ולא מפיל', async () => {
  const kv = makeKV({ 'd:2026-08-02': JSON.stringify({ ev: 'לא מערך' }) });
  const d = await S.getDay(makeEnv(kv), '2026-08-02');
  assert.deepEqual(d.ev, []);
});

test('רשומה פגומה נקראת כיום חסר, לא כשגיאה', async () => {
  const kv = makeKV({ 'd:2026-08-02': '{חצי JSON' });
  const d = await S.getDay(makeEnv(kv), '2026-08-02');
  assert.equal(d._exists, false, 'רשומה שלא ניתן לפענח אינה כיסוי');
  assert.equal(d.gum, 0);
});

test('updateDay צובר על פני קריאות ולא דורס', async () => {
  const env = makeEnv();
  await S.updateDay(env, '2026-08-02', d => { d.gum += 1; d.ev.push({ k: 'g', h: 9, m: 0 }); });
  await S.updateDay(env, '2026-08-02', d => { d.gum += 1; d.patch = true; });
  const d = await S.getDay(env, '2026-08-02');
  assert.equal(d.gum, 2);
  assert.equal(d.patch, true);
  assert.equal(d.ev.length, 1);
});

test('שום מפתח _ לא נכתב ל-KV — לא ב-day ולא ב-meta', async () => {
  const env = makeEnv();
  await S.updateDay(env, '2026-08-02', d => { d.gum = 1; d._tmp = 'זמני'; });
  const day = JSON.parse(env.KV._store['d:2026-08-02']);
  assert.ok(!Object.keys(day).some(k => k.startsWith('_')), Object.keys(day).join(','));

  const m = await S.getMeta(env);
  m._scratch = 1; m.chatId = 7;
  await S.putMeta(env, m);
  const meta = JSON.parse(env.KV._store.meta);
  assert.ok(!Object.keys(meta).some(k => k.startsWith('_')), Object.keys(meta).join(','));
  assert.equal(meta.chatId, 7);
});

// ---------- getMeta ----------

test('totals חלקי ממוזג עם ברירות המחדל', async () => {
  const kv = makeKV({ meta: JSON.stringify({ totals: { waves: 5 } }) });
  const m = await S.getMeta(makeEnv(kv));
  assert.equal(m.totals.waves, 5);
  assert.equal(m.totals.surfed, 0, 'מונה חסר לא אופס');
  assert.equal(m.totals.enroute, 0);
});

test('meta ריק לגמרי מחזיר ברירות מחדל שלמות', async () => {
  const m = await S.getMeta(makeEnv());
  assert.equal(m.chatId, null);
  assert.deepEqual(m.sent, {});
  assert.equal(m.gumSoftCap, 18);
});

test('siteVer ישן מאפס את ה-offset פעם אחת', async () => {
  const kv = makeKV({ meta: JSON.stringify({ siteOffset: 4, siteVer: 1 }) });
  const m = await S.getMeta(makeEnv(kv));
  assert.equal(m.siteOffset, 0, 'offset מגרסה ישנה מזיז את העוגן החדש');
  assert.equal(m.siteVer, 2);
});

// ---------- migratePlan ----------

test('מיגרציה: ברירת מחדל ישנה → הלוח הנוכחי, מותאם אישית נשמר, חסר נופל לברירת מחדל', () => {
  assert.equal(G.migratePlan({ times: G.LEGACY_TIMES_V1 }).times.length, G.RECOMMENDED.times.length);
  assert.deepEqual(G.migratePlan({ times: ['08:00', '20:00'] }).times, ['08:00', '20:00']);
  const merged = { ...G.DEFAULT_PLAN, ...G.migratePlan({ on: true }) };
  assert.equal(merged.times.length, G.RECOMMENDED.times.length, 'תוכנית בלי times מכבה תזכורות');
});

test('מיגרציה אידמפוטנטית ולא מאבדת שדות', () => {
  const orig = { times: G.LEGACY_TIMES_V1, confirmedTaper: true, baseline: { waves: 9 }, stepDays: 5 };
  const once = G.migratePlan(orig);
  const twice = G.migratePlan(once);
  assert.deepEqual(twice, once);
  assert.equal(twice.confirmedTaper, true);
  assert.deepEqual(twice.baseline, { waves: 9 });
  assert.equal(twice.stepDays, 5);
});

test('התקרה הרכה מועלית פעם אחת, ולא דורסת בחירה מודעת גבוהה', async () => {
  const low = makeKV({ meta: JSON.stringify({ gumSoftCap: 15, gumPlan: { times: G.LEGACY_TIMES_V1 } }) });
  assert.equal((await S.getMeta(makeEnv(low))).gumSoftCap, 18, 'לא הועלתה');

  const high = makeKV({ meta: JSON.stringify({ gumSoftCap: 22, gumPlan: { times: G.LEGACY_TIMES_V1 } }) });
  assert.equal((await S.getMeta(makeEnv(high))).gumSoftCap, 22, 'בחירה גבוהה נדרסה');
});

test('התקרה הרכה תמיד מעל היעד', async () => {
  const m = await S.getMeta(makeEnv());
  const plan = { ...G.DEFAULT_PLAN, ...(m.gumPlan || {}) };
  assert.ok(m.gumSoftCap > G.dailyTarget(plan, '2026-08-02'),
    'ציות מלא ליעד ייקרא כמינון-יתר');
});

// ---------- pruneSent ----------

test('pruneSent שומר את היום והסמוכים וזורק ישן', () => {
  const meta = {
    sent: {
      '2026-08-02:morning': 1,
      '2026-08-01:evening': 1,
      '2026-07-20:morning': 1,
      '2026-08-05:morning': 1,
    },
    snooze: { '2026-08-02:pl': 600, '2026-07-30:pl': 600 },
  };
  S.pruneSent(meta, '2026-08-02');
  assert.ok(meta.sent['2026-08-02:morning']);
  assert.ok(meta.sent['2026-08-01:evening'], 'אתמול נזרק');
  assert.ok(meta.sent['2026-08-05:morning'], 'עתידי נזרק');
  assert.ok(!meta.sent['2026-07-20:morning'], 'ישן נשמר');
  assert.deepEqual(Object.keys(meta.snooze), ['2026-08-02:pl'], 'דחייה ישנה נשמרה');
});

test('pruneSent לא קורס בלי snooze', () => {
  const meta = { sent: {} };
  S.pruneSent(meta, '2026-08-02');
  assert.deepEqual(meta.sent, {});
});

// ---------- B4: ריפליי על נתונים אמיתיים ----------

// fileURLToPath ולא .pathname: בנתיב יש רווח ("antigravity code"), ו-
// .pathname מחזיר אותו מקודד כ-%20 — כך ש-existsSync נכשל בשקט
// והבדיקה על הנתונים האמיתיים דילגה על עצמה במקום לרוץ.
const backupDir = fileURLToPath(new URL('../../backups/', import.meta.url));
const backup = existsSync(backupDir)
  ? readdirSync(backupDir).filter(f => f.startsWith('meta-')).sort().pop()
  : null;

test('round-trip על ה-meta האמיתי לא מאבד שדות', { skip: !backup && 'אין גיבוי' }, async () => {
  const live = JSON.parse(readFileSync(backupDir + backup, 'utf8'));
  let saved = null;
  const env = {
    KV: { get: async k => (k === 'meta' ? JSON.stringify(live) : null),
          put: async (k, v) => { if (k === 'meta') saved = JSON.parse(v); } },
  };
  await S.putMeta(env, await S.getMeta(env));

  // כל שדה שהיה — עדיין כאן (למעט מפתחות _ שנמחקים בכוונה)
  for (const k of Object.keys(live)) {
    if (k.startsWith('_')) { assert.ok(!(k in saved), `${k} נשמר`); continue; }
    assert.ok(k in saved, `השדה ${k} אבד בסבב`);
  }
  assert.equal(saved.chatId, live.chatId);
  assert.deepEqual(saved.totals, live.totals);
  assert.deepEqual(saved.sos, live.sos);
  assert.equal(saved.partnerChatId, live.partnerChatId);
});

test('המיגרציות חלות על הנתונים האמיתיים', { skip: !backup && 'אין גיבוי' }, async () => {
  const live = JSON.parse(readFileSync(backupDir + backup, 'utf8'));
  const m = await S.getMeta({ KV: { get: async () => JSON.stringify(live), put: async () => {} } });
  assert.equal(G.dailyTarget({ ...G.DEFAULT_PLAN, ...m.gumPlan }, '2026-08-02'), G.RECOMMENDED.times.length);
  assert.equal(m.gumSoftCap, 18);
});

// ==========================================================================
//  ב5 · הסקירה השבועית — המפתח שהיה מחוץ לשכבת הנתונים
// ==========================================================================

test('ב5 · סקירה שבועית: כתיבה, קריאה, וחיתוך במקום אחד', async () => {
  const kv = makeKV(); const env = makeEnv(kv);
  assert.equal(await S.getWeekly(env, '2026-08-01'), null, 'מפתח שלא נכתב אינו null');

  await S.putWeekly(env, '2026-08-01', 'רפלקציה');
  assert.equal(await S.getWeekly(env, '2026-08-01'), 'רפלקציה');
  assert.equal(kv._store['w:2026-08-01'], 'רפלקציה', 'תבנית המפתח השתנתה');

  // החיתוך חייב לקרות פעם אחת ובמקום אחד, ולא בכל קורא בנפרד
  await S.putWeekly(env, '2026-08-08', 'א'.repeat(S.WEEKLY_MAX + 500));
  assert.equal((await S.getWeekly(env, '2026-08-08')).length, S.WEEKLY_MAX);
});

test('ב5 · סקירה אינה מתערבבת עם רשומות היום', async () => {
  const kv = makeKV(); const env = makeEnv(kv);
  await S.putWeekly(env, '2026-08-01', 'טקסט');
  const d = await S.getDay(env, '2026-08-01');
  assert.equal(d._exists, false, 'סקירה שבועית נספרה כרשומת יום');
});

// ==========================================================================
//  מילוי אחורה של המדבקות — מיגרציה שכותבת לנתוני בריאות אמיתיים
// ==========================================================================

test('מילוי אחורה מסמן מדבקה רק בימים שיש להם רשומה', async () => {
  const kv = makeKV(); const env = makeEnv(kv);
  await S.updateDay(env, '2026-07-25', d => { d.gum = 8; });
  await S.updateDay(env, '2026-07-26', d => { d.gum = 9; d.patch = true; });
  // 27.7 בכוונה ללא רשומה
  await S.updateDay(env, '2026-07-28', d => { d.gum = 7; });

  const r = await S.backfillPatches(env, '2026-07-25', '2026-07-28', P.addDaysISO);
  assert.deepEqual(r, { filled: 2, missing: 1, already: 1 });

  assert.equal((await S.getDay(env, '2026-07-25')).patch, true);
  assert.equal((await S.getDay(env, '2026-07-28')).patch, true);
  assert.equal((await S.getDay(env, '2026-07-27'))._exists, false,
    'נוצרה רשומה ליום שלא דווח — זה משתיק את דגל ה-blind');
});

test('מילוי אחורה אינו נוגע בשום שדה אחר', async () => {
  const kv = makeKV(); const env = makeEnv(kv);
  await S.updateDay(env, '2026-07-25', d => {
    d.gum = 8; d.waves = 2; d.surfed = 1; d.journal = 'טקסט';
    d.ev = [{ k: 'g', h: 9, m: 0 }];
  });
  const before = await S.getDay(env, '2026-07-25');
  await S.backfillPatches(env, '2026-07-25', '2026-07-25', P.addDaysISO);
  const after = await S.getDay(env, '2026-07-25');

  assert.equal(after.patch, true);
  for (const k of ['gum', 'waves', 'surfed', 'journal']) {
    assert.deepEqual(after[k], before[k], `השדה ${k} השתנה`);
  }
  assert.deepEqual(after.ev, before.ev, 'האירועים השתנו');
});

test('מילוי אחורה אידמפוטנטי — הרצה שנייה לא משנה כלום', async () => {
  const kv = makeKV(); const env = makeEnv(kv);
  await S.updateDay(env, '2026-07-25', d => { d.gum = 8; });
  await S.backfillPatches(env, '2026-07-25', '2026-07-26', P.addDaysISO);
  const w1 = kv.stats.writes;
  const r2 = await S.backfillPatches(env, '2026-07-25', '2026-07-26', P.addDaysISO);
  assert.equal(r2.filled, 0);
  assert.equal(kv.stats.writes, w1, 'הרצה שנייה כתבה ל-KV');
});

test('מילוי אחורה עוצר בהיום ולא רץ לעתיד', async () => {
  const kv = makeKV(); const env = makeEnv(kv);
  await S.updateDay(env, '2026-08-20', d => { d.gum = 5; });   // עתידי
  const r = await S.backfillPatches(env, '2026-07-25', '2026-07-27', P.addDaysISO);
  assert.equal(r.filled + r.already, 0);
  assert.equal((await S.getDay(env, '2026-08-20')).patch, false, 'נגע ביום עתידי');
});
