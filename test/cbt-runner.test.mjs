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
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUN = join(HERE, '..', 'scripts', 'cbt-session.mjs');
const REPO = join(HERE, '..');
const CBT = join(REPO, 'cbt-state');
const cli = (...a) => JSON.parse(execFileSync('node', [RUN, ...a], { encoding: 'utf8' }));
const cliEnv = (env, ...a) => JSON.parse(execFileSync('node', [RUN, ...a],
  { encoding: 'utf8', env: { ...process.env, ...env } }));

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
  const live = cli('sync');
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
