// ==========================================================================
//  store.js — מצב מתמשך ב-Cloudflare KV
//  meta  : הגדרות + סכומים + מה נשלח היום + מצב SOS
//  d:ISO : היומן של יום מסוים
// ==========================================================================

const META_KEY = 'meta';

// סדר המקומות ב-plan.js השתנה ב-27.7.2026, וגם נוסף לו עוגן מפורש.
// כל siteOffset שנשמר לפני כן יישר את הרוטציה מול המערך הישן, ולכן
// הוא לא סתם לא-נחוץ אלא מזיק — הוא יזיז את העוגן החדש. מאפסים פעם אחת.
const SITE_ROTATION_VER = 2;

export const DEFAULT_META = {
  chatId: null,
  costPerDay: 25,          // ₪ ליום שהוויפ עלה — /כסף 30 משנה
  gumSoftCap: 12,          // תזכורת רכה בלבד; המקסימום האמיתי הוא מה שעל האריזה
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
};

export async function getMeta(env) {
  const raw = await env.KV.get(META_KEY);
  const m = raw ? JSON.parse(raw) : {};
  const out = {
    ...DEFAULT_META, ...m,
    totals: { ...DEFAULT_META.totals, ...(m.totals || {}) },
    sent: m.sent || {},
  };
  if (out.siteVer !== SITE_ROTATION_VER) { out.siteOffset = 0; out.siteVer = SITE_ROTATION_VER; }
  return out;
}

export async function putMeta(env, meta) {
  await env.KV.put(META_KEY, JSON.stringify(meta));
}

export async function updateMeta(env, fn) {
  const m = await getMeta(env);
  const out = fn(m);
  await putMeta(env, out || m);
  return out || m;
}

export const EMPTY_DAY = {
  patch: false, gum: 0, waves: 0, surfed: 0, slips: 0, outs: 0,
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

export async function getDay(env, iso) {
  const raw = await env.KV.get('d:' + iso);
  const d = { ...EMPTY_DAY, ...(raw ? JSON.parse(raw) : {}) };
  if (!Array.isArray(d.ev)) d.ev = [];
  return d;
}

export async function updateDay(env, iso, fn) {
  const d = await getDay(env, iso);
  fn(d);
  await env.KV.put('d:' + iso, JSON.stringify(d));
  return d;
}

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
