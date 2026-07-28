// ==========================================================================
//  index.js — Cloudflare Worker
//  fetch()     → webhook של טלגרם (תגובות מיידיות)
//  scheduled() → cron כל 10 דקות; מחליט לפי שעון ישראל מה לשלוח
// ==========================================================================

import { send, edit, answer, inline, btn, esc, MAIN_KB, mainKb, KB_REMOVE, setCommands } from './telegram.js';
import * as P from './plan.js';
import * as C from './content.js';
import * as M from './messages.js';
import * as KB from './kb.js';
import * as AI from './ai.js';
import * as ANL from './analytics.js';
import * as INT from './intent.js';
import * as G from './gum.js';
import { getMeta, putMeta, getDay, updateDay, pruneSent } from './store.js';

// מזהה בנייה. מתעדכן בכל פריסה ומוחזר ב-/diag, כדי שאפשר יהיה לדעת
// בוודאות איזו גרסה חיה במקום לנחש אחרי sleep. ארבע פעמים היום בדיקה
// רצה מול הגרסה הקודמת והסקתי מזה מסקנה שגויה.
export const BUILD = '114925';

// ---------- משבצות הזמן היומיות (שעון ישראל) ----------
const SLOTS = [
  { id: 'morning', h: 7,  m: 0,  grace: 240 },
  { id: 'micro1',  h: 10, m: 0,  grace: 90  },
  { id: 'noon',    h: 12, m: 30, grace: 120 },
  { id: 'micro2',  h: 15, m: 0,  grace: 90  },
  { id: 'risk',    h: 17, m: 30, grace: 150 },
  { id: 'evening', h: 21, m: 30, grace: 210 },
];

const BOT_COMMANDS = [
  { command: 'wave',    description: '🌊 יש לי דחף עכשיו' },
  { command: 'planning', description: '🧠 המחשבות מחפשות דרך לצאת ולקנות' },
  { command: 'enroute',  description: '🆘 אני בדרך לקנות' },
  { command: 'out',     description: '🚪 יוצא מהבית — טקס 20 השניות' },
  { command: 'gum',     description: '🍬 רישום מסטיק 2 מ״ג' },
  { command: 'patch',   description: '🩹 רישום מדבקה' },
  { command: 'status',  description: '📊 איפה אנחנו עומדים' },
  { command: 'tools',   description: '🧰 ארגז הכלים' },
  { command: 'morning', description: '🌅 טקס הבוקר' },
  { command: 'evening', description: '🌙 טקס הערב' },
  { command: 'slip',    description: '⚠️ מעידה — נוהל 90 השניות' },
  { command: 'report',  description: '📈 הדפוסים שלי — מיפוי אוטומטי' },
  { command: 'card',    description: '🪪 כרטיס הארנק' },
  { command: 'jar',     description: '🫙 הצנצנת — חוזה הפקדה' },
  { command: 'coach',   description: '🏋️ אימון RAIN שבועי' },
  { command: 'partner', description: '👥 חיבור בת/בן הזוג' },
  { command: 'site',    description: '📍 מקומות ההדבקה ויישור הרוטציה' },
  { command: 'gumplan', description: '🍬 תוכנית תזכורות המסטיק' },
  { command: 'taper',   description: '📉 תצמצום המסטיק' },
  { command: 'keyboard', description: '⌨️ מצב המקלדת: פתוחה / מתקפלת / מוסתרת' },
  { command: 'button',   description: '📲 כפתור פיזי — הפעלה בלי לפתוח את האפליקציה' },
  { command: 'review',  description: '🗓️ סקירה שבועית' },
  { command: 'phones',  description: '📞 טלפוני תמיכה' },
  { command: 'help',    description: '❓ עזרה' },
];

const ALIAS = {
  start:    ['start'],
  help:     ['help', 'עזרה'],
  status:   ['status', 'today', 'סטטוס', 'היום'],
  morning:  ['morning', 'בוקר'],
  evening:  ['evening', 'ערב'],
  wave:     ['wave', 'sos', 'גל', 'דחף'],
  out:      ['out', 'יוצא', 'יציאה'],
  gum:      ['gum', 'מסטיק'],
  patch:    ['patch', 'מדבקה'],
  tools:    ['tools', 'כלים'],
  slip:     ['slip', 'מעידה'],
  review:   ['review', 'סקירה'],
  phones:   ['phones', 'טלפונים'],
  money:    ['money', 'כסף'],
  scenes:   ['scenes', 'סצנות'],
  identity: ['identity', 'זהות'],
  quiet:    ['quiet', 'שקט'],
  unquiet:  ['unquiet', 'דבר'],
  win:      ['win', 'ניצחון', 'נצחון'],
  mine:     ['mine', 'מוקש'],
  report:   ['report', 'דוח', 'דוח', 'מיפוי', 'דפוסים'],
  card:     ['card', 'כרטיס'],
  jar:      ['jar', 'צנצנת'],
  coach:    ['coach', 'training', 'אימון'],
  partner:  ['partner', 'שותף', 'שותפה'],
  join:     ['join'],
  exportd:  ['export', 'ייצוא', 'יצוא'],
  ask:      ['ask', 'שאל', 'שאלה'],
  ai:       ['ai'],
  site:     ['site', 'מקום', 'מקומות'],
  planning: ['planning', 'תירוצים', 'שרשרת', 'מחשבות'],
  enroute:  ['enroute', 'בדרך', 'סוס'],
  keyboard: ['keyboard', 'מקלדת'],
  button:   ['button', 'כפתור'],
  isometric:['isometric', 'איזומטרי', 'איזומטרית', 'בישיבה'],
};

const inPlanDay = pl => !pl.before && !pl.after;
const iso0 = now => now.iso;

// ==========================================================================
//  זיהוי כוונה בטקסט חופשי
//
//  urge הוא הדפוס הקריטי: כל אמירה שיש בה דחף או כוונת קנייה חייבת
//  להגיע לזרימת הגל. השיקול כאן א-סימטרי בכוונה — התראת שווא עולה
//  לחיצה אחת, החמצה עולה מכשיר חדש. לכן הרשימה רחבה.
//
//  ("אני רוצה ללכת לקנות וויפ" לא נתפס בגרסה הראשונה ונשמר ביומן.
//   זה היה הכשל היחיד שאסור היה לקרות, ומכאן הרוחב.)
// ==========================================================================
const RX = {
  // עבר — כבר קרה
  slip: /קניתי|נפלתי|שאפתי|שאבתי|עשיתי שאכטה|מעדתי|לקחתי שאכטה|התפרקתי וקניתי|נכנעתי/,
  // ...אלא אם זה בשלילה. "התגברתי, לא קניתי" הוא ניצחון, לא מעידה —
  // וסימון שגוי כמעידה גם מזין את גלאי ההסלמה בנתון כזב.
  slipNegated: /(?:לא|בלי ש|התגברתי|נמנעתי|הצלחתי לא|כמעט)\s*(?:קניתי|שאפתי|שאבתי|נפלתי|מעדתי|נכנעתי)/,

  // דרגה 3: כבר בדרך. נבדק **ראשון** — בלעדיו "אני בדרך לחנות" נתפס
  // על ידי RX.urge ומנותב לדרגה 1, כלומר הניסוח הדחוף ביותר קיבל את
  // התגובה הרפה ביותר ובלי דיווח לבת הזוג.
  enroute: new RegExp([
    'בדרך לחנות', 'בדרך לקנות', 'בדרך לפיצוצי', 'בדרך לקיוסק',
    'הולך לקנות', 'יוצא לקנות', 'נוסע לקנות', 'הולך לחנות',
    'עומד בחנות', 'נכנס לחנות', 'בקופה', 'היד על הארנק', 'הכסף ביד',
    'עוד רגע קונה', 'כבר בחנות',
  ].join('|')),

  // דרגה 2: המחשבות מייצרות תירוצים לצאת. נבדק לפני urge.
  planning: new RegExp([
    'מחפש (?:תירוצ|סיב|דרך|דרכים)', 'מחפשות (?:תירוצ|סיב|דרך|דרכים)',
    'תירוצ', 'משכנע את עצמי', 'מצדיק', 'מתכנן',
    'סתם אצא', 'סתם לצאת', 'סתם אסתובב', 'צריך לצאת לרגע', 'חייב אוויר',
    'נגמר ה', 'אני צריך לקנות משהו', 'אקפוץ ל', 'רק אקנה',
    'מחשבות מחפשות', 'הראש מחפש', 'תחנה ראשונה',
  ].join('|')),

  // דחף או כוונת קנייה — הווה/עתיד
  urge: new RegExp([
    // כוונת קנייה מפורשת
    'לקנות', 'אקנה', 'קונה עכשיו', 'הולך לקנות', 'יוצא לקנות', 'נוסע לקנות',
    // רצון / משיכה
    'בא לי', 'מתחשק', 'רוצה (?:לשאוף|לוויפ|לווייפ|וויפ|ויפ|סיגריה|עשן|שאכטה)',
    'חייב (?:וויפ|ויפ|סיגריה|שאכטה|לשאוף)', 'צריך (?:וויפ|ויפ|שאכטה)',
    // דחף בשמותיו
    'יש לי גל', 'יש לי דחף', 'גל של קנייה', 'גל עכשיו', 'דחף עכשיו',
    'דחף', 'קראבינג', 'קרייבינג', 'השתוקקות',
    // מקום
    'בדרך לחנות', 'ליד החנות', 'מול החנות', 'בחנות', 'בקיוסק', 'בפיצוצי', 'לפיצוצי',
    // מצוקה שמובילה לשם
    'מתפוצץ', 'לא מחזיק', 'לא יכול יותר', 'נשבר לי', 'מתפרק', 'קורס',
    'מגיע לי אחת', 'רק אחת', 'רק שאכטה',
  ].join('|')),

  // שלילה — "לא בא לי", "לא רוצה לקנות"
  negated: /(?:^|\s)(?:לא|אין לי חשק|התגברתי|הצלחתי לא|נמנעתי)\s+(?:בא לי|רוצה|מתחשק|חייב|צריך|הולך|יוצא|אקנה)/,

  out:    /יוצא מהבית|יוצא לדרך|יוצא החוצה|אני יוצא|יורד למטה|הולך להסתובב/,
  gum:    /^מסטיק|לקחתי מסטיק|לעסתי/,
  patch:  /^מדבקה|הדבקתי|שמתי מדבקה/,
  status: /^(סטטוס|איפה אנחנו|מה המצב|איפה אני)/,
  win:    /ניצחון|נצחון|גלשתי|עברתי את זה|לא קניתי|כמעט קניתי|כמעט נפלתי|עצרתי בזמן|התגברתי/,
};

function resolveCmd(word) {
  for (const [key, list] of Object.entries(ALIAS)) if (list.includes(word)) return key;
  return null;
}

// ==========================================================================
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === '/health') return new Response('ok');

    // בדיקת שפיות + קרון-גיבוי מ-GitHub Actions (מוגן ב-WEBHOOK_SECRET)
    if (['/diag', '/cron', '/export', '/send', '/ask', '/trigger'].includes(url.pathname)) {
      // /trigger מקבל גם TRIGGER_KEY נפרד — הסוד הזה יושב בקיצור על
      // הטלפון, ולא רצוי שיהיה אותו סוד שמגן על /export ועל הווביהוק.
      const given = url.searchParams.get('key');
      const okKey = (env.WEBHOOK_SECRET && given === env.WEBHOOK_SECRET)
        || (url.pathname === '/trigger' && env.TRIGGER_KEY && given === env.TRIGGER_KEY);
      if (!okKey) return new Response('forbidden', { status: 403 });

      if (url.pathname === '/cron') {
        await tick(env);
        return new Response('ticked');
      }
      // שליחה כפויה של משבצת — מדלגת על ה-dedup ועל חלון החסד.
      // לבדיקות, ולשליחה חוזרת של הבוקר/ערב אם משהו התפספס.
      if (url.pathname === '/send') {
        const meta = await getMeta(env);
        if (!meta.chatId) return new Response('not linked', { status: 409 });
        const slot = url.searchParams.get('slot') || 'morning';
        if (!SLOTS.some(x => x.id === slot)) return new Response('unknown slot', { status: 400 });
        const now = P.il();
        const pl = P.planFor(now.iso, meta.siteOffset);
        const day = await getDay(env, now.iso);
        const msg = await buildSlot(slot, pl, now.iso, day, meta, now);
        if (!msg) return new Response('nothing to send', { status: 204 });
        const r = await send(env, meta.chatId, msg.text, { reply_markup: msg.kb });
        // כברירת מחדל *לא* מסמנים כ"נשלח", כדי ששליחת בדיקה לא תבטל
        // את ההודעה המתוזמנת האמיתית של אותו יום. ?mark=1 כדי לסמן בכל זאת.
        if (url.searchParams.get('mark') === '1') {
          meta.sent[`${now.iso}:${slot}`] = 1;
          await putMeta(env, meta);
        }
        return Response.json({ sent: slot, ok: r.ok, marked: url.searchParams.get('mark') === '1' });
      }
      // בדיקת שכבת השיחה בלי לשלוח כלום לטלגרם
      if (url.pathname === '/ask') {
        const q = url.searchParams.get('q') || '';
        if (!q) return new Response('missing q', { status: 400 });
        const meta = await getMeta(env);
        const now = P.il();
        const pl = P.planFor(now.iso, meta.siteOffset);
        const day = await getDay(env, now.iso);
        const hit = KB.answer(q);
        const cls = AI.enabled(env) ? await INT.classify(env, q, await buildState(env, pl, now.iso, now, meta)) : null;
        return Response.json({
          q,
          intent: cls ? cls.intent : null,
          urgency: cls ? cls.urgency : null,
          reply: cls ? cls.reply : null,
          kb: hit ? { topic: hit.t, score: +hit.score.toFixed(1) } : null,
          provider: AI.provider(env),
        });
      }
      // ------------------------------------------------------------------
      //  /trigger — הפעלה בקריאה אחת, בשביל כפתור פיזי.
      //
      //  ברגע דחף אמיתי, "לפתוח נעילה → למצוא טלגרם → לגלול → ללחוץ" הוא
      //  יותר מדי. עם נקודת הקצה הזאת אפשר לחבר קיצור של מערכת ההפעלה:
      //  הקשה כפולה על גב האייפון, כפתור הפעולה, תג NFC על הארנק, או
      //  "היי סירי, יש לי דחף" — והזרימה מופעלת בלי לגעת באפליקציה.
      //
      //  level=1 דחף רגיל · level=2 תירוצים לצאת · level=3 בדרך לקנות
      //  what=gum רישום מסטיק · what=patch רישום מדבקה
      //
      //  מקבל גם TRIGGER_KEY נפרד, כדי שהסוד שיושב בקיצור בטלפון לא
      //  יהיה אותו סוד שמגן על כל שאר נקודות הקצה.
      // ------------------------------------------------------------------
      if (url.pathname === '/trigger') {
        const meta = await getMeta(env);
        if (!meta.chatId) return new Response('not linked', { status: 409 });
        const now = P.il();
        const iso = now.iso;
        const pl = P.planFor(iso, meta.siteOffset);
        const what = (url.searchParams.get('what') || '').toLowerCase();

        if (what === 'gum')   { await logGum(meta.chatId, env, iso, meta, now);   return new Response('🍬 מסטיק נרשם'); }
        if (what === 'patch') { await logPatch(meta.chatId, env, iso, pl, meta, now); return new Response('🩹 מדבקה נרשמה'); }

        const level = parseInt(url.searchParams.get('level') || '1', 10);
        if (level === 3) { await startEnRoute(meta.chatId, env, meta, iso, now); return new Response('🆘 בדרך לקנות — נשלח, ובת הזוג עודכנה'); }
        if (level === 2) { await startPlanning(meta.chatId, env, meta, iso, now); return new Response('🧠 תירוצים לצאת — נשלח, ובת הזוג עודכנה'); }
        await startWave(meta.chatId, env, meta, iso, now);
        return new Response('🌊 דחף — הזרימה נשלחה לטלגרם');
      }

      if (url.pathname === '/export') {
        const now = P.il();
        const days = await ANL.collect(env, now.iso, parseInt(url.searchParams.get('days') || '120', 10));
        const meta = await getMeta(env);
        const out = { exportedAt: now.iso, meta: { ...meta, sent: undefined }, days: days.filter(d => d.waves || d.gum || d.journal || d.win || d.patch || d.slips) };
        return new Response(JSON.stringify(out, null, 1), {
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      const meta = await getMeta(env);
      const now = P.il();
      const pl = P.planFor(now.iso, meta.siteOffset);
      const day = await getDay(env, now.iso);
      return Response.json({
        ok: true,
        israelTime: `${now.iso} ${now.hhmm}`,
        linked: !!meta.chatId,
        partnerLinked: !!meta.partnerChatId,
        quiet: meta.quiet,
        day: pl.n, dose: pl.dose ?? null, site: pl.site ?? null, cleanDays: pl.clean ?? pl.cleanDays ?? null,
        sentToday: Object.keys(meta.sent).filter(k => k.startsWith(now.iso)).map(k => k.split(':')[1]),
        today: { gum: day.gum, waves: day.waves, surfed: day.surfed, patch: day.patch },
        totals: meta.totals,
        ai: AI.provider(env),
        build: BUILD,
        kbTopics: KB.KB.length,
        gum: (() => {
          const gp = { ...G.DEFAULT_PLAN, ...(meta.gumPlan || {}) };
          const t = G.taperInfo(gp, now.iso);
          return {
            on: gp.on,
            planned: G.sortTimes(gp.times).length,
            activeToday: G.activeTimes(gp, now.iso).length,
            times: G.activeTimes(gp, now.iso),
            taperStart: gp.taperStartISO,
            taperConfirmed: !!gp.confirmedTaper,
            taperPending: !!(t && t.pending),
            takenToday: day.gum,
            scheduled: day.gumSched || 0,
            extra: day.gumExtra || 0,
            missed: day.gumMissed || 0,
          };
        })(),
      });
    }

    if (url.pathname === '/setup') {
      // /setup?key=WEBHOOK_SECRET — רושם את תפריט הפקודות
      if (!env.WEBHOOK_SECRET || url.searchParams.get('key') !== env.WEBHOOK_SECRET) {
        return new Response('forbidden', { status: 403 });
      }
      const r = await setCommands(env, BOT_COMMANDS);
      return new Response(JSON.stringify(r), { headers: { 'content-type': 'application/json' } });
    }

    if (req.method !== 'POST') return new Response('vape-quit companion bot');

    if (env.WEBHOOK_SECRET &&
        req.headers.get('x-telegram-bot-api-secret-token') !== env.WEBHOOK_SECRET) {
      return new Response('forbidden', { status: 403 });
    }

    const update = await req.json().catch(() => null);
    if (!update) return new Response('bad request', { status: 400 });

    // מחכים לסיום הטיפול לפני ה-ACK. טלגרם מסדר עדכונים לפי צ׳אט וממתין
    // ל-ACK, כך שהמתנה כאן מונעת מריצת-מונים כששולחים שתי לחיצות מהר.
    // תמיד מחזירים 200 כדי שטלגרם לא ייכנס ללופ של ניסיונות חוזרים.
    try { await handle(update, env); }
    catch (e) { console.log('HANDLE ERR', e && e.stack); }
    return new Response('ok');
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(tick(env).catch(e => console.log('CRON ERR', e && e.stack)));
  },
};

// ==========================================================================
//  Cron — מה לשלוח עכשיו
// ==========================================================================
async function tick(env) {
  const meta = await getMeta(env);
  if (!meta.chatId) return;                       // עוד לא נעשה /start

  const now = P.il();
  const iso = now.iso;
  let dirty = false;

  // --- מעקב SOS: צ׳ק-אין ~10 דקות אחרי שהתחיל גל ---
  if (meta.sos && !meta.sos.followedUp) {
    const mins = (Date.now() - meta.sos.startedAt) / 60000;
    if (mins >= 9 && mins <= 40) {
      await send(env, meta.chatId, [
        `🌊 <b>צ׳ק-אין — עברו ${Math.round(mins)} דקות מאז שהתחיל הגל.</b>`,
        '',
        `איפה זה עכשיו בסולם 1–10? רק להסתכל, בלי לשפוט.`,
        `בדרך-כלל בשלב הזה הגל כבר בצד השני של השיא.`,
        '',
        `<i>אם עברת את זה — זה לא "לשרוד". זה אימון שנרשם.</i>`,
      ].join('\n'), {
        reply_markup: inline([
          [btn('🏆 הגל נשבר — רשום ניצחון', 'sos:done')],
          [btn('▶️ עוד הנחיית RAIN', 'rw:0'), btn('🍬 מסטיק ✓', 'g')],
        ]),
      });
      meta.sos.followedUp = true;
      dirty = true;
    } else if (mins > 40) {
      meta.sos = null;
      dirty = true;
    }
  }

  // --- תזכורות המסטיק, לפי התוכנית ובשעות שנקבעו ---
  if (!meta.quiet) {
    const plan = { ...G.DEFAULT_PLAN, ...(meta.gumPlan || {}) };
    if (plan.on) {
      const active = G.activeTimes(plan, iso);
      const day = await getDay(env, iso);
      for (let i = 0; i < active.length; i++) {
        const t = active[i];
        const key = `${iso}:gum:${t}`;
        if (meta.sent[key]) continue;
        const [hh, mm] = t.split(':').map(Number);
        // דחייה: אם נדחה, היעד הוא הזמן החדש ולא השעה המקורית. בלי זה
        // הכפתור אמר "20 דקות" והתזכורת חזרה בטיק הבא — כלומר עד 10.
        const snoozed = (meta.snooze || {})[key];
        const target = typeof snoozed === 'number' ? snoozed : hh * 60 + mm;
        if (now.minutes < target) continue;
        meta.sent[key] = 1;
        if (snoozed !== undefined) { delete meta.snooze[key]; }
        dirty = true;
        if (now.minutes - target > 75) continue;      // איחור גדול — מדלגים בשקט

        // אם נלקח מסטיק ב-45 הדקות האחרונות (למשל יחידה נוספת מחוץ
        // לתוכנית), התזכורת הזאת מיותרת — והיא גם לא "הוחמצה". סופרים
        // אותה כמכוסה, כדי שההיצמדות תשקף את המציאות ולא תיראה גרועה.
        const since = G.minutesSinceLastGum(day, now.minutes);
        if (since !== null && since <= 45) {
          await updateDay(env, iso, d => { d.gumCovered = (d.gumCovered || 0) + 1; });
          console.log('GUM דילג על', t, '— נלקח לפני', since, 'דק');
          continue;
        }
        console.log('GUM תזכורת נשלחה:', t);
        await send(env, meta.chatId, G.reminderText(t, plan, iso, day, i, active.length), {
          reply_markup: inline([
            [btn('✅ לקחתי', `gr:y:${t}`), btn('⏭️ מדלג', `gr:n:${t}`)],
            [btn('⏰ עוד 20 דק׳', `gr:s:${t}`)],
          ]),
        });
      }
    }

    // --- 15.9: יום פתיחת התצמצום — שואלים לפני שמתחילים ---
    const taperDue = plan.on && plan.taperStartISO && !plan.confirmedTaper
      && P.diffDays(plan.taperStartISO, iso) >= 0
      && P.diffDays(plan.taperStartISO, iso) % 3 === 0;   // חוזר על השאלה כל 3 ימים
    if (taperDue && now.minutes >= 9 * 60 && !meta.sent[`${iso}:taperask`]) {
      meta.sent[`${iso}:taperask`] = 1;
      dirty = true;
      const d14 = await ANL.collect(env, iso, 14);
      const rd = G.readiness(d14.slice(0, 7), d14.slice(7, 14));
      await send(env, meta.chatId, [
        `📉 <b>תצמצום המסטיק — ${P.fmtHe(iso)}</b>`,
        '',
        `לפי התוכנית: יחידה אחת פחות כל ${plan.stepDays} ימים, מ-${G.sortTimes(plan.times).length} יחידות עד יחידת הבוקר בלבד.`,
        '',
        '<b>אבל התנאי הוא מצב, לא תאריך.</b> אלה הנתונים שלך:',
        `• מסטיק: <b>${rd.nowAvg}</b> ביום בשבוע האחרון (שבוע לפני כן: ${rd.prevAvg})`,
        `• מחוץ לתוכנית: <b>${rd.extra}</b> יחידות בשבוע`,
        `• דחפים: ${rd.waves} · עברו: ${rd.surfed}${rd.slips ? ` · מעידות: ${rd.slips}` : ''}`,
        '',
        rd.ready
          ? '✅ <b>הנתונים נראים יציבים.</b> הצריכה לא עולה, השימוש לפי צורך נמוך, ואין מעידות. זה נראה כמו הזמן.'
          : '⏸️ <b>הנתונים מצביעים על להמתין:</b>\n' + rd.reasons.map(r => `   • ${r}`).join('\n'),
        '',
        '<i>אין פרס על מהירות. תצמצם שמחזיר גלים הוא תצמצם שנכשל.</i>',
        '<i>עד שתאשר — נשארים על המספר המלא. אשאל שוב בעוד שלושה ימים.</i>',
      ].join('\n'), {
        reply_markup: inline([
          [btn('✅ יציב — מתחילים לצמצם', 'tp:go')],
          [btn('⏸️ עוד לא — דחה בשבוע', 'tp:wait')],
          [btn('📉 קרא את תוכנית הצמצום', 'T:taper')],
        ]),
      });
    }

    for (const slot of SLOTS) {
      const key = `${iso}:${slot.id}`;
      if (meta.sent[key]) continue;
      const target = slot.h * 60 + slot.m;
      if (now.minutes < target) continue;

      meta.sent[key] = 1;
      dirty = true;

      if (now.minutes - target > slot.grace) continue;   // מאוחר מדי — מדלגים בשקט

      const pl = P.planFor(iso, meta.siteOffset);
      const day = await getDay(env, iso);
      const msg = await buildSlot(slot.id, pl, iso, day, meta, now);
      if (msg) await send(env, meta.chatId, msg.text, { reply_markup: msg.kb });

      // אחרי הודעת הערב: דוח דפוסים במוצ״ש, ובדיקת נקודת ההסלמה
      if (slot.id === 'evening') {
        if (now.dow === 6) await sendWeeklyReport(env, meta, iso);
        await maybeEscalate(env, meta, iso);
      }
    }
  }

  if (dirty) { pruneSent(meta, iso); await putMeta(env, meta); }
}

/** דוח הדפוסים השבועי — הופך את טבלת המיפוי מהמדריך לדבר אוטומטי */
async function sendWeeklyReport(env, meta, iso) {
  const days = await ANL.collect(env, iso, 7);
  const a = ANL.analyse(days);
  if (!a.waves && !a.gum) return;
  const text = ANL.reportText(a, ANL.suggestIfThen(a), 7);
  await send(env, meta.chatId, text, {
    reply_markup: inline([
      [btn('✍️ טבלת האם-אז', 'T:ifthen'), btn('🗓️ סקירה שבועית', 'T:weekly')],
      [btn('🫙 הצנצנת', 'jar:ask')],
    ]),
  });
  if (meta.partnerChatId) {
    await send(env, meta.partnerChatId, [
      `🗓️ <b>סיכום שבוע</b>`,
      `🌊 דחפים שעברו עד הסוף: <b>${a.surfed}</b> מתוך ${a.waves} (${a.surfRate}%)`,
      a.slips ? `↩️ מעידות: ${a.slips} — <i>דאטה, לא ציון. בלי חשבון נפש.</i>` : '✅ בלי מעידות השבוע.',
      '',
      `<i>מודדים שחרורים, לא רק ימים. וחגיגה שבועית קטנה היא חלק מהשיטה.</i>`,
    ].join('\n'));
  }
}

/** נקודת ההחלטה להסלמה (סעיף יב׳) — לכל היותר פעם בשבוע */
async function maybeEscalate(env, meta, iso) {
  if (meta.lastEscalationISO && P.diffDays(meta.lastEscalationISO, iso) < 7) return;
  const days = await ANL.collect(env, iso, 7);
  const { flags, stats } = ANL.escalationFlags(days, meta);
  if (flags.length < 2) return;                       // דורש שני סימנים, לא אחד
  meta.lastEscalationISO = iso;
  await send(env, meta.chatId, ANL.escalationText(flags, stats), {
    reply_markup: inline([
      [btn('📞 טלפוני תמיכה', 'T:phones')],
      [btn('🍬 מדריך המסטיק', 'T:gum'), btn('🩹 שגרת המדבקה', 'T:patch')],
    ]),
  });
}

async function buildSlot(id, pl, iso, day, meta, now) {
  switch (id) {
    case 'morning': return M.morning(pl, day, meta);
    case 'micro1':  return M.micro(pl, iso, 0);
    case 'noon':    return M.noon(pl, iso, day, meta);
    case 'micro2':  return M.micro(pl, iso, 7);
    case 'risk':    return M.risk(pl, iso, day, meta);
    case 'evening': return M.evening(pl, iso, day, meta, now.dow === 6);
    default:        return null;
  }
}

// ==========================================================================
//  טיפול ב-update
// ==========================================================================
async function handle(update, env) {
  if (update.message) return onMessage(update.message, env);
  if (update.callback_query) return onCallback(update.callback_query, env);
}

// ---------- בעלות: הבוט הזה אישי ----------
async function guard(chatId, env) {
  const meta = await getMeta(env);
  if (!meta.chatId) { meta.chatId = chatId; await putMeta(env, meta); return meta; }
  if (String(meta.chatId) !== String(chatId)) return null;
  return meta;
}

// ==========================================================================
async function onMessage(msg, env) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  if (!text) return;

  // /join <code> — הדרך היחידה שצ׳אט אחר (בת/בן הזוג) נכנס פנימה
  if (/^\/join(@\w+)?\s/i.test(text)) return onJoin(text, chatId, msg, env);

  // הודעה מבת/בן הזוג — לפני נעילת הבעלות, אחרת היא נדחית
  const pre = await getMeta(env);
  if (pre.partnerChatId && String(pre.partnerChatId) === String(chatId)) {
    await send(env, pre.chatId, `👥 <b>הודעה מבת/בן הזוג:</b>\n${esc(text)}`);
    return send(env, chatId, 'נמסר ✓');
  }

  const meta = await guard(chatId, env);
  if (!meta) { await send(env, chatId, 'הבוט הזה אישי ומשויך למשתמש אחר. 🙏'); return; }

  const now = P.il();
  const iso = now.iso;
  const pl = P.planFor(iso, meta.siteOffset);

  // ---- פקודה? ----
  if (text.startsWith('/')) {
    const raw = text.slice(1).split(/\s+/);
    const word = raw[0].split('@')[0];
    const arg = text.slice(1 + raw[0].length).trim();
    const cmd = resolveCmd(word);
    if (cmd) { meta.awaiting = null; await putMeta(env, meta); return runCommand(cmd, arg, chatId, env, meta, pl, iso, now); }
    await send(env, chatId, 'לא הכרתי את הפקודה. /עזרה לרשימה המלאה.', { reply_markup: mainKb(meta.kbMode || 'fold') });
    return;
  }

  // ---- כפתורי המקלדת הקבועה ----
  const kbMap = {
    // הטקסט הישן נשאר ממופה: מקלדת שכבר מוצגת במכשיר לא מתעדכנת
    // לבד, ולחיצה עליה חייבת להמשיך לעבוד.
    '🌊 יש לי דחף עכשיו': 'wave', '🌊 יש לי גל': 'wave',
    '🧠 המחשבות מחפשות דרך לקנות': 'planning',
    '🆘 אני בדרך לקנות': 'enroute',
    '🚪 יוצא מהבית': 'out', '🍬 מסטיק': 'gum',
    '🩹 מדבקה': 'patch', '🧰 כלים': 'tools', '📊 סטטוס': 'status',
  };
  if (kbMap[text]) { meta.awaiting = null; await putMeta(env, meta); return runCommand(kbMap[text], '', chatId, env, meta, pl, iso, now); }

  // ---- ממתינים לטקסט? ----
  if (meta.awaiting) {
    const field = meta.awaiting;
    meta.awaiting = null;
    await putMeta(env, meta);

    if (field === 'money') {
      const n = parseFloat(text.replace(/[^\d.]/g, ''));
      if (!isNaN(n) && n >= 0) { meta.costPerDay = Math.round(n); await putMeta(env, meta); }
      await send(env, chatId, `💰 עודכן: <b>${meta.costPerDay}₪ ליום</b>.\nנחסך עד עכשיו: <b>${(pl.clean || 0) * meta.costPerDay}₪</b>.\n\n<i>שים את הסכום בצד — חוזה הפקדה עצמי הוא אחד האפקטים ההתנהגותיים הכי חזקים (RR 1.49).</i>`);
      return;
    }
    if (field === 'scenes') {
      meta.scenes = text.slice(0, 2000); await putMeta(env, meta);
      await send(env, chatId, '🔮 שלוש הסצנות נשמרו. אשלח לך אותן ברגעי דחף.');
      return;
    }
    if (field === 'identity') {
      meta.identity = text.slice(0, 300); await putMeta(env, meta);
      await send(env, chatId, `🪪 משפט הזהות נשמר:\n"${esc(meta.identity)}"\n\nכל בוקר — בקול, ליד המדבקה.`);
      return;
    }
    if (field === 'weekly') {
      await env.KV.put(`w:${iso}`, text.slice(0, 4000));
      await send(env, chatId, '🗓️ הסקירה השבועית נשמרה. <i>מודדים שחרורים, לא רק ימים.</i>');
      return;
    }
    if (field === 'jar') {
      const n = parseFloat(text.replace(/[^\d.]/g, ''));
      if (!isNaN(n) && n >= 0) { meta.jarTotal = Math.round(n); await putMeta(env, meta); }
      await send(env, chatId, `🫙 הצנצנת: <b>${meta.jarTotal}₪</b>.\n\nוקבע מראש למה זה הולך — זה מה שהופך את זה מחיסכון לחוזה.`);
      return;
    }

    const labels = { mine: '🎯 מוקש היום נרשם', journal: '📓 היומן נשמר', win: '🏆 הניצחון נרשם', slip: '📝 התחנה הראשונה נרשמה' };
    await updateDay(env, iso, d => {
      if (field === 'mine') d.mine = text.slice(0, 500);
      if (field === 'journal') d.journal = text.slice(0, 2000);
      if (field === 'win') d.win = text.slice(0, 500);
      if (field === 'slip') d.journal = (d.journal ? d.journal + '\n' : '') + 'מעידה — התחנה הראשונה: ' + text.slice(0, 500);
    });

    let extra = '';
    if (field === 'win') extra = '\n\n<b>עצור 5 שניות ותרגיש אותו.</b> בלי זה הלולאה החדשה לא נצרבת. (ברואר, פרק 7)';
    if (field === 'mine') extra = '\n\nעכשיו נסח את האם-אז שלו: "אם ___ ← אז ___". פעולה אחת, ספציפית.';
    if (field === 'slip') extra = '\n\nזו נקודת ההתערבות שלך — היא נכנסת לטבלת האם-אז כשורה חדשה. וזה הכול. בלי יום של חשבון נפש.';
    await send(env, chatId, `${labels[field] || 'נשמר'} ✓${extra}`);
    return;
  }

  // ---- טקסט חופשי ----
  // המסלול המהיר: ביטויים חד-משמעיים בלבד, כדי שברגע דחף אמיתי
  // התשובה תהיה מיידית ולא תמתין לרשת. כל השאר עובר להבנת המודל
  // ב-converse(), ושם אין רשימת מילים שאפשר ליפול דרכה.
  const t = text.replace(/[״"'׳]/g, '');
  const R = c => runCommand(c, '', chatId, env, meta, pl, iso, now);

  // 1 · עבר — מעידה שקרתה. חייב להיקדם לזיהוי הדחף, אחרת "קניתי"
  //     ייתפס כ"רוצה לקנות".
  if (RX.slip.test(t) && !RX.slipNegated.test(t)) return R('slip');

  // 2 · דרגה 3 ראשונה: הדחופה מכולן, ולכן היא זוכה על כל השאר.
  if (RX.enroute.test(t) && !RX.negated.test(t)) return R('enroute');

  // 3 · דרגה 2: תירוצים לצאת הם התחנה הראשונה בשרשרת, וזו הדרגה
  //     שמדווחת לשותפה. נבדקת לפני דחף רגיל.
  if (RX.planning.test(t) && !RX.negated.test(t)) return R('planning');

  // 3 · דחף רגיל — הרגע שכל הבוט קיים בשבילו.
  //     כאן מעדיפים בכוונה זיהוי-יתר: התראת שווא עולה לחיצה אחת,
  //     החמצה עולה מכשיר חדש.
  if (RX.urge.test(t) && !RX.negated.test(t)) return R('wave');

  // 3 · שאר הכוונות
  if (RX.out.test(t))    return R('out');
  if (RX.gum.test(t))    return R('gum');
  if (RX.patch.test(t))  return R('patch');
  if (RX.status.test(t)) return R('status');
  if (RX.win.test(t))    return R('win');

  // ---- שיחה: קודם בסיס הידע מהמדריכים, אחר-כך AI (אם מופעל) ----
  return converse(text, chatId, env, meta, pl, iso, now);
}

/**
 * המצב שנשלח למודל כהקשר.
 *
 * זה מה שמאפשר לו לענות על שאלות נתונים — "מתי היה המסטיק האחרון?",
 * "כמה לקחתי אתמול?", "באיזו שעה הגלים באים?" — במקום להחזיר כרטיס
 * סטטוס קבוע. בלי הנתונים האלה בהקשר, המודל פשוט לא יודע.
 */
const hm = e => `${String(e.h).padStart(2, '0')}:${String(e.m).padStart(2, '0')}`;

function agoText(now, e) {
  let mins = now.minutes - (e.h * 60 + e.m);
  if (mins < 0) mins += 1440;
  if (mins < 1) return 'ממש עכשיו';
  if (mins === 1) return 'לפני דקה';
  if (mins < 60) return `לפני ${mins} דקות`;
  const h = Math.floor(mins / 60), m = mins % 60;
  const hh = h === 1 ? 'שעה' : `${h} שעות`;
  return m ? `לפני ${hh} ו-${m} דקות` : `לפני ${hh}`;
}

function evLine(now, evs, kind, label) {
  const list = evs.filter(e => e.k === kind);
  if (!list.length) return `${label}: 0`;
  const times = list.map(hm).join(', ');
  const last = list[list.length - 1];
  return `${label}: ${list.length} — בשעות ${times}. האחרון ב-${hm(last)} (${agoText(now, last)})`;
}

async function buildState(env, pl, iso, now, meta) {
  const day = await getDay(env, iso);
  const L = [];

  // --- התוכנית ---
  if (inPlanDay(pl)) {
    const nextStep = pl.dose === 21 ? 'ירידה ל-14 מ״ג ב-18.8'
      : pl.dose === 14 ? 'ירידה ל-7 מ״ג ב-1.9' : 'סיום מדבקות ב-15.9';
    L.push(`תוכנית: יום ${pl.n} מתוך 70 · שבוע ${pl.week} · ${pl.phase} ${pl.dose} מ״ג · מקום ההדבקה היום: ${pl.site} · ${nextStep} · ${pl.clean} ימים נקיים · נחסך ${pl.clean * meta.costPerDay}₪`);
  } else if (pl.before) L.push(`לפני יום ההפסקה — עוד ${pl.daysToQuit} ימים (7.7.2026)`);
  else L.push(`סיים את 70 הימים · ${pl.cleanDays} ימים נקיים`);

  // --- היום, עם שעות ---
  L.push(`היום ${P.fmtHe(iso)} (יום ${now.dowHe}), השעה כרגע ${now.hhmm}:`);
  L.push('  ' + evLine(now, day.ev, 'g', 'מסטיק 2 מ״ג') + (day.gum && !day.ev.some(e => e.k === 'g') ? ` (סה״כ ${day.gum}, בלי שעות מתועדות)` : ''));
  const patchEv = day.ev.filter(e => e.k === 'p').pop();
  L.push(`  מדבקה: ${day.patch ? (patchEv ? `הודבקה ב-${hm(patchEv)}` : 'סומנה') : 'עוד לא סומנה היום'}`);
  const waves = day.ev.filter(e => e.k === 'w');
  L.push(`  דחפים: ${day.waves}${waves.length ? ' — ' + waves.map(e => hm(e) + (e.tag ? ` (${ANL.TAGS[e.tag] || e.tag})` : '')).join(', ') : ''} · עברו עד הסוף: ${day.surfed}`);
  if (day.slips) L.push(`  מעידות היום: ${day.slips}`);
  L.push(`  יציאות עם טקס: ${day.outs}${day.mine ? ` · המוקש שרשם: ${day.mine}` : ''}`);
  if (day.win) L.push(`  הניצחון שרשם: ${day.win}`);

  // --- אתמול ---
  const y = await getDay(env, P.addDaysISO(iso, -1));
  L.push(`אתמול: מסטיק ${y.gum} · דחפים ${y.waves} · עברו ${y.surfed} · מדבקה ${y.patch ? 'סומנה' : 'לא סומנה'}${y.slips ? ` · מעידות ${y.slips}` : ''}`);

  // --- 7 ימים ---
  const week = await ANL.collect(env, iso, 7);
  const a = ANL.analyse(week);
  L.push(`7 ימים אחרונים: ${a.gumPerDay} מסטיק ביום בממוצע · ${a.waves} דחפים, ${a.surfed} עברו (${a.surfRate}%) · ${a.slips} מעידות · מדבקה סומנה ב-${a.patchDays}/7`);
  if (a.topBucket) L.push(`  שעת השיא של הגלים: ${a.topBucket[0]}${a.topTag ? ` · ההקשר החוזר: ${a.topTag[0]}` : ''}`);

  L.push('הערה: תיעוד שעות מדויק לכל אירוע קיים רק מ-26.7.2026 והלאה. לפני זה יש ספירות בלבד.');
  return L.join('\n');
}

/**
 * שכבת ה"דיבור" — כאן המודל גם מבין את הכוונה וגם עונה.
 *
 * הסדר:
 *  1. המודל מסווג ומנסח בקריאה אחת. אם הכוונה היא פעולה (דחף, מעידה,
 *     יציאה, רישום) — מריצים את הזרימה האמיתית ולא רק עונים בטקסט.
 *  2. אין AI / נפל / נגמרה מכסה → בסיס הידע מהמדריכים.
 *  3. גם זה לא → שומרים ביומן, שכלום לא ייפול לרצפה.
 */
async function converse(text, chatId, env, meta, pl, iso, now) {
  const R = c => runCommand(c, '', chatId, env, meta, pl, iso, now);
  meta._today = iso;

  // ---- 1 · סיווג + ניסוח על ידי המודל ----
  if (AI.enabled(env) && text.trim().length >= 3) {
    if (AI.quotaLeft(meta, env) > 0) {
      const res = await INT.classify(env, text, await buildState(env, pl, iso, now, meta));
      if (res) {
        AI.noteUse(meta, iso);
        await putMeta(env, meta);

        // כוונות שדורשות פעולה — הזרימה האמיתית, לא רק תשובה.
        // שתי הדרגות החמורות חייבות להיות כאן: בלעדיהן טקסט חופשי
        // שהמודל מסווג נכון היה מקבל תשובה בצ׳אט בלי להפעיל את הזרימה
        // ובלי שהדיווח לבת הזוג יֵצא — כלומר בדיוק ההפוך מהכוונה.
        if (res.intent === 'urge_enroute')  { if (res.reply) await send(env, chatId, res.reply); return R('enroute'); }
        if (res.intent === 'urge_planning') { if (res.reply) await send(env, chatId, res.reply); return R('planning'); }
        if (res.intent === 'urge')  { if (res.reply) await send(env, chatId, res.reply); return R('wave'); }
        if (res.intent === 'slip')  { if (res.reply) await send(env, chatId, res.reply); return R('slip'); }
        if (res.intent === 'leaving_home') return R('out');
        if (res.intent === 'log_gum')      return R('gum');
        if (res.intent === 'log_patch')    return R('patch');
        if (res.intent === 'status')       return R('status');
        if (res.intent === 'log_win') {
          const day = await updateDay(env, iso, d => { d.surfed += 1; d.win = d.win || text.slice(0, 300); });
          const m2 = await getMeta(env); m2.totals.surfed += 1; m2.sos = null; await putMeta(env, m2);
          return send(env, chatId, `${res.reply}\n\n🌊 <b>נרשם — דחפים שעברו היום: ${day.surfed}</b> · סה״כ ${m2.totals.surfed}`);
        }
        if (res.intent === 'crisis') return send(env, chatId, INT.CRISIS_TEXT);

        // שאלה / רגש / אחר — תשובה בלבד
        const m = M.answerBlock(res.reply, null);
        return send(env, chatId, m.text, { reply_markup: m.kb });
      }
    } else {
      await send(env, chatId, '🤖 נגמרה המכסה היומית של השיחה החופשית. בסיס הידע מהמדריכים עדיין עובד — שאל בקצרה, או /כלים.');
    }
  }

  // ---- 1ב · הסיווג לא חזר תקין → תשובה חופשית בלי סיווג ----
  // (המסלול המהיר בביטוי הרגולרי כבר רץ לפני זה, כך שדחף מפורש
  //  לא מגיע לכאן בכלל.)
  if (AI.enabled(env) && AI.quotaLeft(meta, env) > 0) {
    const plain = await AI.ask(env, text, await buildState(env, pl, iso, now, meta));
    if (plain) {
      AI.noteUse(meta, iso);
      await putMeta(env, meta);
      const m = M.answerBlock(plain, null);
      return send(env, chatId, m.text, { reply_markup: m.kb });
    }
  }

  // ---- 2 · בסיס הידע ----
  const hit = KB.answer(text);
  if (hit) {
    const m = M.answerBlock(hit.text, null);
    return send(env, chatId, m.text, { reply_markup: m.kb });
  }

  // ---- 3 · לא מאבדים כלום ----
  await updateDay(env, iso, d => { d.journal = (d.journal ? d.journal + '\n' : '') + text.slice(0, 800); });
  await send(env, chatId, [
    '📓 שמרתי את זה ביומן של היום.',
    '',
    'אם יש דחף עכשיו — הכפתור הראשון למטה, והוא תמיד שם.',
  ].join('\n'), {
    reply_markup: inline([
      [btn('🌊 יש לי דחף עכשיו', 'sos:1'), btn('🚪 יוצא מהבית', 'out:start')],
      [btn('🧰 כלים', 'T:menu'), btn('📊 סטטוס', 'st')],
    ]),
  });
}

/** חיבור בת/בן הזוג בקוד חד-פעמי */
async function onJoin(text, chatId, msg, env) {
  const code = text.split(/\s+/)[1] || '';
  const meta = await getMeta(env);
  if (!meta.chatId) return send(env, chatId, 'הבוט עוד לא הופעל. 🙏');
  if (String(meta.chatId) === String(chatId)) return send(env, chatId, 'זה הצ׳אט הראשי שלך — הקוד מיועד לבת/בן הזוג.');
  if (!meta.joinCode || meta.joinCode.code !== code || Date.now() > meta.joinCode.exp) {
    return send(env, chatId, 'הקוד לא תקף. בקש קוד חדש (/שותף בצ׳אט הראשי).');
  }
  meta.partnerChatId = chatId;
  meta.joinCode = null;
  await putMeta(env, meta);
  const name = msg.from?.first_name || 'שותף/ה';
  await send(env, chatId, [
    `👥 <b>חוברת בהצלחה, ${esc(name)}.</b>`,
    '',
    'מה תקבלי/תקבל כאן: <b>דיווח כשיש גל</b>, וניצחונות.',
    '',
    '<b>שלוש הנחיות מהמדריך:</b>',
    '• זה <b>דיווח, לא בקשת רשות</b>. לא צריך לעשות כלום — הסודיות היא מה שהחזיק את הסבבים.',
    '• תגובת הקבע: <b>"זה גל — אני איתך, הוא יעבור."</b>',
    '• לעולם לא להציע "אז קח שאכטה", וגם לא לענות בעצבים באותו מטבע.',
    '',
    'אפשר לכתוב לי כאן והודעה תועבר אליו.',
  ].join('\n'));
  await send(env, meta.chatId, `👥 <b>${esc(name)} חובר/ה ✓</b>\nמעכשיו כפתור אחד שולח דיווח גל — בלי העתקה והדבקה.`);
}

// ==========================================================================
async function runCommand(cmd, arg, chatId, env, meta, pl, iso, now) {
  const day = await getDay(env, iso);
  const R = (m, extra = {}) => send(env, chatId, m.text, { reply_markup: m.kb, ...extra });

  switch (cmd) {
    case 'start': {
      await R(M.welcome(pl, meta));
      await send(env, chatId, 'המקלדת מוכנה 👇\n<i>⊞ שליד שדה הכתיבה פותח אותה. /מקלדת כדי שתישאר פתוחה תמיד — לחיצה אחת ברגע דחף.</i>', { reply_markup: mainKb(meta.kbMode || 'fold') });
      await setCommands(env, BOT_COMMANDS);
      return;
    }
    case 'help':    return R(M.help());
    case 'status':  return R(M.status(pl, iso, day, meta));
    case 'morning': return R(M.morning(pl, day, meta));
    case 'evening': return R(M.evening(pl, iso, day, meta, now.dow === 6));
    case 'tools':   return R(M.toolsMenu());
    case 'isometric':
      return send(env, chatId, C.ISOMETRIC, {
        reply_markup: inline([
          [btn('🍬 מסטיק ✓', 'g'), btn('🌊 עשיתי — הגל נחלש', 'sf')],
          [btn('🧰 חזרה לכלים', 'T:menu')],
        ]),
      });
    case 'wave': return startWave(chatId, env, meta, iso, now);
    case 'planning': return startPlanning(chatId, env, meta, iso, now);
    case 'enroute':  return startEnRoute(chatId, env, meta, iso, now);
    case 'out':   return R(M.outing(pl, iso, day, meta, now));
    case 'gum':   return logGum(chatId, env, iso, meta, now);
    case 'patch': return logPatch(chatId, env, iso, pl, meta, now);
    case 'slip': {
      const evIdx = await recordWave(env, iso, now, 'x');
      const m = await getMeta(env);
      m.totals.slips += 1; m.awaiting = 'slip'; m.sos = { startedAt: Date.now(), followedUp: true, evIdx };
      await putMeta(env, m);
      await send(env, chatId, C.SLIP_90);
      await send(env, chatId, [
        '📝 <b>שאלה אחת של מדען, ונגמר:</b>',
        'מה הייתה <b>התחנה הראשונה</b> בשרשרת? (ההחלטה ה"תמימה" הראשונה — לא הקופה.)',
        '',
        'ענה לי בהודעה ואשמור. ואז חוזרים לשגרה <b>מהשעה הזאת</b> — לא ממחר.',
      ].join('\n'));
      return;
    }
    case 'review': {
      const m = await getMeta(env); m.awaiting = 'weekly'; await putMeta(env, m);
      return send(env, chatId, C.WEEKLY);
    }
    case 'phones': return send(env, chatId, C.PHONES);
    case 'money': {
      const n = parseFloat(String(arg).replace(/[^\d.]/g, ''));
      if (!isNaN(n) && n > 0) {
        meta.costPerDay = Math.round(n); await putMeta(env, meta);
        return send(env, chatId, `💰 עודכן: <b>${meta.costPerDay}₪ ליום</b>.\nנחסך מאז 7.7: <b>${(pl.clean || 0) * meta.costPerDay}₪</b>.`);
      }
      meta.awaiting = 'money'; await putMeta(env, meta);
      return send(env, chatId, `💰 כמה הוויפ עלה לך <b>ליום</b> בשקלים? שלח מספר.\n(עכשיו מוגדר: ${meta.costPerDay}₪/יום · נחסך: ${(pl.clean || 0) * meta.costPerDay}₪)`);
    }
    case 'scenes': {
      if (arg) { meta.scenes = arg.slice(0, 2000); await putMeta(env, meta); return send(env, chatId, '🔮 נשמר. אשלח לך את זה ברגעי דחף.'); }
      if (meta.scenes) {
        return send(env, chatId, `🔮 <b>שלוש הסצנות שלך:</b>\n\n${esc(meta.scenes)}\n\n<i>לכתוב מחדש: /סצנות ואז הטקסט.</i>`);
      }
      meta.awaiting = 'scenes'; await putMeta(env, meta);
      return send(env, chatId, C.SCENES + '\n\n📝 שלח לי אותן עכשיו בהודעה אחת.');
    }
    case 'identity': {
      if (arg) { meta.identity = arg.slice(0, 300); await putMeta(env, meta); return send(env, chatId, `🪪 נשמר: "${esc(meta.identity)}"`); }
      await send(env, chatId, C.IDENTITY);
      meta.awaiting = 'identity'; await putMeta(env, meta);
      return send(env, chatId, `📝 המשפט שלך כרגע: "${esc(meta.identity)}"\nרוצה לנסח אחרת? שלח את הנוסח שלך (או התעלם).`);
    }
    case 'win': {
      meta.awaiting = 'win'; await putMeta(env, meta);
      return send(env, chatId, '🏆 מה הניצחון של היום? (אחד לפחות — גם קטן.)');
    }
    case 'mine': {
      meta.awaiting = 'mine'; await putMeta(env, meta);
      return send(env, chatId, '🎯 מה המוקש של היום — המצב המסוכן הצפוי (שעה/מקום/מצב רוח), ומה התגובה המוכנה?');
    }
    case 'report': {
      const days = await ANL.collect(env, iso, 14);
      const a = ANL.analyse(days);
      const text = ANL.reportText(a, ANL.suggestIfThen(a), 14);
      return send(env, chatId, text, {
        reply_markup: inline([
          [btn('✍️ טבלת האם-אז', 'T:ifthen'), btn('⛓️ שרשרת ההחלטות', 'T:chain')],
          [btn('🗓️ סקירה שבועית', 'T:weekly')],
        ]),
      });
    }
    case 'site': {
      const lines = [
        '📍 <b>מקומות ההדבקה</b>',
        '─────────────',
        'הרוטציה שלך, לפי הסדר — מחליפה צד וגובה בכל יום:',
        '',
        ...P.SITES.map((s, i) => `${i === (pl.siteIndex ?? -1) ? '👉' : `${i + 1} ·`} ${s}${i === (pl.siteIndex ?? -1) ? '  ← <b>היום</b>' : ''}`),
        '',
        'לוחצים 10 שניות, על עור נקי, יבש וחסר שיער. שוטפים ידיים.',
        '',
        '⚠️ עם 6 מקומות, אותו מקום חוזר <b>כל 6 ימים</b> — יום אחד פחות מכלל "לא אותו אזור תוך 7 ימים". אם מופיע גירוי, שווה להוסיף מקום שביעי (למשל זרוע עליונה) ואז המחזור נעשה 7.',
        '',
        '<b>לא שם היום איפה שאני אומר?</b> לחץ למטה ואיישר את הרוטציה למציאות — משם היא תמשיך נכון לבד.',
      ];
      const rows = [];
      for (let i = 0; i < P.SITES.length; i += 2) {
        rows.push(P.SITES.slice(i, i + 2).map((s, j) => btn(s, `site:${i + j}`)));
      }
      return send(env, chatId, lines.join('\n'), { reply_markup: inline(rows) });
    }
    case 'card':  return send(env, chatId, C.WALLET_CARD, { reply_markup: inline([[btn('📌 הצמד את ההודעה הזאת למעלה', 'noop')]]) });
    case 'jar':   return R(M.jar(pl, meta));
    case 'coach': return R(M.training(meta, iso));
    case 'partner': {
      if (!meta.partnerChatId) {
        meta.joinCode = { code: Math.random().toString(36).slice(2, 8).toUpperCase(), exp: Date.now() + 30 * 60000 };
        await putMeta(env, meta);
      }
      return R(M.partnerInfo(meta, meta.joinCode && meta.joinCode.code));
    }
    case 'join': return send(env, chatId, 'שימוש: <code>/join CODE</code> — הקוד מתקבל אצל קובי בפקודה /שותף.');
    case 'exportd': {
      const days = await ANL.collect(env, iso, 30);
      const lines = [`# יומן גמילה — 30 ימים אחרונים (יוצא ${P.fmtHe(iso)})`];
      for (const d of days.slice().reverse()) {
        if (!d.waves && !d.gum && !d.journal && !d.win && !d.patch) continue;
        const pd = P.planFor(d.iso);
        lines.push('', `## ${P.fmtHe(d.iso)}${pd.n >= 1 && pd.n <= 70 ? ` · יום ${pd.n}/70 · ${pd.dose} מ״ג` : ''}`);
        lines.push(`מדבקה: ${d.patch ? 'כן' : 'לא'} · מסטיק: ${d.gum} · דחפים: ${d.waves} · עברו: ${d.surfed}${d.slips ? ` · מעידות: ${d.slips}` : ''}`);
        if (d.mine) lines.push(`מוקש: ${d.mine}`);
        if (d.win) lines.push(`ניצחון: ${d.win}`);
        if (d.journal) lines.push(`יומן: ${d.journal}`);
      }
      const body = lines.join('\n');
      // כטקסט אם קצר, כקובץ אם ארוך
      if (body.length < 3500) return send(env, chatId, `<pre>${esc(body)}</pre>`);
      const form = new FormData();
      form.append('chat_id', String(chatId));
      form.append('caption', '📤 היומן שלך');
      form.append('document', new Blob([body], { type: 'text/markdown' }), `yoman-${iso}.md`);
      await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendDocument`, { method: 'POST', body: form });
      return;
    }
    case 'ask': {
      if (!arg) return send(env, chatId, '❓ שאל אותי משהו: <code>/שאל למה הגל לא עובר?</code>\n(או פשוט כתוב את השאלה בלי פקודה.)');
      return converse(arg, chatId, env, meta, pl, iso, now);
    }
    case 'ai': {
      const p = AI.provider(env);
      meta._today = iso;
      return send(env, chatId, [
        `🤖 <b>שיחה חופשית</b>`,
        `ספק: <b>${p === 'off' ? 'כבוי' : p}</b>${AI.enabled(env) ? '' : ' <i>(לא מוגדר במלואו)</i>'}`,
        AI.enabled(env) ? `נותרו היום: <b>${AI.quotaLeft(meta, env)}</b> תשובות` : '',
        '',
        `בסיס הידע מהמדריכים (${KB.KB.length} נושאים) עובד תמיד, גם בלי AI, וגם בלי עלות.`,
        p === 'off' ? '\nלהדלקה — ראה README, סעיף "שיחה חופשית".' : '',
      ].filter(Boolean).join('\n'));
    }
    case 'gumplan': {
      const plan = { ...G.DEFAULT_PLAN, ...(meta.gumPlan || {}) };
      const active = G.activeTimes(plan, iso);
      const t = G.taperInfo(plan, iso);
      const day = await getDay(env, iso);
      const L = [
        '🍬 <b>תוכנית המסטיק</b>',
        '─────────────',
        `מצב: <b>${plan.on ? 'פעיל ✅' : 'כבוי 🔇'}</b> · היום <b>${active.length}</b> יחידות`,
        `שעות: ${active.join(' · ')}`,
        '',
        `היום: <b>${day.gum}</b> סה״כ · ${day.gumSched || 0}/${active.length} מתוזמנים · ${day.gumExtra || 0} נוספים${day.gumMissed ? ` · ${day.gumMissed} הוחמצו` : ''}`,
        '',
        '<i>מסטיק נוסף מחוץ לתוכנית — תמיד מותר. הכפתור 🍬 במקלדת, /מסטיק, או "לקחתי מסטיק". הוא נספר בנפרד כדי שנראה מה מתוזמן ומה לפי צורך.</i>',
        '<i>ואם לקחת יחידה נוספת — התזכורת שב-45 הדקות שאחריה מדולגת, ונספרת כמכוסה ולא כהוחמצה.</i>',
      ];
      if (t) {
        L.push('', t.pending
          ? `📉 תצמצום: <b>ממתין לאישור שלך</b> · מתוכנן מ-${P.fmtHe(plan.taperStartISO)}, יחידה אחת פחות כל ${t.step} ימים. עד שתאשר — נשארים על ${t.start}.`
          : t.dropsSoFar > 0
            ? `📉 בתצמצום: ${t.active} מתוך ${t.start} · ${t.atFloor ? 'הגעת לרצפה (בוקר בלבד)' : `הבאה שנופלת: ${t.nextToGo} ב-${P.fmtHe(t.nextDropISO)}`}`
            : `📉 התצמצום אושר ומתחיל ב-<b>${P.fmtHe(plan.taperStartISO)}</b> — יחידה אחת פחות כל ${t.step} ימים.`);
      }
      L.push('', `<i>${G.RECOMMENDED.why}</i>`);
      const rows = Object.entries(G.PRESETS).map(([k, v]) => [btn((k === 'ten' ? '⭐ ' : '') + v.label, `gp:${k}`)]);
      rows.push([btn(plan.on ? '🔇 כבה תזכורות' : '✅ הפעל תזכורות', 'gp:toggle')]);
      rows.push([btn('📉 תוכנית הצמצום', 'T:taper')]);
      return send(env, chatId, L.join('\n'), { reply_markup: inline(rows) });
    }
    case 'taper': return send(env, chatId, C.TAPER, { reply_markup: inline([[btn('🍬 תוכנית המסטיק', 'gp:show')]]) });
    case 'keyboard': {
      const modes = ['fold', 'open', 'off'];
      const names = {
        open: '📌 <b>פתוחה תמיד</b> — לחיצה אחת ברגע דחף. אין שדה כתיבה גלוי; לכתוב חופשי אפשר דרך כפתור ⊞.',
        fold: '⊞ <b>מתקפלת</b> — נפתחת בכפתור הריבועים שליד שדה הכתיבה. שתי לחיצות, אבל הכתיבה תמיד זמינה.',
        off:  '🔇 <b>מוסתרת</b> — בלי מקלדת. הפקודות והטקסט החופשי עובדים כרגיל.',
      };
      const cur = modes.includes(meta.kbMode) ? meta.kbMode : 'fold';
      const next = arg && modes.includes(arg) ? arg : modes[(modes.indexOf(cur) + 1) % modes.length];
      meta.kbMode = next;
      await putMeta(env, meta);
      return send(env, chatId, [
        `⌨️ <b>המקלדת: ${next === 'open' ? 'פתוחה תמיד' : next === 'fold' ? 'מתקפלת' : 'מוסתרת'}</b>`,
        '─────────────',
        names[next],
        '',
        '<i>/מקלדת שוב כדי להחליף מצב. ולחיצה אחת גם כשהטלפון נעול — /כפתור.</i>',
      ].join('\n'), { reply_markup: mainKb(next) });
    }

    case 'button': return send(env, chatId, C.PHYSICAL_BUTTON, {
      reply_markup: inline([[btn('⌨️ מצב המקלדת', 'kb:cycle')]]),
    });
    case 'quiet': {
      meta.quiet = true; await putMeta(env, meta);
      return send(env, chatId, '🔇 התזכורות המתוזמנות כבויות. הפקודות עדיין עובדות. /דבר להחזיר.');
    }
    case 'unquiet': {
      meta.quiet = false; await putMeta(env, meta);
      return send(env, chatId, '🔔 התזכורות חזרו: 07:00 · 10:00 · 12:30 · 15:00 · 17:30 · 21:30.');
    }
  }
}

/** רושם אירוע גל/מעידה עם שעה — הבסיס למיפוי הדפוסים. מחזיר את האינדקס. */
/**
 * רושם אירוע עם חותמת שעה. זה מה שמאפשר לענות על "מתי היה המסטיק
 * האחרון?" — בלי זה יש רק מונה, ואי-אפשר לגזור ממנו שעה.
 * k: w=גל · x=מעידה · g=מסטיק · p=מדבקה · o=יציאה · v=דחף שעבר
 */
async function recordEvent(env, iso, now, kind, extra = {}) {
  let idx = -1;
  await updateDay(env, iso, d => {
    d.ev.push({ k: kind, h: now.hour, m: now.min, ...extra });
    if (d.ev.length > 120) d.ev = d.ev.slice(-120);
    idx = d.ev.length - 1;
  });
  return idx;
}

/** שולח לשותף/ה. מחזיר true אם נמסר. */
async function notifyPartner(env, meta, text) {
  if (!meta.partnerChatId || meta.partnerMute) return false;
  const r = await send(env, meta.partnerChatId, text);
  if (!r.ok) console.log('דיווח לשותף/ה נכשל:', r.description);
  return !!r.ok;
}

/**
 * תחילת גל — נתיב אחד לכל המקומות (כפתור, פקודה, זיהוי כוונה).
 *
 * הדיווח לשותף/ה יוצא **כאן**, ברגע שהגל מתחיל — ולא בשלב 4 של
 * הזרימה כמו בגרסה הראשונה. שם זה היה חסר תועלת: מי שיוצא להליכה
 * אחרי הלחיצה הראשונה לא מגיע לשלב 4 בכלל, והשקט — שהוא מה
 * שהסבבים חיו עליו — נשמר בדיוק כשהוא הכי מזיק.
 *
 * מגרה של 30 דקות: אפיזודה אחת עם כמה גלים רצופים לא מפציצה אותה.
 */
/**
 * מדווח לשותפה — **רק בדרגות החמורות** (2 ו-3).
 *
 * דחף רגיל לא מגיע אליה: הוא חלק מהיום, והיא לא צריכה להיות צד לכל
 * אחד מהם. מה שכן מגיע: מחשבות שמייצרות תירוצים לצאת, ובדרך לקנות.
 *
 * מגרה: דיווח מאותה דרגה או נמוכה ממנה לא חוזר תוך 30 דקות, אבל
 * **הסלמה לדרגה גבוהה יותר עוברת תמיד** — זה בדיוק מה שהיא צריכה לדעת.
 */
async function alertPartner(env, meta, level) {
  if (level < 2) return false;
  if (!meta.partnerChatId || meta.partnerMute) return false;
  const fresh = Date.now() - (meta.lastPartnerAlert || 0) < 30 * 60000;
  if (fresh && (meta.lastPartnerAlertLevel || 0) >= level) return true;

  const body = level >= 3
    ? [`🆘 <b>${C.PARTNER_MSG_ENROUTE}</b>`, '',
       '<i>זו הדרגה הדחופה — הוא בדרך לקנות ולחץ על הכפתור במקום להמשיך.</i>',
       '<b>אם אפשר: תתקשרי אליו עכשיו.</b> שיחה אחת מפרקת את הסודיות שהסבבים חיו עליה.',
       '<i>ולעולם לא להציע "אז קח שאכטה".</i>']
    : [`🧠 <b>${C.PARTNER_MSG_PLANNING}</b>`, '',
       '<i>לא סתם דחף — מחשבות שמייצרות תירוצים לצאת. זו התחנה הראשונה בשרשרת.</i>',
       '<b>מה שעוזר: אם הוא יוצא — לצאת איתו.</b> זה המצב שהתוכנית מייעדת לך.',
       '<i>זה דיווח ולא בקשת רשות. ולעולם לא להציע "אז קח שאכטה".</i>'];

  if (!(await notifyPartner(env, meta, body.join('\n')))) return false;
  meta.lastPartnerAlert = Date.now();
  meta.lastPartnerAlertLevel = level;
  console.log('PARTNER דיווח נשלח, דרגה', level);
  return true;
}

/**
 * דרגה 1 — דחף רגיל. **בלי דיווח לשותפה, במכוון.**
 */
async function startWave(chatId, env, meta, iso, now) {
  const evIdx = await recordWave(env, iso, now, 'w');
  meta.totals.waves += 1;
  meta.sos = { startedAt: Date.now(), followedUp: false, evIdx, reported: false, level: 1 };
  await putMeta(env, meta);

  const m = M.sos(1);
  await send(env, chatId, m.text, { reply_markup: m.kb });
  if (meta.scenes) await send(env, chatId, `🔮 <b>הסצנות שכתבת לעצמך:</b>\n\n${esc(meta.scenes)}`);
  const tr = M.tagRow();
  await send(env, chatId, tr.text, { reply_markup: tr.kb });
}

/**
 * דרגה 2 — המחשבות מייצרות תירוצים לצאת ולקנות.
 * זו התחנה הראשונה בשרשרת של מרלט, ו**כאן מדווחים לשותפה**: שורת
 * האם-אז בתוכנית קובעת במפורש שבמצב הזה לוקחים שותף/ה או דוחים
 * ב-15 דקות ומודדים אם הסיבה שורדת.
 */
async function startPlanning(chatId, env, meta, iso, now) {
  const evIdx = await recordWave(env, iso, now, 'w');
  meta.totals.waves += 1;
  meta.totals.planning = (meta.totals.planning || 0) + 1;
  meta.sos = { startedAt: Date.now(), followedUp: false, evIdx, reported: false, level: 2 };
  await updateDay(env, iso, d => {
    d.planning = (d.planning || 0) + 1;
    if (d.ev[evIdx]) d.ev[evIdx].lvl = 2;
  });
  meta.sos.reported = await alertPartner(env, meta, 2);
  await putMeta(env, meta);

  const note = meta.sos.reported
    ? '\n\n📨 <i>בת הזוג קיבלה דיווח.</i>'
    : (meta.partnerChatId ? '' : '\n\n<i>אין שותפה מחוברת. /שותף כדי שהדיווח יֵצא לבד.</i>');

  await send(env, chatId, C.URGE_PLANNING + note, {
    reply_markup: inline([
      [btn('⏳ דוחה ב-15 דקות ומודד', 'pl:delay')],
      [btn('👥 יוצא רק עם בת הזוג', 'pl:together')],
      [btn('🚶 פונה 180° ומתחיל ללכת', 'sos:2')],
      [btn('🆘 אני כבר בדרך לקנות', 'er:start')],
      [btn('🚌 דה-פוזיה', 'T:defus'), btn('⛓️ שרשרת ההחלטות', 'T:chain')],
    ]),
  });
  const tr = M.tagRow();
  await send(env, chatId, tr.text, { reply_markup: tr.kb });
}

/**
 * דרגה 3 — בדרך לקנות. הדחופה מכולן, ולחיצה אחת מהמקלדת.
 * דיווח לשותפה יוצא מיד ועובר את המגרה גם אם דרגה 2 דווחה לפני רגע.
 */
async function startEnRoute(chatId, env, meta, iso, now) {
  const evIdx = await recordWave(env, iso, now, 'w');
  meta.totals.waves += 1;
  meta.totals.enroute = (meta.totals.enroute || 0) + 1;
  meta.sos = { startedAt: Date.now(), followedUp: false, evIdx, reported: false, level: 3 };
  await updateDay(env, iso, d => {
    d.enroute = (d.enroute || 0) + 1;
    if (d.ev[evIdx]) d.ev[evIdx].lvl = 3;
  });
  meta.sos.reported = await alertPartner(env, meta, 3);
  await putMeta(env, meta);

  await send(env, chatId, C.URGE_ENROUTE + (meta.sos.reported
    ? '\n\n📨 <i>בת הזוג קיבלה דיווח דחוף. אם היא מתקשרת — תענה.</i>'
    : (meta.partnerChatId ? '' : '\n\n<i>אין שותפה מחוברת. /שותף.</i>')), {
    reply_markup: inline([
      [btn('🚶 פונה 180° ומתחיל ללכת עכשיו', 'sos:2')],
      [btn('🎬 הרץ את הסרט עד הפח', 'sos:3')],
      [btn('🍬 לקחתי מסטיק ✓', 'g')],
    ]),
  });
  const tr = M.tagRow();
  await send(env, chatId, tr.text, { reply_markup: tr.kb });
}

async function recordWave(env, iso, now, kind) {
  await updateDay(env, iso, d => { if (kind === 'x') d.slips += 1; else d.waves += 1; });
  return recordEvent(env, iso, now, kind, { tag: null });
}

// ---------- רישום מסטיק ----------
async function logGum(chatId, env, iso, meta, now) {
  const day = await updateDay(env, iso, d => { d.gum += 1; d.gumExtra = (d.gumExtra || 0) + 1; });
  if (now) await recordEvent(env, iso, now, 'g', { extra: true });
  const m = await getMeta(env); m.totals.gum += 1; await putMeta(env, m);

  const plan = { ...G.DEFAULT_PLAN, ...(meta.gumPlan || {}) };
  const active = plan.on ? G.activeTimes(plan, iso) : [];
  const lines = [`🍬 <b>נרשם — מסטיק נוסף, מחוץ לתוכנית.</b>`];
  lines.push(`היום: <b>${day.gum}</b> סה״כ · ${day.gumSched || 0} מתוזמנים${active.length ? ` מתוך ${active.length}` : ''} · ${day.gumExtra || 0} נוספים`);
  if (day.gum % 4 === 1) {
    lines.push('', '<b>לעוס-והנח:</b> ללעוס עד עקצוץ ← להפסיק ← להניח בין החניכיים ללחי ← לחזור כשהעקצוץ נחלש. ~30 דקות.');
  }
  if (day.gum >= meta.gumSoftCap) {
    lines.push('', `⚠️ הגעת ל-${day.gum} יחידות היום. <b>בדוק את המקסימום שעל האריזה שלך ואל תחרוג ממנו.</b> בחילה/סחרחורת/פעימות מואצות = לשקול הפחתה ולהתייעץ עם רוקח.`);
  }
  return send(env, chatId, lines.join('\n'), {
    reply_markup: inline([[btn('🍬 עוד אחד', 'g'), btn('📖 איך נכון', 'T:gum')]]),
  });
}

// ---------- רישום מדבקה ----------
async function logPatch(chatId, env, iso, pl, meta, now) {
  const day = await updateDay(env, iso, d => { d.patch = true; });
  if (now) await recordEvent(env, iso, now, 'p');
  const m = await getMeta(env); m.totals.patch += 1; await putMeta(env, m);

  const lines = ['🩹 <b>מדבקה נרשמה ✓</b>'];
  if (!pl.before && !pl.after) {
    lines.push(`היום: <b>${pl.dose} מ״ג</b> (${pl.product}) · 📍 ${pl.site}`);
    const tm = P.planFor(P.addDaysISO(iso, 1), meta.siteOffset);
    if (!tm.after) lines.push(`מחר: ${tm.dose} מ״ג · 📍 ${tm.site}`);
  }
  lines.push('', '🍬 ותוך 30–60 דק׳ — מסטיק 2 מ״ג. המדבקה לוקחת 1–2 שעות לעלות בדם; זה הגשר.');
  lines.push('', '<i>התמדה מלאה = גורם ההצלחה מס׳ 1. אל תפסיק מוקדם כשתרגיש טוב.</i>');
  return send(env, chatId, lines.join('\n'), {
    reply_markup: inline([[btn('🍬 מסטיק ✓', 'g'), btn('📖 שגרת המדבקה', 'T:patch')]]),
  });
}

// ==========================================================================
//  כפתורים
// ==========================================================================
async function onCallback(cb, env) {
  const chatId = cb.message.chat.id;
  const msgId = cb.message.message_id;
  const data = cb.data || '';

  const meta = await guard(chatId, env);
  if (!meta) { await answer(env, cb.id, 'הבוט הזה אישי.'); return; }

  const now = P.il();
  const iso = now.iso;
  const pl = P.planFor(iso, meta.siteOffset);

  // --- כלים ---
  if (data.startsWith('T:')) {
    const key = data.slice(2);
    await answer(env, cb.id);
    if (key === 'menu') { const m = M.toolsMenu(); return send(env, chatId, m.text, { reply_markup: m.kb }); }
    if (key === 'weekly') {
      const m2 = await getMeta(env); m2.awaiting = 'weekly'; await putMeta(env, m2);
      return send(env, chatId, C.WEEKLY);
    }
    const text = M.TOOL_TEXTS[key];
    if (text) return send(env, chatId, text, { reply_markup: inline([[btn('🧰 חזרה לכלים', 'T:menu')]]) });
    return;
  }

  if (data === 'noop') return answer(env, cb.id);
  if (data === 'kb:cycle') { await answer(env, cb.id); return runCommand('keyboard', '', chatId, env, meta, pl, iso, now); }
  if (data === 'er:start') { await answer(env, cb.id); return startEnRoute(chatId, env, meta, iso, now); }

  // --- דרגה 2: תירוצים לצאת ---
  if (data.startsWith('pl:')) {
    const what = data.slice(3);
    if (what === 'start') { await answer(env, cb.id); return startPlanning(chatId, env, meta, iso, now); }
    if (what === 'delay') {
      const until = `${String(Math.floor((now.minutes + 15) / 60) % 24).padStart(2, '0')}:${String((now.minutes + 15) % 60).padStart(2, '0')}`;
      meta.snooze = { ...(meta.snooze || {}), [`${iso}:pl`]: now.minutes + 15 };
      await putMeta(env, meta);
      await answer(env, cb.id, 'נדחה ל-15 דק׳');
      return send(env, chatId, [
        `⏳ <b>נדחה עד ${until}.</b>`,
        '',
        'ועכשיו המדידה, וזו כל הפואנטה:',
        '<b>אם הסיבה אמיתית — היא תהיה שם גם ב-' + until + '.</b>',
        '<b>אם היא נעלמה — היא הייתה תירוץ.</b>',
        '',
        'בינתיים: מסטיק, ואם אפשר לזוז בבית — לזוז. לא יוצאים מהדלת עד השעה הזאת.',
        '',
        '<i>אזכיר לך לבדוק. וכל תחנה ראשונה שנעצרה נרשמת — זה בדיוק מה שהמדריך מבקש למדוד.</i>',
      ].join('\n'), { reply_markup: inline([[btn('✅ הסיבה נעלמה — היה תירוץ', 'pl:gone'), btn('🚪 עוד קיימת', 'out:start')]]) });
    }
    if (what === 'together') {
      await answer(env, cb.id, 'הדרך הנכונה');
      if (meta.partnerChatId) await notifyPartner(env, meta, '👥 <b>הוא יוצא — וביקש לצאת יחד.</b>\n\n<i>זה בדיוק המצב שהתוכנית מייעדת לך. לא שוטר — ליווי.</i>');
      return send(env, chatId, [
        '👥 <b>זו התשובה שהתוכנית נותנת למצב הזה.</b>',
        '',
        'יציאה "סתם להסתובב" עם כיווץ בגוף היא <b>בעצמה תחנה ראשונה</b>. יציאה עם מישהו סוגרת אותה — לא בכוח רצון, אלא בכך שהמסלול מפסיק להיות פרטי.',
        '',
        'ולפני שיוצאים — /יוצא לטקס 20 השניות.',
      ].join('\n'), { reply_markup: inline([[btn('🚪 טקס היציאה', 'out:start')]]) });
    }
    if (what === 'gone') {
      const day = await updateDay(env, iso, d => { d.surfed += 1; d.chainStops = (d.chainStops || 0) + 1; });
      await recordEvent(env, iso, now, 'v');
      const m2 = await getMeta(env); m2.totals.surfed += 1; m2.totals.chainStops = (m2.totals.chainStops || 0) + 1; m2.sos = null; await putMeta(env, m2);
      if (m2.partnerChatId && meta.sos && meta.sos.reported) {
        await notifyPartner(env, m2, '✅ <b>עבר.</b> הוא דחה ב-15 דקות והסיבה נעלמה — כלומר היא הייתה תירוץ, והוא תפס אותה בתחנה הראשונה.');
      }
      await answer(env, cb.id, 'נרשם 🎯');
      return send(env, chatId, [
        '🎯 <b>זה הדבר החזק ביותר שאפשר לעשות, ועשית אותו.</b>',
        '',
        `תחנות ראשונות שנעצרו: <b>${m2.totals.chainStops}</b> · דחפים שעברו: ${m2.totals.surfed}`,
        '',
        'הסיבה נעלמה תוך רבע שעה — זו הוכחה אמפירית, במו ידיך, שהיא הייתה תירוץ ולא צורך. <b>עצור 5 שניות והרגש את זה</b>; זה התגמול שצורב את הלולאה החדשה.',
        '',
        '<i>מרלט: בתחנה הראשונה הדחף עוד קטן, ושם עוצרים כמעט בלי מאמץ. בקופה כמעט אף אחד לא עוצר. להילחם מוקדם, לא חזק.</i>',
      ].join('\n'));
    }
    return answer(env, cb.id);
  }

  // --- בחירת תוכנית המסטיק ---
  if (data.startsWith('gp:')) {
    const what = data.slice(3);
    if (what === 'show') { await answer(env, cb.id); return runCommand('gumplan', '', chatId, env, meta, pl, iso, now); }
    const plan = { ...G.DEFAULT_PLAN, ...(meta.gumPlan || {}) };
    if (what === 'toggle') { plan.on = !plan.on; }
    else if (G.PRESETS[what]) { plan.times = G.PRESETS[what].times; plan.on = true; }
    meta.gumPlan = plan; await putMeta(env, meta);
    await answer(env, cb.id, 'עודכן');
    return runCommand('gumplan', '', chatId, env, meta, pl, iso, now);
  }

  // --- אישור תזכורת מסטיק ---
  if (data.startsWith('gr:')) {
    // callback_data הוא gr:<what>:HH:MM — פיצול נאיבי על ':' חותך את
    // השעה ל-"17" ומאבד את הדקות, ואז מפתחות ה-sent וה-snooze לא
    // תואמים למה שהלולאה מחפשת. מחברים בחזרה את כל מה שאחרי המצב.
    const _p = data.split(':');
    const what = _p[1];
    const time = _p.slice(2).join(':');
    const plan = { ...G.DEFAULT_PLAN, ...(meta.gumPlan || {}) };
    const total = G.activeTimes(plan, iso).length;

    if (what === 's') {                                  // דחייה ב-20 דקות מ*עכשיו*
      const key = `${iso}:gum:${time}`;
      const nextMin = now.minutes + 20;
      delete meta.sent[key];
      meta.snooze = { ...(meta.snooze || {}), [key]: nextMin };
      await putMeta(env, meta);
      const nt = `${String(Math.floor(nextMin / 60) % 24).padStart(2, '0')}:${String(nextMin % 60).padStart(2, '0')}`;
      await answer(env, cb.id, 'נדחה ב-20 דק׳');
      return edit(env, chatId, msgId, `⏰ <b>נדחה.</b> אזכיר שוב ב-${nt}.\n\n<i>הנתונים לא השתנו — היחידה עוד לא נספרה.</i>`, { reply_markup: inline([]) });
    }

    if (what === 'y') {
      const day = await updateDay(env, iso, d => { d.gum += 1; d.gumSched = (d.gumSched || 0) + 1; });
      await recordEvent(env, iso, now, 'g', { sched: time });
      const m2 = await getMeta(env); m2.totals.gum += 1; await putMeta(env, m2);
      await answer(env, cb.id, 'נרשם 🍬');
      const extra = day.gum >= (m2.gumSoftCap || 15)
        ? `\n\n⚠️ <b>${day.gum} יחידות היום.</b> בדוק את המקסימום שעל האריזה שלך ואל תחרוג ממנו.`
        : '';
      return edit(env, chatId, msgId,
        `✅ <b>${time} — נלקח.</b>\nהנתונים עודכנו: <b>${day.gum}</b> נלקחו היום · ${day.gumSched || 0}/${total} מתוזמנים${day.gumExtra ? ` · ${day.gumExtra} נוספים` : ''}${extra}`,
        { reply_markup: inline([]) });
    }

    // 'n' — דילוג
    const day = await updateDay(env, iso, d => { d.gumMissed = (d.gumMissed || 0) + 1; });
    await answer(env, cb.id, 'דולג');
    return edit(env, chatId, msgId, [
      `⏭️ <b>${time} — דולג.</b>`,
      `הנתונים עודכנו: <b>${day.gum}</b> נלקחו היום · ${day.gumSched || 0}/${total} מתוזמנים · ${day.gumMissed} דולגו`,
      '',
      '<i>בלי אשמה — זה נתון, לא ציון, וגם דילוג הוא מידע שימושי. אבל שווה לדעת: תת-שימוש הוא הכשל הנפוץ ולא המינון, והיצמדות גבוהה יותר ב-6 השבועות הראשונים נמצאה קשורה לשיעורי הימנעות גבוהים יותר עד שנה.</i>',
    ].join('\n'), { reply_markup: inline([[btn('🍬 בעצם לקחתי', `gr:y:${time}`)]]) });
  }

  // --- פתיחת התצמצום ---
  if (data.startsWith('tp:')) {
    const what = data.slice(3);
    const plan = { ...G.DEFAULT_PLAN, ...(meta.gumPlan || {}) };
    if (what === 'go') {
      plan.confirmedTaper = true; plan.taperStartISO = iso;
      meta.gumPlan = plan; await putMeta(env, meta);
      await answer(env, cb.id, 'התצמצום התחיל');
      const t = G.taperInfo(plan, iso);
      return send(env, chatId, `📉 <b>התצמצום התחיל.</b>\n\n${t.start} יחידות עכשיו · יחידה אחת פחות כל ${t.step} ימים · הראשונה שנופלת: <b>${t.nextToGo}</b> ב-${P.fmtHe(t.nextDropISO)}.\n\nיחידת הבוקר נשארת אחרונה — היא מכסה את הלילה בלי מדבקה.\n\n<i>עולים גלים? /מסטיקים ואני מחזיר אחורה. אין פרס על מהירות.</i>`);
    }
    if (what === 'wait') {
      plan.taperStartISO = P.addDaysISO(iso, 7); plan.confirmedTaper = false;
      meta.gumPlan = plan; await putMeta(env, meta);
      await answer(env, cb.id, 'נדחה בשבוע');
      return send(env, chatId, `⏸️ <b>נדחה ל-${P.fmtHe(plan.taperStartISO)}.</b> התוכנית נשארת ${G.sortTimes(plan.times).length} יחידות ביום.\n\n<i>זו ההחלטה הנכונה אם המצב לא יציב. הניקוטין הוא הזנב, לא הכלב.</i>`);
    }
    return answer(env, cb.id);
  }

  // --- יישור רוטציית המדבקה למקום שהוא באמת הדביק היום ---
  if (data.startsWith('site:')) {
    const want = parseInt(data.slice(5), 10);
    if (!inPlanDay(pl) || isNaN(want)) return answer(env, cb.id);
    const L = P.SITES.length;
    meta.siteOffset = (((meta.siteOffset + want - pl.siteIndex) % L) + L) % L;
    await putMeta(env, meta);
    const fixed = P.planFor(iso, meta.siteOffset);
    const tm = P.planFor(P.addDaysISO(iso, 1), meta.siteOffset);
    await answer(env, cb.id, 'הרוטציה יושרה ✓');
    return send(env, chatId, [
      `📍 <b>עודכן.</b>`,
      `היום: <b>${fixed.site}</b>`,
      inPlanDay(tm) ? `מחר: <b>${tm.site}</b>` : '',
      '',
      '<i>מכאן הרוטציה תמשיך נכון לבד — לא צריך לגעת בזה שוב.</i>',
    ].filter(Boolean).join('\n'));
  }
  if (data === 'money') { await answer(env, cb.id); return runCommand('money', '', chatId, env, meta, pl, iso, now); }
  if (data === 'rep')   { await answer(env, cb.id); return runCommand('report', '', chatId, env, meta, pl, iso, now); }

  // --- תיוג הקשר של גל → מיפוי דפוסים ---
  if (data.startsWith('tag:')) {
    const tag = data.slice(4);
    await answer(env, cb.id, tag === 'skip' ? '' : 'נרשם 🏷️');
    if (tag !== 'skip' && ANL.TAGS[tag]) {
      const idx = meta.sos && typeof meta.sos.evIdx === 'number' ? meta.sos.evIdx : -1;
      await updateDay(env, iso, d => {
        const i = idx >= 0 && d.ev[idx] ? idx : d.ev.length - 1;
        if (d.ev[i]) d.ev[i].tag = tag;
      });
    }
    return edit(env, chatId, msgId, tag === 'skip' ? '🏷️ <i>לא תויג.</i>' : `🏷️ <b>${ANL.TAGS[tag]}</b> — נכנס למיפוי. /דוח מראה את המכנה המשותף.`, { reply_markup: inline([]) });
  }

  // --- אימון RAIN ---
  if (data.startsWith('tr:')) {
    const parts = data.split(':');
    if (parts[1] === 'start') {
      meta.training = { startISO: iso, done: [] };
      await putMeta(env, meta);
      await answer(env, cb.id, 'האימון התחיל');
      const m = M.training(meta, iso);
      return send(env, chatId, m.text, { reply_markup: m.kb });
    }
    if (parts[1] === 'done') {
      const d = parseInt(parts[2], 10);
      if (meta.training && !meta.training.done.includes(d)) meta.training.done.push(d);
      await putMeta(env, meta);
      await answer(env, cb.id, `יום ${d} בוצע ✓`);
      const m = M.training(meta, iso);
      const extra = (meta.training.done.length >= 7)
        ? '\n\n🎉 <b>השבוע הושלם.</b> השריר קיים עכשיו — הוא יהיה שם ברגע האמת. חגיגה קטנה היא חלק מהתרגיל.'
        : '';
      return edit(env, chatId, msgId, m.text + extra, { reply_markup: m.kb });
    }
    return answer(env, cb.id);
  }

  // --- צנצנת ---
  if (data.startsWith('jar:')) {
    const what = data.slice(4);
    if (what === 'ask') {
      meta.awaiting = 'jar'; await putMeta(env, meta);
      await answer(env, cb.id);
      return send(env, chatId, '🫙 כמה העברת לצנצנת? שלח מספר בשקלים.');
    }
    const saved = (pl.clean || pl.cleanDays || 0) * meta.costPerDay;
    meta.jarTotal = saved;
    await putMeta(env, meta);
    await answer(env, cb.id, 'נרשם 🫙');
    return send(env, chatId, `🫙 <b>הצנצנת עודכנה ל-${saved}₪.</b>\n\nוקבע מראש למה זה הולך — משהו אמיתי שאתה רוצה, לא "חיסכון". זה מה שהופך את זה לחוזה.`);
  }

  // --- שותף/ה ---
  if (data.startsWith('pr:')) {
    const what = data.slice(3);
    if (what === 'code') {
      meta.joinCode = { code: Math.random().toString(36).slice(2, 8).toUpperCase(), exp: Date.now() + 30 * 60000 };
      await putMeta(env, meta);
      await answer(env, cb.id, 'קוד חדש');
      const m = M.partnerInfo(meta, meta.joinCode.code);
      return edit(env, chatId, msgId, m.text, { reply_markup: m.kb });
    }
    if (what === 'auto') {
      meta.partnerMute = !meta.partnerMute;
      await putMeta(env, meta);
      await answer(env, cb.id, meta.partnerMute ? 'כובה' : 'הופעל');
      const m = M.partnerInfo(meta, null);
      return edit(env, chatId, msgId, m.text, { reply_markup: m.kb });
    }
    if (what === 'off') {
      meta.partnerChatId = null; await putMeta(env, meta);
      await answer(env, cb.id, 'נותק');
      return send(env, chatId, '🔌 השותף/ה נותק/ה.');
    }
    if (what === 'send') {
      if (!meta.partnerChatId) { await answer(env, cb.id); return send(env, chatId, 'אין שותף/ה מחובר/ת. /שותף לחיבור.'); }
      await send(env, meta.partnerChatId, `🌊 <b>${C.PARTNER_MSG}</b>\n\n<i>זה דיווח. תגובת הקבע: "זה גל — אני איתך, הוא יעבור."</i>`);
      await answer(env, cb.id, 'נשלח 📨');
      return send(env, chatId, '📨 <b>נשלח.</b> עכשיו תמשיך ללכת.');
    }
    return answer(env, cb.id);
  }

  // --- מונים ---
  if (data === 'g') { await answer(env, cb.id, 'מסטיק נרשם 🍬'); return logGum(chatId, env, iso, meta, now); }
  if (data === 'p') { await answer(env, cb.id, 'מדבקה נרשמה 🩹'); return logPatch(chatId, env, iso, pl, meta, now); }

  if (data === 'sf') {
    const day = await updateDay(env, iso, d => { d.surfed += 1; });
    await recordEvent(env, iso, now, 'v');
    const m2 = await getMeta(env); m2.totals.surfed += 1; m2.sos = null; await putMeta(env, m2);
    await answer(env, cb.id, 'דחף שעבר 🌊');
    return send(env, chatId, [
      `🌊 <b>נרשם. דחפים שעברו עד הסוף היום: ${day.surfed}</b> · סה״כ: ${m2.totals.surfed}`,
      '',
      '<b>עצור 5 שניות והרגש את השקט שאחרי.</b> זה התגמול שצורב את הלולאה החדשה.',
      '',
      '<i>השתוקקת — ולא פעלת. הגל הבא כבר נולד קטן יותר.</i>',
    ].join('\n'));
  }

  if (data === 'wv') {
    const day = await updateDay(env, iso, d => { d.waves += 1; });
    const m2 = await getMeta(env); m2.totals.waves += 1; await putMeta(env, m2);
    return answer(env, cb.id, `נרשם. גלים היום: ${day.waves}`);
  }

  // --- ממתין לטקסט ---
  if (data.startsWith('ask:')) {
    const field = data.slice(4);
    const m2 = await getMeta(env); m2.awaiting = field; await putMeta(env, m2);
    await answer(env, cb.id);
    const prompts = {
      mine: '🎯 מה המוקש של היום — המצב המסוכן הצפוי (שעה/מקום/מצב רוח), ומה התגובה המוכנה?',
      win: '🏆 מה הניצחון של היום? עצור 5 שניות אחרי שתכתוב אותו — זה החלק שעושה את העבודה.',
      journal: '📓 יומן שלוש שורות:\n1) הרגע הקשה + התחנה הראשונה שלו\n2) מה עבד\n3) מה מחר עושים אחרת',
      waves: '🌀 כמה גלים היו היום? שלח מספר.',
    };
    return send(env, chatId, prompts[field] || 'שלח לי את הטקסט.');
  }

  // --- בוקר / ערב הושלמו ---
  if (data === 'md') {
    const day = await getDay(env, iso);
    if (!day.mDone) {
      await updateDay(env, iso, d => { d.mDone = true; });
      const m2 = await getMeta(env); m2.totals.mDone += 1; await putMeta(env, m2);
    }
    await answer(env, cb.id, 'בוקר הושלם ✓');
    return send(env, chatId, '🌅 <b>בוקר הושלם.</b> צא לדרך — הכלים איתך.\n\n<i>עשרים שניות שקונות את היום.</i>');
  }
  if (data === 'ed') {
    const day = await getDay(env, iso);
    if (!day.eDone) {
      await updateDay(env, iso, d => { d.eDone = true; });
      const m2 = await getMeta(env); m2.totals.eDone += 1; await putMeta(env, m2);
    }
    await answer(env, cb.id, 'ערב הושלם ✓');
    return send(env, chatId, [
      '🌙 <b>ערב הושלם. הלולאה החדשה קיבלה עוד יום של אימון.</b>',
      '',
      '🩹 <b>לפני השינה</b> — להסיר את המדבקה, ולהכין את של מחר.',
      '😴 שינה היא תחמושת: מחר תקבל החלטות טובות רק כמו הלילה שלך.',
      '',
      'לילה טוב.',
    ].join('\n'));
  }

  if (data === 'st') { await answer(env, cb.id); const day = await getDay(env, iso); const m = M.status(pl, iso, day, meta); return send(env, chatId, m.text, { reply_markup: m.kb }); }
  if (data === 'run:morning') { await answer(env, cb.id); const day = await getDay(env, iso); const m = M.morning(pl, day, meta); return send(env, chatId, m.text, { reply_markup: m.kb }); }

  // --- יציאה מהבית ---
  if (data === 'out:start') {
    await answer(env, cb.id);
    const day = await getDay(env, iso);
    const m = M.outing(pl, iso, day, meta, now);
    return send(env, chatId, m.text, { reply_markup: m.kb });
  }
  if (data === 'out:done') {
    await updateDay(env, iso, d => { d.outs += 1; });
    await recordEvent(env, iso, now, 'o');
    const m2 = await getMeta(env); m2.totals.outs += 1; await putMeta(env, m2);
    await answer(env, cb.id, 'יצאת מוכן ✓');
    return send(env, chatId, [
      `🚪 <b>יצאת מוכן.</b> נרשם — יציאות עם טקס: ${m2.totals.outs}`,
      '',
      'הכפתור למטה איתך כל הזמן. אם עולה גל — לחיצה אחת, ואני מוביל.',
    ].join('\n'), { reply_markup: inline([[btn('🌊 יש דחף / אני בדרך לחנות', 'sos:1')]]) });
  }

  // --- SOS ---
  if (data.startsWith('sos:')) {
    const which = data.slice(4);

    if (which === 'done') {
      const day = await updateDay(env, iso, d => { d.surfed += 1; });
      await recordEvent(env, iso, now, 'v');
      const m2 = await getMeta(env);
      const wasReported = !!(m2.sos && m2.sos.reported);
      m2.totals.surfed += 1; m2.sos = null; m2.awaiting = 'win';
      await putMeta(env, m2);
      if (wasReported) {
        await notifyPartner(env, m2, '✅ <b>הגל נשבר.</b>\n\nהוא גלש עליו עד הסוף ולא פעל. <i>השתוקק — ולא פעל. זה בדיוק המדד.</i>');
      }
      await answer(env, cb.id, 'ניצחון נרשם 🏆');
      return send(env, chatId, [
        `🏆 <b>נרשם! דחפים שעברו עד הסוף: ${m2.totals.surfed}</b> (היום: ${day.surfed})`,
        '',
        'זה המדד האמיתי — לא ספירת ימים. <i>מדוד שחרורים.</i>',
        '',
        '📝 ובמשפט אחד: מה הייתה <b>התחנה הראשונה</b> של הגל הזה? (זה נכנס לטבלת האם-אז שלך.)',
      ].join('\n'));
    }

    const step = parseInt(which, 10) || 1;
    if (step === 1) {
      await answer(env, cb.id);
      return startWave(chatId, env, meta, iso, now);
    }
    await answer(env, cb.id);
    const m = M.sos(step);
    // שלב 4 — אם יש שותף/ה מחובר/ת, שולחים בלחיצה במקום להעתיק
    if (step === 4 && meta.partnerChatId) {
      if (meta.sos && meta.sos.reported) {
        m.text = '📨 <b>כבר דווח.</b>\n\nההודעה יצאה לבת הזוג ברגע שהגל התחיל — הסודיות נשברה, וזה כל העניין.\n\n<i>הסבבים חיו על שקט. הודעה אחת מפרקת אותם.</i>';
        m.kb = inline([[btn('📨 שלח שוב', 'pr:send')], [btn('ממשיך ←', 'sos:5')]]);
      } else {
        m.kb = inline([[btn('📨 שלח דיווח לבת/בן הזוג', 'pr:send')], [btn('נשלח / ממשיך ←', 'sos:5')]]);
      }
    }
    return edit(env, chatId, msgId, m.text, { reply_markup: m.kb });
  }

  // --- הליכת RAIN (עריכה במקום, בלי הצפה) ---
  if (data.startsWith('rw:')) {
    const i = parseInt(data.slice(3), 10) || 0;
    await answer(env, cb.id);
    const m = M.rainWalk(i);
    const r = await edit(env, chatId, msgId, m.text, { reply_markup: m.kb });
    if (!r.ok) await send(env, chatId, m.text, { reply_markup: m.kb });
    return;
  }

  await answer(env, cb.id);
}
