// ==========================================================================
//  analytics.js — מיפוי דפוסים אוטומטי
//  זה מה שהופך את "טבלת מיפוי ארבעת האירועים" מהמדריך לדבר חי:
//  כל גל נרשם עם שעה + תגית הקשר, והבוט מוציא מזה את המכנה המשותף
//  ומציע ממנו שורת אם-אז — בדיוק התהליך שהמדריך מבקש לעשות ביד.
//  בנוסף: זיהוי נקודת ההחלטה להסלמה (סעיף יב׳ בתוכנית המקיפה).
// ==========================================================================

import * as P from './plan.js';
import { getDay } from './store.js';

export const TAGS = {
  out:    'בחוץ',
  home:   'בבית',
  stress: 'לחץ',
  bored:  'שעמום',
  tired:  'עייף/רעב',
  food:   'אחרי אוכל',
  screen: 'מסך/גלילה',
  alone:  'לבד',
  social: 'חברה/מסיבה',
  alc:    'אלכוהול',
};

const BUCKETS = [
  { lo: 0,  hi: 6,  name: 'לילה (00–06)' },
  { lo: 6,  hi: 10, name: 'בוקר (06–10)' },
  { lo: 10, hi: 14, name: 'צהריים (10–14)' },
  { lo: 14, hi: 17, name: 'אחה״צ (14–17)' },
  { lo: 17, hi: 21, name: 'ערב (17–21)' },
  { lo: 21, hi: 24, name: 'לילה מוקדם (21–24)' },
];
const bucketOf = h => (BUCKETS.find(b => h >= b.lo && h < b.hi) || BUCKETS[0]).name;
const DOW_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/** קורא את N הימים האחרונים מ-KV */
export async function collect(env, todayISO, days = 14) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const iso = P.addDaysISO(todayISO, -i);
    const d = await getDay(env, iso);
    const dow = new Date(Date.parse(iso + 'T12:00:00Z')).getUTCDay();
    out.push({ iso, dow, ...d });
  }
  return out;
}

const topOf = obj => Object.entries(obj).sort((a, b) => b[1] - a[1])[0] || null;
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

/** מנתח ומחזיר אובייקט מסקנות */
export function analyse(daysArr) {
  const buckets = {}, tags = {}, dows = {};
  let waves = 0, surfed = 0, gum = 0, slips = 0, outs = 0, patchDays = 0, evCount = 0;

  for (const d of daysArr) {
    waves += d.waves || 0;
    surfed += d.surfed || 0;
    gum += d.gum || 0;
    slips += d.slips || 0;
    outs += d.outs || 0;
    if (d.patch) patchDays++;
    if (d.waves) dows[DOW_HE[d.dow]] = (dows[DOW_HE[d.dow]] || 0) + d.waves;
    for (const e of d.ev || []) {
      if (e.k !== 'w' && e.k !== 'x') continue;
      evCount++;
      buckets[bucketOf(e.h)] = (buckets[bucketOf(e.h)] || 0) + 1;
      if (e.tag && TAGS[e.tag]) tags[TAGS[e.tag]] = (tags[TAGS[e.tag]] || 0) + 1;
    }
  }

  const n = daysArr.length;
  return {
    n, waves, surfed, gum, slips, outs, patchDays, evCount,
    surfRate: pct(surfed, waves),
    wavesPerDay: +(waves / n).toFixed(1),
    gumPerDay: +(gum / n).toFixed(1),
    topBucket: topOf(buckets),
    topTag: topOf(tags),
    topDow: topOf(dows),
    buckets, tags,
  };
}

/** מציע שורת אם-אז מהמכנה המשותף שנמצא */
export function suggestIfThen(a) {
  if (!a.topBucket && !a.topTag) return null;
  const when = [];
  if (a.topBucket && a.topBucket[1] >= 2) when.push(a.topBucket[0].replace(/\s*\(.*\)/, ''));
  if (a.topTag && a.topTag[1] >= 2) when.push(a.topTag[0]);
  if (!when.length) return null;

  const tag = a.topTag && a.topTag[1] >= 2 ? a.topTag[0] : null;
  const then = {
    'בחוץ':        'לא יוצא בלי יעד ומסלול סגורים מראש, ומסטיק בכיס',
    'לחץ':         'קודם 10 דק׳ הליכה או נשימה 4-7-8 — לפני כל החלטה',
    'שעמום':       'שולף את רשימת "5 דקות ריקות" — הליכה ראשונה ברשימה',
    'עייף/רעב':    'אוכל משהו אמיתי ושותה, ורק אחר-כך מחליט אם לצאת',
    'מסך/גלילה':   'מניח את הטלפון ותופס משהו אחר ביד — 60 שניות',
    'לבד':         'שולח הודעה לבת/בן הזוג לפני שאני זז',
    'אחרי אוכל':   'קם להליכה קצרה מיד אחרי — לא נשאר בכיסא',
    'אלכוהול':     'עוצר בכוס, ומודיע מראש לבת/בן הזוג שאני בחוץ',
    'חברה/מסיבה':  'משפט הסירוב מוכן: "לא תודה, אני לא מווייפ"',
    'בבית':        'RAIN במקום — 4 דקות, בלי לצאת מהדלת',
  }[tag] || 'מפעיל RAIN מיד ומודיע לבת/בן הזוג';

  return `<b>אם</b> ${when.join(' + ')} ← <b>אז</b> ${then}.`;
}

/** נקודת ההחלטה להסלמה — סעיף יב׳ בתוכנית המקיפה */
export function escalationFlags(daysArr, meta) {
  const last7 = daysArr.slice(0, 7);
  const a = analyse(last7);
  const flags = [];

  if (a.slips >= 1) {
    flags.push(`הייתה מעידה ב-7 הימים האחרונים (${a.slips}).`);
  }
  if (a.wavesPerDay >= 4 && a.surfRate < 60 && a.waves >= 10) {
    flags.push(`קראבינג פורץ ומתמשך: ${a.wavesPerDay} דחפים ביום בממוצע, ורק ${a.surfRate}% עברו עד הסוף.`);
  }
  const atCap = last7.filter(d => (d.gum || 0) >= (meta.gumSoftCap || 12)).length;
  if (atCap >= 3) {
    flags.push(`${atCap} ימים בשבוע האחרון בתקרת המסטיק — סימן שהפער עוד פתוח.`);
  }
  const missed = last7.filter(d => !d.patch).length;
  if (missed >= 3) {
    flags.push(`${missed} ימים בשבוע האחרון בלי סימון מדבקה — התמדה היא גורם ההצלחה מס׳ 1, ובודקים אותה ראשונה.`);
  }
  return { flags, stats: a };
}

// ---------- דוח לתצוגה ----------
export function reportText(a, ifThen, days) {
  const L = ['📈 <b>הדפוסים שלך</b>', `<i>${days} הימים האחרונים</i>`, '─────────────'];

  if (!a.waves && !a.gum) {
    L.push('אין עדיין מספיק נתונים. כל פעם שתלחץ "יש לי דחף עכשיו" או "מסטיק" אני אוסף — ומכאן יוצא המיפוי.');
    return L.join('\n');
  }

  L.push(`🌀 דחפים: <b>${a.waves}</b> (${a.wavesPerDay} ביום) · 🌊 עברו: <b>${a.surfed}</b>`);
  L.push(`📊 <b>שיעור שחרור: ${a.surfRate}%</b> ${a.surfRate >= 80 ? '— חזק מאוד' : a.surfRate >= 50 ? '— בכיוון' : '— יש כאן מה לחזק'}`);
  L.push(`🍬 מסטיק: ${a.gumPerDay} ביום · 🩹 מדבקה סומנה ב-${a.patchDays}/${a.n} ימים · 🚪 יציאות עם טקס: ${a.outs}`);
  if (a.slips) L.push(`↩️ מעידות: ${a.slips} <i>(דאטה, לא ציון)</i>`);

  if (a.topBucket || a.topTag || a.topDow) {
    L.push('', '<b>המכנה המשותף:</b>');
    if (a.topBucket) L.push(`🕐 שעת השיא: <b>${a.topBucket[0]}</b> — ${a.topBucket[1]} מתוך ${a.evCount} דחפים (${pct(a.topBucket[1], a.evCount)}%)`);
    if (a.topTag)    L.push(`🏷️ ההקשר החוזר: <b>${a.topTag[0]}</b> (${a.topTag[1]} פעמים)`);
    if (a.topDow)    L.push(`📅 היום הקשה: <b>יום ${a.topDow[0]}</b>`);
  }

  if (ifThen) {
    L.push('', '✍️ <b>שורת האם-אז שנגזרת מזה:</b>', ifThen,
      '', '<i>זה בדיוק מה שהמדריך מבקש לעשות ביד — למצוא את המכנה המשותף של האירועים ולהפוך אותו לשורה ראשונה בטבלה. להילחם מוקדם, לא חזק.</i>');
  } else {
    L.push('', '<i>עוד כמה דחפים מתויגים ואוציא לך מזה שורת אם-אז אוטומטית.</i>');
  }
  return L.join('\n');
}

export function escalationText(flags, a) {
  return [
    '⚠️ <b>נקודת החלטה — לא אזעקה</b>',
    '─────────────',
    'לפי הנתונים שלך מהשבוע:',
    ...flags.map(f => `• ${f}`),
    '',
    '<b>מה התוכנית שלך אומרת על המצב הזה (סעיף יב׳):</b>',
    'אם קראבינג פורץ נמשך למרות שילוב נכון של מדבקה + מסטיק + תמיכה אחרי ~1–2 שבועות, <b>או שהחלקת</b> — זה הסימן להעלות <b>וארניקלין</b> מול רופא. זו הראיה הכי חזקה שקיימת לגמילה מוויפ ספציפית (Evins 2025: 28% מול 7% בשבועות 9–24).',
    'בישראל: Apo-Varenicline, במרשם, בסל עם 15% השתתפות.',
    '',
    '<b>ולפני זה, שתי בדיקות זולות:</b>',
    '1 · מדבקה כל בוקר בלי דילוגים — זו הבדיקה הראשונה תמיד.',
    '2 · תמיכה — <b>*6800</b> חינם, ומכפילה. גם מזכה בתעודה ל-85% סבסוד.',
    '',
    '<i>זה לא כישלון ולא "לא הצלחתי לבד". זו בדיוק ההסלמה שהתוכנית בנתה מראש — והחלטה עליה היא של רופא, לא שלי.</i>',
  ].join('\n');
}
