// עוזרים משותפים לבדיקות. אין תלויות חיצוניות — node:test מובנה.

// ==========================================================================
//  מוק KV
//
//  בלעדיו אי אפשר היה לבדוק את שכבת הנתונים בכלל, ושם ישבו הבאגים
//  החמורים ביותר — כולל זה שיום חסר נראה כמו יום מאופס, ולכן שבוע של
//  שתיקה מוחלטת קיבל ציון טוב יותר משבוע אמיתי מוצלח.
//
//  ההבחנה הקריטית שהמוק חייב לשמר: מפתח **שלא נכתב** מחזיר null,
//  להבדיל ממפתח שנכתב עם ערכי אפס. זה בדיוק ההבדל שאבד בקוד.
// ==========================================================================
export function makeKV(seed = {}) {
  const store = { ...seed };
  let reads = 0, writes = 0;
  return {
    _store: store,
    get stats() { return { reads, writes, keys: Object.keys(store).length }; },
    async get(k) { reads++; return k in store ? store[k] : null; },
    async put(k, v) { writes++; store[k] = String(v); },
    async delete(k) { delete store[k]; },
  };
}

export const makeEnv = (kv = makeKV()) => ({ KV: kv });

/** זורע ימים אמיתיים ב-KV. ימים שלא נזרעו נשארים **חסרים**, לא מאופסים. */
export function seedDays(kv, days) {
  for (const [iso, d] of Object.entries(days)) {
    kv._store['d:' + iso] = JSON.stringify(day(d));
  }
  return kv;
}

/** N הימים שקדמו ל-todayISO ועד בכלל, כולם זהים */
export function seedRecent(kv, todayISO, n, d = {}) {
  const base = Date.parse(todayISO + 'T00:00:00Z');
  const out = {};
  for (let i = 0; i < n; i++) {
    out[new Date(base - i * 86400000).toISOString().slice(0, 10)] = d;
  }
  return seedDays(kv, out);
}

/** יום ריק עם ברירות מחדל, כדי שכל בדיקה תציין רק את מה שחשוב לה */
export const day = (o = {}) => ({
  patch: false, gum: 0, waves: 0, surfed: 0, slips: 0, outs: 0,
  win: '', journal: '', mine: '', mDone: false, eDone: false, ev: [],
  gumMissed: 0, gumSched: 0, gumExtra: 0, gumCovered: 0,
  planning: 0, chainStops: 0, enroute: 0, ...o,
});

/** שבוע של ימים זהים */
export const week = (o = {}) => Array.from({ length: 7 }, () => day(o));

/** שבוע שבו f(i) קובע כל יום */
export const weekOf = f => Array.from({ length: 7 }, (_, i) => day(f(i)));

/** אירוע מסטיק בשעה נתונה */
export const gumAt = (h, m = 0) => ({ k: 'g', h, m });

export const hhmm = min =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/**
 * מריץ יום שלם: כל 10 דקות בודק אם מגיעה תזכורת, ומדמה לקיחת מסטיק
 * לפי הקצב שנמסר. מחזיר {taken, reminders}.
 */
export function simulateDay(G, plan, { gapMinutes, firstAt = 510, iso = '2026-08-15' }) {
  const d = day();
  let lastRemind = null, reminders = 0;
  for (let t = 7 * 60; t <= 21 * 60 + 30; t += 10) {
    const last = d.ev.length ? d.ev[d.ev.length - 1] : null;
    const since = last ? t - (last.h * 60 + last.m) : Infinity;
    if (d.gum < G.dailyTarget(plan, iso) && t >= firstAt && since >= gapMinutes) {
      d.gum += 1;
      d.ev.push(gumAt(Math.floor(t / 60), t % 60));
    }
    const r = G.dueNow(plan, iso, d, t, lastRemind);
    if (r.due) { lastRemind = t; reminders += 1; }
  }
  return { taken: d.gum, reminders };
}
