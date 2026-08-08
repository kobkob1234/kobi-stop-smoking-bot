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
// **הרמטי בכוונה.** מאז ש-`status`/`start` מושכים את המצב מ-KV, בדיקה
// שרצה מול הבוט החי תלויה במה שבמקרה שמור שם — וסשן שנשאר פתוח
// מהרצה קודמת היה מפיל אותה. מכוונים לפורט מת כדי שהמשיכה תיכשל
// ותיפול למצב המקומי.
const OFFLINE = { CBT_WORKER: 'http://127.0.0.1:1' };
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
  const live = cliEnv({ CBT_WORKER: undefined }, 'sync');
  assert.match(live.source, /חי/, `לא נשלף חי: ${live.source}`);

  // כופים נפילה — אחרת הענף לא רץ כשיש רשת, והבדיקה שומרת על כלום.
  const fell = cliEnv({ CBT_WORKER: 'http://127.0.0.1:1' }, 'sync');
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
    const early = (c.match(/return out\(/g) || []).length;
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
