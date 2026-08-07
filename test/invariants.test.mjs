// ==========================================================================
//  ח׳ (S6–S10) + ט׳ — התפרים שנותרו, והאינווריאנטות חוצות-הקבצים
//
//  I5 היא הלב כאן: "הבטחה = מימוש". שלושה באגים נפרדים בסשן הזה היו
//  אותה מחלקה בדיוק — הבוט אמר בטקסט שיעשה משהו, ולא היה קוד שמקיים:
//    • "אזכיר שוב בסביבות 10:51"  → הסנוז נבלע בנסיגה (79 דק׳ איחור)
//    • "אזכיר לך לבדוק"           → meta.snooze נכתב ואין לו קורא
//    • "לא מוריד עוד יחידה"       → activeTimes המשיכה להוריד
// ==========================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as P from '../src/plan.js';
import * as G from '../src/gum.js';
import * as KB from '../src/kb.js';
import { sanitizeModelText } from '../src/core.js';
import { mergeTickMeta } from '../src/tick-logic.js';
import { day, gumAt } from './helpers.mjs';

const read = f => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const SRC = Object.fromEntries(
  readdirSync(new URL('../src/', import.meta.url)).filter(f => f.endsWith('.js'))
    .map(f => [f, read(f)]));
const ALL = Object.values(SRC).join('\n');

// ==========================================================================
//  S6 · gum ↔ index — הסנוז
// ==========================================================================

test('S6 · הסנוז נאכף בצד אחד בלבד — בתוך dueNow', () => {
  // כשהוא נאכף גם ב-index (רצפה) וגם התעלם מהנסיגה (תקרה), המכפלה
  // איחרה את התזכורת ב-79 דקות. עכשיו index רק מעביר, ו-dueNow מכריע.
  assert.ok(/dueNow\([^)]*snoozedTo/s.test(SRC['index.js'])
    || /meta\.gumSoftCap,\s*snoozedTo/.test(SRC['index.js']),
    'index.js לא מעביר את הסנוז ל-dueNow');
  assert.ok(!/r\.due && now\.minutes >= snoozedTo/.test(SRC['index.js']),
    'index.js עדיין אוכף את הסנוז בעצמו — שתי אכיפות = הבאג חוזר');
});

test('S6 · סנוז שפג מנצח את הנסיגה, ובלי סנוז הנסיגה עומדת', () => {
  const P0 = { ...G.DEFAULT_PLAN };
  const d = day({ gum: 3, ev: [gumAt(9, 0)] });
  const last = 11 * 60;
  assert.equal(G.dueNow(P0, '2026-08-03', d, 11 * 60 + 30, last, 18, 11 * 60 + 20).due, true);
  assert.equal(G.dueNow(P0, '2026-08-03', d, 11 * 60 + 30, last, 18, 0).due, false);
});

// ==========================================================================
//  S9 · model → telegram
// ==========================================================================

test('S9 · פלט מודל שרירותי יוצא תמיד כ-HTML תקין', () => {
  const nasty = [
    '<b>פתוח', 'סוגר בלי פתיחה</i>', '<script>alert(1)</script>',
    '**מודגש** ו-*נטוי*', 'א'.repeat(4000) + '<b>חתוך</b>',
    '&quot;ציטוט&quot;', '', '<b><i>מקונן</b>',
  ];
  for (const s of nasty) {
    const out = sanitizeModelText(s);
    for (const tag of ['b', 'i', 'code', 'u', 's']) {
      const o = (out.match(new RegExp(`<${tag}>`, 'g')) || []).length;
      const c = (out.match(new RegExp(`</${tag}>`, 'g')) || []).length;
      assert.equal(o, c, `<${tag}> לא מאוזן על ${JSON.stringify(s.slice(0, 25))}`);
    }
    assert.ok(!/<[^>]*$/.test(out), `תגית קטועה: ${JSON.stringify(out.slice(-12))}`);
    assert.ok(!/<script|<div/.test(out), 'תגית לא מותרת שרדה');
  }
});

test('S9 · תשובה ריקה נופלת ל-KB ולא נשלחת כהודעה ריקה', () => {
  assert.equal(sanitizeModelText(''), '');
  assert.ok(/res\.reply && res\.reply\.trim\(\)/.test(SRC['index.js']),
    'index.js לא בודק תשובה ריקה לפני שליחה');
});

// ==========================================================================
//  ט׳ · אינווריאנטות
// ==========================================================================

test('I1 · אין ליטרל תאריך של התוכנית מחוץ ל-plan.js', () => {
  // מקור אמת אחד. ליטרל קשיח שורד שינוי לוח ומשקר בשקט.
  const dates = ['2026-07-25', '2026-09-14', '2026-08-17', '2026-08-18', '2026-08-31'];
  for (const [f, src] of Object.entries(SRC)) {
    if (f === 'plan.js') continue;
    for (const d of dates) {
      const lines = src.split('\n')
        .map((l, i) => [i + 1, l])
        .filter(([, l]) => l.includes(d) && !l.trim().startsWith('//') && !l.trim().startsWith('*'));
      assert.deepEqual(lines, [], `${f}: תאריך קשיח ${d}`);
    }
  }
});

test('I2 · התקרה הרכה מעל היעד, ואותו סף בהסלמה', () => {
  const target = G.dailyTarget({ ...G.DEFAULT_PLAN }, '2026-08-03');
  assert.ok(18 > target, 'gumSoftCap אינו מעל היעד');
  // analytics משתמש ב-meta.gumSoftCap ולא במספר משלו
  assert.ok(/meta\.gumSoftCap \|\| 18/.test(SRC['analytics.js']),
    'analytics מחזיק סף משלו במקום להשתמש בזה של ה-meta');
});

test('I3 · אפס תרופות מרשם מחוץ לשורות האיסור', () => {
  const RX = /וארניקלין|בופרופיון|ציטיזין|Champix|צמפיקס/;
  for (const [f, src] of Object.entries(SRC)) {
    src.split('\n').forEach((l, i) => {
      if (RX.test(l) && !/נשללו|אל תציע|אסור|לא לקחת/.test(l)) {
        assert.fail(`${f}:${i + 1} — ${l.trim().slice(0, 70)}`);
      }
    });
  }
});

test('I4 · מפתחות _ לעולם לא נכתבים ל-KV', () => {
  // גם ב-meta וגם ב-day. הכלל הזה הוא מה שהופך את באג ה-dry-run
  // לבלתי-אפשרי, ולא רק מתקן את המופע שלו.
  assert.ok(/startsWith\('_'\)/.test(SRC['store.js']), 'store.js לא מסנן מפתחות _');
  const filters = (SRC['store.js'].match(/startsWith\('_'\)/g) || []).length;
  assert.ok(filters >= 2, `רק ${filters} מסננים — צריך גם ל-meta וגם ל-day`);
});

test('I5 · "הבטחה = מימוש" — כל הבטחה בטקסט יש לה קורא בקוד', () => {
  // המחלקה שייצרה שלושה באגים נפרדים בסשן הזה. כל ביטוי שמבטיח
  // פעולה עתידית חייב להופיע ברשימה יחד עם הסמל שמקיים אותו —
  // וכל הבטחה חדשה שתתווסף בלי מימוש תפיל את הבדיקה הזאת.
  const PROMISES = [
    { re: /אזכיר שוב ב/,            impl: /gumSnoozeMin/,  what: 'סנוז המסטיק' },
    { re: /אזכיר לך לבדוק/,         impl: /meta\.snooze\[plKey\]|snooze\[`\$\{iso\}:pl`\]/, what: 'דחיית דרגה 2' },
    { re: /הקפאתי את הצמצום/,       impl: /pausedISO/,     what: 'הקפאת הצמצום' },
    { re: /אבדוק שוב בעוד שבוע/,    impl: /taperWatchDue/, what: 'ניטור הצמצום' },
    { re: /אשאל שוב בעוד שלושה ימים/, impl: /taperAskDue/, what: 'שאלת הצמצום' },
    { re: /אזכיר שוב כשהקצב יחייב/,  impl: /PACE_SLACK|MAX_GAP/, what: 'תזכורת לפי קצב' },
    // נתפס במוטציה: backstopPassed היה מוגדר ונבדק, אבל ניתוק
    // הקריאה אליו לא הפיל אף בדיקה — הפרדיקט נבדק והחיבור לא.
    { re: /ברצפה הזמנית/,          impl: /G\.backstopPassed\(/, what: 'רצפת הצמצום הזמנית' },
    { re: /מרווח היעד/,            impl: /targetGap\(/,        what: 'מצב-מרווח' },
  ];
  for (const { re, impl, what } of PROMISES) {
    assert.ok(re.test(ALL), `ההבטחה "${what}" נעלמה מהטקסט — עדכן את הרשימה`);
    assert.ok(impl.test(ALL), `ההבטחה "${what}" קיימת בטקסט ואין לה מימוש`);
  }
});

test('I5ב · אין הבטחת-זמן חדשה בלי רישום', () => {
  // תופס ניסוח חדש כמו "אזכיר בעוד X" שאיש לא חיבר לקוד.
  // "אזכיר שוב כשהקצב יחייב" (כפתור ⏭️ מדלג) — נתפס על ידי הבדיקה
  // הזאת כשנוספה, ואומת שהוא מקוים: ענף הקצב ו-MAX_GAP ב-dueNow
  // מחזירים תזכורת מעצמם למי שנשאר מאחור.
  const known = /אזכיר שוב ב|אזכיר לך לבדוק|אזכיר לך|אזכיר בכל|אזכיר שוב כשהקצב יחייב/;
  const found = [];
  for (const [f, src] of Object.entries(SRC)) {
    for (const m of src.matchAll(/['`][^'`\n]{0,60}אזכיר[^'`\n]{0,60}['`]/g)) {
      if (!known.test(m[0])) found.push(`${f}: ${m[0].slice(0, 60)}`);
    }
  }
  assert.deepEqual(found, [], 'הבטחת תזכורת חדשה בלי רישום ב-I5');
});

test('I6 · כל callback_data שמופיע בכפתור מטופל', () => {
  // הבאג שנתפס: btn(..., "wave:start") בלי מטפל — לחיצה שלא עושה כלום.
  const datas = new Set();
  for (const m of ALL.matchAll(/btn\(\s*(?:'[^']*'|`[^`]*`)\s*,\s*'([^']+)'/g)) datas.add(m[1]);
  const idx = SRC['index.js'];
  const exact = new Set([...idx.matchAll(/data === '([^']+)'/g)].map(m => m[1]));
  const prefixes = [...idx.matchAll(/data\.startsWith\('([^']+)'\)/g)].map(m => m[1]);
  const orphan = [...datas].filter(d => !exact.has(d) && !prefixes.some(p => d.startsWith(p)));
  assert.deepEqual(orphan, [], 'כפתורים בלי מטפל');
  assert.ok(datas.size > 50, `רק ${datas.size} כפתורים — הסריקה כנראה נשברה`);
});

test('I7 · כל כרטיס KB נשלף, וכל ייחוס מוכר', () => {
  for (const c of KB.KB) {
    assert.ok(c.k.some(k => KB.search(k, 5).some(h => h.id === c.id)), `${c.id} לא נשלף`);
  }
});

test('I11 · שום טקסט למשתמש אינו סופר משבצות', () => {
  // activeTimes מחזיר את מספר **המשבצות**. במצב-מרווח זה פשוט מספר
  // אחר מהיעד, ולכן כל הודעה שמציגה אותו כ"כמה מנות היום" משקרת.
  // זה נמצא בשלושה מקומות בבת אחת — ניטור הצמצום, כפתור "צעד אחורה",
  // ורישום המסטיק, שהיא ההודעה הנפוצה ביותר בבוט.
  // היעד האמיתי בשני המצבים הוא dailyTarget, והוא המקור היחיד המותר.
  assert.ok(!/activeTimes\(/.test(SRC['index.js']),
    'index.js סופר משבצות במקום להשתמש ב-dailyTarget');
});

test('I11 · dailyTarget ו-activeTimes נפרדים דווקא במצב-מרווח', () => {
  // אם השניים היו זהים תמיד, האינווריאנטה שלמעלה הייתה חסרת משמעות.
  const iv = {
    ...G.DEFAULT_PLAN, on: true, confirmedTaper: true,
    taperStartISO: G.TAPER_START, stepDays: 4,
    mode: 'interval', baseGap: 91, gapStepPct: 10, winStart: 540, winEnd: 1294,
  };
  const iso = P.addDaysISO(G.TAPER_START, 20);
  assert.notEqual(G.dailyTarget(iv, iso), G.activeTimes(iv, iso).length,
    'שני המספרים זהים — הבדיקה שלמעלה כבר לא בודקת כלום');
});

test('I12 · שאלת מצב הרוח אינה תלויה בלחיצה על "ערב הושלם"', () => {
  // הגרסה הראשונה תלתה אותה רק על מטפל ה-callback, ולכן בערב שבו לא
  // נכנסת לטקס המדד לא נאסף כלל — וזה בדיוק הערב שהוא נועד לתפוס.
  const idx = SRC['index.js'];
  assert.match(idx, /slot\.id === 'evening' && !day\.mood/,
    'השאלה אינה נתלית על הודעת הערב שהקרון שולח');
  // והקרון שואל מיוזמתו בעוגנים, בלי תלות בשום לחיצה
  assert.match(idx, /moodCheckDue\(/, 'אין בדיקות יזומות בכלל');
  assert.match(idx, /moodAnchorAt\(/, 'אין עוגני זמן לבדיקות');
  const rows = [...idx.matchAll(/\[1, 2, 3, 4, 5\]\.map\(v => btn\(String\(v\), `mo:\$\{v\}`\)\)/g)];
  assert.ok(rows.length >= 3, `נמצאו ${rows.length} מקומות שמציעים דירוג — צפויים 3`);
  // ותקרה יומית, כדי שהתדירות לא תהפוך להצפה
  assert.match(idx, /MOOD_MAX_PER_DAY/, 'אין תקרה יומית לבדיקות');
});

test('I12 · לכל ערך שהכפתורים שולחים יש מטפל וטווח חוקי', () => {
  const idx = SRC['index.js'];
  assert.match(idx, /data\.startsWith\('mo:'\)/);
  assert.match(idx, /data\.startsWith\('cf:'\)/);
  // הידוק לטווח 1–5 — כדי ש-callback מזויף לא יכתוב ערך מופרך
  assert.match(idx, /Math\.max\(1, Math\.min\(5,/, 'הערך אינו מהודק לטווח');
});

test('I10 · רק store.js ניגש ל-KV', () => {
  // הסקירה השבועית נכתבה ונקראה ישירות מ-index.js, כלומר שכבת הנתונים
  // לא ידעה שהמפתח קיים ושני מקומות החזיקו את אותה תבנית בעל-פה.
  // לא סיכון לשלמות (מחרוזת חופשית, לא רשומה) — אבל בדיוק כך נולד
  // מפתח שאף אחד לא מגבה ואף אחד לא מוחק.
  for (const [file, src] of Object.entries(SRC)) {
    if (file === 'store.js') continue;
    const hits = [...src.matchAll(/env\.KV\.\w+/g)].map(m => m[0]);
    assert.deepEqual(hits, [], `${file} ניגש ל-KV ישירות: ${hits.join(', ')}`);
  }
});

// ==========================================================================
//  S7 · tick ↔ callbacks — המרוץ
//
//  ה-tick קורא meta, עובד ~250 שורות (כולל קריאות רשת), ואז כותב.
//  בזמן הזה המשתמש יכול ללחוץ כפתור ולכתוב meta משלו. הפתרון בקוד:
//  לקרוא meta טרי לפני הכתיבה, ולהחיל עליו רק את השדות שה-tick באמת
//  נגע בהם — הסט `touched`.
//
//  הבאג האפשרי כאן אינו בפונקציית המיזוג (היא טהורה ומכוסה) אלא
//  ב**חוסר**: שדה שה-tick מציב ושוכחים להוסיף ל-touched פשוט נעלם
//  בכתיבה. זה שקט לחלוטין — אין שגיאה, רק ערך שחוזר לאחור.
//  לכן הבדיקה כאן היא על השלמות, ונגזרת מהקוד עצמו ולא מרשימה ידנית.
// ==========================================================================

const TICK_BODY = (() => {
  const s = SRC['index.js'];
  const i = s.indexOf('async function tick(env)');
  const j = s.indexOf('\nasync function sendWeeklyReport');
  assert.ok(i > 0 && j > i, 'לא נמצא גוף ה-tick');
  return s.slice(i, j);
})();

test('S7 · כל שדה שה-tick מציב נמצא ב-touched', () => {
  const assigned = new Set(
    [...TICK_BODY.matchAll(/\bmeta\.([A-Za-z_]\w*)\s*(?:=[^=]|\+\+|--)/g)].map(m => m[1]));
  const touched = new Set(
    [...TICK_BODY.matchAll(/touched\.add\('([^']+)'\)/g)].map(m => m[1]));

  const missing = [...assigned].filter(k => !touched.has(k));
  assert.deepEqual(missing, [],
    `שדות שה-tick מציב ואינם ב-touched — הם ייעלמו בכתיבה: ${missing.join(', ')}`);
});

test('S7 · גם שדות שעוזרים מציבים על meta נמצאים ב-touched', () => {
  // maybeEscalate מקבל את meta ומציב עליו lastEscalationISO. שדה כזה
  // אינו נראה בגוף ה-tick, ולכן בדיקה שמסתכלת רק שם הייתה מפספסת אותו.
  const idx = SRC['index.js'];
  const touched = new Set(
    [...TICK_BODY.matchAll(/touched\.add\('([^']+)'\)/g)].map(m => m[1]));

  for (const [, fn] of TICK_BODY.matchAll(/\b(\w+)\(env, meta[,)]/g).map(m => [0, m[1]])) {
    const k = idx.indexOf(`function ${fn}(`);
    if (k < 0) continue;                       // מיובא — נבדק במקומו
    const body = idx.slice(k, idx.indexOf('\n}\n', k));
    for (const m of body.matchAll(/\bmeta\.([A-Za-z_]\w*)\s*=[^=]/g)) {
      assert.ok(touched.has(m[1]),
        `${fn} מציב meta.${m[1]} וה-tick אינו מסמן אותו ב-touched`);
    }
  }
});

test('S7 · ה-tick קורא meta טרי לפני הכתיבה, ולא כותב את מה שקרא', () => {
  const put = TICK_BODY.lastIndexOf('putMeta(');
  const fresh = TICK_BODY.lastIndexOf('getMeta(', put);
  assert.ok(fresh > 0 && fresh < put, 'אין קריאה חוזרת של meta לפני הכתיבה');
  assert.ok(TICK_BODY.slice(fresh, put).includes('mergeTickMeta'),
    'הכתיבה אינה עוברת דרך המיזוג — שינוי מקבילי יידרס');
  assert.ok(!/putMeta\(env,\s*meta\s*\)/.test(TICK_BODY),
    'ה-tick כותב את האובייקט שקרא בהתחלה — כל לחיצה במקביל נמחקת');
});

test('S7 · לחיצה במקביל שורדת, והשדה שה-tick נגע בו מנצח', () => {
  // המרוץ עצמו, מקצה לקצה על פונקציית המיזוג.
  const atStart = { sent: {}, gumRemindMin: 100, sos: null, partnerChatId: 5 };
  const tickMeta = { ...atStart, gumRemindMin: 620, sent: { 'x:gum': 1 } };

  // בזמן שה-tick עבד, המשתמש לחץ — וזה מה שיש עכשיו ב-KV
  const fresh = { ...atStart, sos: { level: 3 }, lastPartnerAlert: 1234, sent: { 'x:sos': 1 } };

  const out = mergeTickMeta(fresh, tickMeta, new Set(['gumRemindMin']));
  assert.deepEqual(out.sos, { level: 3 }, 'הלחיצה נדרסה');
  assert.equal(out.lastPartnerAlert, 1234, 'חותמת ההתראה נדרסה — מגרה נפתחת מחדש');
  assert.equal(out.gumRemindMin, 620, 'השדה שה-tick נגע בו לא נשמר');
  assert.deepEqual(out.sent, { 'x:sos': 1, 'x:gum': 1 }, 'sent אינו איחוד');
});

// ==========================================================================
//  I9 · החלטת מצב הצמצום — נקודה אחת, ושני הנתיבים עוברים בה
// ==========================================================================

test('I9 · שני נתיבי הצמצום קוראים ל-chooseTaperMode ואינם משכפלים אותה', () => {
  // ההחלטה ישבה מועתקת בשני מקומות ב-index.js. עותקים יכולים להיפרד
  // בשקט, ואף אחד מהם לא היה ניתן לבדיקה. אם מישהו יחזיר את ההשמה
  // הישירה — כאן זה ייעצר.
  const idx = SRC['index.js'];
  const calls = [...idx.matchAll(/chooseTaperMode\(/g)].length;
  assert.equal(calls, 2, `נמצאו ${calls} קריאות — צפויות שתיים (אישור + רצפה זמנית)`);

  // הבדיקה האמיתית: ההחלטה עצמה — ההשמה ל-mode — שייכת ל-gum.js בלבד.
  // קריאה ל-measureRhythm לתצוגה היא לגיטימית ואינה החלטה, ולכן אינה
  // נאסרת כאן; מה שנאסר הוא לקבוע את המצב מחוץ לנקודה האחת.
  const assigns = [...idx.matchAll(/\bplan\.mode\s*=[^=]/g)].length;
  assert.equal(assigns, 0, 'index.js מציב plan.mode ישירות — ההחלטה שוב משוכפלת');
});

test('I9 · הודעת תחילת הצמצום מתארת את המנגנון שירוץ בפועל', () => {
  // "הבטחה = מימוש" בגרסתו החמורה ביותר: ההודעה הזאת נשלחת פעם אחת,
  // ביום שבו הצמצום מתחיל. הגרסה הקודמת הבטיחה "יחידה אחת פחות כל 4
  // ימים · הראשונה שנופלת 14:15" גם כשהמנגנון היה מרווח.
  const idx = SRC['index.js'];
  const i = idx.indexOf('התצמצום התחיל');
  assert.ok(i > 0, 'הודעת תחילת הצמצום נעלמה');
  const around = idx.slice(i, i + 1800);
  assert.match(around, /t\.mode === 'interval'/, 'ההודעה אינה מסתעפת לפי המצב');
  assert.match(around, /t\.gap/, 'ענף המרווח אינו מציג את המרווח');
  assert.match(around, /nextToGo/, 'ענף המשבצות איבד את המשבצת שנופלת');
});

test('I9 · אף צרכן של taperInfo אינו מניח משבצות', () => {
  // nextToGo הוא null במצב-מרווח. כל שימוש בו חייב להיות מוגן.
  const t = G.taperInfo({
    ...G.DEFAULT_PLAN, on: true, confirmedTaper: true,
    taperStartISO: G.TAPER_START, stepDays: 4,
    mode: 'interval', baseGap: 91, gapStepPct: 10, winStart: 540, winEnd: 1294,
  }, G.TAPER_START);
  assert.equal(t.nextToGo, null);
  assert.equal(typeof t.active, 'number');
  assert.ok(t.active > 0, 'היעד ביום הראשון של הצמצום הוא אפס');
  assert.ok(t.gap > 0, 'המרווח לא דווח, ולכן אין מה להציג במקום המשבצת');
});

test('I8 · ציר התוכנית עקבי מקצה לקצה', () => {
  const first = P.planFor(P.QUIT);
  const last = P.planFor(P.addDaysISO(P.QUIT, P.TOTAL_DAYS - 1));
  assert.equal(first.n, 1);
  assert.equal(last.n, P.TOTAL_DAYS);
  assert.equal(last.iso, first.lastPatchISO);
  assert.equal(G.TAPER_START, P.addDaysISO(last.iso, 1));
});
