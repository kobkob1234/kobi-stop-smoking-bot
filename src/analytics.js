// ==========================================================================
//  analytics.js — מיפוי דפוסים אוטומטי
//  זה מה שהופך את "טבלת מיפוי ארבעת האירועים" מהמדריך לדבר חי:
//  כל גל נרשם עם שעה + תגית הקשר, והבוט מוציא מזה את המכנה המשותף
//  ומציע ממנו שורת אם-אז — בדיוק התהליך שהמדריך מבקש לעשות ביד.
//  בנוסף: זיהוי נקודת ההחלטה להסלמה (סעיף יב׳ בתוכנית המקיפה).
// ==========================================================================

import * as P from './plan.js';
import { getDay } from './store.js';
import { isLogged, COVERAGE_MIN } from './gum.js';

/** יום נחשב מכוסה אם יש לו רשומה ב-KV או סימן חיים כלשהו */
const covered = d => !!d._exists || isLogged(d);

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

/**
 * קורא את N הימים האחרונים מ-KV.
 *
 * במנות ובמקביל, ולא אחד-אחרי-השני: הגיבוי היומי מבקש 120 ימים, וזה
 * היה 120 קריאות סדרתיות בבקשה אחת — זמן קיר שגדל ליניארית, ומספר
 * subrequests שעלול לחרוג מהמגבלה. המנות שומרות על מקביליות בלי
 * לפתוח 120 קריאות בבת אחת.
 */
const CHUNK = 20;

export async function collect(env, todayISO, days = 14) {
  const isos = Array.from({ length: days }, (_, i) => P.addDaysISO(todayISO, -i));
  const out = [];
  for (let i = 0; i < isos.length; i += CHUNK) {
    const slice = isos.slice(i, i + CHUNK);
    const got = await Promise.all(slice.map(iso => getDay(env, iso)));
    slice.forEach((iso, k) => {
      out.push({ iso, dow: new Date(Date.parse(iso + 'T12:00:00Z')).getUTCDay(), ...got[k] });
    });
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
    // רק עם dow תקין. `collect` תמיד מוסיף אותו, אבל analyse מקבל גם
    // מערכי ימים גולמיים — ואז DOW_HE[undefined] מייצר את המפתח
    // "undefined", והדוח מציג למשתמש "היום הקשה: יום undefined".
    if (d.waves && d.dow >= 0 && d.dow <= 6) {
      dows[DOW_HE[d.dow]] = (dows[DOW_HE[d.dow]] || 0) + d.waves;
    }
    for (const e of d.ev || []) {
      if (e.k !== 'w' && e.k !== 'x') continue;
      evCount++;
      buckets[bucketOf(e.h)] = (buckets[bucketOf(e.h)] || 0) + 1;
      if (e.tag && TAGS[e.tag]) tags[TAGS[e.tag]] = (tags[TAGS[e.tag]] || 0) + 1;
    }
  }

  // משך הגלים — הטענה האמפירית המרכזית של ברואר, על הנתונים שלו עצמו.
  const durs = [];
  for (const d of daysArr) {
    for (const e of d.ev || []) if (e.k === 'v' && typeof e.sec === 'number') durs.push(e.sec);
  }
  durs.sort((a, b) => a - b);
  const medianWaveSec = durs.length ? durs[Math.floor(durs.length / 2)] : null;

  const n = daysArr.length;
  // ממוצעים על ימים מכוסים בלבד. חלוקה ב-n הגולמי גורמת לימים שלא
  // תועדו "לדלל" את הצריכה כלפי מטה — כלומר פחות דיווח נראה כמו
  // פחות דחפים ופחות מסטיק, וזה בדיוק הפוך מהמציאות.
  const coverage = daysArr.filter(covered).length;
  const denom = Math.max(1, coverage);
  return {
    n, coverage, waves, surfed, gum, slips, outs, patchDays, evCount,
    medianWaveSec, waveSamples: durs.length,
    surfRate: pct(surfed, waves),
    wavesPerDay: +(waves / denom).toFixed(1),
    gumPerDay: +(gum / denom).toFixed(1),
    topBucket: topOf(buckets),
    topTag: topOf(tags),
    topDow: topOf(dows),
    buckets, tags,
  };
}

/**
 * מחשב את הסכומים מחדש מרשומות הימים.
 *
 * `meta.totals` הוא מונה מצטבר שמוגדל בכל אירוע, במקביל לרשומות
 * היומיות — כלומר **שני מקורות אמת לאותו נתון**. הם נפרדו בפועל:
 * 62 מסטיקים במונה מול 73 ברשומות, ו-3 ימי מדבקה מול 4. כל כתיבה
 * שנכשלה באמצע, כל מיזוג שנדרס וכל בדיקה שנוקתה מזיזה אותם זה מזה,
 * והמונה אינו ניתן לשחזור.
 *
 * הרשומות היומיות הן האמת — יש להן חותמות זמן ואפשר לבדוק אותן.
 * המונה הופך כאן למטמון שנבנה מחדש, ולא למקור.
 */
export async function reconcileTotals(env, todayISO, days = 120) {
  const arr = await collect(env, todayISO, days);
  const sum = k => arr.reduce((t, d) => t + (d[k] || 0), 0);
  return {
    surfed: sum('surfed'), waves: sum('waves'), slips: sum('slips'),
    outs: sum('outs'), gum: sum('gum'), planning: sum('planning'),
    chainStops: sum('chainStops'), enroute: sum('enroute'),
    patch: arr.filter(d => d.patch).length,
    mDone: arr.filter(d => d.mDone).length,
    eDone: arr.filter(d => d.eDone).length,
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

  // ---- כיסוי לפני הכל ----
  // זה הדגל שהיה חסר, והחוסר שלו היה החור המסוכן ביותר במערכת.
  // שבוע של שתיקה מוחלטת ייצר בדיוק דגל אחד (חוסר מדבקה, כי יום חסר
  // נראה כ-patch:false), ו-maybeEscalate דורש שניים — כלומר התנתקות
  // מהבוט, שהיא הסימן המובהק ביותר למצוקה, הייתה בלתי-נראית לגמרי.
  // עכשיו היא הדגל הראשון, והיא גם מבטלת את דגל המדבקה הכוזב.
  const blind = a.coverage < COVERAGE_MIN;
  if (blind) {
    flags.push(`רק ${a.coverage} מתוך 7 ימים תועדו. ניתוק מהבוט הוא בדרך כלל סימן שקשה, לא שהכול בסדר — ובלי נתונים אני גם לא יכול להגיד לך כלום אמין.`);
  }

  if (a.slips >= 1) {
    flags.push(`הייתה מעידה ב-7 הימים האחרונים (${a.slips}).`);
  }
  if (a.wavesPerDay >= 4 && a.surfRate < 60 && a.waves >= 10) {
    flags.push(`קראבינג פורץ ומתמשך: ${a.wavesPerDay} דחפים ביום בממוצע, ורק ${a.surfRate}% עברו עד הסוף.`);
  }
  const atCap = last7.filter(d => (d.gum || 0) >= (meta.gumSoftCap || 18)).length;
  if (atCap >= 3) {
    flags.push(`${atCap} ימים בשבוע האחרון בתקרת המסטיק — סימן שהפער עוד פתוח.`);
  }
  // רק ימים מכוסים נספרים כ"בלי מדבקה". קודם לכן יום שלא תועד נספר
  // כדילוג, כך שהדגל היחיד שנדלק על שתיקה היה גם הדגל הלא-נכון.
  const missed = last7.filter(d => covered(d) && !d.patch).length;
  if (missed >= 3) {
    flags.push(`${missed} ימים בשבוע האחרון בלי סימון מדבקה — התמדה היא גורם ההצלחה מס׳ 1, ובודקים אותה ראשונה.`);
  }
  // `blind` מוחזר בנפרד מהדגלים כי הוא לא "עוד סימפטום": הוא אומר
  // שאין לנו בכלל תמונה. maybeEscalate דורש שני דגלים כדי לא להציף,
  // אבל כיסוי חסר חייב לעמוד בפני עצמו — אחרת שבוע של שתיקה, שהוא
  // בדיוק המצב שהכי צריך פנייה, לעולם לא יעבור את הסף.
  return { flags, stats: a, blind };
}

/**
 * שער ההסלמה — חי כאן ולא ב-index.js, וזה לא סידור.
 *
 * התנאי היה `!blind && flags.length < 2` בתוך maybeEscalate, כלומר
 * **הנתונים היו כאן והכלל היה שם**. בדיוק בפער הזה נולד הבאג: הדגל
 * היחיד שנדלק על שבוע שקט לא הספיק לסף של שניים, ואיש לא ראה את זה
 * כי אף צד לא הכיל את התמונה המלאה. עכשיו שניהם באותו קובץ ובדיקים.
 *
 * שני דגלים כדי לא להציף — אבל כיסוי חסר עומד בפני עצמו, כי הוא לא
 * "עוד סימפטום" אלא היעדר תמונה.
 */
export const ESCALATION_MIN_FLAGS = 2;

export const shouldEscalate = ({ flags, blind }) =>
  !!blind || flags.length >= ESCALATION_MIN_FLAGS;

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
  // המספר הזה שווה יותר מכל עצה: זו ההוכחה שלו, על עצמו, שהגל דועך.
  if (a.medianWaveSec != null && a.waveSamples >= 3) {
    const m = Math.floor(a.medianWaveSec / 60), s = a.medianWaveSec % 60;
    L.push(`⏱️ <b>אורך הגל החציוני שלך: ${m ? `${m} דק׳ ` : ''}${s} שנ׳</b> <i>(${a.waveSamples} גלים שנמדדו) — דקות, לא שעות. זה הנתון שלך, לא טענה מספר.</i>`);
  }

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

// מסלול ההסלמה הוא **בתוך NRT בלבד**. תרופות מרשם נשללו מדעת, והבוט
// לא מציע אותן — לא כאן ולא בשום מקום. הידיות שנשארו אמיתיות ורובן
// עוד לא נוצלו, וזה בדיוק מה שההודעה הזאת אמורה להגיד.
export function escalationText(flags, a, blind = false) {
  // שבוע בלי תיעוד מקבל פנייה אחרת לגמרי. סולם ההסלמה נבנה על נתונים,
  // ואין טעם — ואף לא הגינות — לדחוף אותו במי שפשוט הפסיק לדווח.
  if (blind) {
    return [
      '👋 <b>בדיקה קצרה</b>',
      '─────────────',
      `רק ${a.coverage} מתוך 7 הימים האחרונים תועדו, אז אני באמת לא יודע איפה אתה.`,
      '',
      'ולמה אני שואל דווקא עכשיו: <b>ניתוק מהבוט הוא בדרך כלל מה שקורה כשקשה</b>, לא כשהכול טוב. אם זה המצב — זה בסדר, וזה בדיוק הרגע שכדאי לחזור.',
      '',
      'ואם פשוט היה עמוס ואתה בסדר גמור — תגיד לי ואשתוק.',
      '',
      '<i>שתי לחיצות ביום מספיקות כדי שהמספרים יחזרו להיות אמיתיים.</i>',
    ].join('\n');
  }
  return [
    '⚠️ <b>נקודת החלטה — לא אזעקה</b>',
    '─────────────',
    'לפי הנתונים שלך מהשבוע:',
    ...flags.map(f => `• ${f}`),
    '',
    '<b>מה התוכנית אומרת על המצב הזה (סעיף יב׳) — בסדר הזה:</b>',
    '1 · <b>להעלות מספר מנות</b> לפני כל דבר אחר. תת-שימוש הוא כשל ה-NRT הנפוץ ביותר, וזו הידית הזולה והמהירה ביותר.',
    '2 · <b>לתזמן מחדש</b> — מנה ~30 דקות <b>לפני</b> חלון-סיכון חוזר. מנה שנלקחת בשיא הגל מבוזבזת פרמקולוגית.',
    '3 · <b>מדבקת 24 שעות</b> אם הבקרים הם הנקודה החלשה. שאלה לרוקח, הפיך תוך יום.',
    '4 · <b>להאריך את המנה המלאה.</b> הדרגה מול הפסקה פתאומית: RR 0.99 — להאריך זה בדיוק אותה מידה של מבוסס-ראיות כמו לרדת.',
    '5 · <b>חוזה-פיקדון</b> (RR 1.49, ודאות גבוהה) ו-<b>*6800</b> (RR 1.37) — מצטברים, חינם, ועדיין לא בשימוש.',
    '',
    '<i>זה לא כישלון ולא "לא הצלחתי לבד". רוב הידיות ברשימה עוד לא נמשכו. ואם אחרי כולן זה לא מחזיק — זו שיחה עם רוקח או רופא, בלי שאני אמליץ מראש על כלום.</i>',
  ].join('\n');
}
