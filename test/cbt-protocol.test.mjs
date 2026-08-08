// ==========================================================================
//  שלב 2 — הפרוטוקול הקליני
//
//  נגזר מ-NCSCT STP. הבדיקות כאן שומרות על שלוש תכונות שבלעדיהן זה
//  מפסיק להיות פרוטוקול ונהיה טקסט:
//    • כל סשן ניתן לסגירה רק כשכל פריטי החובה בוצעו
//    • הלוח נגזר מיום הגמילה ולא מקודד קשיח
//    • כל BCT שהפרוטוקול מבקש חייב להיות קיים כמזהה מוכר
// ==========================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/cbt/protocol.js';
import * as P from '../src/plan.js';
import { readFileSync } from 'node:fs';

const START = '2026-08-07';

test('כל סשן מוגדר במלואו — כותרת, ייחוס ל-STP, וצ׳קליסט', () => {
  for (const s of C.SESSIONS) {
    assert.ok(s.id && s.title, `סשן בלי זהות: ${JSON.stringify(s).slice(0, 60)}`);
    assert.ok(s.stpRef, `${s.id}: אין ייחוס ל-STP`);
    assert.ok(s.checklist.length >= 5, `${s.id}: צ׳קליסט של ${s.checklist.length} פריטים`);
    for (const c of s.checklist) {
      assert.ok(c.bct && c.label, `${s.id}: פריט בלי bct או label`);
    }
  }
});

test('לכל סשן יש לפחות פריט חובה אחד — אחרת אין קריטריון מעבר', () => {
  for (const s of C.SESSIONS) {
    assert.ok(s.checklist.some(c => c.required), `${s.id}: הכול אופציונלי`);
  }
});

test('כל התאמה מה-STP מנומקת', () => {
  // התאמה בלי סיבה כתובה היא סטייה שאיש לא יוכל לשחזר למה נעשתה.
  for (const s of C.SESSIONS) {
    for (const c of s.checklist) {
      if (c.adapted) assert.ok(c.adapted.length > 15, `${s.id}/${c.bct}: נימוק ריק`);
    }
    if (s.adapted) assert.ok(s.adapted.length > 30, `${s.id}: נימוק סשן ריק`);
  }
});

test('ניטור CO הוחלף — ולא נשמט', () => {
  // ה-STP מבקש CO בכל סשן פוסט-גמילה. ויפ אינו מייצר CO, אבל הפונקציה
  // (אימות אובייקטיבי במקום דיווח עצמי) חייבת להישאר.
  for (const id of ['wk3', 'wk4', 'maint']) {
    const s = C.byId(id);
    const obj = s.checklist.find(c => c.bct === C.BCT.OBJECTIVE);
    assert.ok(obj, `${id}: אין אימות אובייקטיבי`);
    assert.ok(obj.required, `${id}: האימות אינו חובה`);
    assert.match(obj.adapted || '', /CO/, `${id}: ההחלפה לא מתועדת`);
  }
});

// ---------- לוח הזמנים ----------

test('הלוח נגזר מיום הגמילה ולא מקודד קשיח', () => {
  const s = C.scheduleFor(START);
  assert.equal(s.find(x => x.id === 'wk3').dueISO, P.addDaysISO(P.QUIT, 21));
  assert.equal(s.find(x => x.id === 'wk4').dueISO, P.addDaysISO(P.QUIT, 28));
});

test('הסשנים מתקדמים לפי סדר ככל שנסגרים', () => {
  const seq = [
    ['2026-08-07', [], 'intake'],
    ['2026-08-15', ['intake'], 'wk3'],
    ['2026-08-22', ['intake', 'wk3'], 'wk4'],
    ['2026-08-29', ['intake', 'wk3', 'wk4'], 'maint:0'],
    ['2026-09-05', ['intake', 'wk3', 'wk4', 'maint:0'], 'maint:1'],
  ];
  for (const [iso, done, want] of seq) {
    const d = C.dueSession(iso, done, START);
    assert.equal(d && d.id, want, `${iso} עם ${done.length} סגורים`);
  }
});

test('סשן שכבר נסגר אינו חוזר', () => {
  // ב-20.8 wk3 סגור ו-wk4 עוד לא הגיע (22.8) — התשובה הנכונה היא null,
  // ולא "להריץ את wk3 שוב כי הוא עדיין בטווח".
  const d = C.dueSession('2026-08-20', ['intake', 'wk3'], START);
  assert.notEqual(d && d.id, 'wk3');
});

test('אין סשן לפני שהגיע מועדו', () => {
  // ב-16.8 סשן wk4 (28 ימים = 22.8) עוד לא אמור לרוץ
  const d = C.dueSession('2026-08-16', ['intake', 'wk3'], START);
  assert.notEqual(d && d.id, 'wk4', 'wk4 רץ שישה ימים מוקדם');
});

test('התחזוקה ממשיכה לאורך כל הצמצום ולא נעצרת בשבוע 4', () => {
  // הצמצום רץ עד 15.10; אם התחזוקה תיפסק לפניו, הליווי נעלם בדיוק
  // בשלב שבו מורידים מינון.
  const done = ['intake', 'wk3', 'wk4'];
  const d = C.dueSession('2026-10-10', done, START);
  assert.ok(d, 'אין סשן ב-10.10 — הליווי נעצר באמצע הצמצום');
  assert.equal(C.byId(d.id).id, 'maint');
});

// ---------- קריטריון מעבר ונאמנות ----------

test('סשן נסגר רק כשכל פריטי החובה בוצעו', () => {
  const s = C.byId('wk3');
  const req = s.checklist.filter(c => c.required).map(c => c.bct);
  assert.equal(C.canComplete(s, []).ok, false);
  assert.equal(C.canComplete(s, req.slice(0, -1)).ok, false, 'נסגר עם פריט חסר');
  assert.equal(C.canComplete(s, req).ok, true);
});

test('מה שחסר מדווח בשמו', () => {
  const s = C.byId('wk3');
  const r = C.canComplete(s, [C.BCT.PROGRESS]);
  assert.ok(r.missing.includes(C.BCT.NAP), JSON.stringify(r.missing));
});

test('ציון הנאמנות משקף את פריטי החובה בלבד', () => {
  const s = C.byId('wk3');
  const req = s.checklist.filter(c => c.required).map(c => c.bct);
  assert.equal(C.fidelity(s, req).score, 1);
  assert.equal(C.fidelity(s, []).score, 0);
  const half = req.slice(0, Math.ceil(req.length / 2));
  assert.ok(C.fidelity(s, half).score > 0.4 && C.fidelity(s, half).score < 0.7);
});

test('פריט אופציונלי שנשמט נרשם אך אינו חוסם', () => {
  // "אופציונלי" שלא נרשם הופך ל"בלתי נראה", ואז הצ׳קליסט מודד רק את הקל.
  const s = C.byId('maint');
  const req = s.checklist.filter(c => c.required).map(c => c.bct);
  const f = C.fidelity(s, req);
  assert.equal(f.score, 1, 'אופציונלי חוסם סגירה');
  assert.ok(f.skippedOptional.length > 0, 'אופציונלי שנשמט לא נרשם');
});

test('כל BCT שהפרוטוקול מבקש הוא מזהה מוכר', () => {
  const known = new Set(Object.values(C.BCT));
  for (const b of C.requiredBcts()) {
    assert.ok(known.has(b), `BCT לא מוכר: ${b}`);
  }
  assert.ok(C.requiredBcts().length >= 12);
});

test('אין תאריך קשיח בפרוטוקול — הכול נגזר מ-plan.js', () => {
  // השוואת ערך לא תופסת את זה: '2026-08-15' *שווה* ל-QUIT+21, ולכן טסט
  // שבודק את התוצאה עובר גם כשהתאריך הוקשח. רק בדיקה מבנית תופסת —
  // וזה בדיוק מה שיישבר בשינוי הבא של יום הגמילה.
  const src = readFileSync(new URL('../src/cbt/protocol.js', import.meta.url), 'utf8');
  const lits = src.split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /['"]\d{4}-\d{2}-\d{2}['"]/.test(l) && !l.trim().startsWith('//'));
  assert.deepEqual(lits.map(([i]) => i), [], `תאריך קשיח בשורות: ${lits.map(([i, l]) => i + ': ' + l.trim().slice(0, 50))}`);
});


// ==========================================================================
//  תחזוקה לא מתחילה ביום של wk4
// ==========================================================================

test('אין שני סשנים על אותו תאריך, ויש מרווח מינימלי', () => {
  // שתי תכונות שנשברו יחד: `maint:0` היה זמין באותו יום כמו `wk4`,
  // ולא היה בכלל מרווח — משתמש שפתח `/טיפול` אחרי חודשיים יכול היה
  // להריץ עשרה סשנים ברצף באותו ערב.
  const seen = new Map();
  const done = [];
  let last = null;
  let ran = 0;
  for (let d = 0; d <= 200; d++) {
    const iso = new Date(Date.parse('2026-08-07') + d * 864e5).toISOString().slice(0, 10);
    const s = C.dueSession(iso, done, '2026-08-07', last);
    if (!s) continue;
    assert.ok(!seen.has(s.dueISO),
      `${s.id} ו-${seen.get(s.dueISO)} חולקים את ${s.dueISO}`);
    if (last) {
      const gap = Math.round((Date.parse(iso) - Date.parse(last)) / 864e5);
      assert.ok(gap >= C.MIN_GAP_DAYS, `${s.id} רץ ${gap} ימים אחרי הקודם`);
    }
    seen.set(s.dueISO, s.id);
    done.push(s.id);
    last = iso;
    ran++;
  }
  assert.ok(ran >= 8, `רק ${ran} סשנים — הלוח נשבר`);
});

test('בק-לוג אינו נפתח בבת אחת', () => {
  // התרחיש: המשתמש נעלם לחודשיים ופותח /טיפול. כל מפגש שפוספס היה
  // "אמור לרוץ" רטרואקטיבית, והשלמת אחד חשפה מיד את הבא.
  const done = [];
  let last = null;
  let n = 0;
  while (n < 12) {
    const s = C.dueSession('2026-10-15', done, '2026-10-15', last);
    if (!s) break;
    done.push(s.id); last = '2026-10-15'; n++;
  }
  assert.equal(n, 1, `${n} סשנים נפתחו באותו יום`);
});

test('nextDueISO מחשב גם תחזוקה', () => {
  // הוא נגזר משלושת הקבועים בלבד, ולכן אחרי wk4 החזיר null לנצח —
  // והבוט אמר "אין סשן היום" בלי תאריך, בזמן שהתחזוקה היא כל השלב.
  const done = ['intake', 'wk3', 'wk4'];
  const next = C.nextDueISO('2026-08-23', done, '2026-08-07', '2026-08-22');
  assert.ok(next, 'אין תאריך לסשן הבא אחרי wk4');
  assert.match(next, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(next > '2026-08-22', 'התאריך הבא אינו אחרי הסשן האחרון');
});

test('המרווח נאכף גם על התאריך הבא', () => {
  const next = C.nextDueISO('2026-08-16', ['intake'], '2026-08-07', '2026-08-15');
  const gap = Math.round((Date.parse(next) - Date.parse('2026-08-15')) / 864e5);
  assert.ok(gap >= C.MIN_GAP_DAYS, `הבא בעוד ${gap} ימים בלבד`);
});


test('התחזוקה הראשונה שבוע אחרי wk4', () => {
  const done = ['intake', 'wk3', 'wk4'];
  const wk4Due = C.scheduleFor('2026-08-07').find(s => s.id === 'wk4').dueISO;
  assert.equal(C.dueSession(wk4Due, done, '2026-08-07'), null,
    'תחזוקה זמינה כבר ביום ה-wk4');
  const dayAfter = new Date(Date.parse(wk4Due) + 864e5).toISOString().slice(0, 10);
  assert.equal(C.dueSession(dayAfter, done, '2026-08-07'), null,
    'תחזוקה זמינה יום אחרי wk4');
  const weekAfter = new Date(Date.parse(wk4Due) + 7 * 864e5).toISOString().slice(0, 10);
  assert.equal(C.dueSession(weekAfter, done, '2026-08-07').id, 'maint:0');
});


test('התחזוקה נגזרת מהסשן האחרון בפועל, לא מתאריך לוח', () => {
  // עוגן קבוע פירושו שמי שאיחר בשבועיים מקבל את המפגש הבא "מיד",
  // כי התאריך שלו כבר עבר. עוגן אמיתי נותן שבוע **מהמפגש שהיה**.
  const done = ['intake', 'wk3', 'wk4', 'maint:0'];
  const ranLate = '2026-10-01';                 // התחזוקה רצה באיחור
  // יום אחרי — עדיין לא
  assert.equal(C.dueSession('2026-10-02', done, '2026-08-07', ranLate), null,
    'מפגש נוסף יום אחרי הקודם');
  // שישה ימים — עדיין לא (everyDays = 7)
  assert.equal(C.dueSession('2026-10-07', done, '2026-08-07', ranLate), null,
    'מפגש נוסף לפני שבוע');
  // שבוע בדיוק — כן
  const due = C.dueSession('2026-10-08', done, '2026-08-07', ranLate);
  assert.ok(due, 'אין מפגש שבוע אחרי הקודם');
  assert.equal(due.dueISO, '2026-10-08',
    `העוגן הוא ${due.dueISO} ולא תאריך הסשן שרץ`);
});

test('nextDueISO לתחזוקה נמדד מהסשן האחרון', () => {
  const done = ['intake', 'wk3', 'wk4', 'maint:0'];
  assert.equal(C.nextDueISO('2026-10-02', done, '2026-08-07', '2026-10-01'),
    '2026-10-08', 'התאריך הבא אינו שבוע מהסשן שרץ');
});


test('רק פריטי חובה נספרים בנאמנות', () => {
  // סריקת מוטציות: ביטול `filter(c => c.required)` שרד — אף בדיקה לא
  // הבחינה בין חובה לרשות, כלומר "נאמנות לפרוטוקול" יכלה להיות
  // ממוצע על פריטים שהפרוטוקול עצמו מסמן כאופציונליים.
  // `maint` הוא הסשן היחיד עם פריט רשות (coping-plan)
  const s = C.byId('maint');
  const opt = s.checklist.filter(c => !c.required).map(c => c.bct);
  const req = s.checklist.filter(c => c.required).map(c => c.bct);
  assert.ok(opt.length, 'לסשן אין פריטי רשות — הבדיקה לא בודקת כלום');

  // כל החובה ואף רשות → 100%
  assert.equal(C.fidelity(s, req).score, 1,
    'פריטי רשות שנשמטו הורידו את הציון');
  // כל הרשות ואף חובה → 0%
  assert.equal(C.fidelity(s, opt).score, 0,
    'פריטי רשות העלו את הציון בלי שאף פריט חובה רץ');
});

test('missed מדווח רק פריטי חובה שנשמטו', () => {
  const s = C.byId('maint');
  const req = s.checklist.filter(c => c.required).map(c => c.bct);
  assert.deepEqual(C.fidelity(s, req).missed, [], 'רשות דווחה כנשמטת');
});


test('canComplete מבחין בין חובה לרשות', () => {
  // סריקת מוטציות: `filter(c => c.required)` ב-`canComplete` שרד —
  // אף בדיקה לא בדקה שפריט רשות שנשמט אינו חוסם סגירה.
  const s = C.byId('maint');
  const req = s.checklist.filter(c => c.required).map(c => c.bct);
  const opt = s.checklist.filter(c => !c.required).map(c => c.bct);
  assert.ok(opt.length, 'אין פריט רשות — הבדיקה לא בודקת כלום');

  assert.equal(C.canComplete(s, req).ok, true,
    'פריט רשות שנשמט חסם סגירה');
  assert.equal(C.canComplete(s, req.slice(1)).ok, false,
    'פריט חובה שנשמט לא חסם סגירה');
  assert.equal(C.canComplete(s, opt).ok, false,
    'רשות לבדה הספיקה לסגירה');
});
