#!/usr/bin/env node
/**
 * cbt-session.mjs — הרצת סשן CBT מחוץ לבוט
 *
 * למה זה קיים: `runTurn` מקבל את המודל כפרמטר (`call`). בבוט זה Gemini
 * החינמי; כאן **הסוכן שמריץ את הסקריפט הוא המודל**. אותו protocol.js,
 * אותו tools.js, אותו engine.js — רק המודל טוב יותר.
 *
 * הסקריפט אינו מנהל שיחה. הוא **מגיש לסוכן את מה שצריך ורושם את מה
 * שחזר**, תור אחר תור. כך הפרוטוקול נאכף בקוד ולא בזיכרון של הסוכן.
 *
 * ═══ בעלים אחד: KV ═══
 *
 * התכנון הראשון חילק בעלוּת — הבוט על הימים, הקובץ על מצב ה-CBT —
 * מתוך הנחה שהסשנים רצים רק כאן. משהתווסף `/טיפול` יש שני מקומות
 * שמריצים סשן, וחלוקה כזו הופכת לשני מצבים מקבילים שמתפצלים.
 *
 * לכן `meta.cbt` ב-KV הוא **המקור היחיד**. הסקריפט מושך אותו לפני
 * שהוא נוגע, ודוחף אחרי כל שינוי. הקובץ המקומי הוא מטמון עבודה
 * ותו לא — `pull` דורס אותו בלי היסוס.
 *
 * `active` מונע התנגשות: הבוט מסרב לקבל דחיפה שתדרוס סשן שפתוח בו.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '../src/cbt/protocol.js';
import * as T from '../src/cbt/tools.js';
import * as E from '../src/cbt/engine.js';
import * as S from '../src/cbt/state.js';
import { planFor, il } from '../src/plan.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const REPO = join(HERE, '..');

// ═══ למה המצב יושב **בתוך הריפו** ולא ליד חומרי ה-RAG ═══
//
// שתי סיבות, ושתיהן התגלו רק אחרי שהוא כבר ישב שם:
//
//   1. `cbt/` אינו ריפו. רק `telegram-bot/` הוא. קובץ שם אינו מנוהל
//      גרסאות, לא נדחף, ולא ניתן לשחזור — כלומר בדיוק ההפך ממה
//      שרציתי מהיסטוריית דפוסים ושיעורי בית.
//   2. `extraction/build_cbt.py` עושה `shutil.rmtree(cbt/)` לפני שהוא
//      בונה מחדש. ה-CLAUDE.md מנחה במפורש להריץ אותו אחרי הוספת ספר.
//      כלומר תחזוקה שגרתית הייתה **מוחקת בשקט את כל היסטוריית הטיפול**.
//
// כאן הוא מנוהל גרסאות, נדחף עם הבוט, ומחוץ לנתיב המחיקה.
const STATE = join(REPO, 'cbt-state', 'session-state.json');
// תצלום נתוני הבוט — **נגזר, לא בבעלות**, ולכן מחוץ לגיט. בלי ההפרדה
// כל sync היה מייצר diff של 17KB על נתונים שהבוט כבר מחזיק.
const SNAP = join(REPO, 'cbt-state', '.bot-snapshot.json');
// ניתן לדריסה כדי שהבדיקות יוכלו לכפות את מסלול הנפילה. בלי זה הענף
// הזה לא רץ אף פעם כשיש רשת, והמוטציה שמשתיקה את ההודעה עוברת.
const WORKER = process.env.CBT_WORKER || 'https://kobi-stop-smoking-bot.kobiamit.workers.dev';

const load = () => {
  const own = existsSync(STATE)
    ? JSON.parse(readFileSync(STATE, 'utf8'))
    : { cbt: S.migrateCbt(null), turns: [] };
  const snap = existsSync(SNAP)
    ? JSON.parse(readFileSync(SNAP, 'utf8'))
    : { days: [], syncedISO: null };
  return { ...own, cbt: S.migrateCbt(own.cbt), ...snap };
};

const save = (s) => {
  const { days, syncedISO, ...own } = s;
  writeFileSync(STATE, JSON.stringify(own, null, 2) + '\n', 'utf8');
  if (days) writeFileSync(SNAP, JSON.stringify({ days, syncedISO }, null, 2) + '\n', 'utf8');
};
const today = () => il().iso;

/** נתוני הבוט — מתצלום, עם סימון גיל */
function botState(s, iso) {
  const plan = planFor(iso) || {};
  return {
    ...S.toolState(s.cbt, s.days || [], { ...plan, gumTarget: 9 }, iso),
    _stale: s.syncedISO ? Math.max(0, Math.round((Date.parse(iso) - Date.parse(s.syncedISO)) / 864e5)) : null,
  };
}

const out = (o) => console.log(JSON.stringify(o, null, 2));

/**
 * דחיפת המראה לבוט — כדי שיפסיק להזכיר על סשן שכבר רץ.
 *
 * **הכיוון חד-סטרי בכוונה.** הקובץ בעלים של `sessionsDone`; הבוט משקף.
 * שני צדדים שמחליטים על אותו שדה מתפצלים, וכאן הפיצול היה מתבטא
 * בתזכורת שחוזרת על סשן שנסגר — או גרוע יותר, בשתיקה על סשן שלא רץ.
 *
 * מחזיר ולא מדפיס, כדי שהקורא יחליט על הפלט.
 */
async function pushMirror(s) {
  const kf = join(REPO, '.webhook-secret');
  if (!existsSync(kf)) return { pushed: false, why: 'אין .webhook-secret' };
  try {
    const r = await fetch(`${WORKER}/cbt-state?key=${readFileSync(kf, 'utf8').trim()}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // **המצב המלא.** דחיפה חלקית הייתה מוחקת טריגרים, דפוסים ושיעורי
      // בית — כלומר בדיוק את הרצף שכל המודול קיים בשבילו.
      body: JSON.stringify({ ...s.cbt, force: true }),
      signal: AbortSignal.timeout(20000),
    });
    return { pushed: r.ok, status: r.status, sessionsDone: s.cbt.sessionsDone };
  } catch (e) {
    return { pushed: false, why: String(e.message || e) };
  }
}

// ==========================================================================
//  פקודות
// ==========================================================================

/** מושך את מצב ה-CBT מ-KV. **המקור** — לא עותק. */
async function pullCbt() {
  const kf = join(REPO, '.webhook-secret');
  if (process.env.CBT_OFFLINE) return null;
  if (!existsSync(kf)) return null;
  try {
    const r = await fetch(`${WORKER}/cbt-state?key=${readFileSync(kf, 'utf8').trim()}`,
                          { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    return (await r.json()).cbt || null;
  } catch { return null; }
}

const CMDS = {
  /** מה המצב, ומה אמור לרוץ */
  async status() {
    const s = load(); const iso = today();
    const remote = await pullCbt();
    if (remote) { s.cbt = S.migrateCbt(remote); save(s); }
    const due = P.dueSession(iso, s.cbt.sessionsDone, s.cbt.startISO || iso);
    out({
      today: iso,
      dataAge: s.syncedISO
        ? `${botState(s, iso)._stale} ימים (סונכרן ${s.syncedISO})`
        : '⚠️ לא סונכרן — הנתונים אינם אמינים',
      stale: s.syncedISO ? botState(s, iso)._stale > 2 : true,
      sessionsDone: s.cbt.sessionsDone,
      active: s.cbt.active ? s.cbt.active.id : null,
      due: due ? { id: due.id, title: due.title, dueISO: due.dueISO } : null,
      opening: S.openingContext(s.cbt, iso).map(E.describeOpening).filter(Boolean),
      formulation: S.latestFormulation(s.cbt),
    });
  },

  /** פתיחת הסשן שאמור לרוץ */
  async start() {
    const s = load(); const iso = today();
    // מושכים לפני שנוגעים — אחרת סשן שנפתח בבוט לא ייראה כאן.
    const remote = await pullCbt();
    if (remote) s.cbt = S.migrateCbt(remote);
    if (s.cbt.active) return out({ error: 'סשן כבר פתוח', active: s.cbt.active.id });
    const due = P.dueSession(iso, s.cbt.sessionsDone, s.cbt.startISO || iso);
    if (!due) return out({ error: 'אין סשן שאמור לרוץ היום' });
    s.cbt = S.startSession(s.cbt, due.id, iso);
    s.turns = [];
    save(s);
    await pushMirror(s);
    out({
      started: due.id, title: due.title, stpRef: due.stpRef,
      checklist: due.checklist.map(c => ({ bct: c.bct, label: c.label, required: c.required })),
      opening: S.openingContext(s.cbt, iso).map(E.describeOpening).filter(Boolean),
    });
  },

  /**
   * הכלי הבא — והפרומפט המדויק שהסוכן אמור לחשוב עליו.
   *
   * הסקריפט אינו מנסח את התשובה. הוא מגיש את אותו הקשר שהמנוע היה
   * מגיש לג׳מיני, והסוכן ממלא את תפקיד `respond`.
   */
  next() {
    const s = load(); const iso = today();
    if (!s.cbt.active) return out({ error: 'אין סשן פתוח — הרץ start' });
    const st = botState(s, iso);
    const tool = T.nextTool(st, s.cbt.active.remaining);
    if (!tool) {
      const sess = P.byId(s.cbt.active.id);
      return out({ done: true, fidelity: P.fidelity(sess, s.cbt.active.done) });
    }
    const asked = tool.run(st);
    // אזהרה גלויה כשהתצלום ישן. כלי "אימות אובייקטיבי" מציג מספרים
    // כעובדה, ומספר ישן שמוצג כעובדה גרוע ממספר חסר.
    const warn = st._stale > 2
      ? `⚠️ נתוני הבוט מגיל ${st._stale} ימים — הרץ sync לפני שתציג מספרים כעובדה`
      : null;
    out({
      warning: warn,
      tool: tool.id, name: tool.name, mode: tool.mode, evidence: tool.evidence,
      say: asked.text, ask: asked.ask || null, expects: asked.expects,
      remaining: s.cbt.active.remaining.length,
      context: {
        system: E.THERAPIST_SYSTEM,
        data: E.stateDigest(st),
        formulation: S.latestFormulation(s.cbt),
        capturedSoFar: E.capturedChain(s.turns),
        rules: E.RESPOND_RULES,
        exemplars: E.exemplarText(),
      },
    });
  },

  /** רישום תשובה: record <bct> "<answer>" ["<captured>"] */
  async record(bct, answer, captured) {
    const s = load();
    if (!s.cbt.active) return out({ error: 'אין סשן פתוח' });
    if (!bct || !P.requiredBcts().includes(bct)) return out({ error: `bct לא מוכר: ${bct}` });
    s.cbt = S.recordBct(s.cbt, bct, captured || answer || null);
    s.turns.push({ tool: bct, answer: answer || '', captured: captured || null });
    save(s);
    // דחיפה בכל תור ולא רק בסוף: סשן שנקטע באמצע משאיר את מה שנאמר
    // ב-KV, ולא רק בקובץ מקומי שאיש לא יסתכל בו.
    const m = await pushMirror(s);
    out({ recorded: bct, captured: captured || null,
          remaining: s.cbt.active.remaining.length, pushed: m.pushed });
  },

  /** סגירה — מחזיר גם את הפרומפט לפורמולציה */
  close() {
    const s = load(); const iso = today();
    if (!s.cbt.active) return out({ error: 'אין סשן פתוח' });
    const sess = P.byId(s.cbt.active.id);
    const f = P.fidelity(sess, s.cbt.active.done);
    out({
      session: s.cbt.active.id,
      fidelity: f,
      formulatePrompt: {
        data: E.stateDigest(botState(s, iso)),
        prior: S.latestFormulation(s.cbt),
        turns: s.turns.map(t => `${t.tool}: "${t.answer}"`),
        instruction: 'נסח דפוס אחד — לא סיכום. אם אין מספיק, החזר NONE.',
      },
      then: 'הרץ: cbt-session.mjs finish "<הדפוס או NONE>"',
    });
  },

  /**
   * דחיפת המראה לבוט — כדי שיפסיק להזכיר על סשן שכבר רץ.
   *
   * **הכיוון חד-סטרי בכוונה.** הקובץ בעלים של `sessionsDone`; הבוט
   * משקף. שני צדדים שמחליטים על אותו שדה מתפצלים, וכאן הפיצול היה
   * מתבטא בתזכורת שחוזרת על סשן שנסגר — או גרוע יותר, בשתיקה על סשן
   * שלא רץ.
   */
  async push() { out(await pushMirror(load())); },

  /** סגירה סופית עם הדפוס */
  async finish(formulation) {
    const s = load(); const iso = today();
    if (!s.cbt.active) return out({ error: 'אין סשן פתוח' });
    const id = s.cbt.active.id;
    if (formulation && !/^NONE$/i.test(formulation.trim())) {
      s.cbt = S.recordFormulation(s.cbt, formulation.trim(), iso);
    }
    s.cbt = S.completeSession(s.cbt, iso);
    s.turns = [];
    save(s);
    // הדחיפה מיד אחרי הסגירה — אחרת התזכורת של הערב הבא חוזרת על סשן
    // שכבר רץ, וזה בדיוק סוג הרעש שגורם להתעלם מהתזכורות.
    //
    // **פלט אחד.** גרסה קודמת קראה ל-`push` שהדפיס בעצמו, ואז הפקודה
    // הוציאה שני אובייקטי JSON — כל קורא שמפרסר את הפלט נשבר.
    out({ closed: id, note: s.cbt.notes[s.cbt.notes.length - 1],
          formulation: S.latestFormulation(s.cbt), mirror: await pushMirror(s) });
  },

  /**
   * רענון תצלום נתוני הבוט.
   *
   * מקבל קובץ ייצוא של הבוט, או נופל לגיבוי המקומי. **כותב רק לשדה
   * `days`** — לעולם לא לשדות ה-CBT, כדי ששני המקורות לא יתנגשו.
   */
  async sync(file) {
    const s = load();
    let days = [], src = null, at = null;
    if (file && existsSync(file)) {
      const j = JSON.parse(readFileSync(file, 'utf8'));
      days = j.days || j; at = j.exportedAt || null; src = file;
    } else if (!file && (at = await (async () => {
      // **חי קודם.** הסוד יושב מקומית ב-.webhook-secret, כלומר הנתונים
      // הטריים היו בהישג יד כל הזמן והסקריפט בכל זאת הגיש גיבוי בן
      // ארבעה ימים. `exportedAt` מגיע מהבוט עצמו — הוא הסמכות על
      // התאריך, לא שם קובץ ולא שעון מקומי.
      const kf = join(REPO, '.webhook-secret');
      if (!existsSync(kf)) return null;
      try {
        const r = await fetch(`${WORKER}/export?days=14&key=${readFileSync(kf, 'utf8').trim()}`,
                              { signal: AbortSignal.timeout(25000) });
        if (!r.ok) return null;
        const j = await r.json();
        days = j.days || []; src = 'הבוט (חי)';
        return j.exportedAt || null;
      } catch { return null; }
    })())) {
      // נשלף חי — days ו-src כבר הוצבו
    } else {
      const dir = join(ROOT, 'backups', 'days-20260803');
      if (!existsSync(dir)) return out({ error: 'אין קובץ ייצוא ואין גיבוי מקומי' });
      // התאריך מגיע **משם הקובץ**, לא מתוך הרשומה — רשומות היום אינן
      // נושאות `iso`. בלי זה הנפילה ל-`today()` הציגה גיבוי מ-3.8
      // כאילו סונכרן היום, כלומר שיקרה על גיל הנתונים בדיוק במקום
      // שבו הגיל הוא כל העניין.
      const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort().reverse();
      days = files.map(f => ({ iso: f.replace('.json', ''),
                               ...JSON.parse(readFileSync(join(dir, f), 'utf8')) }));
      at = days[0]?.iso || null; src = 'backups/ (הבוט לא נענה)';
    }
    s.days = days.slice(0, 14);
    s.syncedISO = at || days[0]?.iso || null;
    save(s);
    out({ synced: s.days.length, syncedISO: s.syncedISO, source: src });
  },
};

const [cmd, ...args] = process.argv.slice(2);
if (!CMDS[cmd]) {
  console.log(`שימוש: cbt-session.mjs <${Object.keys(CMDS).join('|')}>`);
  process.exit(1);
}
await CMDS[cmd](...args);
