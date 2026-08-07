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
 * ═══ בעלוּת על נתונים — ההחלטה שמונעת סתירה ═══
 *
 * שני מקורות, ולכל שדה **בעלים אחד בלבד**:
 *
 *   הבוט (KV)  בעלים של: ימים — מסטיק, מדבקה, מצב רוח, גלים.
 *              הוא היחיד שאוסף אותם, בזמן אמת.
 *   הקובץ      בעלים של: מצב ה-CBT — סשנים, טריגרים, דפוסים, ש"ב.
 *
 * אף צד לא כותב לשדות של השני. נתוני הבוט מגיעים לכאן כ**תצלום**
 * (`sync`), ומסומנים בתאריך כדי שיהיה ברור כמה הם טריים.
 *
 * זה מה שמאפשר להריץ סשן גם כאן וגם בבוט בלי שהמצב יתפצל.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '../src/cbt/protocol.js';
import * as T from '../src/cbt/tools.js';
import * as E from '../src/cbt/engine.js';
import * as S from '../src/cbt/state.js';
import { planFor, il } from '../src/plan.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// המצב שבבעלות הקובץ — נשמר בגיט, כי היסטוריה של דפוסים ושיעורי בית
// היא בדיוק מה שכדאי שתהיה ניתנת לשחזור.
const STATE = join(ROOT, 'cbt', 'session-state.json');
// תצלום נתוני הבוט — **נגזר, לא בבעלות**, ולכן מחוץ לגיט. בלי ההפרדה
// כל sync היה מייצר diff של 17KB על נתונים שהבוט כבר מחזיק.
const SNAP = join(ROOT, 'cbt', '.bot-snapshot.json');

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

// ==========================================================================
//  פקודות
// ==========================================================================

const CMDS = {
  /** מה המצב, ומה אמור לרוץ */
  status() {
    const s = load(); const iso = today();
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
  start() {
    const s = load(); const iso = today();
    if (s.cbt.active) return out({ error: 'סשן כבר פתוח', active: s.cbt.active.id });
    const due = P.dueSession(iso, s.cbt.sessionsDone, s.cbt.startISO || iso);
    if (!due) return out({ error: 'אין סשן שאמור לרוץ היום' });
    s.cbt = S.startSession(s.cbt, due.id, iso);
    s.turns = [];
    save(s);
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
  record(bct, answer, captured) {
    const s = load();
    if (!s.cbt.active) return out({ error: 'אין סשן פתוח' });
    if (!bct || !P.requiredBcts().includes(bct)) return out({ error: `bct לא מוכר: ${bct}` });
    s.cbt = S.recordBct(s.cbt, bct, captured || answer || null);
    s.turns.push({ tool: bct, answer: answer || '', captured: captured || null });
    save(s);
    out({ recorded: bct, captured: captured || null, remaining: s.cbt.active.remaining.length });
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

  /** סגירה סופית עם הדפוס */
  finish(formulation) {
    const s = load(); const iso = today();
    if (!s.cbt.active) return out({ error: 'אין סשן פתוח' });
    const id = s.cbt.active.id;
    if (formulation && !/^NONE$/i.test(formulation.trim())) {
      s.cbt = S.recordFormulation(s.cbt, formulation.trim(), iso);
    }
    s.cbt = S.completeSession(s.cbt, iso);
    s.turns = [];
    save(s);
    out({ closed: id, note: s.cbt.notes[s.cbt.notes.length - 1], formulation: S.latestFormulation(s.cbt) });
  },

  /**
   * רענון תצלום נתוני הבוט.
   *
   * מקבל קובץ ייצוא של הבוט, או נופל לגיבוי המקומי. **כותב רק לשדה
   * `days`** — לעולם לא לשדות ה-CBT, כדי ששני המקורות לא יתנגשו.
   */
  sync(file) {
    const s = load();
    let days = [];
    if (file && existsSync(file)) {
      const j = JSON.parse(readFileSync(file, 'utf8'));
      days = j.days || j;
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
    }
    s.days = days.slice(0, 14);
    s.syncedISO = days[0]?.iso || null;
    save(s);
    out({ synced: s.days.length, syncedISO: s.syncedISO, source: file || 'backups/' });
  },
};

const [cmd, ...args] = process.argv.slice(2);
if (!CMDS[cmd]) {
  console.log(`שימוש: cbt-session.mjs <${Object.keys(CMDS).join('|')}>`);
  process.exit(1);
}
CMDS[cmd](...args);
