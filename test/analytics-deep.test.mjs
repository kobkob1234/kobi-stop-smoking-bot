// ==========================================================================
//  D — אנליטיקה לעומק
//
//  analytics.test.mjs מכסה את הכיסוי וההסלמה. כאן הענפים שנשארו:
//  אינטראקציה בין דגלים, דליים ותגיות, וקצוות של collect.
// ==========================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ANL from '../src/analytics.js';
import { makeKV, makeEnv, seedRecent, seedDays, day } from './helpers.mjs';

const TODAY = '2026-08-02';
const META = { gumSoftCap: 18 };
const flags = async kv => ANL.escalationFlags(await ANL.collect(makeEnv(kv), TODAY, 7), META);

// ---------- D1 · collect ----------

test('collect עם 0 ימים מחזיר מערך ריק', async () => {
  assert.deepEqual(await ANL.collect(makeEnv(), TODAY, 0), []);
});

test('collect מחזיר dow נכון לכל יום', async () => {
  const got = await ANL.collect(makeEnv(), '2026-08-02', 3);
  assert.equal(got[0].dow, 0, '2.8.2026 ראשון');
  assert.equal(got[1].dow, 6, '1.8 שבת');
  assert.equal(got[2].dow, 5, '31.7 שישי');
});

test('collect שומר סדר יורד גם על גבול מנה (20)', async () => {
  for (const n of [19, 20, 21, 40, 41]) {
    const got = await ANL.collect(makeEnv(), TODAY, n);
    assert.equal(got.length, n);
    assert.equal(got[0].iso, TODAY, `n=${n}`);
    for (let i = 1; i < got.length; i++) {
      assert.ok(got[i].iso < got[i - 1].iso, `n=${n} סדר נשבר ב-${i}`);
    }
  }
});

// ---------- D2 · analyse ----------

test('analyse על מערך ריק לא מחלק באפס', () => {
  const a = ANL.analyse([]);
  assert.equal(a.n, 0);
  assert.equal(a.coverage, 0);
  assert.equal(a.wavesPerDay, 0);
  assert.equal(a.gumPerDay, 0);
  assert.equal(a.surfRate, 0);
});

test('רק אירועי w ו-x נספרים לדליים ולתגיות', () => {
  // אירועי g (מסטיק) ו-v (גל שעבר) אינם דחפים, ואסור שיזהמו את המיפוי.
  const a = ANL.analyse([day({
    waves: 1,
    ev: [
      { k: 'w', h: 19, m: 0, tag: 'out' },
      { k: 'g', h: 9, m: 0 },
      { k: 'v', h: 20, m: 0, sec: 90 },
      { k: 'x', h: 20, m: 0, tag: 'out' },
    ],
  })]);
  assert.equal(a.evCount, 2, 'נספרו אירועים שאינם דחפים');
  assert.equal(a.topTag[1], 2);
});

test('תגית לא מוכרת לא נכנסת למיפוי', () => {
  const a = ANL.analyse([day({ waves: 1, ev: [{ k: 'w', h: 19, m: 0, tag: 'המצאתי' }] })]);
  assert.equal(a.topTag, null);
});

test('כל שעה נופלת לדלי אחד בדיוק', () => {
  for (let h = 0; h < 24; h++) {
    const a = ANL.analyse([day({ waves: 1, ev: [{ k: 'w', h, m: 0 }] })]);
    assert.equal(a.evCount, 1, `שעה ${h}`);
    assert.ok(a.topBucket, `שעה ${h} בלי דלי`);
  }
});

test('חציון משך הגל על מדגם זוגי ואי-זוגי', () => {
  const w = sec => day({ waves: 1, surfed: 1, ev: [{ k: 'v', h: 19, m: 0, sec }] });
  assert.equal(ANL.analyse([w(10), w(20), w(30)]).medianWaveSec, 20);
  assert.equal(ANL.analyse([w(10), w(20), w(30), w(40)]).medianWaveSec, 30);
  assert.equal(ANL.analyse([w(10)]).medianWaveSec, 10);
});

test('אירוע v בלי sec לא נספר כמדידה', () => {
  const a = ANL.analyse([day({ waves: 1, surfed: 1, ev: [{ k: 'v', h: 19, m: 0 }] })]);
  assert.equal(a.waveSamples, 0);
  assert.equal(a.medianWaveSec, null);
});

test('surfRate הוא 0 ולא NaN כשאין דחפים', () => {
  const a = ANL.analyse([day({ gum: 5 })]);
  assert.equal(a.surfRate, 0);
  assert.ok(Number.isFinite(a.wavesPerDay));
});

// ---------- D3 · אינטראקציה בין דגלים ----------

test('כל דגל לבדו — מעידה', async () => {
  const kv = seedRecent(makeKV(), TODAY, 7, { patch: true, gum: 12, slips: 1, waves: 1, ev: [{ k: 'g', h: 9, m: 0 }] });
  const { flags: f, blind } = await flags(kv);
  assert.equal(blind, false);
  assert.equal(f.length, 1, f.join(' | '));
  assert.match(f[0], /מעידה/);
});

test('כל דגל לבדו — קראבינג פורץ', async () => {
  const kv = seedRecent(makeKV(), TODAY, 7, {
    patch: true, gum: 12, waves: 5, surfed: 1, ev: [{ k: 'w', h: 19, m: 0 }],
  });
  const { flags: f } = await flags(kv);
  assert.ok(f.some(x => x.includes('קראבינג פורץ')), f.join(' | '));
});

test('כל דגל לבדו — תקרת מסטיק', async () => {
  const kv = seedRecent(makeKV(), TODAY, 7, { patch: true, gum: 19, ev: [{ k: 'g', h: 9, m: 0 }] });
  const { flags: f } = await flags(kv);
  assert.ok(f.some(x => x.includes('תקרת המסטיק')), f.join(' | '));
});

test('דגל התקרה דורש 3 ימים, לא אחד', async () => {
  const kv = makeKV();
  seedRecent(kv, TODAY, 7, { patch: true, gum: 12, ev: [{ k: 'g', h: 9, m: 0 }] });
  seedDays(kv, { [TODAY]: { patch: true, gum: 20, ev: [{ k: 'g', h: 9, m: 0 }] } });
  const { flags: f } = await flags(kv);
  assert.ok(!f.some(x => x.includes('תקרת המסטיק')), 'יום אחד בתקרה הדליק דגל');
});

test('blind מבטל את דגל המדבקה הכוזב', async () => {
  // בשבוע ריק, כל 7 הימים הם patch:false. בלי הסינון היו נדלקים
  // שני דגלים — כיסוי **וגם** מדבקה — ואז הסיבה שהוצגה הייתה שגויה.
  const { flags: f, blind } = await flags(makeKV());
  assert.equal(blind, true);
  assert.ok(!f.some(x => x.includes('בלי סימון מדבקה')), f.join(' | '));
});

test('שבוע עמוס מדליק כמה דגלים יחד', async () => {
  const kv = seedRecent(makeKV(), TODAY, 7, {
    patch: false, gum: 19, waves: 5, surfed: 1, slips: 1, ev: [{ k: 'w', h: 19, m: 0 }],
  });
  const { flags: f } = await flags(kv);
  assert.ok(f.length >= 3, `רק ${f.length}: ${f.join(' | ')}`);
});

// ---------- D4 · טקסטים ----------

test('reportText כולל את כל השורות כשיש נתונים', () => {
  const a = ANL.analyse(Array.from({ length: 3 }, () => day({
    waves: 2, surfed: 2, gum: 12, patch: true, ev: [{ k: 'w', h: 19, m: 0, tag: 'out' }],
  })));
  const t = ANL.reportText(a, ANL.suggestIfThen(a), 7);
  for (const must of ['דחפים', 'שיעור שחרור', 'מסטיק', 'המכנה המשותף']) {
    assert.ok(t.includes(must), `חסר "${must}"`);
  }
});

test('suggestIfThen מחזיר null בלי מכנה משותף מספיק', () => {
  const a = ANL.analyse([day({ waves: 1, ev: [{ k: 'w', h: 19, m: 0, tag: 'out' }] })]);
  assert.equal(ANL.suggestIfThen(a), null, 'הופעה אחת אינה דפוס');
});

test('escalationText מציג כל דגל שנמסר', async () => {
  const kv = seedRecent(makeKV(), TODAY, 7, {
    patch: false, gum: 12, waves: 5, surfed: 1, slips: 1, ev: [{ k: 'w', h: 19, m: 0 }],
  });
  const { flags: f, stats, blind } = await flags(kv);
  const t = ANL.escalationText(f, stats, blind);
  for (const x of f) assert.ok(t.includes(x), `דגל לא הוצג: ${x}`);
});

test('כל טקסטי האנליטיקה מחזירים HTML מאוזן', () => {
  const a = ANL.analyse(Array.from({ length: 3 }, () => day({
    waves: 2, surfed: 2, gum: 12, patch: true,
    ev: [{ k: 'w', h: 19, m: 0, tag: 'out' }, { k: 'v', h: 20, m: 0, sec: 120 }],
  })));
  const texts = [ANL.reportText(a, ANL.suggestIfThen(a), 7),
                 ANL.escalationText(['דגל'], a, false),
                 ANL.escalationText([], a, true)];
  for (const t of texts) {
    for (const tag of ['b', 'i']) {
      const o = (t.match(new RegExp(`<${tag}>`, 'g')) || []).length;
      const c = (t.match(new RegExp(`</${tag}>`, 'g')) || []).length;
      assert.equal(o, c, `<${tag}> לא מאוזן: ${t.slice(0, 60)}`);
    }
  }
});

test('יום בלי dow לא מייצר "יום undefined" בדוח', () => {
  // analyse מקבל גם מערכי ימים גולמיים (לא רק דרך collect), ואז
  // DOW_HE[undefined] יצר את המפתח "undefined" והדוח הציג למשתמש
  // "📅 היום הקשה: יום undefined".
  const raw = { waves: 2, surfed: 0, gum: 5, ev: [{ k: 'w', h: 19, m: 0, tag: 'out' }], _exists: true };
  const a = ANL.analyse([raw, raw]);
  assert.equal(a.topDow, null, 'יום לא תקין נספר');
  assert.ok(!ANL.reportText(a, null, 7).includes('undefined'));
});

test('dow תקין כן נספר', () => {
  const d = { dow: 3, waves: 2, ev: [{ k: 'w', h: 19, m: 0 }], _exists: true };
  assert.equal(ANL.analyse([d]).topDow[0], 'רביעי');
});
