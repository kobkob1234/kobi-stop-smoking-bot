// ==========================================================================
//  store.js — מצב מתמשך ב-Cloudflare KV
//  meta  : הגדרות + סכומים + מה נשלח היום + מצב SOS
//  d:ISO : היומן של יום מסוים
// ==========================================================================

const META_KEY = 'meta';

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
  totals: { surfed: 0, waves: 0, slips: 0, outs: 0, mDone: 0, eDone: 0, gum: 0, patch: 0 },

  // --- תוספות ---
  partnerChatId: null,     // צ׳אט של בת/בן הזוג לדיווח בלחיצה
  joinCode: null,          // {code, exp} — קוד חד-פעמי לחיבור השותף/ה
  training: null,          // {startISO, done:[1,2,...]} — אימון RAIN בן שבוע (נספח א׳)
  jarTotal: 0,             // מה שהועבר פיזית לצנצנת
  siteOffset: 0,           // יישור רוטציית המדבקה למציאות (/מקום)
  kbHidden: false,         // האם מקלדת הכפתורים מוסתרת (/מקלדת)
  partnerMute: false,      // השתקת הדיווח האוטומטי לשותף/ה
  lastPartnerAlert: 0,     // מגרה של 30 דקות בין דיווחי גל
  lastEscalationISO: null, // כדי לא להציף את הודעת ההסלמה
  ai: null,                // {date, n} — מכסת AI יומית
};

export async function getMeta(env) {
  const raw = await env.KV.get(META_KEY);
  const m = raw ? JSON.parse(raw) : {};
  return {
    ...DEFAULT_META, ...m,
    totals: { ...DEFAULT_META.totals, ...(m.totals || {}) },
    sent: m.sent || {},
  };
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
  ev: [],   // אירועים למיפוי דפוסים: {k:'w'|'x', h, m, tag}
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
}
