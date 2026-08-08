// ==========================================================================
//  הרצת סשן מחוץ לבוט
//
//  אותו פרוטוקול, מודל אחר. הבדיקות כאן שומרות על שתי תכונות שבלעדיהן
//  זה נשבר בשקט:
//    • **בעלוּת מופרדת** — הבוט בעלים של הימים, הקובץ של מצב ה-CBT.
//      בלי זה שתי ההרצות דורסות זו את זו.
//    • **גיל הנתונים אמיתי** — כלי "אימות אובייקטיבי" מציג מספרים
//      כעובדה, ומספר ישן שמוצג ככזה גרוע ממספר חסר.
// ==========================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUN = join(HERE, '..', 'scripts', 'cbt-session.mjs');
const REPO = join(HERE, '..');
const CBT = join(REPO, 'cbt-state');
const CBT_LIB = join(REPO, '..', 'cbt');
const SRC_DIR = join(REPO, 'src');
// **הרמטי בכוונה.** מאז שכל פקודה מוטציונית מושכת מ-KV, בדיקה שרצה מול
// הבוט החי תלויה במה שבמקרה שמור שם.
//
// `CBT_OFFLINE` ולא פורט מת: פורט מת פירושו עכשיו "הבוט לא נענה", וזה
// **עוצר את הכתיבה** — בכוונה, כי מצב שלא ידוע אם הוא טרי אינו בסיס
// לדריסה. `CBT_OFFLINE` הוא הצהרת כוונה, ולכן ממשיך עם המקומי.
const OFFLINE = { CBT_OFFLINE: '1' };
const cli = (...a) => JSON.parse(execFileSync('node', [RUN, ...a],
  { encoding: 'utf8', env: { ...process.env, ...OFFLINE } }));
const cliEnv = (env, ...a) => {
  const e = { ...process.env, ...OFFLINE, ...env };
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  return JSON.parse(execFileSync('node', [RUN, ...a], { encoding: 'utf8', env: e }));
};

/**
 * איפוס מצב ה-CBT המקומי.
 *
 * הבדיקות פותחות וסוגרות סשנים, ולכן מצב שנשאר מהרצה קודמת — או
 * מהרצה ידנית — קובע אם יש בכלל סשן שאפשר לפתוח. בלי איפוס מפורש
 * הן עוברות או נכשלות לפי מה שקרה קודם, וזה לא מבחן.
 */
const reset = () => {
  const p = join(CBT, 'session-state.json');
  if (existsSync(p)) {
    const j = JSON.parse(readFileSync(p, 'utf8'));
    j.cbt = { ver: 1, startISO: null, sessionsDone: [], triggers: [], pastAttempts: [],
              dependence: null, confidence: [], homework: null, formulations: [],
              notes: [], active: null };
    j.turns = [];
    writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  }
};

test('איפוס — הבדיקות לא תלויות בהרצה קודמת', () => {
  cliEnv({}, 'sync');
  reset();
  assert.deepEqual(cli('status').sessionsDone, []);
});

test('הסקריפט קיים ורץ', () => {
  assert.ok(existsSync(RUN));
  const s = cli('status');
  assert.ok(s.today);
});

test('מצב ה-CBT ותצלום הבוט בקבצים נפרדים', () => {
  // תצלום נגזר בתוך הקובץ שבגיט היה מייצר diff של 16KB בכל sync.
  cli('sync');
  assert.ok(existsSync(join(CBT, 'session-state.json')), 'אין קובץ מצב');
  assert.ok(existsSync(join(CBT, '.bot-snapshot.json')), 'אין תצלום');
  const own = JSON.parse(readFileSync(join(CBT, 'session-state.json'), 'utf8'));
  assert.equal(own.days, undefined, 'נתוני הבוט דלפו לקובץ שבבעלות');
  assert.ok(own.cbt, 'מצב ה-CBT חסר');
});

test('sync כותב רק לתצלום ולא נוגע במצב ה-CBT', () => {
  const before = readFileSync(join(CBT, 'session-state.json'), 'utf8');
  cli('sync');
  assert.equal(readFileSync(join(CBT, 'session-state.json'), 'utf8'), before,
    'sync שינה מצב שאינו בבעלותו');
});

test('sync מעדיף נתונים חיים, ולא משתיק נפילה לגיבוי', () => {
  // הסוד יושב מקומית כל הזמן — הגרסה הראשונה בכל זאת הגישה גיבוי בן
  // ארבעה ימים בשקט. אם הבוט לא נענה זה בסדר, אבל **המקור חייב לומר
  // זאת**, כי כלי האימות מציג את המספרים כעובדה מדודה.
  // הבדיקה הזו **כן** צריכה את הבוט החי — היא בודקת בדיוק את זה.
  const live = cliEnv({ CBT_OFFLINE: undefined, CBT_WORKER: undefined }, 'sync');
  assert.match(live.source, /חי/, `לא נשלף חי: ${live.source}`);

  // כופים נפילה — אחרת הענף לא רץ כשיש רשת, והבדיקה שומרת על כלום.
  const fell = cliEnv({ CBT_OFFLINE: undefined, CBT_WORKER: 'http://127.0.0.1:1' }, 'sync');
  assert.match(fell.source, /לא נענה/, `נפילה לגיבוי הוסתרה: ${fell.source}`);
  cli('sync');                                     // מחזירים נתונים טריים
});

test('גיל הנתונים מדווח אמיתי ולא נופל להיום', () => {
  // הגרסה הראשונה נפלה ל-today() כשהרשומה לא נשאה iso, והציגה גיבוי
  // בן ארבעה ימים כאילו סונכרן עכשיו.
  const s = cli('sync');
  assert.ok(s.syncedISO, 'אין תאריך סנכרון');
  assert.match(s.syncedISO, /^\d{4}-\d{2}-\d{2}$/);
});

test('סטטוס מסמן נתונים ישנים', () => {
  const s = cli('status');
  assert.equal(typeof s.stale, 'boolean');
  assert.match(s.dataAge, /ימים|לא סונכרן/);
});

test('המצב יושב בתוך הריפו — לא בנתיב שנמחק בבנייה מחדש', () => {
  // שני באגים אמיתיים שהתגלו יחד:
  //   • `cbt/` אינו ריפו כלל — רק `telegram-bot/` הוא. קובץ שם לא
  //     מנוהל גרסאות ולא ניתן לשחזור.
  //   • `extraction/build_cbt.py` עושה rmtree על `cbt/`, וה-CLAUDE.md
  //     מנחה להריץ אותו אחרי הוספת ספר — תחזוקה שגרתית שהייתה מוחקת
  //     בשקט את כל היסטוריית הטיפול.
  const src = readFileSync(RUN, 'utf8');
  const paths = [...src.matchAll(/const (STATE|SNAP) = ([^;]+);/g)].map(m => m[2]);
  assert.equal(paths.length, 2, 'לא נמצאו שני נתיבי מצב');
  for (const p of paths) {
    assert.ok(/REPO/.test(p), `נתיב מחוץ לריפו: ${p}`);
    assert.ok(!/'cbt'/.test(p), `נתיב בתוך תיקיית ה-RAG שנמחקת: ${p}`);
  }
  // והבנאי עדיין באמת מוחק — כלומר הבדיקה שומרת על משהו חי
  const builder = join(REPO, '..', 'extraction', 'build_cbt.py');
  if (existsSync(builder)) {
    assert.match(readFileSync(builder, 'utf8'), /rmtree/,
      'הבנאי כבר לא מוחק — עדכן את הנימוק בבדיקה הזו');
  }
});

test('קובץ המצב במעקב גיט, התצלום לא', () => {
  const tracked = (f) => {
    try {
      execFileSync('git', ['ls-files', '--error-unmatch', f],
        { cwd: REPO, stdio: 'pipe' });
      return true;
    } catch { return false; }
  };
  assert.ok(tracked('cbt-state/session-state.json'),
    'קובץ המצב אינו במעקב — אין רצף בין סשנים ואין שחזור');
  assert.ok(!tracked('cbt-state/.bot-snapshot.json'), 'התצלום הנגזר נכנס לגיט');
  assert.match(readFileSync(join(REPO, '.gitignore'), 'utf8'), /cbt-state\/\.bot-snapshot\.json/);
});

test('כל מה שהסשן צריך כדי לשרוד יושב בתוך הריפו', () => {
  // שלוש פעמים כבר נכתב קובץ נושא-מצב מחוץ לריפו היחיד בפרויקט
  // (מצב הסשן, התצלום, ה-SKILL) — ובכל פעם הוא נראה שמור ולא היה.
  // הבדיקה **גוזרת את הרשימה מהקוד** במקום לתחזק אותה ביד, אחרת היא
  // תפגר אחרי הקובץ הרביעי בדיוק כמו קודמותיה.
  const src = readFileSync(RUN, 'utf8');
  const needed = [
    RUN,                                                 // הסקריפט
    join(HERE, '..', '..', '.claude', 'skills', 'cbt-session', 'SKILL.md'),
    fileURLToPath(import.meta.url),                       // הבדיקה הזו
    // כל נתיב מצב שהסקריפט מכריז עליו — למעט מה שמוצהר כנגזר
    ...[...src.matchAll(/const STATE = join\(([^;]+)\);/g)]
        .map(() => join(REPO, 'cbt-state', 'session-state.json')),
  ];
  const untracked = needed.filter(f => {
    if (!existsSync(f)) return true;
    const real = realpathSync(f);                         // הסימלינק חייב לנחות בריפו
    const rel = relative(realpathSync(REPO), real);
    if (rel.startsWith('..') || isAbsolute(rel)) return true;
    try {
      execFileSync('git', ['ls-files', '--error-unmatch', rel], { cwd: REPO, stdio: 'pipe' });
      return false;
    } catch { return true; }
  });
  assert.deepEqual(untracked, [], `לא מנוהל גרסאות — לא ישרוד: ${untracked}`);
});

test('אי אפשר לרשום בלי סשן פתוח', () => {
  const s = cli('status');
  if (s.active) return;                       // סשן פתוח מהרצה קודמת
  const r = cli('record', 'identify-triggers', 'x');
  assert.match(r.error || '', /אין סשן פתוח/);
});

test('bct לא מוכר נדחה', () => {
  const st = cli('status');
  if (!st.active) cli('start');
  const r = cli('record', 'לא-קיים', 'x');
  assert.match(r.error || '', /לא מוכר/);
});

test('next מגיש את כל ההקשר שהמנוע היה שולח למודל', () => {
  const st = cli('status');
  if (!st.active) cli('start');
  const n = cli('next');
  if (n.done) return;
  for (const k of ['system', 'data', 'rules', 'exemplars']) {
    assert.ok(n.context[k], `ההקשר חסר ${k}`);
  }
  assert.match(n.context.system, /גילוי מודרך/);
  assert.ok(n.tool && n.name && n.mode);
});

test('הכלי נבחר לפי מצב — לא לפי סדר הרשימה', () => {
  const st = cli('status');
  if (!st.active) cli('start');
  const n = cli('next');
  if (n.done) return;
  // הכלי שנבחר חייב להיות אחד מהצ׳קליסט של הסשן הפתוח
  assert.ok(n.remaining >= 0);
});

test('כל פקודה מוציאה בדיוק אובייקט JSON אחד', () => {
  // `finish` קראה ל-`push` שהדפיס בעצמו, ואז הפקודה פלטה שני
  // אובייקטים — וכל קורא שמפרסר את הפלט נשבר. הבדיקה **סופרת קוראים
  // ל-out** בכל פקודה במקום לבדוק פקודות לפי שם, אחרת הפקודה הבאה
  // שתעשה את אותו הדבר תעבור.
  const src = readFileSync(RUN, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const body = src.slice(src.indexOf('const CMDS = {'), src.indexOf('const [cmd,'));
  // כל פקודה: מ-`  name(` או `  async name(` עד הפקודה הבאה
  const cmds = body.split(/\n  (?:async )?\w+\(/).slice(1);
  assert.ok(cmds.length >= 6, `נמצאו ${cmds.length} פקודות — הפיצול נשבר`);
  for (const c of cmds) {
    const outs = (c.match(/\bout\(/g) || []).length;
    // `return void out(...)` הוא יציאה מוקדמת בדיוק כמו `return out(...)`
    const early = (c.match(/return (void )?out\(/g) || []).length;
    // מספר `return out(` + לכל היותר `out(` סופי אחד שאינו return
    assert.ok(outs - early <= 1,
      `פקודה עם ${outs - early} פלטים שאינם return — פלט כפול:\n${c.slice(0, 120)}`);
  }
});

// ניקוי: מחזירים את המצב לנקי כדי שהרצה של הטסטים לא תשאיר סשן פתוח
test('ניקוי', () => {
  const s = cli('status');
  if (s.active) {
    cli('close');
    cli('finish', 'NONE');
  }
  rmSync(join(CBT, 'session-state.json'), { force: true });
  cli('sync');
  assert.equal(cli('status').active, null);
});

// ==========================================================================
//  שוויון בין שני המשטחים
//
//  הסוכן מריץ עם המודל החזק יותר, ובכל זאת קיבל זמן־מה את ההקשר
//  הגרוע: בלי הספרייה, עם דוגמאות גנריות, ועם עותק משלו של מחזור
//  החיים. כל תיקון היה צריך לקרות פעמיים, וההתנהגות יכלה להתפצל בשקט.
// ==========================================================================

test('הסקריפט אינו מכפיל את מחזור החיים של הסשן', () => {
  const src = readFileSync(RUN, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // בחירת כלי, ציון נאמנות וסגירה — כולם ב-session.js
  assert.doesNotMatch(src, /T\.nextTool\(/, 'בחירת כלי משוכפלת');
  assert.doesNotMatch(src, /S\.completeSession\(/, 'הסגירה משוכפלת');
  assert.doesNotMatch(src, /S\.startSession\(/, 'הפתיחה משוכפלת');
  assert.match(src, /SESS\.(openSession|nextStep|closeSession)/, 'אינו משתמש במודול');
});

test('ההקשר לסוכן נושא את מה שהבוט שולח למודל', () => {
  const st = cli('status');
  if (!st.active) cli('start');
  const n = cli('next');
  if (n.done) return;
  for (const k of ['system', 'data', 'rules', 'exemplars', 'critique', 'sources']) {
    assert.ok(k in n.context, `ההקשר חסר ${k}`);
  }
  // **לא ריק.** מערך ריק היה מרוקן כל בדיקה שרצה עליו בלולאה, ושתי
  // מוטציות עברו בדיוק כך.
  assert.ok(n.context.sources.length > 0,
    `${n.tool}: אפס מקורות — הסוכן רץ בלי הספרייה`);
  for (const src of n.context.sources) assert.ok(src.id && src.src, 'מקור בלי זיהוי');
});

test('הדוגמה בהקשר היא של הכלי הפעיל', async () => {
  const { TOOL_EXEMPLARS } = await import('../src/cbt/engine.js');
  const st = cli('status');
  if (!st.active) cli('start');
  const n = cli('next');
  if (n.done) return;
  const own = TOOL_EXEMPLARS[n.tool];
  if (!own) return;                       // כלי בלי דוגמה ייעודית
  assert.ok(n.context.exemplars.includes(own.good),
    `הדוגמה של ${n.tool} לא הוגשה`);
});

test('בלי רשת — עדיין נאמר אילו מקטעים רלוונטיים', () => {
  // לדעת **אילו** מקטעים רלוונטיים שווה משהו לסוכן גם בלי הגוף.
  const st = cli('status');
  if (!st.active) cli('start');
  const n = cliEnv({ CBT_OFFLINE: '1' }, 'next');
  if (n.done) return;
  assert.ok(n.context.sources.length > 0, 'בלי רשת לא נאמר כלום על המקורות');
  for (const s of n.context.sources) {
    assert.ok(s.id && s.src, 'מקור בלי זיהוי');
    assert.equal(s.text, null, 'טקסט הגיע במצב offline');
  }
});

test('ניקוי אחרי בדיקות השוויון', () => {
  const s = cli('status');
  if (s.active) { cli('close'); cli('finish', 'NONE'); }
  reset();
  assert.equal(cli('status').active, null);
});


// ==========================================================================
//  הפלט חייב להיות JSON תקין — בכל צעד של סשן שלם
//
//  הרצה מקצה לקצה נכשלה על "Invalid control character": הקורפוס מגיע
//  מ-pdftotext, ו-8 מתוך 121 הקטעים נשאו form feed, bell ו-backspace.
//  הם נוסעים משם אל הפרומפט **ואל כל JSON שעוטף אותם**.
//
//  מבחן צעד בודד לא היה תופס את זה: התקלה תלויה באיזה קטע נבחר, ולכן
//  כאן רץ סשן שלם וכל פלט מפורסר.
// ==========================================================================

const CTRL = /[\u0000-\u0008\u000b-\u001f\u007f]/;

test('הטקסט שעולה ל-KV נקי מתווי בקרה', () => {
  // הגרסה הראשונה של הבדיקה הזו בדקה כותרות ומונחים מהאינדקס — שניהם
  // עוברים טוקניזציה ל-[a-z] ולכן **לא יכולים** להכיל תווי בקרה.
  // כלומר היא לא יכלה להיכשל, ומוטציה שביטלה את הניקוי עברה.
  //
  // מה שנבדק עכשיו הוא הארטיפקט שבאמת נשלח: גוף הקטעים.
  const bulk = join(CBT_LIB, '.kv-bulk.json');
  if (!existsSync(bulk)) return;                 // נבנה מחדש בלבד
  const rows = JSON.parse(readFileSync(bulk, 'utf8'));
  assert.ok(rows.length > 50, `רק ${rows.length} קטעים`);
  const dirty = rows.filter(r => CTRL.test(r.value)).map(r => r.key);
  assert.deepEqual(dirty, [], 'תווי בקרה מ-pdftotext שרדו אל מה שנשלח למודל');
});

test('סשן שלם — כל פלט הוא JSON תקין', () => {
  const s0 = cli('status');
  if (s0.active) { cli('close'); cli('finish', 'NONE'); }
  reset();
  const st = cli('start');
  assert.ok(!st.error, `start נכשל: ${st.error}`);
  let n = 0;
  for (;;) {
    const step = cli('next');            // cli מפרסר — פלט פגום זורק כאן
    if (step.done) break;
    assert.ok(++n <= 20, 'הסשן לא נגמר');
    assert.ok(step.tool && step.name, 'צעד בלי כלי');
    // גם הטקסט שנשלף חייב להיות נקי — הוא נכנס לפרומפט
    for (const src of step.context.sources) {
      if (src.text) assert.ok(!CTRL.test(src.text), `${src.id}: תווי בקרה בטקסט`);
    }
    const r = cli('record', step.tool, 'תשובה לבדיקה', 'ערך');
    assert.equal(r.recorded, step.tool);
  }
  assert.ok(n >= 5, `רק ${n} צעדים`);
  const c = cli('close');
  assert.equal(c.fidelity.score, 1, `נאמנות ${c.fidelity.score} · דולג ${c.fidelity.missed}`);
  cli('finish', 'NONE');
  reset();
});


// ==========================================================================
//  בעלוּת משותפת — הכיסוי שחסר, וזו הסיבה שהבאגים נשלחו
//
//  כל בדיקות הסשן רצו מול פורט מת, כלומר **אך ורק** מסלול הנפילה
//  המקומי. אפס כיסוי למשיכה מוצלחת, לדחיפה, ל-409 ולשזירה בין שני
//  המשטחים — בדיוק המנגנון שנשא את שלושת הליקויים הקריטיים.
//
//  כאן רץ worker מדומה בתהליך, כדי שהמנגנון ייבדק בלי הבוט החי.
// ==========================================================================

import { createServer } from 'node:http';
import * as ST from '../src/cbt/state.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileP = promisify(execFile);

/** worker מדומה: מחזיק מצב CBT, מכבד את הגנת ה-409, וסופר בקשות */
function fakeWorker(initial = {}) {
  const log = [];
  let state = { ver: 1, startISO: null, sessionsDone: [], triggers: [],
                pastAttempts: [], dependence: null, confidence: [], homework: null,
                formulations: [], notes: [], active: null, ...initial };
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      log.push({ method: req.method, path: url.pathname, body: body || null });
      if (url.pathname !== '/cbt-state') { res.writeHead(404).end('no'); return; }
      if (req.method === 'POST') {
        // **ההחלטה האמיתית**, לא העתק שלה. הגרסה הראשונה שכפלה כאן את
        // ההגנה, ולכן שתי מוטציות על ההגנה שבבוט עברו — המוק בדק את
        // עצמו. מוק ששוכפל ממנו הקוד עובר בדיוק כשהמקור נשבר.
        const r = ST.applyCbtPush(state, JSON.parse(body || '{}'));
        if (r.bad) { res.writeHead(400).end('bad'); return; }
        if (r.conflict) {
          res.writeHead(409, { 'content-type': 'application/json' });
          return void res.end(JSON.stringify({ ok: false, ...r }));
        }
        state = r.cbt;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, cbt: state }));
    });
  });
  return new Promise(resolve => {
    srv.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${srv.address().port}`,
        log,
        get state() { return state; },
        set state(v) { state = v; },
        close: () => new Promise(r => srv.close(r)),
      });
    });
  });
}

/**
 * מריץ את ה-CLI מול ה-worker המדומה — **אסינכרוני בהכרח**.
 *
 * `execFileSync` חוסם את לולאת האירועים של התהליך שמארח את השרת, ולכן
 * הבן היה מחכה לתשובה שלעולם לא תישלח. הבדיקות נתקעו 20 שניות כל אחת
 * עד ה-timeout של ה-fetch.
 */
const cliAt = async (worker, ...a) => {
  const { stdout } = await execFileP('node', [RUN, ...a], {
    encoding: 'utf8',
    env: { ...process.env, CBT_OFFLINE: undefined, CBT_WORKER: worker.url },
  });
  return JSON.parse(stdout);
};

test('כל פקודה מוטציונית מושכת מ-KV לפני שהיא כותבת', async () => {
  // רק status ו-start משכו. next/record/close/finish כתבו מעל הקובץ
  // המקומי — כך שסשן שהמשתמש קידם בטלגרם נמחק בשקט.
  const w = await fakeWorker();
  try {
    reset();
    await cliAt(w, 'start');
    for (const cmd of ['next', 'close']) {
      w.log.length = 0;
      await cliAt(w, cmd);
      assert.ok(w.log.some(r => r.method === 'GET'), `${cmd} לא משך מ-KV`);
    }
  } finally { await w.close(); }
});

test('דחיפה אינה שולחת force אלא אם ביקשו', async () => {
  // force נשלח בכל דחיפה, ולכן הגנת ה-409 מעולם לא נורתה.
  const w = await fakeWorker();
  try {
    reset();
    await cliAt(w, 'start');
    const posts = w.log.filter(r => r.method === 'POST');
    assert.ok(posts.length, 'לא הייתה דחיפה');
    for (const p of posts) {
      assert.ok(!JSON.parse(p.body).force, 'force נשלח בלי שביקשו');
    }
    w.log.length = 0;
    await cliAt(w, 'push', '--force');
    assert.ok(JSON.parse(w.log.find(r => r.method === 'POST').body).force,
      '--force לא הגיע');
  } finally { await w.close(); }
});

test('סשן פתוח בבוט חוסם דחיפה מתנגשת — 409 מדווח', async () => {
  const w = await fakeWorker({ active: { id: 'wk3', iso: '2026-08-15', remaining: [], done: [], captured: {} } });
  try {
    reset();
    const r = await cliAt(w, 'push');
    assert.equal(r.pushed, false, 'הדחיפה עברה מעל סשן פתוח בבוט');
    assert.ok(r.conflict, 'ההתנגשות לא דווחה');
    assert.match(r.why, /סשן פתוח/);
  } finally { await w.close(); }
});

test('משיכה שנכשלה עוצרת את הכתיבה', async () => {
  // מצב שלא ידוע אם הוא טרי אינו בסיס לדריסה — זה המסלול שאיבד נתונים.
  const dead = { url: 'http://127.0.0.1:1' };
  const run = (...a) => JSON.parse(execFileSync('node', [RUN, ...a], {
    encoding: 'utf8', env: { ...process.env, CBT_OFFLINE: undefined, CBT_WORKER: dead.url },
  }));
  for (const cmd of ['start', 'next', 'record', 'close', 'finish']) {
    const r = run(cmd);
    assert.match(r.error || '', /למשוך מצב טרי/, `${cmd} כתב בלי מצב טרי`);
  }
});

test('CBT_OFFLINE הוא הצהרת כוונה ולכן ממשיך', () => {
  // ההבחנה בין "אין רשת בכוונה" לבין "הבוט לא נענה" היא כל העניין.
  const r = cli('status');
  assert.ok(!r.error, `offline נחסם: ${r.error}`);
});

test('שזירה: הבוט מקדם סשן, הסוכן לא מוחק אותו', async () => {
  // התרחיש שאיבד נתונים: סוכן פותח, המשתמש עונה בטלגרם, הסוכן רושם.
  const w = await fakeWorker();
  try {
    reset();
    await cliAt(w, 'start');
    // המשתמש עונה בטלגרם — הבוט מקדם את אותו סשן
    const inBot = JSON.parse(JSON.stringify(w.state));
    inBot.active.done = ['check-nrt'];
    inBot.active.remaining = inBot.active.remaining.filter(b => b !== 'check-nrt');
    inBot.active.captured = { 'check-nrt': 'שוכח בערב' };
    w.state = inBot;

    const step = await cliAt(w, 'next');
    assert.ok(!step.error, step.error);
    await cliAt(w, 'record', step.tool, 'תשובה', 'ערך');

    assert.ok(w.state.active.done.includes('check-nrt'),
      'תשובת המשתמש מהבוט נמחקה');
    assert.equal(w.state.active.captured['check-nrt'], 'שוכח בערב',
      'התוכן שנקלט בבוט נמחק');
  } finally { await w.close(); }
});

test('סגירה כפולה אינה מזיזה את לוח התחזוקה', async () => {
  const S = await import('../src/cbt/state.js');
  const P = await import('../src/cbt/protocol.js');
  let c = S.migrateCbt(null);
  c = S.startSession(c, 'maint', '2026-09-05');
  const once = S.completeSession(c, '2026-09-05');
  // סגירה שנייה מעותק מקומי ישן שעדיין מחזיק active
  const stale = { ...S.startSession(S.migrateCbt(null), 'maint', '2026-09-05'),
                  sessionsDone: [...once.sessionsDone], notes: [...once.notes] };
  const twice = S.completeSession(stale, '2026-09-05');

  assert.deepEqual(twice.sessionsDone, once.sessionsDone, 'הסשן נספר פעמיים');
  assert.equal(twice.notes.length, once.notes.length, 'ההערה נרשמה פעמיים');
  const a = P.dueSession('2026-12-01', ['intake', 'wk3', 'wk4', ...once.sessionsDone], '2026-08-07');
  const b = P.dueSession('2026-12-01', ['intake', 'wk3', 'wk4', ...twice.sessionsDone], '2026-08-07');
  assert.equal(a.dueISO, b.dueISO, 'לוח התחזוקה זז בגלל סגירה כפולה');
});

test('מפתח זר בדחיפה אינו נשמר', async () => {
  const S = await import('../src/cbt/state.js');
  const clean = S.pickCbtFields({ sessionsDone: ['x'], force: true, junk: 1, active: null });
  assert.deepEqual(Object.keys(clean).sort(), ['active', 'sessionsDone']);
  assert.equal('force' in S.migrateCbt(clean), false, 'force שרד את הסינון');
});

test('start מדווח אם הדחיפה נכשלה', () => {
  // התוצאה נזרקה, ולכן סשן שנפתח בלי שהבוט ידע נראה כמו הצלחה —
  // והתזכורת של 20:30 המשיכה לירות עליו.
  reset();
  const r = cli('start');
  if (r.error) return;
  assert.ok('mirror' in r, 'start אינו מדווח על הדחיפה');
  cli('close'); cli('finish', 'NONE'); reset();
});


// ---------- ההחלטה של ה-endpoint, ישירות ----------

test('applyCbtPush חוסם החלפה של סשן פתוח, לא רק מחיקה', () => {
  const open = { ...ST.migrateCbt(null),
                 active: { id: 'wk3', iso: '2026-08-15', remaining: [], done: [], captured: {} } };
  // מחיקה
  assert.ok(ST.applyCbtPush(open, { sessionsDone: [] }).conflict, 'מחיקה עברה');
  // החלפה בסשן אחר — התנאי הישן התיר את זה
  const other = { id: 'wk4', iso: '2026-08-22', remaining: [], done: [], captured: {} };
  assert.ok(ST.applyCbtPush(open, { sessionsDone: [], active: other }).conflict,
    'החלפה של סשן פתוח בסשן אחר עברה');
  // אותו סשן — מותר, זה בדיוק העדכון הלגיטימי
  const same = { ...open.active, done: ['check-nrt'] };
  assert.ok(ST.applyCbtPush(open, { sessionsDone: [], active: same }).cbt,
    'עדכון של אותו סשן נחסם');
});

test('applyCbtPush מסנן מפתחות זרים', () => {
  const r = ST.applyCbtPush(ST.migrateCbt(null),
                            { sessionsDone: ['x'], force: true, junk: 1 });
  assert.ok(r.cbt, 'נדחה בטעות');
  assert.equal('force' in r.cbt, false, 'force נשמר');
  assert.equal('junk' in r.cbt, false, 'מפתח זר נשמר');
});

test('applyCbtPush דוחה גוף פגום', () => {
  for (const bad of [null, {}, { sessionsDone: 'x' }, 'str']) {
    assert.ok(ST.applyCbtPush(ST.migrateCbt(null), bad).bad, `${JSON.stringify(bad)} עבר`);
  }
});

test('force עוקף — אבל רק כשנשלח במפורש', () => {
  const open = { ...ST.migrateCbt(null),
                 active: { id: 'wk3', iso: '2026-08-15', remaining: [], done: [], captured: {} } };
  assert.ok(ST.applyCbtPush(open, { sessionsDone: [], force: true }).cbt, 'force לא עקף');
});

test('הבוט משתמש בהחלטה המחולצת ולא בעותק', () => {
  const src = readFileSync(join(SRC_DIR, 'index.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(src, /applyCbtPush/, 'ה-endpoint אינו משתמש בהחלטה המחולצת');
  assert.doesNotMatch(src, /cur\.active && \(!b\.active/, 'ההגנה שוכפלה בחזרה ל-index');
});
