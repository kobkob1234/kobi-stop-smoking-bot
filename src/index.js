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
import * as CBTP from './cbt/protocol.js';
import * as CBTS from './cbt/state.js';
import * as CBTT from './cbt/tools.js';
import * as CBTE from './cbt/engine.js';
import * as CBTSESS from './cbt/session.js';
import { retrieverFor } from './cbt/retrieve.js';
const S_latest = c => CBTS.latestFormulation(c);
import * as ANL from './analytics.js';
import * as INT from './intent.js';
import * as G from './gum.js';
import { getMeta, putMeta, getDay, updateDay, pruneSent, recentHist, pushHist, getWeekly, putWeekly, PATCH_BACKFILL_VER, backfillPatches, recordMood, moodReadings, MOOD_MAX_PER_DAY } from './store.js';
import { SLOTS, slotAction, mergeTickMeta, taperAskDue, taperWatchDue, moodCheckDue, moodAnchorAt, cbtRemindDue } from './tick-logic.js';
import { notifyPartner, alertPartner } from './partner.js';

// מזהה בנייה. מתעדכן בכל פריסה ומוחזר ב-/diag, כדי שאפשר יהיה לדעת
// בוודאות איזו גרסה חיה במקום לנחש אחרי sleep. ארבע פעמים היום בדיקה
// רצה מול הגרסה הקודמת והסקתי מזה מסקנה שגויה.
export const BUILD = '183305';

// ---------- משבצות הזמן היומיות (שעון ישראל) ----------

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
  { command: 'therapy', description: '🪑 סשן CBT — לפי פרוטוקול NCSCT' },
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
  therapy:  ['therapy', 'טיפול', 'סשן', 'פגישה'],
  endsess:  ['endsession', 'סיום', 'עצור'],
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
export const RX = {
  // משבר — נבדק **ראשון**, לפני הכל.
  //
  // עד כה `crisis` זוהה רק על ידי המודל, ול-KB אין כרטיס משבר: נבדק,
  // ו"אין לי טעם לחיות" / "אני רוצה למות" / "אני חושב לפגוע בעצמי"
  // החזירו אפס תוצאות. כלומר כשהמכסה נגמרה או שכל הספקים למטה,
  // הודעה כזאת קיבלה "📓 שמרתי את זה ביומן של היום" — והטקסט הנכון
  // (ער"ן 1201) ישב לידה בלתי-נגיש. זה הנתיב היחיד בבוט שחייב לעבוד
  // בלי רשת בכלל.
  //
  // אסימטריית העלויות כאן קיצונית יותר מאשר בדחף, ולכן גם הסף נמוך
  // יותר: התראת שווא שולחת מספר טלפון של קו סיוע, החמצה היא החמצה.
  crisis: new RegExp([
    'אין (?:לי )?טעם (?:לחיות|לכלום|בכלום|בחיים|להמשיך|בשום דבר)',
    'לא רוצה (?:לחיות|להתעורר|להמשיך לחיות|להיות פה|להיות כאן)',
    'רוצה למות', 'מתחשק לי למות', 'מוטב שאמות', 'שאמות',
    'לשים סוף', 'לשים קץ', 'לסיים את החיים', 'לגמור עם הכל',
    'לפגוע בעצמי', 'להזיק לעצמי', 'לעשות לעצמי משהו',
    'אובדני', 'אובדנות',
    'אין לי (?:כוח|סיבה|טעם) לחיות',
    'יסתדרו בלעדיי', 'יהיה להם יותר טוב בלעדיי', 'העולם בלעדיי',
  ].join('|')),

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
    if (['/diag', '/cron', '/export', '/send', '/ask', '/trigger', '/cbt-state', '/cbt-probe', '/cbt-fetch'].includes(url.pathname)) {
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
        // h= זוג תורות מדומה לבדיקת המשכיות: h=שאלה||תשובה
        const hRaw = url.searchParams.get('h');
        const hist = hRaw ? hRaw.split('||').map((t, i) => ({ r: i % 2 ? 'a' : 'u', t, ts: Date.now() })) : recentHist(meta);
        // /ask עקף את המכסה לגמרי, ו-live-check שולח 17 קריאות בהרצה.
        // כלומר הריצה שנועדה *לבדוק* את הבוט שרפה מכסה שלא נספרה, ואז
        // שיחה אמיתית נתקלה ב-429 בלי שהמונה הראה משהו.
        const meter = { calls: 0 };
        const left = AI.quotaLeft(meta, env, now.iso);
        const cls = AI.enabled(env) && left > 0
          ? await INT.classify(env, q, await buildState(env, pl, now.iso, now, meta), hist, meter)
          : null;
        if (meter.calls) { AI.noteUse(meta, now.iso, meter.calls); await putMeta(env, meta); }
        return Response.json({
          q,
          intent: cls ? cls.intent : null,
          urgency: cls ? cls.urgency : null,
          reply: cls ? cls.reply : null,
          kb: hit ? { topic: hit.t, score: +hit.score.toFixed(1) } : null,
          provider: AI.provider(env),
          quota: { left: AI.quotaLeft(meta, env, now.iso), spent: meter.calls },
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
        // _dryRun ולא partnerMute: putMeta מסנן מפתחות _ ולכן זה לא נשמר.
        if (url.searchParams.get('dry') === '1') meta._dryRun = true;
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

      if (url.pathname === '/cbt-fetch') {
        // ═══ אחזור לסוכן ═══
        //
        // הסוכן מריץ את אותו פרוטוקול עם מודל חזק יותר — ועד עכשיו
        // **בלי הספרייה בכלל**, כי היא ב-KV והוא מריץ מקומית. כלומר
        // הצד עם המודל הטוב קיבל את ההקשר הגרוע.
        //
        // אותו `pickSections` בדיוק, אותם משקלים, אותו תקציב.
        const want = url.searchParams.get('q') || '';
        const bct = url.searchParams.get('bct') || null;
        const r = await retrieverFor(env, { bct })(want);
        return Response.json({ sources: r });
      }

      if (url.pathname === '/cbt-probe') {
        // ═══ תור אחד, בלי לגעת במצב ═══
        //
        // הדרך היחידה לדעת אם התשובות באמת טיפוליות ולא גנריות היא
        // להריץ תור אמיתי ולקרוא אותו. `GEMINI_KEY` הוא סוד ולכן זה
        // אינו ניתן להרצה מקומית, ובלי הנתיב הזה "איכות התשובות"
        // נשארת הערכה במקום מדידה.
        //
        // **לא כותב כלום.** אין putMeta, אין שינוי סשן.
        const tid = url.searchParams.get('tool') || 'identify-triggers';
        const said = url.searchParams.get('said') || 'בעיקר כשאני לחוץ בעבודה';
        const tool = CBTT.byId(tid);
        if (!tool) return Response.json({ error: 'כלי לא מוכר', tool: tid }, { status: 400 });
        const meta = await getMeta(env);
        const now = P.il();
        const pl = P.planFor(now.iso, meta.siteOffset);
        const st = await cbtState(env, meta, CBTS.migrateCbt(meta.cbt), pl, now.iso);
        const meter = { calls: 0 };
        const t0 = Date.now();
        const r = await CBTSESS.runStep(CBTS.migrateCbt(meta.cbt), tool, st, said, {
          call: AI.cbtCall(env, CBTE.ROLES, meter),
          retrieve: retrieverFor(env, { bct: tool.id }),
          turns: [],
        });
        return Response.json({
          tool: tool.id, name: tool.name, mode: r.mode,
          asked: tool.run(st).ask || tool.run(st).text,
          said, reply: r.reply, captured: r.captured,
          sources: (r.sources || []).map(x => ({ id: x.id, src: x.src, words: x.text.split(/\s+/).length })),
          trace: r.trace, calls: meter.calls, ms: Date.now() - t0,
          state: CBTE.stateDigest(st),
        });
      }

      if (url.pathname === '/cbt-state') {
        // ═══ בעלים אחד: KV ═══
        //
        // התכנון הראשון החזיק כאן **מראה** של מצב ה-CBT, מתוך הנחה
        // שהסשנים רצים רק בסוכן. משהתווסף `/טיפול` יש שני מקומות
        // שמריצים סשן — ומראה עם שני כותבים היא בדיוק ההגדרה של
        // מצב שמתפצל.
        //
        // לכן `meta.cbt` ב-KV הוא המקור היחיד, והסוכן קורא וכותב
        // דרכו. `active` מונע התנגשות: אי אפשר לפתוח סשן במקום אחד
        // בזמן שרץ אחד בשני.
        const meta = await getMeta(env);
        const cur = CBTS.migrateCbt(meta.cbt);
        if (req.method === 'POST') {
          // ההחלטה עצמה ב-`state.js` — מחוץ ל-I/O ולכן נבדקת ישירות.
          const r = CBTS.applyCbtPush(meta.cbt, await req.json().catch(() => null));
          if (r.bad) return new Response('bad body', { status: 400 });
          if (r.conflict) return Response.json({ ok: false, ...r }, { status: 409 });
          meta.cbt = r.cbt;
          await putMeta(env, meta);
          return Response.json({ ok: true, cbt: meta.cbt });
        }
        return Response.json({ ok: true, cbt: cur });
      }

      if (url.pathname === '/export') {
        const now = P.il();
        const days = await ANL.collect(env, now.iso, parseInt(url.searchParams.get('days') || '120', 10));
        const meta = await getMeta(env);
        // הפילטר הישן פספס בדיוק את הימים שהכי חשוב לשמר: יום שבו הוא
        // ענה "מדלג" לכל תזכורת (gumMissed בלבד) הוא יום של אי-היענות
        // מלאה — הסיגנל הקליני החזק ביותר — והוא נשמט מהגיבוי. כך גם
        // ימי outs/mine/planning/enroute בלבד. עכשיו הבדיקה היא על
        // **כל** סימן חיים, באותה הגדרה שמשמשת את גלאי הכיסוי.
        const hasData = d =>
          d.waves || d.gum || d.journal || d.win || d.patch || d.slips ||
          d.outs || d.mine || d.mDone || d.eDone || d.planning || d.enroute ||
          d.chainStops || d.gumMissed || d.gumSched || d.gumExtra ||
          (d.ev && d.ev.length);
        // הסקירות השבועיות (`w:ISO`) נכתבו ואף אחד לא קרא אותן: לא
        // /status, לא /דוח, לא /ייצוא ולא הגיבוי — collect עובר רק על
        // מפתחות `d:`. עד 4000 תווים של רפלקציה שבועית היו ניתנים
        // לשליפה רק ב-wrangler kv key get, ורק אם ידעת את התאריך.
        const weeklies = {};
        for (const d of days) {
          if (d.dow !== 6) continue;                 // נכתבות במוצ״ש
          const w = await getWeekly(env, d.iso);
          if (w) weeklies[d.iso] = w;
        }
        const out = {
          exportedAt: now.iso,
          meta: { ...meta, sent: undefined },
          days: days.filter(hasData),
          weeklies,
        };
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
          const w = G.windowOf(gp);
          const lastRemind = meta.gumRemindISO === now.iso ? meta.gumRemindMin : null;
          const r = G.dueNow(gp, now.iso, day, now.minutes, lastRemind);
          return {
            on: gp.on,
            mode: 'adaptive',
            planned: G.sortTimes(gp.times).length,
            targetToday: G.dailyTarget(gp, now.iso),
            window: `${G.hhmm(w.start)}-${G.hhmm(w.end)}`,
            dueNow: r.due,
            why: r.why,
            expected: r.expected ?? null,
            sinceLastGum: r.since,
            lastRemindMin: lastRemind,
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

  // אילו שדות ה-tick באמת שינה. המיזוג בסוף החיל אותם ללא תנאי,
  // גם כשהקרון לא נגע בהם — ולכן ערך ישן מתחילת ה-tick דרס
  // שינוי שהמשתמש עשה תוך כדי. ראו את ההסבר במיזוג למטה.
  const touched = new Set();

  // --- מצב רוח: עד שלוש בדיקות ביום ------------------------------------
  {
    const dayNow = await getDay(env, iso);
    const anchor = moodAnchorAt(now.minutes);
    const n = moodReadings(dayNow).length;
    const key = anchor ? `${iso}:mood:${anchor.id}` : null;
    if (anchor && moodCheckDue(now.minutes, n, meta.sent[key], MOOD_MAX_PER_DAY)) {
      meta.sent[key] = 1; dirty = true;
      const nth = ['הבוקר', 'אחר הצהריים', 'הערב'][['am', 'pm', 'eve'].indexOf(anchor.id)];
      // משפט העידוד מתחלף לפי מונה רץ, ולכן לא חוזר בין הבדיקות.
      const [enc, encSrc] = C.encouragement(P.diffDays(P.QUIT, iso) * 3 + n);
      await send(env, meta.chatId, [
        `🌤️ <b>איך ${nth}?</b>`,
        '1 = רע מאוד · 5 = טוב מאוד',
        '',
        `<i>${enc}</i>`,
        `— ${encSrc}`,
      ].join('\n'), { reply_markup: inline([[1, 2, 3, 4, 5].map(v => btn(String(v), `mo:${v}`))]) });
    }
  }

  // --- תזכורת לסשן CBT -------------------------------------------------
  //
  //  הפרוטוקול נבנה, נבדק, ואיש לא היה יודע מתי להריץ אותו: הסשנים
  //  רצים בסוכן, והבוט — היחיד שמדבר איתו ביוזמתו — לא ידע עליהם דבר.
  //  התערבות שתלויה בכך שייזכר לבד אינה התערבות.
  //
  //  **בעלים אחד.** `meta.cbt` ב-KV הוא המצב, ושני המקומות שמריצים
  //  סשן — הבוט והסוכן דרך `/cbt-state` — קוראים וכותבים אותו. אם
  //  המצב חסר, מזכירים: תזכורת מיותרת עולה הודעה אחת, תזכורת שנחסמה
  //  בטעות עולה סשן שלם.
  {
    const due = cbtRemindDue(now.minutes, meta, iso, CBTP.dueSession);
    if (due) {
      meta.sent[`${iso}:cbt`] = 1; dirty = true;
      const late = P.diffDays(due.dueISO, iso);
      await send(env, meta.chatId, [
        `🪑 <b>${esc(due.title)}</b>`,
        late > 0 ? `היה אמור לרוץ לפני ${late} ימים.` : 'מוכן להיום.',
        '',
        `כ-${due.minMinutes || 15} דקות · ${due.checklist.length} שלבים`,
        '',
        '<i>פותחים את Claude Code או Antigravity בתיקיית הפרויקט,</i>',
        '<i>ואומרים: "בוא נעשה סשן".</i>',
      ].join('\n'));
    }
  }

  // --- מילוי אחורה חד-פעמי של המדבקות ---------------------------------
  //
  //  הוא לבש מדבקה בכל יום מאז הגמילה ופשוט לא סימן. הנתון הזה אינו
  //  קוסמטי: `patch:false` מייצר דגל הסלמה, ומעוות כל ניתוח היצמדות.
  //
  //  זה נעשה כאן ולא מה-CLI מפני ש-`wrangler kv` לא הגיב כלל. מוגן
  //  גרסה בדיוק כמו SITE_ROTATION_VER, ולכן רץ פעם אחת ולא חוזר.
  //
  //  **נוגע רק בימים שכבר יש להם רשומה.** יום בלי רשומה בכלל נשאר
  //  חסר במכוון: `isLogged` היה הופך אותו ל"מכוסה", ודגל ה-blind —
  //  שכל תפקידו לזהות שהדיווח נפסק — היה מושתק על ידי מילוי אחורה.
  //  תיקון נתונים לא אמור לכבות גלאי.
  if (meta.patchBackfillVer !== PATCH_BACKFILL_VER) {
    const r = await backfillPatches(env, P.QUIT, iso, P.addDaysISO);
    meta.patchBackfillVer = PATCH_BACKFILL_VER;
    dirty = true; touched.add('patchBackfillVer');
    console.log(`מדבקות: מולאו ${r.filled} · כבר סומנו ${r.already} · ${r.missing} ימים בלי רשומה`);
  }

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
      dirty = true; touched.add('sos');
    } else if (mins > 40) {
      meta.sos = null;
      dirty = true; touched.add('sos');
    }
  }

  // --- דחיית 15 הדקות של דרגה 2 ---
  //
  // meta.snooze נכתב ב-pl:delay, נוקה ב-pruneSent, ו**אף אחד לא קרא אותו**.
  // כלומר ההודעה הבטיחה "אזכיר לך לבדוק" ואז לא קרה כלום — בזמן שכל
  // הפואנטה של הדחייה היא המדידה שאחריה: אם הסיבה נעלמה היא הייתה
  // תירוץ. בלי התזכורת, ההתערבות המרכזית של דרגה 2 פשוט לא הושלמה.
  const plKey = `${iso}:pl`;
  if (meta.snooze && meta.snooze[plKey] && now.minutes >= meta.snooze[plKey]) {
    const s = { ...meta.snooze };
    delete s[plKey];
    meta.snooze = s;
    dirty = true; touched.add('snooze');
    await send(env, meta.chatId, [
      '⏳ <b>עברו 15 הדקות. עכשיו המדידה.</b>',
      '',
      'הסיבה שרצית לצאת בשבילה — <b>היא עדיין שם?</b>',
      '',
      'אם היא נעלמה, זו לא הקלה מקרית: זו הוכחה אמפירית, במו ידיך, שהיא הייתה תירוץ ולא צורך. ואם היא עדיין כאן — זה בסדר, ואז יוצאים עם מישהו ולא לבד.',
    ].join('\n'), {
      reply_markup: inline([
        [btn('✅ נעלמה — היה תירוץ', 'pl:gone')],
        [btn('🚪 עדיין קיימת', 'out:start'), btn('🌊 יש לי דחף', 'sos:1')],
      ]),
    });
  }

  // --- תזכורת המסטיק: מסתגלת לקצב בפועל, לא לשעון קבוע ---
  const plan = { ...G.DEFAULT_PLAN, ...(meta.gumPlan || {}) };
  if (!meta.quiet && plan.on) {
    const day = await getDay(env, iso);
    const snoozedTo = meta.gumSnoozeISO === iso ? (meta.gumSnoozeMin || 0) : 0;
    const lastRemind = meta.gumRemindISO === iso ? meta.gumRemindMin : null;
    // הסנוז נמסר ל-dueNow ולא נאכף כאן בנפרד. כשהוא היה תנאי חיצוני
    // בלבד הוא היה רצפה מול תקרת הנסיגה שבתוך dueNow, והמכפלה איחרה
    // את התזכורת ב-79 דקות מעבר למה שהובטח.
    const r = G.dueNow(plan, iso, day, now.minutes, lastRemind,
                       meta.gumSoftCap, snoozedTo);

    if (r.due) {
      meta.gumRemindISO = iso;
      meta.gumRemindMin = now.minutes;
      // הסנוז כובד — מנקים, אחרת הוא היה מדלג על הנסיגה שוב ושוב
      // לשארית היום ומייצר תזכורת בכל בדיקה.
      if (snoozedTo) { meta.gumSnoozeMin = 0; touched.add('gumSnoozeMin'); }
      dirty = true; touched.add('gumRemindISO'); touched.add('gumRemindMin');
      console.log('GUM תזכורת:', r.taken, '/', r.target, '·', r.why);
      // רושמים שהתזכורת יצאה, כדי שאפשר יהיה למדוד שיהוי תזכורת→מנה.
      // בלי האירוע הזה אין דרך לדעת אם התזכורות בכלל מניעות משהו —
      // ובנתונים בפועל 90% מהמנות נלקחות ביוזמה ולא בתגובה.
      await recordEvent(env, iso, now, 'r');
      await send(env, meta.chatId, G.reminderText(now.hhmm, plan, iso, day, r.taken, r.target), {
        reply_markup: inline([
          [btn('✅ לקחתי', 'gr:y'), btn('⏭️ מדלג', 'gr:n')],
          [btn('⏰ עוד 20 דק׳', 'gr:s')],
        ]),
      });
    }
  }

  if (!meta.quiet) {

    // --- 15.9: יום פתיחת התצמצום — שואלים לפני שמתחילים ---
    // הרצפה הזמנית: אם לא אושר עד 12 שבועות מהגמילה, מתחילים בכל זאת
    // ובקצב איטי יותר. תנאי-מצב פתוח לגמרי אומר שהצמצום עלול לא
    // להתחיל לעולם — וזה כשל אמיתי בדיוק כמו לצמצם מוקדם מדי.
    if (G.backstopPassed(plan, iso) && !meta.sent[`${iso}:backstop`]) {
      meta.sent[`${iso}:backstop`] = 1;
      dirty = true;
      plan.confirmedTaper = true;
      plan.taperStartISO = iso;
      const b14 = await ANL.collect(env, iso, 14);
      // slow: הצמצום הזה לא נבחר אלא הופעל אוטומטית, ולכן רץ איטי יותר.
      G.chooseTaperMode(plan, b14, { slow: true });
      plan.baseline = ANL.buildBaseline(b14, iso);
      meta.gumPlan = plan; touched.add('gumPlan');
      await send(env, meta.chatId, [
        '📉 <b>מתחילים לצמצם — ברצפה הזמנית.</b>',
        '',
        `עברו 12 שבועות מהגמילה, והתנאי המצבי לא התקיים. התוכנית שלך אומרת במפורש: אם לא התחלת עד ${P.fmtHe(G.TAPER_BACKSTOP)} — להתחיל בכל זאת, לאט.`,
        '',
        plan.mode === 'interval'
          ? `מתחילים מהקצב שלך בפועל: <b>מרווח ${plan.baseGap} דק׳</b>, ומאריכים ב-${plan.gapStepPct}% כל ${plan.stepDays} ימים.`
          : `יחידה אחת פחות כל ${plan.stepDays} ימים.`,
        `<i>איטי יותר מהרגיל, כי זה לא תזמון שבחרת.</i>`,
        '',
        '<b>וזה הפיך לגמרי</b> — צעד אחורה או עצירה, בלחיצה.',
      ].join('\n'), {
        reply_markup: inline([
          [btn('⏸️ עצור — עוד לא', 'tp:wait')],
          [btn('↩️ צעד אחורה', 'tp:back'), btn('🍬 מצב המסטיק', 'gp:show')],
        ]),
      });
    }

    if (taperAskDue(plan, P.diffDays(plan.taperStartISO, iso), now.minutes,
                    !!meta.sent[`${iso}:taperask`])) {
      meta.sent[`${iso}:taperask`] = 1;
      dirty = true;
      const d14 = await ANL.collect(env, iso, 14);
      const rd = G.readiness(d14.slice(0, 7), d14.slice(7, 14), G.dailyTarget(plan, iso));
      const verdict = !rd.ready
        ? '⏸️ <b>הנתונים מצביעים על להמתין:</b>\n' + rd.reasons.map(r => `   • ${r}`).join('\n')
        : rd.confidence === 'weak'
          ? '🟡 <b>אין סיבה לחסום — אבל גם אין סימן חיובי אחד.</b>\nהצריכה לא עולה ואין מעידות, וזה הכל. זה "לא רע", לא "זה הזמן". אם אתה מהסס, זו הסיבה.'
          : `✅ <b>הנתונים נראים יציבים${rd.confidence === 'strong' ? ', ובבירור' : ''}:</b>\n` + rd.signals.map(s => `   • ${s}`).join('\n');
      await send(env, meta.chatId, [
        `📉 <b>תצמצום המסטיק — ${P.fmtHe(iso)}</b>`,
        '',
        `לפי התוכנית: יחידה אחת פחות כל ${plan.stepDays} ימים, מ-${G.sortTimes(plan.times).length} יחידות עד יחידת הבוקר בלבד.`,
        '',
        '<b>אבל התנאי הוא מצב, לא תאריך.</b> אלה הנתונים שלך:',
        `• מסטיק: <b>${rd.nowAvg}</b> ביום (שבוע לפני כן: ${rd.prevAvg || '—'})`,
        // "0% עברו" נקרא ככישלון, אבל כשאף גל לא סומן זה אומר שלא מדדנו
        // — לא שנכשלת. אצלו זה המצב בפועל (3 מתוך 47), ולכן ההבחנה חשובה.
        `• דחפים: ${rd.waves}${rd.unmeasured ? ' · <i>אף אחד לא סומן כ"עבר", אז אין לי מדד איכות</i>'
          : rd.passRate !== null ? ` · ${rd.passRate}% עברו בלי שנדרש כלום` : ''}${rd.slips ? ` · מעידות: ${rd.slips}` : ''}`,
        `• תיעוד: ${rd.coverage}/7 ימים${rd.coverage < G.COVERAGE_MIN ? ' ⚠️' : ''}`,
        '',
        verdict,
        '',
        rd.coverage < G.COVERAGE_MIN
          ? '<i>שים לב: ימים בלי תיעוד נראים לי כמו ימים בלי מסטיק ובלי דחפים. לכן כשהתיעוד חלקי אני לא קובע שהמצב טוב — אני אומר שאני לא יודע.</i>'
          : '<i>אין פרס על מהירות. תצמצם שמחזיר דחפים הוא תצמצם שנכשל.</i>',
        '<i>ההחלטה שלך בכל מקרה — הנתונים הם קלט, לא שער. עד שתאשר נשארים על המספר המלא, ואשאל שוב בעוד שלושה ימים.</i>',
      ].join('\n'), {
        reply_markup: inline([
          [btn('✅ יציב — מתחילים לצמצם', 'tp:go')],
          [btn('⏸️ עוד לא — דחה בשבוע', 'tp:wait')],
          [btn('📉 קרא את תוכנית הצמצום', 'T:taper')],
        ]),
      });
    }

    // --- ניטור *במהלך* התצמצום, כל 7 ימים ---
    // בלי זה האישור ב-15.9 היה ההחלטה האחרונה בתהליך, והסולם היה יורד
    // כל 4 ימים בלי שאיש בודק אם זה עובד.
    if (taperWatchDue(plan, P.diffDays(plan.taperStartISO, iso), now.minutes,
                      !!meta.sent[`${iso}:taperwatch`])) {
      const w7 = await ANL.collect(env, iso, 7);
      const tw = G.taperWatch(w7, plan.baseline);
      meta.sent[`${iso}:taperwatch`] = 1;
      dirty = true;
      if (tw) {
        // ההקפאה נעשית **בפועל** ולא רק בהבטחה. קודם לכן ההודעה אמרה
        // "אני לא מוריד עוד יחידה עד שתחליט", ו-activeTimes המשיכה
        // להוריד מנה כל 4 ימים בלי להתייעץ בכלום — כלומר הבוט הבטיח
        // הבטחה שלא קיים, בדיוק במצב שבו הכי חשוב שיקיים.
        if (!plan.pausedISO) {
          plan.pausedISO = iso;
          meta.gumPlan = plan;
          touched.add('gumPlan');
        }
        const n = G.dailyTarget(plan, iso);   // היעד האמיתי, לא מספר המשבצות
        await send(env, meta.chatId, [
          tw.lowCoverage
            ? '⏸️ <b>בדיקת התצמצום — אין לי מספיק נתונים.</b>'
            : '⚠️ <b>בדיקת התצמצום — משהו החמיר.</b>',
          '',
          `אתה על <b>${n}</b> יחידות ביום. מאז שהתחלנו לצמצם:`,
          ...tw.worse.map(x => `   • ${x}`),
          '',
          tw.lowCoverage
            ? 'להוריד עוד מנה בלי לדעת מה קורה זה לצמצם בעיוורון, ולכן עצרתי. שני ימים של תיעוד ואני ממשיך.'
            : 'התוכנית אומרת את זה במפורש: <b>אם צריך להתאמץ כדי להפחית, עוד לא הזמן.</b>',
          '⏸️ <b>הקפאתי את הצמצום עכשיו</b> — לא תיפול עוד מנה עד שתחליט.',
          '',
          '<i>צעד אחורה עכשיו זול. מעידה יקרה.</i>',
        ].join('\n'), {
          reply_markup: inline([
            [btn('↩️ חזור צעד אחורה', 'tp:back')],
            [btn('✅ ממשיכים — זה בשליטה', 'tp:keep')],
            [btn('🍬 מצב המסטיק', 'gp:show')],
          ]),
        });
      }
    }

    for (const slot of SLOTS) {
      const act = slotAction(slot, now.minutes, meta.sent, iso);
      if (act === 'done' || act === 'early') continue;

      // 'late' מסמן שנשלח בלי לשלוח: וורקר שהיה למטה שעתיים לא אמור
      // לירות את כל הודעות היום בבת אחת, וגם לא לדלג עליהן לנצח.
      meta.sent[`${iso}:${slot.id}`] = 1;
      dirty = true;
      if (act === 'late') continue;

      const pl = P.planFor(iso, meta.siteOffset);
      const day = await getDay(env, iso);
      const msg = await buildSlot(slot.id, pl, iso, day, meta, now);
      // שאלת מצב הרוח נתלית על הודעת הערב עצמה, ולא רק על כפתור
      // "ערב הושלם". קודם היא הופיעה רק אחרי לחיצה — כלומר בערב שבו
      // לא נכנסת לטקס, המדד לא נאסף כלל. וזה בדיוק הערב שבו הוא הכי
      // שווה: יום שבו לא בא לך לפתוח את הבוט הוא נתון בפני עצמו.
      if (msg && slot.id === 'evening' && !day.mood) {
        msg.kb = msg.kb || inline([]);
        msg.kb.inline_keyboard.unshift([1, 2, 3, 4, 5].map(v => btn(String(v), `mo:${v}`)));
        msg.text += '\n\n🌤️ <b>איך היה היום?</b>  1 = רע מאוד · 5 = טוב מאוד';
      }
      if (msg) await send(env, meta.chatId, msg.text, { reply_markup: msg.kb });

      // אחרי הודעת הערב: דוח דפוסים במוצ״ש, ובדיקת נקודת ההסלמה
      if (slot.id === 'evening') {
        if (now.dow === 6) {
          // מיישבים את המונה מול הרשומות פעם בשבוע. הוא נסחף בפועל
          // (62 מול 73 מסטיקים), והרשומות הן האמת.
          meta.totals = await ANL.reconcileTotals(env, iso);
          touched.add('totals');
          // רענון החלון מהמדידה. הלוח אמר 07:30–20:30 והמציאות
          // 09:00–21:34, ולכן 20% מהמנות נפלו מחוץ לחלון והבוט שתק
          // דווקא בשעות שבהן הוא כן לוקח.
          const rh14 = G.measureRhythm(await ANL.collect(env, iso, 14));
          if (rh14.days >= 5) {
            const gp = { ...G.DEFAULT_PLAN, ...(meta.gumPlan || {}) };
            gp.winStart = rh14.first; gp.winEnd = rh14.last;
            meta.gumPlan = gp; touched.add('gumPlan');
          }
          await sendWeeklyReport(env, meta, iso);
        }
        if (await maybeEscalate(env, meta, iso)) touched.add('lastEscalationISO');
      }
    }
  }

  // כתיבה ממוזגת, ולא putMeta(meta) על האובייקט שנקרא בתחילת ה-tick.
  //
  // הקרון רץ במקביל להודעות: טלגרם מסדר עדכונים לפי צ׳אט, אבל הוא לא
  // יודע דבר על הקרון. tick קורא meta, שולח הודעות (שניות), וכותב.
  // אם בזמן הזה הגיעה הודעה ו-converse כתב meta, הכתיבה כאן הייתה
  // מוחקת אותה — ובכיוון ההפוך, הודעה שנכתבה אחרי קריאת ה-tick הייתה
  // מוחקת את meta.sent ומייצרת שליחה כפולה של הודעת הבוקר בקרון הבא.
  // לכן קוראים מחדש ומחילים רק את השדות שהקרון באמת מחזיק.
  if (dirty) {
    const fresh0 = await getMeta(env);
    // רק שדות שה-tick באמת שינה. הגרסה הקודמת החילה רשימה קבועה ללא
    // תנאי, כולל `sos` ו-`gumPlan` שהקרון כמעט אף פעם לא נוגע בהם —
    // ולכן ערך שנקרא בתחילת ה-tick נכתב בחזרה בסופו ודרס כל שינוי
    // שהמשתמש עשה בשניות שביניהם:
    //   • לחיצה על "יש לי דחף" באמצע tick → sos חוזר ל-null, כלומר
    //     צ׳ק-אין 10 הדקות לא יוצא, evIdx אובד והתגית נדבקת לאירוע
    //     הלא נכון, ו-reported אובד כך שגם עדכון "הגל נשבר" נעלם.
    //   • אישור התצמצום (tp:go) באמצע tick → confirmedTaper ו-baseline
    //     נמחקים, והבוט שואל שוב שלושה ימים אחר-כך.
    //   • lastPartnerAlert — נכתב ב-alertPartner, שרץ ממסלולי המשתמש
    //     (startPlanning/startEnRoute) ולא מהקרון. כתיבה בחזרה של ערך
    //     ישן הייתה מאפסת את מגרת 30 הדקות ומאפשרת דיווח כפול לשותפה.
    //     לכן הוא **לא** ברשימה: הקרון לא נוגע בו, ולכן גם לא כותב אותו.
    const fresh = mergeTickMeta(fresh0, meta, touched);
    pruneSent(fresh, iso);
    await putMeta(env, fresh);
  }
}

// ==========================================================================
//  סשן CBT בבוט
//
//  ה-I/O בלבד. כל ההחלטות — איזה כלי, מתי נגמר, מה הציון — יושבות
//  ב-`cbt/session.js` ונבדקות שם בלי טלגרם ובלי KV.
// ==========================================================================

/**
 * טקסט של כלי — **HTML שנכתב בכוונה**, לא קלט משתמש.
 *
 * `tools.js` כותב `<b>...</b>` במפורש, וכל אתר רינדור עטף אותו ב-`esc()`,
 * ולכן טלגרם הציג `<b>` כתווים. escaping נכון לתשובת מודל; כאן הוא
 * הופך עיצוב מכוון לזבל על המסך.
 *
 * הכלים הם קוד שלנו, לא קלט חיצוני — אבל ערכים שמוזרקים לתוכם (טריגר
 * שהמשתמש כתב) כן עוברים escaping ב-`tools.js` עצמו.
 */
const toolText = s => String(s ?? '');

/** ה-state המספרי שהכלים והמודל מקבלים */
async function cbtState(env, meta, cbt, pl, iso) {
  const days = await ANL.collect(env, iso, 14);
  const gp = { ...G.DEFAULT_PLAN, ...(meta.gumPlan || {}) };
  return CBTS.toolState(cbt, days, { ...pl, gumTarget: G.dailyTarget(gp, iso),
                                     confirmedTaper: !!gp.confirmedTaper }, iso);
}

/** התורות של הסשן הנוכחי — נגזרים מ-`captured`, כי הם מה ששרד */
const cbtTurns = cbt => Object.entries(cbt.active?.captured || {})
  .map(([tool, answer]) => ({ tool, answer }));

/**
 * תור אחד: מריץ, רושם, ושואל את הבא.
 *
 * **המצב נשמר גם כשהמודל נכשל.** תור שלא נרשם משאיר את הכלי
 * ב-remaining לנצח — כישלון רשת שהופך לסשן שאי אפשר לסיים.
 */
async function runTherapyTurn(env, chatId, meta, text, pl, iso) {
  const cbt0 = CBTS.migrateCbt(meta.cbt);
  if (!cbt0.active) return void await send(env, chatId, 'אין סשן פתוח. /טיפול כדי להתחיל.');

  const st = await cbtState(env, meta, cbt0, pl, iso);
  const tool = CBTSESS.nextStep(cbt0, st);
  if (!tool) return void await finishTherapy(env, chatId, meta, cbt0, st);

  const turns = cbtTurns(cbt0);
  const r = await CBTSESS.runStep(cbt0, tool, st, text, {
    call: AI.cbtCall(env, CBTE.ROLES),
    retrieve: retrieverFor(env, { bct: tool.id }),
    turns,
  });

  const next = CBTSESS.nextStep(r.cbt, st);
  const done = !next || CBTSESS.exhausted(cbtTurns(r.cbt), r.cbt);
  meta.cbt = r.cbt;
  meta.awaiting = done ? null : 'cbt';
  await putMeta(env, meta);

  // ═══ עצירת בטיחות ═══
  //
  // `halt` הגיע כ-reply ריק, ולכן הוצג כ"לא הצלחתי לנסח תגובה —
  // ממשיכים". כלומר זיהוי מצוקה אמיתי היה **נבלע** והסשן היה ממשיך
  // לצ׳קליסט. הצ׳קליסט אינו חשוב מזה.
  if (r.mode === 'halt') {
    meta.awaiting = null; await putMeta(env, meta);
    return void await send(env, chatId, [
      'עצרתי את הסשן.',
      '',
      'מה שאמרת נשמע גדול מהפרוטוקול הזה, ואני בוט ולא תחליף לאדם.',
      '',
      ...C.PHONES.split('\n').filter(Boolean),
      '',
      // **מוצא אמיתי.** ההודעה הציעה רק `/טיפול`, שמחזיר לאותה שאלה
      // ולכן לאותה עצירה. `/סיום` לא הוזכר בכלל.
      '<i>/טיפול לחזור לאותו שלב · /סיום לסגור את הסשן.</i>',
    ].join('\n'));
  }

  const bits = [];
  // תשובה שנכשלה אינה מוסתרת: סשן שממשיך כאילו כלום לא קרה מייצר
  // רצף שבור שהמשתמש לא יכול להסביר לעצמו.
  //
  // **תשובת מודל עוברת escaping; טקסט כלי לא.** ראה `toolText` למטה.
  if (r.reply) bits.push(esc(r.reply));
  else if (r.mode === 'failed' && r.tries < CBTSESS.MAX_TRIES) {
    // הכלי **לא** נרשם כבוצע — לכן ההודעה אומרת "שוב", לא "ממשיכים".
    bits.push('<i>(לא הצלחתי לנסח תגובה. ננסה את אותו שלב שוב — ענה שוב, או /סיום.)</i>');
  } else {
    bits.push('<i>(לא הצלחתי לנסח תגובה. מדלג על השלב הזה — הוא יסומן כנשמט.)</i>');
  }
  if (next) {
    const a = next.run(st);
    bits.push('', `<b>${esc(next.name)}</b>`, toolText(a.text));
    if (a.ask) bits.push('', `<b>${esc(a.ask)}</b>`);
  }
  await send(env, chatId, bits.join('\n'));
  if (done) await finishTherapy(env, chatId, meta, r.cbt, st);
}

/** סגירה — ציון נאמנות ודפוס */
async function finishTherapy(env, chatId, meta, cbt, st) {
  const r = await CBTSESS.closeSession(cbt, st, {
    call: AI.cbtCall(env, CBTE.ROLES), turns: cbtTurns(cbt),
  });
  if (r.error) return void await send(env, chatId, 'אין סשן פתוח.');
  meta.cbt = r.cbt; meta.awaiting = null;
  await putMeta(env, meta);
  const fl = CBTS.fidelityLine(r.cbt);
  await send(env, chatId, [
    '🪑 <b>הסשן נסגר.</b>',
    `נאמנות לפרוטוקול: <b>${Math.round(r.fidelity.score * 100)}%</b>` +
      (r.fidelity.missed.length ? ` · דולג: ${esc(r.fidelity.missed.join(', '))}` : ''),
    ...(fl ? [esc(fl)] : []),
    ...(r.formulation ? ['', `<i>${esc(r.formulation)}</i>`] : []),
  ].join('\n'));
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
    // "✅ בלי מעידות השבוע" נאמר קודם גם על שבוע שכמעט לא תועד — כלומר
    // אישור אקטיבי לבת הזוג על ששה ימים שאין עליהם שום נתון. אם הכיסוי
    // חלקי, אומרים את זה במפורש ולא מנחמים על סמך חוסר.
    const thin = a.coverage < 5;
    await send(env, meta.partnerChatId, [
      `🗓️ <b>סיכום שבוע</b>`,
      thin ? `📭 רק ${a.coverage} מתוך 7 ימים תועדו — הנתונים למטה חלקיים.` : null,
      `🌊 דחפים שעברו עד הסוף: <b>${a.surfed}</b> מתוך ${a.waves} (${a.surfRate}%)`,
      a.slips  ? `↩️ מעידות: ${a.slips} — <i>דאטה, לא ציון. בלי חשבון נפש.</i>`
      : thin   ? `<i>לא דווחו מעידות — אבל עם כיסוי חלקי זה לא אותו דבר כמו "לא היו".</i>`
               : '✅ בלי מעידות השבוע.',
      '',
      `<i>מודדים שחרורים, לא רק ימים. וחגיגה שבועית קטנה היא חלק מהשיטה.</i>`,
    ].filter(Boolean).join('\n'));
  }
}

/** נקודת ההחלטה להסלמה (סעיף יב׳) — לכל היותר פעם בשבוע */
async function maybeEscalate(env, meta, iso) {
  let fired = false;
  if (meta.lastEscalationISO && P.diffDays(meta.lastEscalationISO, iso) < 7) return fired;
  const days = await ANL.collect(env, iso, 7);
  const res = ANL.escalationFlags(days, meta);
  const { flags, stats, blind } = res;
  // הכלל עצמו יושב ב-analytics.js לצד הנתונים שהוא שופט. כשהוא ישב
  // כאן, אף צד לא הכיל את התמונה המלאה — וזה מה שהסתיר את העובדה
  // ששבוע שקט מייצר דגל אחד בלבד ולכן לעולם לא עובר את הסף.
  if (!ANL.shouldEscalate(res)) return fired;
  meta.lastEscalationISO = iso;
  fired = true;
  await send(env, meta.chatId, ANL.escalationText(flags, stats, blind), {
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

    // ---- תור בסשן CBT ----
    if (field === 'cbt') {
      await runTherapyTurn(env, chatId, meta, text, pl, iso);
      return;
    }

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
      await putWeekly(env, iso, text);
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
  const R = c => runCommand(c, '', chatId, env, meta, pl, iso, now);
  const fast = fastRoute(text);
  // משבר נשלח כאן ישירות ולא דרך runCommand: זה טקסט סטטי בלי שינוי
  // מצב, וזה הנתיב היחיד שחייב לעבוד גם כשהמכסה נגמרה וכל הספקים למטה.
  if (fast === 'crisis') return send(env, chatId, INT.CRISIS_TEXT);
  if (fast) return R(fast);

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
    L.push(`תוכנית: יום ${pl.n} מתוך ${P.TOTAL_DAYS} · שבוע ${pl.week} · ${pl.phase} ${pl.dose} מ״ג · מקום ההדבקה היום: ${pl.site} · ${nextStep} · ${pl.clean} ימים נקיים · נחסך ${pl.clean * meta.costPerDay}₪`);
  } else if (pl.before) L.push(`לפני יום ההפסקה — עוד ${pl.daysToQuit} ימים (25.7.2026)`);
  else L.push(`סיים את שלב המדבקות · ${pl.cleanDays} ימים נקיים`);

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
    if (AI.quotaLeft(meta, env, iso) > 0) {
      const hist = recentHist(meta);
      // meter סופר קריאות upstream בפועל. הודעה אחת יכולה לייצר עד
      // ארבע (classify מנסה שני ספקים, ואז ask מנסה שוב שניים), וקודם
      // לכן כולן נספרו כאחת — או כאפס כשהכול נכשל, שזה בדיוק היום
      // שבו הצריכה הגבוהה ביותר.
      const meter = { calls: 0 };
      const res = await INT.classify(env, text, await buildState(env, pl, iso, now, meta), hist, meter);
      if (res) {
        AI.noteUse(meta, iso, meter.calls);
        // ההודעה והתשובה נכנסות לזיכרון כאן, לפני כל הסתעפות — אחרת
        // כוונות שמסתיימות ב-return R(...) היו נופלות מההיסטוריה,
        // ובדיוק הן הרגעים שהמשך שיחה מתייחס אליהם ("זה עבר", "ולמה?").
        pushHist(meta, 'u', text);
        pushHist(meta, 'a', res.reply);
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

        // שאלה / רגש / אחר — תשובה בלבד.
        // אם התשובה התרוקנה בניקוי, **לא** שולחים הודעה ריקה: טלגרם
        // דוחה אותה ב-400 שלא נתפס בנפילה-לאחור לטקסט פשוט, והמשתמש
        // היה מקבל שתיקה מוחלטת אחרי שהמכסה כבר חויבה. נופלים ל-KB.
        if (res.reply && res.reply.trim()) {
          const m = M.answerBlock(res.reply, null);
          return send(env, chatId, m.text, { reply_markup: m.kb });
        }
      }
    } else {
      await send(env, chatId, '🤖 נגמרה המכסה היומית של השיחה החופשית. בסיס הידע מהמדריכים עדיין עובד — שאל בקצרה, או /כלים.');
    }
  }

  // ---- 1ב · הסיווג לא חזר תקין → תשובה חופשית בלי סיווג ----
  // (המסלול המהיר בביטוי הרגולרי כבר רץ לפני זה, כך שדחף מפורש
  //  לא מגיע לכאן בכלל.)
  if (AI.enabled(env) && AI.quotaLeft(meta, env, iso) > 0) {
    const meter2 = { calls: 0 };
    const plain = await AI.ask(env, text, await buildState(env, pl, iso, now, meta), recentHist(meta), meter2);
    if (plain && plain.trim()) {
      AI.noteUse(meta, iso, meter2.calls);
      pushHist(meta, 'u', text);
      pushHist(meta, 'a', plain);
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
//  הניתוב המהיר — פונקציה טהורה, ולכן ניתנת לבדיקה
//
//  הסדר כאן הוא הלוגיקה הכי קריטית בבוט, והוא כבר נשבר פעם אחת: בלי
//  בדיקת enroute לפני urge, "אני בדרך לחנות" נתפס כדחף רגיל — כלומר
//  הניסוח הדחוף ביותר קיבל את התגובה הרפה ביותר ובלי דיווח לבת הזוג.
//  הסדר היה מוטבע ב-handleText ולא היה ניתן לבדיקה בלי KV ורשת.
//
//  מחזיר את שם הפקודה, או null אם אין התאמה חד-משמעית — ואז ההודעה
//  עוברת להבנת המודל ב-converse(), שם אין רשימת מילים ליפול דרכה.
// ==========================================================================
// אותיות סופיות. הדפוסים נכתבו בצורה הלא-סופית ("תירוצ"), והמילה
// נכתבת בסופית ("תירוץ") — ולכן "אני מחפש תירוץ לצאת", הניסוח הכי
// מובהק לדרגה 2 שיש, לא זוהה בכלל. מקפלים את שני הצדדים במקום לצוד
// כל מקרה בנפרד: הקיפול נוגע רק באותיות עבריות, ולכן תחביר הביטוי
// הרגולרי אינו נפגע.
const foldFinals = s => s
  .replace(/\u05dd/g, '\u05de').replace(/\u05df/g, '\u05e0').replace(/\u05e5/g, '\u05e6')
  .replace(/\u05e3/g, '\u05e4').replace(/\u05da/g, '\u05db');

const RXF = Object.fromEntries(
  Object.entries(RX).map(([k, re]) => [k, new RegExp(foldFinals(re.source))]),
);

export function fastRoute(text) {
  const t = foldFinals(String(text).replace(/[\u05f4"'\u05f3]/g, ''));

  // 0 · משבר — גובר על הכל, כולל על מעידה. מי שכותב "קניתי ואין לי
  //     טעם לחיות" צריך את קו הסיוע, לא את נוהל המעידה.
  if (RXF.crisis.test(t)) return 'crisis';

  // 1 · עבר — מעידה שקרתה. חייב להיקדם לזיהוי הדחף, אחרת "קניתי"
  //     ייתפס כ"רוצה לקנות".
  if (RXF.slip.test(t) && !RXF.slipNegated.test(t)) return 'slip';

  // 2 · דרגה 3: הדחופה מכולן, ולכן היא זוכה על כל השאר.
  if (RXF.enroute.test(t) && !RXF.negated.test(t)) return 'enroute';

  // 3 · דרגה 2: תירוצים לצאת הם התחנה הראשונה בשרשרת, וזו הדרגה
  //     שמדווחת לשותפה. נבדקת לפני דחף רגיל.
  if (RXF.planning.test(t) && !RXF.negated.test(t)) return 'planning';

  // 4 · דחף רגיל — הרגע שכל הבוט קיים בשבילו. כאן מעדיפים בכוונה
  //     זיהוי-יתר: התראת שווא עולה לחיצה אחת, החמצה עולה מכשיר חדש.
  if (RXF.urge.test(t) && !RXF.negated.test(t)) return 'wave';

  if (RXF.out.test(t))    return 'out';
  if (RXF.gum.test(t))    return 'gum';
  if (RXF.patch.test(t))  return 'patch';
  if (RXF.status.test(t)) return 'status';
  if (RXF.win.test(t))    return 'win';
  return null;
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
        return send(env, chatId, `💰 עודכן: <b>${meta.costPerDay}₪ ליום</b>.\nנחסך מאז 25.7: <b>${(pl.clean || 0) * meta.costPerDay}₪</b>.`);
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
    // ═══ סשן CBT ═══
    //
    // הפרוטוקול היה בנוי, בדוק ומחובר לספרייה — וניתן להרצה רק
    // מהסוכן. כאן הוא נפתח מהטלפון, על אותם protocol/tools/engine.
    case 'therapy': {
      const cbt = CBTS.migrateCbt(meta.cbt);
      if (cbt.active) {
        const st = await cbtState(env, meta, cbt, pl, iso);
        const tool = CBTSESS.nextStep(cbt, st);
        if (!tool) return void await finishTherapy(env, chatId, meta, cbt, st);
        meta.awaiting = 'cbt'; await putMeta(env, meta);
        const a = tool.run(st);
        return void await send(env, chatId,
          `🪑 <b>${esc(tool.name)}</b>\n\n${toolText(a.text)}${a.ask ? `\n\n<b>${esc(a.ask)}</b>` : ''}`);
      }
      const open = CBTSESS.openSession(cbt, iso);
      if (open.error === 'none-due') {
        // ההיסטוריה נרשמה בכל סגירה ואיש לא קרא אותה. כאן היא סוף סוף
        // נראית — וזה גם המקום היחיד שבו ירידה מתמשכת מסומנת.
        const fl = CBTS.fidelityLine(cbt);
        return void await send(env, chatId, [
          `🪑 אין סשן שאמור לרוץ היום.${open.nextISO ? ` הבא: <b>${P.fmtHe(open.nextISO)}</b>.` : ''}`,
          ...(fl ? ['', esc(fl)] : []),
          ...(S_latest(cbt) ? ['', `<i>${esc(S_latest(cbt))}</i>`] : []),
        ].join('\n'));
      }
      meta.cbt = open.cbt; meta.awaiting = 'cbt'; await putMeta(env, meta);
      const st = await cbtState(env, meta, open.cbt, pl, iso);
      const tool = CBTSESS.nextStep(open.cbt, st);
      if (!tool) return void await finishTherapy(env, chatId, meta, open.cbt, st);
      const a = tool.run(st);
      // **אומרים מראש כשאין AI.** `sessionMode` נכתב בדיוק בשביל זה
      // ולא נקרא מ-`src/` בכלל, ולכן סשן בלי מודל נראה זהה לסשן מלא.
      const smode = CBTT.sessionMode(open.cbt.active.remaining, !!env.GEMINI_KEY);
      return void await send(env, chatId, [
        `🪑 <b>${esc(open.session.title)}</b>`,
        `${open.session.checklist.length} שלבים · כ-${open.session.minMinutes} דקות`,
        ...(smode && smode.note ? [`<i>${esc(smode.note)}</i>`] : []),
        ...(open.opening.length ? ['', `<i>${esc(open.opening.join(' · '))}</i>`] : []),
        '', `<b>${esc(tool.name)}</b>`, toolText(a.text),
        ...(a.ask ? ['', `<b>${esc(a.ask)}</b>`] : []),
        '', '<i>/סיום כדי לעצור באמצע.</i>',
      ].join('\n'));
    }

    // עצירה באמצע. **סוגר ורושם** ולא נוטש: סשן שנשאר פתוח חוסם את
    // כל הבאים אחריו, וציון נאמנות חלקי הוא מידע — נטישה שקטה לא.
    case 'endsess': {
      const cbt = CBTS.migrateCbt(meta.cbt);
      if (!cbt.active) return void await send(env, chatId, 'אין סשן פתוח.');
      const st = await cbtState(env, meta, cbt, pl, iso);
      return void await finishTherapy(env, chatId, meta, cbt, st);
    }

    case 'exportd': {
      const days = await ANL.collect(env, iso, 30);
      const lines = [`# יומן גמילה — 30 ימים אחרונים (יוצא ${P.fmtHe(iso)})`];
      for (const d of days.slice().reverse()) {
        // d.slips **חסר** כאן — ולכן יום שבו נרשמה מעידה ב-/מעידה אבל
        // לא נכתב יומן היה נשמט בשקט מהייצוא שהוא עצמו קורא.
        if (!d.waves && !d.gum && !d.journal && !d.win && !d.patch
            && !d.slips && !d.outs && !d.mine && !d.gumMissed
            && !d.planning && !d.enroute) continue;
        const pd = P.planFor(d.iso);
        lines.push('', `## ${P.fmtHe(d.iso)}${pd.n >= 1 && pd.n <= P.TOTAL_DAYS ? ` · יום ${pd.n}/${P.TOTAL_DAYS} · ${pd.dose} מ״ג` : ''}`);
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
        AI.enabled(env) ? `נותרו היום: <b>${AI.quotaLeft(meta, env, iso)}</b> תשובות` : '',
        '',
        `בסיס הידע מהמדריכים (${KB.KB.length} נושאים) עובד תמיד, גם בלי AI, וגם בלי עלות.`,
        p === 'off' ? '\nלהדלקה — ראה README, סעיף "שיחה חופשית".' : '',
      ].filter(Boolean).join('\n'));
    }
    case 'gumplan': {
      const plan = { ...G.DEFAULT_PLAN, ...(meta.gumPlan || {}) };
      const t = G.taperInfo(plan, iso);
      const day = await getDay(env, iso);
      const w = G.windowOf(plan);
      const r = G.dueNow(plan, iso, day, now.minutes, meta.gumRemindISO === iso ? meta.gumRemindMin : null);
      const L = [
        '🍬 <b>תוכנית המסטיק</b>',
        '─────────────',
        // r.target הוא היעד האמיתי בשני המצבים. active.length הוא מספר
        // המשבצות, ובמצב-מרווח הוא פשוט מספר אחר — 9 בזמן שהיעד 8.
        `מצב: <b>${plan.on ? 'פעיל ✅' : 'כבוי 🔇'}</b> · יעד היום <b>${r.target}</b> יחידות`,
        `חלון: ${G.hhmm(w.start)}–${G.hhmm(w.end)} · לפי הקצב שלך, לא לפי שעון קבוע`,
        '',
        `היום: <b>${day.gum}</b> מתוך ${r.target}${r.since !== null ? ` · האחרונה לפני ${r.since} דק׳` : ' · עוד לא היתה'}`,
        `עכשיו: <b>${r.due ? 'כדאי לקחת' : 'לא צריך'}</b> — ${r.why}`,
        '',
        '<i>אין שעות קבועות. אני סופר כמה יחידות נשארו וכמה שעות נשארו בחלון, ומזכיר רק כשאתה מתחת לקצב — או אחרי 2.5 שעות בלי כלום. יחידה שלקחת ביוזמתך נספרת בדיוק כמו כל אחרת ומזיזה את התזכורת הבאה.</i>',
        `<i>לא מזכיר בתוך ${G.MIN_GAP} דק׳ מהיחידה האחרונה. בפועל המרווח בין תזכורות הוא לפחות ~80 דק׳ — ואם התעלמת מהקודמת, ${G.BACKOFF} דק׳.</i>`,
      ];
      if (t) {
        // הניסוח חייב לעקוב אחרי המנגנון. במצב-מרווח אין "משבצת שנופלת",
        // ו-nextToGo הוא null — הגרסה הקודמת הייתה מדפיסה כאן ממש
        // "הבאה שנופלת: null".
        const iv = t.mode === 'interval';
        const how = iv
          ? `המרווח מתארך ב-${t.gapStepPct}% כל ${t.step} ימים`
          : `יחידה אחת פחות כל ${t.step} ימים`;
        const next = t.atFloor
          ? (iv ? 'הגעת לסוף — אפס מנות' : 'הגעת לרצפה (בוקר בלבד)')
          : iv
            ? `הבא: ${t.nextGap} דק׳ ב-${P.fmtHe(t.nextDropISO)}`
            : `הבאה שנופלת: ${t.nextToGo} ב-${P.fmtHe(t.nextDropISO)}`;
        L.push('', t.pending
          ? `📉 תצמצום: <b>ממתין לאישור שלך</b> · מתוכנן מ-${P.fmtHe(plan.taperStartISO)}, ${how}. עד שתאשר — נשארים על ${t.start}.`
          : t.dropsSoFar > 0
            ? `📉 בתצמצום: <b>${t.active}</b> מתוך ${t.start}${iv ? ` · מרווח ${t.gap} דק׳` : ''} · ${next}`
            : `📉 התצמצום אושר ומתחיל ב-<b>${P.fmtHe(plan.taperStartISO)}</b> — ${how}.`);
      }
      // ---- מה הנתונים מראים ----
      // בלי התצוגה הזאת הניתוח קיים ולא נראה, וגם אי אפשר לחלוק עליו.
      const d14 = await ANL.collect(env, iso, 14);
      const usage = G.slotStats(d14, plan.times);
      const lat = G.remindLatency(d14);
      if (usage.covered) {
        const rank = Object.entries(usage.slots).sort((a, b) => b[1].adherence - a[1].adherence);
        const top = rank.slice(0, 3).filter(([, s]) => s.taken);
        const weak = rank.slice(-3).reverse().filter(([, s]) => s.adherence < 0.5);
        L.push('', `📊 <b>מה שאני רואה ב-${usage.covered} הימים המתועדים</b>`);
        if (top.length) L.push(`   הכי עקביות: ${top.map(([k, s]) => `<b>${k}</b> ${(s.adherence * 100) | 0}%`).join(' · ')}`);
        if (weak.length) L.push(`   הכי חלשות: ${weak.map(([k, s]) => `${k} ${(s.adherence * 100) | 0}%`).join(' · ')}`);
        if (lat.n >= 3) L.push(`   ⏱️ מתזכורת עד מנה: חציון <b>${lat.median} דק׳</b> (${lat.n} מדידות)`);
        // הקצב בפועל מול המתוכנן. כשהפער גדול, הלוח מודד את עצמו
        // ולא אותך — ואז גם הצמצום שנשען עליו מודד את עצמו.
        const rh = G.measureRhythm(d14);
        if (rh.days >= 3) {
          L.push(`   🕐 הקצב שלך: <b>${rh.perDay}</b> מנות ביום · מרווח חציוני <b>${rh.gap} דק׳</b> · ${G.hhmm(rh.first)}–${G.hhmm(rh.last)}`);
          if (rh.outsideWindow >= 0.1) {
            L.push(`   ⚠️ <b>${Math.round(rh.outsideWindow * 100)}% מהמנות מחוץ לחלון ${G.hhmm(w.start)}–${G.hhmm(w.end)}</b> — הן לא נספרות בקצב.`);
          }
        }
        L.push(usage.usable
          ? '   <i>מספיק נתונים — הצמצום יוריד קודם את המשבצות שפחות בשימוש.</i>'
          : `   <i>עוד ${G.MIN_USAGE_DAYS - usage.covered} ימים מתועדים ואוכל לבנות את סדר הצמצום על השימוש שלך ולא על כלל כללי.</i>`);
      }
      if (plan.dropBasis) L.push(`   <i>סדר הצמצום נקבע לפי: ${plan.dropBasis}</i>`);
      const tg = G.targetGap(plan, iso);
      if (tg != null) {
        L.push('', `⏳ <b>מצב-מרווח</b> · המרווח היעד היום: <b>${tg} דק׳</b> (התחלנו מ-${plan.baseGap})`,
          `   כל ${plan.stepDays} ימים המרווח מתארך ב-${plan.gapStepPct}% — כלומר ~${plan.gapStepPct}% פחות מנות, בעוצמת צעד אחידה לכל האורך.`,
          plan.rhythmBasis ? `   <i>הבסיס נמדד ממך: ${plan.rhythmBasis}</i>` : '');
      }

      L.push('', `<i>${G.RECOMMENDED.why}</i>`);
      const rows = Object.entries(G.PRESETS).map(([k, v]) => [btn((k === 'ten' ? '⭐ ' : '') + v.label, `gp:${k}`)]);
      rows.push([btn(plan.on ? '🔇 כבה תזכורות' : '✅ הפעל תזכורות', 'gp:toggle')]);
      // צעד אחורה חייב להיות בהישג יד *תוך כדי* התצמצום, לא רק כשהבוט
      // מזהה החמרה — הוא מרגיש את זה לפני שהנתונים מראים את זה.
      if (t && !t.pending && t.dropsSoFar > 0) rows.push([btn('↩️ חזור צעד אחורה', 'tp:back')]);
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
/**
 * משך הגל בשניות, אם ידוע.
 *
 * `sos.startedAt` נמדד בכל פתיחת גל ונזרק בכל סגירה — הקוד פשוט קבע
 * `sos = null`. זו הטענה האמפירית המרכזית של ברואר ("הגל דועך תוך
 * דקות, לא שעות"), היא נמדדת כאן בחינם, ואי אפשר היה להראות לו אותה
 * על הנתונים שלו עצמו.
 */
const waveSeconds = meta =>
  meta && meta.sos && meta.sos.startedAt
    ? Math.max(0, Math.round((Date.now() - meta.sos.startedAt) / 1000))
    : null;

async function recordEvent(env, iso, now, kind, extra = {}) {
  let idx = -1;
  await updateDay(env, iso, d => {
    d.ev.push({ k: kind, h: now.hour, m: now.min, ...extra });
    if (d.ev.length > 120) d.ev = d.ev.slice(-120);
    idx = d.ev.length - 1;
  });
  return idx;
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
  const target = plan.on ? G.dailyTarget(plan, iso) : 0;
  const lines = [`🍬 <b>נרשם.</b>`];
  lines.push(`היום: <b>${day.gum}</b> מתוך ${target || '—'} · <i>${day.gumSched || 0} אחרי תזכורת · ${day.gumExtra || 0} ביוזמתך</i>`);
  lines.push(`<i>שניהם נספרים ליעד — והתזכורת הבאה נדחית בהתאם.</i>`);
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
      const secPl = waveSeconds(meta);
      const day = await updateDay(env, iso, d => { d.surfed += 1; d.chainStops = (d.chainStops || 0) + 1; });
      await recordEvent(env, iso, now, 'v', secPl != null ? { sec: secPl } : {});
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
    const what = data.slice(3);
    const gplan = { ...G.DEFAULT_PLAN, ...(meta.gumPlan || {}) };
    const target = G.dailyTarget(gplan, iso);

    if (what === 's') {                       // דחייה ב-20 דקות מעכשיו
      // מעגלים לרשת הקרון (כל 10 דקות) ומודיעים את השעה שבה באמת
      // תצא התזכורת. קודם הובטח 10:51 בזמן שהבדיקה הבאה היא ב-11:00,
      // כלומר ההבטחה לא הייתה ניתנת לקיום גם בלי הבאג.
      meta.gumSnoozeISO = iso;
      meta.gumSnoozeMin = Math.ceil((now.minutes + 20) / 10) * 10;
      await putMeta(env, meta);
      const nt = G.hhmm(meta.gumSnoozeMin % 1440);
      await answer(env, cb.id, 'נדחה');
      return edit(env, chatId, msgId, `⏰ <b>נדחה.</b> אזכיר שוב ב-${nt}.\n\n<i>שום מונה לא זז — היחידה עוד לא נספרה.</i>`, { reply_markup: inline([]) });
    }

    if (what === 'y') {
      const day = await updateDay(env, iso, d => { d.gum += 1; d.gumSched = (d.gumSched || 0) + 1; });
      await recordEvent(env, iso, now, 'g', { sched: true });
      const m2 = await getMeta(env); m2.totals.gum += 1; await putMeta(env, m2);
      const cap = day.gum >= (m2.gumSoftCap || 18)
        ? `\n\n⚠️ <b>${day.gum} יחידות היום.</b> בדוק את המקסימום שעל האריזה ואל תחרוג ממנו.`
        : '';
      await answer(env, cb.id, 'נרשם 🍬');
      return edit(env, chatId, msgId,
        `✅ <b>נרשם.</b> <b>${day.gum}</b> מתוך ${target} להיום.${cap}`, { reply_markup: inline([]) });
    }

    // 'n' — דילוג
    const day = await updateDay(env, iso, d => { d.gumMissed = (d.gumMissed || 0) + 1; });
    await answer(env, cb.id, 'דולג');
    return edit(env, chatId, msgId, [
      `⏭️ <b>דולג.</b> ${day.gum} מתוך ${target} להיום · ${day.gumMissed} דולגו.`,
      '',
      '<i>בלי אשמה — זה נתון, לא ציון. אזכיר שוב כשהקצב יחייב.</i>',
    ].join('\n'), { reply_markup: inline([[btn('🍬 בעצם לקחתי', 'gr:y')]]) });
  }

  // --- פתיחת התצמצום ---
  if (data.startsWith('tp:')) {
    const what = data.slice(3);
    const plan = { ...G.DEFAULT_PLAN, ...(meta.gumPlan || {}) };
    if (what === 'go') {
      plan.confirmedTaper = true; plan.taperStartISO = iso;
      // קו-הבסיס נשמר *ברגע האישור* כדי שיהיה מול מה להשוות בהמשך.
      // בלי זה אין דרך לדעת אם התצמצום עצמו החזיר גלים.
      plan.baseline = ANL.buildBaseline(await ANL.collect(env, iso, 14), iso);

      // סדר ההורדה נקבע כאן, מ-14 יום של שימוש בפועל, ונשמר.
      // משבצת שעקבית לא נלקחת אינה עושה עבודה — היא יורדת ראשונה,
      // ולא זו שהלוח הצביע עליה. מתחת ל-MIN_USAGE_DAYS ההבדלים הם
      // רעש דגימה, ואז נופלים לסדר הקליני.
      const b14 = await ANL.collect(env, iso, 14);
      const usage = G.slotStats(b14, plan.times);
      plan.dropOrder = G.dropOrderOf(G.sortTimes(plan.times), usage);
      plan.dropBasis = usage.usable ? `שימוש בפועל · ${usage.covered} ימים` : 'סדר קליני (מדגם קטן מדי)';

      // מעבר למצב-מרווח, על בסיס הקצב הנמדד. אם אין מספיק מדידות
      // נשארים במצב המשבצות — עדיף לוח שמרני מבסיס שנשען על יומיים.
      G.chooseTaperMode(plan, b14);
      meta.gumPlan = plan; await putMeta(env, meta);
      await answer(env, cb.id, 'התצמצום התחיל');
      const t = G.taperInfo(plan, iso);
      // הטקסט חייב לתאר את המנגנון שירוץ בפועל. הגרסה הקודמת הייתה
      // משבצתית תמיד, ולכן במצב-מרווח היא הבטיחה "יחידה אחת פחות כל
      // 4 ימים · הראשונה שנופלת 14:15" — שלוש טענות שגויות.
      const how = t.mode === 'interval'
        ? `<b>${t.active} מנות ביום</b> עכשיו · המרווח מתארך מ-<b>${t.gap} דק׳</b> ב-${t.gapStepPct}% כל ${t.step} ימים (הבא: ${t.nextGap} דק׳ ב-${P.fmtHe(t.nextDropISO)}).\n\n<i>מבוסס על ${plan.rhythmBasis}.</i>\n\nהמרווח הוא הממד שבו אתה באמת מתנהג — 90% מהמנות ביוזמתך ולא מתזכורת, ולכן הורדת תזכורת לא מורידה צריכה, והארכת מרווח כן.`
        : `<b>${t.start} יחידות</b> עכשיו · יחידה אחת פחות כל ${t.step} ימים · הראשונה שנופלת: <b>${t.nextToGo}</b> ב-${P.fmtHe(t.nextDropISO)}.\n\n<i>${plan.rhythmBasis} — ולכן לוח משבצות ולא מרווח.</i>\n\nיחידת הבוקר נשארת אחרונה — היא מכסה את הלילה בלי מדבקה.`;
      return send(env, chatId, `📉 <b>התצמצום התחיל.</b>\n\n${how}\n\n<b>ואני ממשיך לבדוק.</b> כל שבוע אשווה את הדחפים והמעידות לקו-הבסיס של עכשיו (${plan.baseline.waves} דחפים בשבוע), ואם המצב מחמיר אציע צעד אחורה — לא אחכה שתבקש.\n\n<i>אין פרס על מהירות.</i>`);
    }
    if (what === 'back') {
      // דחיפת נקודת ההתחלה קדימה בצעד אחד מחזירה בדיוק דרגה אחת,
      // וכל הירידות הבאות נדחות איתה. משחררים גם את ההקפאה — הצעד
      // אחורה הוא ההחלטה, ומכאן הלוח רץ שוב.
      plan.taperStartISO = P.addDaysISO(plan.taperStartISO, Math.max(1, plan.stepDays || 4));
      plan.pausedISO = null;
      meta.gumPlan = plan; await putMeta(env, meta);
      await answer(env, cb.id, 'חזרנו צעד אחורה');
      const n = G.dailyTarget(plan, iso);
      return send(env, chatId, `↩️ <b>צעד אחורה.</b> חזרת ל-<b>${n}</b> יחידות ביום, וכל הירידות הבאות נדחו ב-${plan.stepDays} ימים.\n\n<i>זו לא נסיגה. התוכנית אומרת במפורש: אם צריך להתאמץ כדי להפחית, עוד לא הזמן. הניקוטין הוא הזנב, לא הכלב — והכלב הוא מה שאתה שומר עליו עכשיו.</i>`);
    }
    if (what === 'keep') {
      // שחרור ההקפאה: הלוח קפא ביום שבו הגלאי התריע, ולכן מזיזים את
      // נקודת ההתחלה קדימה באותו מספר ימים — אחרת כל הימים שעברו
      // בהקפאה היו "נפרעים" בבת אחת ומפילים כמה מנות ביום אחד.
      let held = 0;
      if (plan.pausedISO) {
        held = Math.max(0, P.diffDays(plan.pausedISO, iso));
        plan.taperStartISO = P.addDaysISO(plan.taperStartISO, held);
        plan.pausedISO = null;
        meta.gumPlan = plan; await putMeta(env, meta);
      }
      await answer(env, cb.id, 'ממשיכים');
      return send(env, chatId, `👍 <b>ממשיכים.</b>${held ? ` הצמצום היה מוקפא ${held} ימים, והלוח נדחה באותה מידה כדי שלא ייפלו כמה מנות בבת אחת.` : ''} אבדוק שוב בעוד שבוע.\n\n<i>ואם תשנה דעת באמצע — /מסטיקים, כפתור הצמצום, ואני מחזיר צעד. זה תמיד פתוח.</i>`);
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
    const sec = waveSeconds(meta);
    const day = await updateDay(env, iso, d => { d.surfed += 1; });
    await recordEvent(env, iso, now, 'v', sec != null ? { sec } : {});
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
  // --- מצב רוח (יומי) ועייפות גמילה (שבועי) --------------------------
  //
  //  שני המדדים שהמערכת לא אספה, והם היחידים שהספרות מצביעה עליהם
  //  כמנבאים: אפקט שלילי ניבא מעידה ראשונה יותר מכל משתנה מצבי אחר,
  //  ועייפות-גמילה מנבאת הישנות מעל ומעבר לעוצמת הדחפים.
  if (data.startsWith('mo:')) {
    const v = Math.max(1, Math.min(5, parseInt(data.slice(3), 10) || 0));
    const dayBefore = await getDay(env, iso);
    const nth = moodReadings(dayBefore).length;          // כמה כבר נרשמו היום
    await recordMood(env, iso, now.hour, now.minutes % 60, v);
    await answer(env, cb.id, `נרשם ${v}/5`);
    const d14 = await ANL.collect(env, iso, 14);
    const med = ANL.subjMedian(d14, 'mood');
    const n14 = ANL.subjCount(d14, 'mood');
    const fb = C.MOOD_FEEDBACK[v];
    // מונה רץ: יום × 3 + מספר הבדיקה. שתי תשובות עוקבות — גם באותה
    // דרגה, גם באותו ערב — לעולם לא מקבלות את אותו ציטוט.
    const [q, src, kind] = C.moodQuote(v, (pl.n || 0) * 3 + nth);
    const L = [`🌤️ <b>מצב רוח: ${v}/5</b>`, '', `<b>${fb.head}</b>`, fb.body];
    // מגמה, ורק כשיש מספיק מדידות כדי שלא תהיה רעש
    if (med !== null && n14 >= 3) {
      const arrow = v > med ? 'מעל' : v < med ? 'מתחת ל' : 'בדיוק ב';
      L.push('', `📊 היום ${arrow}חציון של ${n14} הימים שנמדדו (${med}).`);
    }
    // מגמה בתוך היום עצמה — זו התנועה שמנבאת, לא הממוצע
    const today = moodReadings(await getDay(env, iso)).map(e => e.v);
    if (today.length >= 2) {
      const prev = today[today.length - 2];
      const dir = v > prev ? '↗️ עלה' : v < prev ? '↘️ ירד' : '➡️ יציב';
      L.push('', `${dir} מאז המדידה הקודמת היום (${today.join(' → ')}).`);
    }
    // מרכאות רק לציטוט מילולי. פרפרזה מוצגת כמו ב-INS_* — טקסט ואז
    // ייחוס, בלי מרכאות. ההבדל אינו קוסמטי: מרכאות הן טענה שהמשפט
    // נאמר כלשונו, ובכמה מהערכים יש תוספת פרשנות שאינה של המחבר.
    L.push('', kind === 'q' ? `<i>"${q}"</i>` : `<i>${q}</i>`, `— ${src}`);
    const [enc, encSrc] = C.encouragement((pl.n || 0) * 3 + nth);
    L.push('', `<i>${enc}</i>`, `<i>— ${encSrc}</i>`);
    // ביום נמוך הכפתורים חשובים יותר מהטקסט: אפקט שלילי הוא המנבא
    // החזק ביותר למעידה, וזה הרגע להציע פעולה ולא רק ניסוח.
    const kb = v <= 2
      ? inline([[btn('🍬 מסטיק עכשיו', 'g'), btn('🌊 יש לי דחף', 'wv')], [btn('🚶 יוצא להליכה', 'out:start')]])
      : undefined;
    return send(env, chatId, L.join('\n'), kb ? { reply_markup: kb } : undefined);
  }
  if (data.startsWith('cf:')) {
    const v = Math.max(1, Math.min(5, parseInt(data.slice(3), 10) || 0));
    await updateDay(env, iso, d => { d.fatigue = v; });
    await answer(env, cb.id, `נרשם ${v}/5`);
    const kb2 = v >= 4
      ? inline([[btn('↩️ צעד אחורה בצמצום', 'tp:back'), btn('⏸️ עצור צמצום', 'tp:wait')]])
      : undefined;
    return send(env, chatId, `🔋 <b>עייפות מלנסות: ${v}/5</b>\n\n${C.FATIGUE_FEEDBACK[v]}`,
      kb2 ? { reply_markup: kb2 } : undefined);
  }

  if (data === 'ed') {
    const day = await getDay(env, iso);
    if (!day.eDone) {
      await updateDay(env, iso, d => { d.eDone = true; });
      const m2 = await getMeta(env); m2.totals.eDone += 1; await putMeta(env, m2);
    }
    await answer(env, cb.id, 'ערב הושלם ✓');
    // השאלות נתלות כאן ולא בהודעה נפרדת: הערב הוא הרגע היחיד ביום שבו
    // יש מבט לאחור על היום כולו, וזה בדיוק מה שהמדד מודד. הודעה נוספת
    // הייתה עוד התראה — וכל התראה מיותרת מקרבת להשתקת הבוט.
    const askMood = !day.mood;
    // עייפות-גמילה נעה בקצב של שבועות, לא ימים. שאלה יומית עליה הייתה
    // רעש ונטל; שבועית היא גם הקצב שבו היא נמדדת בספרות.
    const askFat = !day.fatigue && P.diffDays(P.QUIT, iso) % 7 === 0;
    const rows = [];
    if (askMood) rows.push([1, 2, 3, 4, 5].map(v => btn(String(v), `mo:${v}`)));
    if (askFat)  rows.push([1, 2, 3, 4, 5].map(v => btn(String(v), `cf:${v}`)));
    return send(env, chatId, [
      '🌙 <b>ערב הושלם. הלולאה החדשה קיבלה עוד יום של אימון.</b>',
      '',
      '🩹 <b>לפני השינה</b> — להסיר את המדבקה, ולהכין את של מחר.',
      '😴 שינה היא תחמושת: מחר תקבל החלטות טובות רק כמו הלילה שלך.',
      ...(askMood ? ['', '🌤️ <b>איך היה היום?</b>  1 = רע מאוד · 5 = טוב מאוד'] : []),
      ...(askFat  ? ['', '🔋 <b>ועד כמה אתה עייף מלנסות?</b>  1 = בכלל לא · 5 = מאוד'] : []),
      '',
      'לילה טוב.',
    ].join('\n'), rows.length ? { reply_markup: inline(rows) } : undefined);
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
