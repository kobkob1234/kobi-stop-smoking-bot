// ==========================================================================
//  index.js — Cloudflare Worker
//  fetch()     → webhook של טלגרם (תגובות מיידיות)
//  scheduled() → cron כל 10 דקות; מחליט לפי שעון ישראל מה לשלוח
// ==========================================================================

import { send, edit, answer, inline, btn, esc, MAIN_KB, setCommands } from './telegram.js';
import * as P from './plan.js';
import * as C from './content.js';
import * as M from './messages.js';
import * as KB from './kb.js';
import * as AI from './ai.js';
import * as ANL from './analytics.js';
import { getMeta, putMeta, getDay, updateDay, pruneSent } from './store.js';

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
  { command: 'wave',    description: '🌊 יש לי גל / דחף עכשיו' },
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
    if (url.pathname === '/diag' || url.pathname === '/cron' || url.pathname === '/export') {
      if (!env.WEBHOOK_SECRET || url.searchParams.get('key') !== env.WEBHOOK_SECRET) {
        return new Response('forbidden', { status: 403 });
      }
      if (url.pathname === '/cron') {
        await tick(env);
        return new Response('ticked');
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
      const pl = P.planFor(now.iso);
      const day = await getDay(env, now.iso);
      return Response.json({
        ok: true,
        israelTime: `${now.iso} ${now.hhmm}`,
        linked: !!meta.chatId,
        partnerLinked: !!meta.partnerChatId,
        quiet: meta.quiet,
        day: pl.n, dose: pl.dose ?? null, cleanDays: pl.clean ?? pl.cleanDays ?? null,
        sentToday: Object.keys(meta.sent).filter(k => k.startsWith(now.iso)).map(k => k.split(':')[1]),
        today: { gum: day.gum, waves: day.waves, surfed: day.surfed, patch: day.patch },
        totals: meta.totals,
        ai: AI.provider(env),
        kbTopics: KB.KB.length,
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

  if (!meta.quiet) {
    for (const slot of SLOTS) {
      const key = `${iso}:${slot.id}`;
      if (meta.sent[key]) continue;
      const target = slot.h * 60 + slot.m;
      if (now.minutes < target) continue;

      meta.sent[key] = 1;
      dirty = true;

      if (now.minutes - target > slot.grace) continue;   // מאוחר מדי — מדלגים בשקט

      const pl = P.planFor(iso);
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
      `🌊 גלים שנגלשו עד הסוף: <b>${a.surfed}</b> מתוך ${a.waves} (${a.surfRate}%)`,
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
  const pl = P.planFor(iso);

  // ---- פקודה? ----
  if (text.startsWith('/')) {
    const raw = text.slice(1).split(/\s+/);
    const word = raw[0].split('@')[0];
    const arg = text.slice(1 + raw[0].length).trim();
    const cmd = resolveCmd(word);
    if (cmd) { meta.awaiting = null; await putMeta(env, meta); return runCommand(cmd, arg, chatId, env, meta, pl, iso, now); }
    await send(env, chatId, 'לא הכרתי את הפקודה. /עזרה לרשימה המלאה.', { reply_markup: MAIN_KB });
    return;
  }

  // ---- כפתורי המקלדת הקבועה ----
  const kbMap = {
    '🌊 יש לי גל': 'wave', '🚪 יוצא מהבית': 'out', '🍬 מסטיק': 'gum',
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

  // ---- טקסט חופשי: ניתוב לפי מילות מפתח ----
  const t = text.replace(/[״"']/g, '');
  if (/יוצא מהבית|יוצא לדרך|יוצא החוצה|אני יוצא/.test(t)) return runCommand('out', '', chatId, env, meta, pl, iso, now);
  if (/קניתי|נפלתי|שאפתי|עשיתי שאכטה|מעדתי/.test(t))      return runCommand('slip', '', chatId, env, meta, pl, iso, now);
  if (/יש לי גל|גל של קנייה|בא לי|דחף|קראבינג|מתפוצץ|רוצה לווייפ|בדרך לחנות/.test(t)) return runCommand('wave', '', chatId, env, meta, pl, iso, now);
  if (/^מסטיק|לקחתי מסטיק/.test(t))                        return runCommand('gum', '', chatId, env, meta, pl, iso, now);
  if (/^מדבקה|הדבקתי/.test(t))                             return runCommand('patch', '', chatId, env, meta, pl, iso, now);
  if (/^(סטטוס|איפה אנחנו|מה המצב)/.test(t))               return runCommand('status', '', chatId, env, meta, pl, iso, now);
  if (/ניצחון|נצחון/.test(t))                              return runCommand('win', '', chatId, env, meta, pl, iso, now);

  // ---- שיחה: קודם בסיס הידע מהמדריכים, אחר-כך AI (אם מופעל) ----
  return converse(text, chatId, env, meta, pl, iso);
}

/**
 * שכבת ה"דיבור":
 *  1. בסיס הידע מהמדריכים (kb.js) — חינם, מדויק, עם מקור. זה הרוב.
 *  2. AI אופציונלי, מעוגן באותם קטעים + מצב היום — רק אם הוגדר ספק.
 *  3. אחרת — שומר ביומן ומציע כלים, כדי שכלום לא ייפול לרצפה.
 */
async function converse(text, chatId, env, meta, pl, iso) {
  const isQuestion = /[?]|^(מה|למה|איך|כמה|מתי|האם|אפשר|מותר|כדאי|צריך|יש)/.test(text.trim());
  const hit = KB.answer(text);

  // התאמה חזקה → תשובה מהמדריכים, בלי AI ובלי עלות
  if (hit && hit.score >= 6) {
    const m = M.answerBlock(hit.text, null);
    return send(env, chatId, m.text, { reply_markup: m.kb });
  }

  // AI מופעל → תשובה מעוגנת
  if (AI.enabled(env) && (isQuestion || text.length > 25)) {
    meta._today = iso;
    if (AI.quotaLeft(meta, env) > 0) {
      const day = await getDay(env, iso);
      const state = [
        pl.before ? `לפני יום ההפסקה, עוד ${pl.daysToQuit} ימים`
          : pl.after ? `סיים את 70 הימים, ${pl.cleanDays} ימים נקיים`
          : `יום ${pl.n} מתוך 70, שבוע ${pl.week}, ${pl.clean} ימים נקיים, מדבקה ${pl.dose} מ"ג`,
        `היום: מסטיק ${day.gum}, גלים ${day.waves}, נגלשו ${day.surfed}, מדבקה ${day.patch ? 'סומנה' : 'לא סומנה'}`,
        day.mine ? `המוקש שרשם היום: ${day.mine}` : '',
      ].filter(Boolean).join(' · ');

      const out = await AI.ask(env, text, state);
      if (out) {
        AI.noteUse(meta, iso);
        await putMeta(env, meta);
        const m = M.answerBlock(out, `${AI.provider(env)} · מעוגן במדריכים שלך`);
        return send(env, chatId, m.text, { reply_markup: m.kb });
      }
    } else {
      await send(env, chatId, '🤖 נגמרה המכסה היומית של השיחה החופשית. בסיס הידע מהמדריכים עדיין עובד — נסה לנסח כשאלה קצרה, או /כלים.');
    }
  }

  // התאמה חלשה → עדיין שווה להציע
  if (hit) {
    const m = M.answerBlock(hit.text, null);
    return send(env, chatId, m.text, { reply_markup: m.kb });
  }

  // אין התאמה — שומרים ביומן, לא מאבדים כלום
  await updateDay(env, iso, d => { d.journal = (d.journal ? d.journal + '\n' : '') + text.slice(0, 800); });
  await send(env, chatId, [
    '📓 שמרתי את זה ביומן של היום.',
    '',
    isQuestion
      ? 'על השאלה הזאת אין לי תשובה מהמדריכים שלך — ואני לא ממציא. נסה לנסח אחרת, או /כלים · /טלפונים.'
      : 'אם התכוונת למשהו אחר — הכפתורים למטה, או /עזרה.',
  ].join('\n'), {
    reply_markup: inline([
      [btn('🌊 יש לי גל', 'sos:1'), btn('🚪 יוצא מהבית', 'out:start')],
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
      await send(env, chatId, 'המקלדת מוכנה 👇', { reply_markup: MAIN_KB });
      await setCommands(env, BOT_COMMANDS);
      return;
    }
    case 'help':    return R(M.help());
    case 'status':  return R(M.status(pl, iso, day, meta));
    case 'morning': return R(M.morning(pl, day, meta));
    case 'evening': return R(M.evening(pl, iso, day, meta, now.dow === 6));
    case 'tools':   return R(M.toolsMenu());
    case 'wave': {
      const evIdx = await recordWave(env, iso, now, 'w');
      meta.sos = { startedAt: Date.now(), followedUp: false, evIdx };
      meta.totals.waves += 1;
      await putMeta(env, meta);
      const m = M.sos(1);
      await send(env, chatId, m.text, { reply_markup: m.kb });
      if (meta.scenes) await send(env, chatId, `🔮 <b>הסצנות שכתבת לעצמך:</b>\n\n${esc(meta.scenes)}`);
      const tr = M.tagRow();
      await send(env, chatId, tr.text, { reply_markup: tr.kb });
      return;
    }
    case 'out':   return R(M.outing(pl, iso, day, meta, now));
    case 'gum':   return logGum(chatId, env, iso, meta);
    case 'patch': return logPatch(chatId, env, iso, pl, meta);
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
        lines.push(`מדבקה: ${d.patch ? 'כן' : 'לא'} · מסטיק: ${d.gum} · גלים: ${d.waves} · נגלשו: ${d.surfed}${d.slips ? ` · מעידות: ${d.slips}` : ''}`);
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
      return converse(arg, chatId, env, meta, pl, iso);
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
async function recordWave(env, iso, now, kind) {
  let idx = -1;
  await updateDay(env, iso, d => {
    if (kind === 'x') d.slips += 1; else d.waves += 1;
    d.ev.push({ k: kind, h: now.hour, m: now.min, tag: null });
    if (d.ev.length > 60) d.ev = d.ev.slice(-60);
    idx = d.ev.length - 1;
  });
  return idx;
}

// ---------- רישום מסטיק ----------
async function logGum(chatId, env, iso, meta) {
  const day = await updateDay(env, iso, d => { d.gum += 1; });
  const m = await getMeta(env); m.totals.gum += 1; await putMeta(env, m);

  const lines = [`🍬 נרשם. מסטיק 2 מ״ג היום: <b>${day.gum}</b>`];
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
async function logPatch(chatId, env, iso, pl, meta) {
  const day = await updateDay(env, iso, d => { d.patch = true; });
  const m = await getMeta(env); m.totals.patch += 1; await putMeta(env, m);

  const lines = ['🩹 <b>מדבקה נרשמה ✓</b>'];
  if (!pl.before && !pl.after) {
    lines.push(`היום: <b>${pl.dose} מ״ג</b> (${pl.product}) · 📍 ${pl.site}`);
    const tm = P.planFor(P.addDaysISO(iso, 1));
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
  const pl = P.planFor(iso);

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
  if (data === 'g') { await answer(env, cb.id, 'מסטיק נרשם 🍬'); return logGum(chatId, env, iso, meta); }
  if (data === 'p') { await answer(env, cb.id, 'מדבקה נרשמה 🩹'); return logPatch(chatId, env, iso, pl, meta); }

  if (data === 'sf') {
    const day = await updateDay(env, iso, d => { d.surfed += 1; });
    const m2 = await getMeta(env); m2.totals.surfed += 1; m2.sos = null; await putMeta(env, m2);
    await answer(env, cb.id, 'גל נגלש 🌊');
    return send(env, chatId, [
      `🌊 <b>נרשם. גלים שנגלשו עד הסוף היום: ${day.surfed}</b> · סה״כ: ${m2.totals.surfed}`,
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
      '🩹 המדבקה הוסרה? החדשה מוכנה למחר?',
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
    const m2 = await getMeta(env); m2.totals.outs += 1; await putMeta(env, m2);
    await answer(env, cb.id, 'יצאת מוכן ✓');
    return send(env, chatId, [
      `🚪 <b>יצאת מוכן.</b> נרשם — יציאות עם טקס: ${m2.totals.outs}`,
      '',
      'הכפתור למטה איתך כל הזמן. אם עולה גל — לחיצה אחת, ואני מוביל.',
    ].join('\n'), { reply_markup: inline([[btn('🌊 יש גל / אני בדרך לחנות', 'sos:1')]]) });
  }

  // --- SOS ---
  if (data.startsWith('sos:')) {
    const which = data.slice(4);

    if (which === 'done') {
      const day = await updateDay(env, iso, d => { d.surfed += 1; });
      const m2 = await getMeta(env);
      m2.totals.surfed += 1; m2.sos = null; m2.awaiting = 'win';
      await putMeta(env, m2);
      await answer(env, cb.id, 'ניצחון נרשם 🏆');
      return send(env, chatId, [
        `🏆 <b>נרשם! גלים שנגלשו עד הסוף: ${m2.totals.surfed}</b> (היום: ${day.surfed})`,
        '',
        'זה המדד האמיתי — לא ספירת ימים. <i>מדוד שחרורים.</i>',
        '',
        '📝 ובמשפט אחד: מה הייתה <b>התחנה הראשונה</b> של הגל הזה? (זה נכנס לטבלת האם-אז שלך.)',
      ].join('\n'));
    }

    const step = parseInt(which, 10) || 1;
    if (step === 1) {
      const evIdx = await recordWave(env, iso, now, 'w');
      const m2 = await getMeta(env);
      m2.totals.waves += 1; m2.sos = { startedAt: Date.now(), followedUp: false, evIdx };
      await putMeta(env, m2);
      await answer(env, cb.id);
      const m = M.sos(1);
      await send(env, chatId, m.text, { reply_markup: m.kb });
      const tr = M.tagRow();
      return send(env, chatId, tr.text, { reply_markup: tr.kb });
    }
    await answer(env, cb.id);
    const m = M.sos(step);
    // שלב 4 — אם יש שותף/ה מחובר/ת, שולחים בלחיצה במקום להעתיק
    if (step === 4 && meta.partnerChatId) {
      m.kb = inline([[btn('📨 שלח דיווח לבת/בן הזוג', 'pr:send')], [btn('נשלח / ממשיך ←', 'sos:5')]]);
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
