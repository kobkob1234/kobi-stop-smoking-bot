// עוזרים משותפים לבדיקות. אין תלויות חיצוניות — node:test מובנה.

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
