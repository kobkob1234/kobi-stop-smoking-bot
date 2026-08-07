// ==========================================================================
//  store.js — מצב מתמשך ב-Cloudflare KV
//  meta  : הגדרות + סכומים + מה נשלח היום + מצב SOS
//  d:ISO : היומן של יום מסוים
// ==========================================================================

import { migratePlan, PLAN_VER } from './gum.js';
import { migrateCbt } from './cbt/state.js';

// התקרה הרכה חייבת להישאר מעל היעד (12) במרווח סביר
const MIN_SOFT_CAP = 18;

const META_KEY = 'meta';

// סדר המקומות ב-plan.js השתנה ב-27.7.2026, וגם נוסף לו עוגן מפורש.
// כל siteOffset שנשמר לפני כן יישר את הרוטציה מול המערך הישן, ולכן
// הוא לא סתם לא-נחוץ אלא מזיק — הוא יזיז את העוגן החדש. מאפסים פעם אחת.
const SITE_ROTATION_VER = 2;

// גרסת המילוי-אחורה של המדבקות. עולה ב-1 בלבד כשצריך למלא שוב;
// ה-tick משווה מולה ומדלג אם כבר רץ. ראה את הבלוק ב-index.js.
export const PATCH_BACKFILL_VER = 1;

export const DEFAULT_META = {
  chatId: null,
  patchBackfillVer: 0,
  costPerDay: 25,          // ₪ ליום שהוויפ עלה — /כסף 30 משנה
  // תזכורת רכה בלבד; המקסימום המסומן ל-2 מ״ג הוא 24–25 מנות ביום.
  // חייב להיות **מעל** היעד: כשהיעד היה 10 והסף 12 זה עוד עבד, אבל עם
  // יעד 12 סף של 12 היה מפיק אזהרת מינון-יתר בכל יום שבו הוא עומד ביעד,
  // וגם דגל הסלמה שבועי — כלומר ציות מלא היה נקרא כמצוקה.
  gumSoftCap: 18,
  partner: '',             // שם בת/בן הזוג לתזכורות
  scenes: '',              // שלוש סצנות העתיד (כלי 4)
  identity: 'אני לא מווייפ. ההחלטה סגורה — אין דיון היום.',
  awaiting: null,          // 'mine' | 'journal' | 'win' | 'slip' | 'weekly' | 'waves'
  sos: null,               // {startedAt, followedUp, evIdx}
  quiet: false,            // השתקת תזכורות מתוזמנות
  sent: {},                // "ISO:slot" -> 1
  totals: { surfed: 0, waves: 0, slips: 0, outs: 0, mDone: 0, eDone: 0, gum: 0, patch: 0,
            planning: 0, chainStops: 0, enroute: 0 },

  // --- תוספות ---
  partnerChatId: null,     // צ׳אט של בת/בן הזוג לדיווח בלחיצה
  joinCode: null,          // {code, exp} — קוד חד-פעמי לחיבור השותף/ה
  training: null,          // {startISO, done:[1,2,...]} — אימון RAIN בן שבוע (נספח א׳)
  jarTotal: 0,             // מה שהועבר פיזית לצנצנת
  siteOffset: 0,           // יישור רוטציית המדבקה למציאות (/מקום), מעל SITE_ANCHOR
  siteVer: 0,              // גרסת מערך המקומות שה-siteOffset יושר מולה
  kbMode: 'fold',          // 'open' פתוחה תמיד · 'fold' מתקפלת · 'off' מוסתרת
  partnerMute: false,      // השתקת הדיווח האוטומטי לשותף/ה
  lastPartnerAlert: 0,     // מגרה של 30 דקות בין דיווחים מאותה דרגה
  lastPartnerAlertLevel: 0,// דרגת הדיווח האחרון — הסלמה ל-2 עוברת תמיד
  lastEscalationISO: null, // כדי לא להציף את הודעת ההסלמה
  ai: null,                // {date, n} — מכסת AI יומית
  gumPlan: null,           // תוכנית תזכורות המסטיק (ראה gum.js)
  gumRemindISO: null,      // היום של תזכורת המסטיק האחרונה
  gumRemindMin: null,      // ובאיזו דקה — לא יותר מפעם ב-45 דק׳
  gumSnoozeISO: null,      // דחייה: היום
  gumSnoozeMin: 0,         // ועד איזו דקה
  hist: [],                // זיכרון שיחה: [{r:'u'|'a', t, ts}] — ראה HIST_* למטה
  cbt: null,               // מודול ה-CBT: פרוטוקול, רצף וסשנים (ראה cbt/state.js)

};

// כל הודעה שמגיעה ל-AI כבר כותבת meta, ולכן ההיסטוריה לא עולה בכתיבה
// נוספת ל-KV. מה שכן צריך תקרה: meta נקרא בכל בקשה.
export const HIST_TURNS = 8;        // 4 חילופי דברים
export const HIST_CHARS = 260;      // לכל תור
export const HIST_TTL_MS = 2 * 3600 * 1000;  // שיחה מלפני שעתיים היא רעש

/** התורות הרלוונטיים בלבד, ישן→חדש */
export function recentHist(meta, nowMs = Date.now()) {
  return (meta.hist || []).filter(h => nowMs - (h.ts || 0) <= HIST_TTL_MS);
}

export function pushHist(meta, role, text, nowMs = Date.now()) {
  if (!text) return;
  const h = recentHist(meta, nowMs);
  h.push({ r: role, t: String(text).replace(/<[^>]*>/g, '').slice(0, HIST_CHARS), ts: nowMs });
  meta.hist = h.slice(-HIST_TURNS);
}

export async function getMeta(env) {
  const raw = await env.KV.get(META_KEY);
  const m = raw ? JSON.parse(raw) : {};
  const out = {
    ...DEFAULT_META, ...m,
    totals: { ...DEFAULT_META.totals, ...(m.totals || {}) },
    sent: m.sent || {},
  };
  if (out.siteVer !== SITE_ROTATION_VER) { out.siteOffset = 0; out.siteVer = SITE_ROTATION_VER; }
  // רץ בכל קריאה ולא רק בשדרוג גרסה — אותו לקח מ-repairPlan: מצב פגום
  // שנשמר בגרסה הנוכחית היה שורד לנצח.
  out.cbt = migrateCbt(out.cbt);
  // שדרוג תוכנית המסטיק ל-12 מנות. בלי זה `times` השמור היה גובר על
  // ברירת המחדל החדשה, והיעד החדש היה קיים בקוד ולא בפועל.
  if (out.gumPlan) {
    const before = out.gumPlan.ver || 1;
    out.gumPlan = migratePlan(out.gumPlan);
    // התקרה הרכה נשמרה כשהיעד היה 10, ולכן 15 היה מרווח של חמש מנות.
    // עם יעד 12 היא מרווח של שלוש, ו-atCap>=3 היה מדליק דגל הסלמה על
    // שלושה ימים קשים. מעלים פעם אחת יחד עם הלוח, ורק אם נשארה מתחת.
    if (before < PLAN_VER && out.gumSoftCap < MIN_SOFT_CAP) out.gumSoftCap = MIN_SOFT_CAP;
  }
  return out;
}

// מפתחות שמתחילים ב-_ הם request-scoped ולעולם לא נשמרים.
//
// זה קיים בגלל באג אמיתי: `/trigger?dry=1` קבע `meta.partnerMute = true`
// "כדי לבדוק בלי להטריד אותה", אבל startEnRoute/startWave/startPlanning
// מסתיימים ב-putMeta — כך שהדגל נשמר ל-KV, ובדיקה אחת השביתה את ערוץ
// ההתראה לשותפה **לצמיתות ובשקט**. הכלל הזה הופך את המחלקה הזאת של
// באגים לבלתי-אפשרית: כל דגל זמני נכתב עם _ ונעלם מעצמו.
export async function putMeta(env, meta) {
  const clean = {};
  for (const [k, v] of Object.entries(meta)) if (!k.startsWith('_')) clean[k] = v;
  await env.KV.put(META_KEY, JSON.stringify(clean));
}

export async function updateMeta(env, fn) {
  const m = await getMeta(env);
  const out = fn(m);
  await putMeta(env, out || m);
  return out || m;
}

export const EMPTY_DAY = {
  patch: false, gum: 0, waves: 0, surfed: 0, slips: 0, outs: 0,
  // ---- שני מדדים סובייקטיביים. 0 = לא נמדד. ----
  //
  //  כל השאר ברשומה הזאת הוא **התנהגות**, כי התנהגות קלה לספור. אבל
  //  ב-EMA, מכל המשתנים המצביים שנבדקו — שעה ביום, נוכחות מעשנים,
  //  קפה, אלכוהול — **רק דפוס האפקט השלילי ניבא מעידה ראשונה**.
  //  וירידה בחרדה/דיכאון/כעס לאורך 44 הימים הראשונים ניבאה הימנעות
  //  ב-3 חודשים ובשנה. כלומר נמדד כאן היטב מה שקל, ולא נמדד מה שמנבא.
  mood: 0,     // 1–5, יומי. 1 = רע מאוד · 5 = טוב מאוד
  // "עייפות גמילה" — פריט יחיד מתוקף ("עד כמה אתה עייף מלנסות"),
  // שמנבא הישנות **מעל ומעבר** למנבאים ידועים אחרים, כולל עוצמת
  // הדחפים ומסוגלות עצמית. הוא עולה ב-6 השבועות הראשונים ואז מתייצב,
  // ולכן נמדד שבועית ולא יומית — זה קצב השינוי שלו.
  fatigue: 0,  // 1–5, שבועי. 1 = בכלל לא עייף · 5 = עייף מאוד
  win: '', journal: '', mine: '', mDone: false, eDone: false,
  ev: [],       // אירועים למיפוי דפוסים: {k, h, m, tag}
  gumMissed: 0, // תזכורות שאושרו כ"לא לקחתי"
  gumSched: 0,  // יחידות שנלקחו לפי התוכנית
  gumExtra: 0,  // יחידות שנרשמו ביוזמתו ולא בתגובה לתזכורת
  gumCovered: 0,// תזכורות שדולגו כי נלקח מסטיק ב-45 הדק' שלפניהן
  planning: 0,  // פעמים שהמחשבות חיפשו דרך לצאת ולקנות (דרגה 2)
  chainStops: 0,// תחנות ראשונות שנעצרו — הסיבה נעלמה אחרי דחייה
  enroute: 0,   // פעמים שהיה בדרך לקנות ועצר (דרגה 3)
};

/** מסיר מפתחות request-scoped לפני כתיבה — ראה putMeta */
const strip = o => {
  const out = {};
  for (const [k, v] of Object.entries(o)) if (!k.startsWith('_')) out[k] = v;
  return out;
};

/**
 * יום מ-KV. `_exists` אומר אם הרשומה באמת קיימת.
 *
 * בלי הסימן הזה יום שלא תועד היה **בלתי-נבדל** מיום מאופס, ומכאן
 * העיוות החמור ביותר במערכת: שבוע של שתיקה מוחלטת קיבל ציון טוב יותר
 * משבוע אמיתי מוצלח — 0 דחפים, 0 מעידות, 0 מסטיקים — וגלאי ההסלמה
 * ראה בו שבוע תקין. התנתקות מהבוט היא בדיוק מה שקורה כשקשה, ולכן זה
 * היה עיוור בכיוון המסוכן.
 *
 * `_exists` מתחיל ב-_ ולכן strip() מוחק אותו בכתיבה — הוא לעולם לא
 * זולג לרשומה עצמה.
 */
export async function getDay(env, iso) {
  const raw = await env.KV.get('d:' + iso);
  let parsed = {};
  let ok = false;
  if (raw) {
    // בלי try/catch, רשומה פגומה אחת השביתה לצמיתות ובשקט כל
    // אינטראקציה בתאריך הזה — getDay נקרא בכל מסלול.
    try { parsed = JSON.parse(raw); ok = true; }
    catch (e) { console.log('DAY PARSE ERR', iso, e && e.message); }
  }
  const d = { ...EMPTY_DAY, ...parsed };
  if (!Array.isArray(d.ev)) d.ev = [];
  d._exists = ok;
  return d;
}

export async function updateDay(env, iso, fn) {
  const d = await getDay(env, iso);
  fn(d);
  await env.KV.put('d:' + iso, JSON.stringify(strip(d)));
  return d;
}

// ==========================================================================
//  מילוי אחורה של המדבקות — מיגרציה חד-פעמית
//
//  הוא לבש מדבקה בכל יום מאז הגמילה ופשוט לא סימן. הנתון אינו קוסמטי:
//  `patch:false` מייצר דגל הסלמה ומעוות כל ניתוח היצמדות.
//
//  **נוגע רק בימים שכבר יש להם רשומה.** יום בלי רשומה בכלל נשאר חסר
//  במכוון: `isLogged` היה הופך אותו ל"מכוסה", ודגל ה-blind — שכל תפקידו
//  לזהות שהדיווח נפסק — היה מושתק על ידי מילוי אחורה. תיקון נתונים לא
//  אמור לכבות גלאי.
//
//  זה כאן ולא ב-tick כדי שיהיה ניתן לבדיקה: הוא כותב לנתוני בריאות
//  אמיתיים, ולכן חייב בדיקה ולא רק הרצה.
// ==========================================================================
export async function backfillPatches(env, fromISO, todayISO, addDays) {
  let filled = 0, missing = 0, already = 0;
  for (let n = 0; ; n++) {
    const iso = addDays(fromISO, n);
    if (iso > todayISO) break;
    const rec = await getDay(env, iso);
    if (!rec._exists) { missing++; continue; }
    if (rec.patch) { already++; continue; }
    await updateDay(env, iso, d => { d.patch = true; });
    filled++;
  }
  return { filled, missing, already };
}

// ==========================================================================
//  הסקירה השבועית — `w:ISO`
//
//  הקריאה והכתיבה ישבו ב-index.js מול env.KV ישירות, כלומר שכבת
//  הנתונים לא ידעה שהמפתח הזה קיים. זה לא סיכון לשלמות (זו מחרוזת
//  חופשית ולא רשומה מובנית, ולכן strip לא רלוונטי) אבל זה כן אומר
//  ששני מקומות בקוד צריכים לזכור את אותה תבנית מפתח בעל-פה.
//
//  התקרה: KV מוגבל, והרפלקציה נכתבת ביד — 4000 תווים הם התקרה
//  שנקבעה בכתיבה, וחיתוך חייב לקרות פעם אחת ובמקום אחד.
// ==========================================================================
export const WEEKLY_MAX = 4000;
export const weeklyKey = iso => `w:${iso}`;

export const getWeekly = (env, iso) => env.KV.get(weeklyKey(iso));

export const putWeekly = (env, iso, text) =>
  env.KV.put(weeklyKey(iso), String(text).slice(0, WEEKLY_MAX));

// ניקוי מפתחות "נשלח" ישנים כדי שה-meta לא יגדל לנצח
export function pruneSent(meta, todayISO) {
  const keep = {};
  for (const k of Object.keys(meta.sent)) {
    const iso = k.split(':')[0];
    if (iso >= todayISO) keep[k] = 1;
    else if (Math.abs(Date.parse(iso) - Date.parse(todayISO)) <= 3 * 86400000) keep[k] = 1;
  }
  meta.sent = keep;

  // דחיות של ימים שעברו לא רלוונטיות, ואחרת הן נשארות ב-KV לנצח.
  if (meta.snooze) {
    const s = {};
    for (const [k, v] of Object.entries(meta.snooze)) {
      if (k.startsWith(todayISO + ':')) s[k] = v;
    }
    meta.snooze = s;
  }
}

// ==========================================================================
//  דירוגי מצב רוח — כמה ביום, לא אחד
//
//  מדידה יחידה בערב היא זיכרון משוחזר של יום שלם, והיא נוטה להיצבע
//  לפי איך שהיום הסתיים. 2–3 מדידות פרוסות תופסות את התנועה עצמה —
//  וזו התנועה שמנבאת, לא הממוצע.
//
//  כל דירוג נשמר כאירוע ב-ev (אותו מנגנון של המסטיק), ו-`mood` מחזיק
//  את **החציון** של היום כדי שכל הניתוחים הקיימים ימשיכו לעבוד בלי
//  לדעת שהמבנה השתנה.
// ==========================================================================
export const MOOD_MAX_PER_DAY = 3;

export const moodReadings = day => (day.ev || []).filter(e => e.k === 'mo');

export async function recordMood(env, iso, hour, minute, value) {
  return updateDay(env, iso, d => {
    d.ev = [...(d.ev || []), { k: 'mo', h: hour, m: minute, v: value }];
    const vals = moodReadings(d).map(e => e.v).sort((a, b) => a - b);
    d.mood = vals[Math.floor(vals.length / 2)];   // חציון היום
  });
}
