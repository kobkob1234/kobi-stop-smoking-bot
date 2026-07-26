// ==========================================================================
//  messages.js — בוני ההודעות
// ==========================================================================

import * as P from './plan.js';
import * as C from './content.js';
import { btn, inline, esc } from './telegram.js';

const LINE = '─────────────';

function bar(done, total, width = 12) {
  const f = Math.max(0, Math.min(width, Math.round((done / total) * width)));
  return '▓'.repeat(f) + '░'.repeat(width - f);
}

function insight([text, who]) {
  return `💡 <i>${text}</i>\n<code>— ${who}</code>`;
}

// האם היום נמצא בתוך 70 הימים
const inPlan = pl => !pl.before && !pl.after;

// ==================== בוקר ====================
export function morning(pl, day, meta) {
  const ins = P.pick(C.INS_MORNING, pl.iso);

  if (pl.before) {
    return {
      text: `🌅 <b>בוקר טוב</b>\n\nיום ההפסקה: <b>7.7.2026</b> — עוד ${pl.daysToQuit} ימים.\nממשיכים מדבקה 21 מ״ג.\n\n${insight(ins)}`,
      kb: inline([[btn('🩹 מדבקה הודבקה ✓', 'p')]]),
    };
  }
  if (pl.after) {
    return {
      text: `🌅 <b>בוקר טוב</b>\n\n🏁 סיימת את 70 הימים. המדבקה האחרונה הייתה ב-14.9.2026.\n<b>${pl.cleanDays} ימים נקיים מוויפ.</b>\n\nשומרים על השגרה החדשה, על הכלים, ומסטיק בהישג יד לביטחון.\n\n${insight(ins)}`,
      kb: inline([[btn('📊 סטטוס', 'st'), btn('🧰 כלים', 'T:menu')]]),
    };
  }

  const parts = [];
  parts.push(`🌅 <b>בוקר טוב — יום ${pl.n} מתוך ${P.TOTAL_DAYS}</b>`);
  parts.push(`<code>${bar(pl.n, P.TOTAL_DAYS)}</code>  שבוע ${pl.week} · ${pl.phase}`);
  parts.push(LINE);
  if (pl.milestone) parts.push(`${pl.milestone}\n`);
  parts.push(`🩹 <b>מדבקה:</b> ${pl.dose} מ״ג · 📍 ${pl.site}`);
  parts.push(`🍬 <b>מסטיק 2 מ״ג:</b> תוך 30–60 דק׳ מהקימה — הבוקר הוא הפער הגדול (אין מדבקה בלילה).`);
  parts.push(`🔥 <b>${pl.clean} ימים נקיים</b> · 💰 ${pl.clean * meta.costPerDay}₪ נשארו אצלך`);
  parts.push('');
  parts.push(`<b>1 · הזהות והנדר — בקול, ליד המדבקה:</b>`);
  parts.push(`"${esc(meta.identity)}"`);
  parts.push('');
  parts.push(`<b>2 · שלושת האם-אז — לקרוא בקול (זה מה שצורב אותם):</b>`);
  parts.push(C.IFTHEN_3.join('\n'));
  parts.push('');
  parts.push(`<b>3 · המוקש של היום:</b> מה המצב המסוכן הצפוי היום (שעה/מקום/מצב רוח) — ומה התגובה המוכנה?`);
  if (day.mine) parts.push(`<i>אתמול רשמת: ${esc(day.mine)}</i>`);
  parts.push('');
  parts.push(`<b>4 · רענון RAIN (30 שניות):</b>`);
  parts.push(C.RAIN_SHORT.join('\n'));
  parts.push('');
  parts.push(`🎯 <b>מיקוד השבוע:</b> ${pl.focus}`);
  if (pl.tip) parts.push(`💡 <b>טיפ היום:</b> ${pl.tip}`);
  parts.push('');
  parts.push(insight(ins));

  return {
    text: parts.join('\n'),
    kb: inline([
      [btn('🩹 מדבקה הודבקה ✓', 'p'), btn('🍬 מסטיק ✓', 'g')],
      [btn('🎯 רשום את מוקש היום', 'ask:mine')],
      [btn('🌅 בוקר הושלם ✓', 'md')],
    ]),
  };
}

// ==================== בדיקת סקרנות מיקרו ====================
export function micro(pl, iso, offset) {
  const m = P.pick(C.MICRO, iso, offset);
  const head = inPlan(pl) ? `יום ${pl.n} · ` : '';
  return {
    text: `🫧 <b>${head}בדיקת סקרנות</b>\n\n${m}`,
    kb: inline([[btn('🍬 מסטיק ✓', 'g'), btn('🌊 יש לי גל', 'sos:1')]]),
  };
}

// ==================== צהריים ====================
export function noon(pl, iso, day, meta) {
  const ins = P.pick(C.INS_NOON, iso);
  const sub = inPlan(pl)
    ? `יום ${pl.n} מתוך ${P.TOTAL_DAYS} · 🔥 ${pl.clean} ימים נקיים`
    : pl.after ? `🔥 ${pl.cleanDays} ימים נקיים` : `עוד ${pl.daysToQuit} ימים ליום ההפסקה`;
  const lines = [
    `☀️ <b>צ׳ק-אין צהריים</b>`,
    sub,
    LINE,
    `🍬 מסטיקים היום: <b>${day.gum}</b>${day.gum === 0 ? ' — אם היה דחף ולא לקחת, זה בסדר. אם היה דחף ובלעת אותו בכוח — קח.' : ''}`,
    `🌊 גלים שנגלשו היום: <b>${day.surfed}</b>`,
    '',
    `🧭 <b>המצפן:</b> כיווץ = דרום. פתיחות = צפון. מה יש בגוף שלך עכשיו?`,
    '',
    insight(ins),
  ];
  return {
    text: lines.filter(x => x !== null).join('\n'),
    kb: inline([
      [btn('🍬 מסטיק ✓', 'g'), btn('🌊 גל נגלש +1', 'sf')],
      [btn('🌊 יש לי גל עכשיו', 'sos:1'), btn('🧰 כלים', 'T:menu')],
    ]),
  };
}

// ==================== חלון הסיכון (אחה"צ/ערב) ====================
export function risk(pl, iso, day, meta) {
  const lines = [
    `🕯️ <b>חלון הסיכון</b>`,
    LINE,
    `המצב המסוכן שלך, שחור על לבן:`,
    `<b>ערב עייף ורעב מחוץ לבית.</b>`,
    '',
    `<b>תחזוקת המיכל</b> (ברואר, פרק 4): השליטה העצמית היא מיכל שמתרוקן. עייפות, רעב ומתח מנתקים בדיוק את החלק במוח שמחזיק את הכללים שלך.`,
    `<b>שינה, אוכל ותנועה הם לא ״אורח חיים בריא״ — הם תחמושת.</b>`,
    '',
    `✔️ אכלת משהו אמיתי?`,
    `✔️ מים?`,
    `✔️ 10 דק׳ הליכה עכשיו מורידות קראבינג ל-30–50 דקות.`,
    '',
    day.mine ? `🎯 <b>המוקש שרשמת הבוקר:</b> ${esc(day.mine)}\n` : '',
    `🚪 <b>יוצא מהבית הערב?</b> רק עם מסלול סגור. אין "סתם להסתובב".`,
    `🍬 מסטיק בכיס? ${day.gum > 0 ? `(היום: ${day.gum})` : ''}`,
  ];
  return {
    text: lines.filter(Boolean).join('\n'),
    kb: inline([
      [btn('🚪 יוצא מהבית', 'out:start')],
      [btn('🌊 יש לי גל', 'sos:1'), btn('🍬 מסטיק ✓', 'g')],
    ]),
  };
}

// ==================== ערב ====================
export function evening(pl, iso, day, meta, isSaturdayNight) {
  const ins = P.pick(C.INS_EVENING, iso);
  const tomorrow = P.planFor(P.addDaysISO(iso, 1));
  const parts = [];

  parts.push(`🌙 <b>ערב${inPlan(pl) ? ` — יום ${pl.n} מתוך ${P.TOTAL_DAYS}` : ''}</b>`);
  parts.push(LINE);
  parts.push(`<b>1 · המדבקה</b> — מסירים עכשיו, ומכינים את של מחר.`);
  if (inPlan(tomorrow)) {
    parts.push(`   מחר: <b>${tomorrow.dose} מ״ג</b> · 📍 ${tomorrow.site}`);
    if (tomorrow.milestone) parts.push(`   ${tomorrow.milestone}`);
  } else if (tomorrow.after) {
    parts.push(`   🏁 מחר — בלי מדבקה. סיימת את התוכנית.`);
  }
  parts.push('');
  parts.push(`<b>2 · ספירת היום</b> — מודדים שחרורים, לא רק ימים:`);
  parts.push(`   🌀 גלים שהיו: <b>${day.waves}</b> · 🌊 נגלשו עד הסוף: <b>${day.surfed}</b>`);
  parts.push(`   🍬 מסטיק: <b>${day.gum}</b> · 🩹 מדבקה: ${day.patch ? '✓' : '—'}`);
  parts.push('');
  parts.push(`<b>3 · יומן שלוש שורות</b>`);
  parts.push(`   הרגע הקשה של היום — ומה הייתה <b>התחנה הראשונה</b> שלו? · מה עבד? · מה מחר עושים אחרת?`);
  if (day.journal) parts.push(`   <i>נשמר: ${esc(day.journal).slice(0, 200)}</i>`);
  parts.push('');
  parts.push(`<b>4 · הניצחון של היום 🏆</b>`);
  parts.push(`   אחד לפחות. עצור 5 שניות <b>ותרגיש אותו</b> — זה התגמול שצורב את הלולאה החדשה.`);
  if (day.win) parts.push(`   <i>נשמר: ${esc(day.win)}</i>`);
  parts.push('');
  if (isSaturdayNight) {
    parts.push(`🗓️ <b>מוצ״ש — ערב הסקירה השבועית.</b> לחץ "סקירה שבועית" למטה, ומלאו יחד.`);
    parts.push('');
  }
  parts.push(insight(ins));

  const rows = [
    [btn('🌀 היה גל +1', 'wv'), btn('🌊 נגלש +1', 'sf')],
    [btn('🏆 רשום ניצחון', 'ask:win'), btn('📓 יומן', 'ask:journal')],
  ];
  if (isSaturdayNight) rows.push([btn('🗓️ סקירה שבועית', 'T:weekly')]);
  rows.push([btn('🌙 ערב הושלם ✓ לילה טוב', 'ed')]);

  return { text: parts.join('\n'), kb: inline(rows) };
}

// ==================== סטטוס ====================
export function status(pl, iso, day, meta) {
  const t = meta.totals;
  const parts = [`📊 <b>איפה אנחנו עומדים</b>`, LINE];

  if (pl.before) {
    parts.push(`יום ההפסקה: <b>7.7.2026</b> — עוד ${pl.daysToQuit} ימים.`);
  } else if (pl.after) {
    parts.push(`🏁 התוכנית הושלמה. <b>${pl.cleanDays} ימים נקיים.</b>`);
    parts.push(`💰 נחסך: <b>${pl.cleanDays * meta.costPerDay}₪</b>`);
  } else {
    const left = P.diffDays(iso, pl.lastPatchISO);
    parts.push(`<code>${bar(pl.n, P.TOTAL_DAYS)}</code>`);
    parts.push(`יום <b>${pl.n}</b> מתוך ${P.TOTAL_DAYS} · שבוע ${pl.week} · ${pl.phase}`);
    parts.push(`🔥 <b>${pl.clean} ימים נקיים מוויפ</b>`);
    parts.push(`🩹 היום: <b>${pl.dose} מ״ג</b> (${pl.product}) · 📍 ${pl.site}`);
    parts.push(`📅 המדבקה האחרונה: <b>${P.fmtHe(pl.lastPatchISO)}</b> — עוד ${left} ימים`);
    parts.push(`💰 נחסך מאז 7.7: <b>${pl.clean * meta.costPerDay}₪</b> <i>(${meta.costPerDay}₪/יום — /כסף לשינוי)</i>`);
  }

  parts.push('');
  parts.push(`<b>מדדי שחרור — מה שבאמת נמדד:</b>`);
  parts.push(`🌊 גלים שנגלשו עד הסוף: <b>${t.surfed}</b>  <i>(היום: ${day.surfed})</i>`);
  parts.push(`🌀 גלים שהיו: <b>${t.waves}</b>  <i>(היום: ${day.waves})</i>`);
  parts.push(`🍬 מסטיק: היום <b>${day.gum}</b> · סה״כ ${t.gum}`);
  parts.push(`🩹 מדבקה היום: ${day.patch ? '✓' : '— עדיין לא סומן'}`);
  parts.push(`🚪 יציאות עם טקס: <b>${t.outs}</b>`);
  parts.push(`🌅 בקרים: ${t.mDone} · 🌙 ערבים: ${t.eDone}`);
  if (t.slips > 0) {
    parts.push('');
    parts.push(`↩️ מעידות שנרשמו: ${t.slips} — <i>נרשמו כדאטה, לא כציון. השרשרת ממשיכה מהשעה הזאת.</i>`);
  }
  parts.push('');
  parts.push(`<i>מדוד שחרורים, לא רק ימים. השחרורים הם השריר שימנע את הנפילה הבאה. (ברואר, פרק 10)</i>`);

  return {
    text: parts.join('\n'),
    kb: inline([
      [btn('🍬 מסטיק ✓', 'g'), btn('🩹 מדבקה ✓', 'p')],
      [btn('🌊 גל נגלש +1', 'sf'), btn('🧰 כלים', 'T:menu')],
    ]),
  };
}

// ==================== יוצא מהבית ====================
export function outing(pl, iso, day, meta, ilNow) {
  const evening = ilNow.hour >= 17 || ilNow.hour < 4;
  const parts = [
    `🚪 <b>יוצא מהבית — טקס 20 השניות</b>`,
    `<i>לפני שהיד על הידית.</i>`,
    LINE,
  ];
  C.OUT_RITUAL.forEach((r, i) => parts.push(`${i + 1} · ${r}`));
  parts.push('');
  if (!pl.after && !pl.before) {
    parts.push(`🩹 מדבקה היום: ${pl.dose} מ״ג · 📍 ${pl.site} ${day.patch ? '✓' : '— סמן שהודבקה!'}`);
  }
  parts.push(`🍬 מסטיק 2 מ״ג בכיס? ${day.gum > 0 ? `(היום לקחת ${day.gum})` : ''}`);
  if (day.mine) parts.push(`🎯 <b>המוקש שרשמת היום:</b> ${esc(day.mine)}`);
  if (evening) {
    parts.push('');
    parts.push(`⚠️ <b>עכשיו זה חלון הסיכון שלך.</b> ערב + עייפות + רעב + חוץ = המצב הכי מסוכן. מסלול קצר וסגור, יעד מוגדר מראש, ובן/בת זוג בעדכון.`);
  }
  parts.push('');
  parts.push(C.OUT_5_LINES);
  parts.push('');
  parts.push(`<i>כל ארבע הקניות קרו בחוץ. לכן היציאה מהבית היא הצומת שמקבל טקס משלו.</i>`);

  return {
    text: parts.join('\n'),
    kb: inline([
      [btn('✅ יצאתי מוכן', 'out:done')],
      [btn('🌊 יש גל / אני בדרך לחנות', 'sos:1')],
      [btn('🩹 מדבקה ✓', 'p'), btn('🍬 מסטיק ✓', 'g')],
    ]),
  };
}

// ==================== SOS — זרימת הגל ====================
export function sos(step) {
  switch (step) {
    case 1:
      return {
        text: [
          `🛑 <b>עצור. זה גל.</b>`,
          LINE,
          `אתה קורא את זה — סימן שתפסת אותו בזמן. <b>ההחלטה עדיין אצלך.</b> 🎯`,
          '',
          `זה לא "אתה רוצה וויפ".`,
          `זו לולאה ישנה ששולחת חשמל ישן.`,
          `<b>גלים נגמרים גם בלי קנייה. תמיד.</b>`,
          '',
          `🍬 קח מסטיק 2 מ״ג <b>עכשיו</b> — לעוס-והנח. זה סוגר את פער ה-spike בזמן שאתה גולש.`,
        ].join('\n'),
        kb: inline([
          [btn('🚶 פונה 180° ומתחיל ללכת ←', 'sos:2')],
          [btn('🍬 לקחתי מסטיק ✓', 'g')],
        ]),
      };
    case 2:
      return {
        text: [
          `🚶 <b>10 דקות בכיוון ההפוך + RAIN</b>`,
          LINE,
          `פנה בכיוון ההפוך מהחנות — והתחל ללכת. עכשיו.`,
          '',
          C.RAIN_SHORT.join('\n'),
          '',
          `<i>לא נלחמים בגל — גולשים עליו. לחץ "ההנחיה הבאה" בקצב שלך תוך כדי הליכה.</i>`,
        ].join('\n'),
        kb: inline([
          [btn('▶️ ההנחיה הבאה', 'rw:0')],
          [btn('הגל נחלש — לשלב הבא ←', 'sos:3')],
        ]),
      };
    case 3:
      return {
        text: C.MOVIE,
        kb: inline([[btn('לא. ממשיך הלאה ←', 'sos:4')]]),
      };
    case 4:
      return {
        text: [
          `📱 <b>דווח — אל תשמור בסוד</b>`,
          LINE,
          `הסבבים חיו על שקט. הודעה אחת מפרקת אותם.`,
          `<b>זה דיווח, לא בקשת רשות.</b>`,
          '',
          `העתק ושלח:`,
          `<code>${C.PARTNER_MSG}</code>`,
          '',
          `<i>(לחיצה על הטקסט מעתיקה אותו.)</i>`,
        ].join('\n'),
        kb: inline([[btn('נשלח / ממשיך ←', 'sos:5')]]),
      };
    case 5:
      return {
        text: [
          `🏆 <b>הגל נשבר</b>`,
          LINE,
          `<b>עצור 5 שניות. הרגש את השקט שאחרי.</b>`,
          `<i>זה</i> התגמול שצורב את הלולאה החדשה — בלעדיו היא לא נרשמת.`,
          '',
          `בדיוק עכשיו עשית את הדבר שמדדו במעבדה אצל המצליחים:`,
          `<b>השתוקקת — ולא פעלת.</b>`,
          '',
          `הגל הבא כבר נולד קטן יותר.`,
        ].join('\n'),
        kb: inline([[btn('✅ רשום לי את הניצחון', 'sos:done')]]),
      };
    default:
      return sos(1);
  }
}

export function rainWalk(i) {
  const idx = ((i % C.RAIN_WALK.length) + C.RAIN_WALK.length) % C.RAIN_WALK.length;
  const [letter, prompt] = C.RAIN_WALK[idx];
  return {
    text: [
      `🚶 <b>RAIN בהליכה</b> · הנחיה ${idx + 1}/${C.RAIN_WALK.length}`,
      LINE,
      `<b>${letter}</b> — ${prompt}`,
      '',
      `<i>ממשיכים ללכת. נדדה הדעת? חוזרים ל"מה בגוף עכשיו?"</i>`,
    ].join('\n'),
    kb: inline([
      [btn('▶️ ההנחיה הבאה', `rw:${idx + 1}`)],
      [btn('הגל נחלש — לשלב הבא ←', 'sos:3')],
    ]),
  };
}

// ==================== תפריט כלים ====================
export function toolsMenu() {
  return {
    text: [
      `🧰 <b>ארגז הכלים</b>`,
      LINE,
      `<b>מוקדם</b> — שרשרת ההחלטות · אם-אז`,
      `<b>באמצע</b> — RAIN · דה-פוזיה · הרצת הסרט · סצנות עתיד`,
      `<b>אחרי</b> — נוהל 90 השניות (במקום הלקאה)`,
      `<b>הדלק</b> — זהות · ערכים · תרגול יומי קטן`,
      '',
      `<i>הכלים עובדים אצל מי שמפעיל אותם יומיום, לא אצל מי שקורא אותם.</i>`,
    ].join('\n'),
    kb: inline([
      [btn('🌊 RAIN', 'T:rain'), btn('⚡ שבירת דחף', 'T:urge')],
      [btn('✍️ אם-אז', 'T:ifthen'), btn('⛓️ שרשרת ההחלטות', 'T:chain')],
      [btn('🎬 הרצת הסרט', 'T:movie'), btn('🚌 דה-פוזיה', 'T:defus')],
      [btn('🪪 זהות', 'T:ident'), btn('🧭 מצפן', 'T:compass')],
      [btn('🔮 סצנות עתיד', 'T:scenes'), btn('🧠 5 שורות בחוץ', 'T:out5')],
      [btn('🍬 מסטיק 2 מ״ג', 'T:gum'), btn('🩹 מדבקה', 'T:patch')],
      [btn('⚠️ מעידה — 90 שניות', 'T:slip'), btn('📞 טלפונים', 'T:phones')],
      [btn('🪪 כרטיס ארנק', 'T:card'), btn('🫙 צנצנת', 'jar:ask')],
      [btn('📈 הדפוסים שלי', 'rep'), btn('🗓️ סקירה שבועית', 'T:weekly')],
    ]),
  };
}

export const TOOL_TEXTS = {
  rain: C.RAIN_FULL,
  ifthen: C.IFTHEN_FULL,
  movie: C.MOVIE,
  slip: C.SLIP_90,
  defus: C.DEFUSION,
  ident: C.IDENTITY,
  compass: C.COMPASS,
  chain: C.CHAIN,
  scenes: C.SCENES,
  gum: C.GUM_GUIDE,
  patch: C.PATCH_GUIDE,
  phones: C.PHONES,
  urge: C.URGE_ORDER,
  out5: C.OUT_5_LINES,
  weekly: C.WEEKLY,
  card: C.WALLET_CARD,
};

// ==================== עזרה ====================
export function help() {
  return {
    text: [
      `🤖 <b>מה אני יודע לעשות</b>`,
      LINE,
      `<b>אוטומטית, כל יום (שעון ישראל):</b>`,
      `07:00 🌅 בוקר — איפה אנחנו עומדים, מדבקה + מקום, מסטיק בוקר, זהות, אם-אז, מוקש היום, RAIN`,
      `10:00 🫧 בדיקת סקרנות`,
      `12:30 ☀️ צ׳ק-אין צהריים + מוטיבציה`,
      `15:00 🫧 בדיקת סקרנות`,
      `17:30 🕯️ חלון הסיכון (ערב עייף ורעב מחוץ לבית)`,
      `21:30 🌙 ערב — ספירת שחרורים, יומן, ניצחון, מדבקה של מחר`,
      `מוצ״ש 🗓️ סקירה שבועית`,
      '',
      `<b>פקודות:</b>`,
      `/גל — יש לי דחף עכשיו (זרימה מודרכת + RAIN)`,
      `/יוצא — טקס היציאה מהבית`,
      `/מסטיק — רישום מסטיק 2 מ״ג`,
      `/מדבקה — רישום מדבקה + מקום ההדבקה`,
      `/סטטוס — איפה אנחנו עומדים`,
      `/כלים — ארגז הכלים המלא`,
      `/בוקר · /ערב — להריץ את הטקס עכשיו`,
      `/מעידה — נוהל 90 השניות, בלי אשמה`,
      `/דוח — <b>הדפוסים שלך</b>: שעת השיא, ההקשר החוזר, ושורת אם-אז שנגזרת מהם`,
      `/כרטיס — כרטיס הארנק (כדאי להצמיד למעלה)`,
      `/צנצנת — חוזה ההפקדה העצמי`,
      `/אימון — אימון RAIN בן שבוע (נספח א׳)`,
      `/שותף — חיבור בת/בן הזוג לדיווח בלחיצה`,
      `/סקירה — הסקירה השבועית`,
      `/ייצוא — כל היומן שלך`,
      `/טלפונים — *6800 והקופות`,
      `/כסף 30 — כמה הוויפ עלה ליום (לחישוב החיסכון)`,
      `/שקט · /דבר — כיבוי/הדלקה של תזכורות`,
      `/עזרה — ההודעה הזאת`,
      '',
      `<b>ואפשר פשוט לדבר איתי.</b> שאל שאלה בעברית — "למה הגל לא עובר?" · "כמה מסטיק מותר?" · "שכחתי מדבקה" · "זה נורמלי שאני עצבני?" — ואני עונה מתוך המדריכים שלך, עם ציון המקור. מה שלא כתוב שם אני אומר שאין, ולא ממציא.`,
      '',
      `<b>גם מילות מפתח עובדות:</b> "יוצא מהבית" · "יש לי גל" · "בא לי" · "קניתי" · "מסטיק"`,
      '',
      `<i>אני לא ייעוץ רפואי. מינון והתאמה — עם רוקח או רופא.</i>`,
    ].join('\n'),
    kb: inline([[btn('🧰 כלים', 'T:menu'), btn('📊 סטטוס', 'st')], [btn('📈 הדפוסים שלי', 'rep')]]),
  };
}

export function welcome(pl, meta) {
  const where = pl.before
    ? `יום ההפסקה: 7.7.2026 — עוד ${pl.daysToQuit} ימים.`
    : pl.after
      ? `🏁 התוכנית הושלמה — ${pl.cleanDays} ימים נקיים.`
      : `אנחנו ביום <b>${pl.n} מתוך ${P.TOTAL_DAYS}</b> · שבוע ${pl.week} · מדבקה ${pl.dose} מ״ג · <b>${pl.clean} ימים נקיים</b>.`;

  return {
    text: [
      `🌊 <b>שלום. אני הליווי היומי שלך.</b>`,
      LINE,
      where,
      '',
      `אני בנוי על ארבעת המסמכים שלך: התוכנית המקיפה (מדבקות + <b>מסטיק 2 מ״ג</b>), המדריך המנטלי, טקס הבוקר והערב, והמלווה לכיס.`,
      '',
      `<b>מה יקרה מעכשיו:</b>`,
      `• בוקר, צהריים, אחה״צ וערב — הודעות אוטומטיות במקום להיזכר לבד.`,
      `• רגע דחף — כתוב "יש לי גל" או /גל ואני מוביל אותך צעד-צעד ב-RAIN.`,
      `• יוצא מהבית — כתוב "יוצא מהבית" ואני נותן את טקס 20 השניות ואת מה שרלוונטי לשעה הזאת.`,
      `• כל מסטיק, כל גל שנגלש, כל ניצחון — נספרים. <b>מודדים שחרורים, לא רק ימים.</b>`,
      '',
      `המקלדת למטה תמיד זמינה. /עזרה לכל הפקודות.`,
    ].join('\n'),
    kb: inline([[btn('🌅 תן לי את הבוקר', 'run:morning'), btn('📊 סטטוס', 'st')], [btn('🧰 כלים', 'T:menu')]]),
  };
}

// ==========================================================================
//  תוספות: תיוג הקשר · אימון RAIN · צנצנת · שותף/ה · שאלה חופשית
// ==========================================================================

import { TAGS } from './analytics.js';

/** שורת כפתורי תיוג אחרי גל — מזין את מיפוי הדפוסים */
export function tagRow() {
  const keys = Object.keys(TAGS);
  const rows = [];
  for (let i = 0; i < keys.length; i += 3) {
    rows.push(keys.slice(i, i + 3).map(k => btn(TAGS[k], 'tag:' + k)));
  }
  rows.push([btn('דלג', 'tag:skip')]);
  return { text: C.TAG_PROMPT, kb: inline(rows) };
}

/** אימון RAIN בן שבוע — נספח א׳ */
export function training(meta, iso) {
  const t = meta.training;
  if (!t) {
    return {
      text: [
        `🏋️ <b>אימון RAIN — שבוע</b>`,
        LINE,
        `לבנות את השריר בהדרגה — <b>לא לפגוש אותו לראשונה מול גל ברמה 9.</b>`,
        '',
        `שבעה ימים, תרגיל קטן ליום, עולה בעומס: מתחושות ניטרליות ← דחפים קטנים שאינם וויפ ← רגש ← גל מתוכנן בתנאים שבשליטתך.`,
        '',
        `<b>כלל לכל השבוע:</b> אחרי כל גל שנגלש — חמש שניות של טעימת השקט שאחרי. זה התגמול שצורב את הלולאה החדשה.`,
        '',
        `<i>נספח א׳ במדריך המנטלי.</i>`,
      ].join('\n'),
      kb: inline([[btn('▶️ מתחיל את האימון', 'tr:start')]]),
    };
  }

  const dayN = Math.min(7, Math.max(1, P.diffDays(t.startISO, iso) + 1));
  const done = t.done || [];
  const cur = C.RAIN_TRAINING[dayN - 1];
  const lines = [
    `🏋️ <b>אימון RAIN — יום ${dayN} מתוך 7</b>`,
    `<code>${C.RAIN_TRAINING.map(x => done.includes(x.d) ? '✅' : x.d === dayN ? '🔵' : '⬜').join('')}</code>`,
    LINE,
    `<b>התרגיל:</b> ${cur.w}`,
    `<b>מה זה בונה:</b> <i>${cur.b}</i>`,
  ];
  if (dayN === 7 && done.length >= 6) lines.push('', '🎉 יום אחרון. חגיגת סיום קטנה בסוף — היא חלק מהתרגיל.');
  const rows = [];
  if (!done.includes(dayN)) rows.push([btn(`✅ יום ${dayN} בוצע`, 'tr:done:' + dayN)]);
  rows.push([btn('🌊 RAIN המלא', 'T:rain'), btn('🔄 להתחיל מחדש', 'tr:start')]);
  return { text: lines.join('\n'), kb: inline(rows) };
}

/** הצנצנת */
export function jar(pl, meta) {
  const saved = (pl.clean || pl.cleanDays || 0) * meta.costPerDay;
  const left = Math.max(0, saved - (meta.jarTotal || 0));
  return {
    text: [
      C.JAR,
      '',
      LINE,
      `💰 נחסך על הנייר: <b>${saved}₪</b>`,
      `🫙 הועבר לצנצנת בפועל: <b>${meta.jarTotal || 0}₪</b>`,
      left > 0 ? `⏳ מחכה להעברה: <b>${left}₪</b>` : `✅ הצנצנת מעודכנת.`,
    ].join('\n'),
    kb: inline([
      left > 0 ? [btn(`🫙 העברתי ${left}₪ לצנצנת`, 'jar:all')] : [],
      [btn('✍️ סכום אחר', 'jar:ask'), btn('💰 עלות יומית', 'money')],
    ].filter(r => r.length)),
  };
}

/** חיבור בת/בן הזוג */
export function partnerInfo(meta, code) {
  if (meta.partnerChatId) {
    return {
      text: [
        `👥 <b>שותף/ה מחובר/ת ✓</b>`,
        LINE,
        `דיווח "גל של קנייה עכשיו" נשלח בלחיצה אחת, בלי העתקה והדבקה.`,
        '',
        `<b>דיווח, לא בקשת רשות.</b> הסבבים חיו על שקט; הודעה אחת מפרקת אותם.`,
        '',
        `<i>חוק התפוח הרקוב: כל אחד בעלים של הגמילה שלו. מעידה של אחד אינה אישור לשני.</i>`,
      ].join('\n'),
      kb: inline([[btn('📨 שלח דיווח עכשיו', 'pr:send')], [btn('🔌 ניתוק', 'pr:off')]]),
    };
  }
  return {
    text: [
      `👥 <b>חיבור בת/בן הזוג</b>`,
      LINE,
      `אחרי החיבור, כפתור אחד שולח לה/לו "גל של קנייה עכשיו" — בלי להעתיק, בלי להסביר.`,
      '',
      `<b>איך:</b> תן לה/לו לפתוח את הבוט <code>@kobi_stop_smoking_bot</code> ולשלוח:`,
      '',
      `<code>/join ${code}</code>`,
      '',
      `הקוד תקף 30 דקות. אני לא שולח לה/לו שום דבר אחר — רק דיווחי גל וניצחונות, ורק כשאתה לוחץ.`,
    ].join('\n'),
    kb: inline([[btn('🔄 קוד חדש', 'pr:code')]]),
  };
}

/** תשובת KB / AI */
export function answerBlock(body, srcNote) {
  return {
    text: body + (srcNote ? `\n\n<code>${srcNote}</code>` : ''),
    kb: inline([
      [btn('🌊 יש לי גל', 'sos:1'), btn('🧰 כלים', 'T:menu')],
      [btn('📞 *6800', 'T:phones')],
    ]),
  };
}
