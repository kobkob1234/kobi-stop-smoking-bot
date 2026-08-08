// ==========================================================================
//  האחזור
//
//  שלושה כשלים שהמדידה חשפה, וכל בדיקה כאן מכוונת לאחד:
//    • **שפה** — השיחה בעברית, הקורפוס באנגלית. בקשה ל"נושאים" החזירה
//      מונחים שלא נפגשים עם שום מקטע, והדירוג נשען על תג ה-BCT בלבד
//      בלי שאיש יבחין.
//    • **"trigger" הוא מונח קליני נפוץ** — התג לבדו החזיר דף עבודה על
//      OCD ומילון מונחים.
//    • **תקציב** — "מקטע שלם" הוא בין 138 ל-26,844 מילים.
// ==========================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pickSections, queryTerms, clip, retrieverFor, FETCH_ASK,
         WORD_BUDGET, MAX_SECTIONS, SMOKING_BOOKS, W, SCORE_FLOOR } from '../src/cbt/retrieve.js';
import { LIBRARY } from '../src/cbt/library.js';
import { TOOLS } from '../src/cbt/tools.js';
import { TOOL_EXEMPLARS, exemplarText, runTurn } from '../src/cbt/engine.js';
import * as P from '../src/cbt/protocol.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

// ---------- האינדקס ----------

test('האינדקס אינו ריק ולכל רשומה יש את מה שהדירוג צריך', () => {
  assert.ok(LIBRARY.length > 80, `רק ${LIBRARY.length} מקטעים`);
  for (const e of LIBRARY) {
    for (const k of ['id', 'book', 'title', 'src', 'kind', 'words', 'bcts', 'terms']) {
      assert.ok(k in e, `${e.id} חסר ${k}`);
    }
    assert.ok(Array.isArray(e.bcts) && Array.isArray(e.terms));
    assert.ok(e.words >= 120, `${e.id}: ${e.words} מילים — רעש`);
  }
});

test('כל BCT שכלי משתמש בו מכוסה במקטע אחד לפחות', () => {
  // התקרה של 6 תגים מחקה את `past-attempts` מהמקטע היחיד שמלמד אותו,
  // ולכן הכלי שמפעיל אותו נשאר בלי מקור בכלל.
  const tagged = new Set(LIBRARY.flatMap(e => e.bcts));
  const needed = TOOLS.filter(t => t.mode === 'responsive').map(t => t.id);
  const gaps = needed.filter(id => !tagged.has(id));
  assert.deepEqual(gaps, [], `כלים בלי אף מקטע: ${gaps}`);
});

test('אין תג שמופיע ביותר משליש מהקורפוס', () => {
  // תג כזה אינו מבחין בין מקטעים. `worksheet` תפס 72 מתוך 121.
  const n = LIBRARY.length;
  const freq = {};
  for (const e of LIBRARY) for (const b of e.bcts) freq[b] = (freq[b] || 0) + 1;
  const broad = Object.entries(freq).filter(([, k]) => k > n * 0.34);
  assert.deepEqual(broad, [], `תגים רחבים מדי: ${JSON.stringify(broad)}`);
});

test('האינדקס נשאר קטן מספיק לבנדל', () => {
  const kb = readFileSync(join(SRC, 'cbt', 'library.js')).length / 1024;
  assert.ok(kb < 200, `${kb.toFixed(0)}KB — הטקסט המלא דלף לאינדקס`);
});

test('האינדקס נושא מטא-דאטה ולא את הטקסט', () => {
  // הכשל שהיה משתיק את כל העיצוב: לצרף את 2.7MB לבנדל.
  const longest = Math.max(...LIBRARY.map(e => JSON.stringify(e).length));
  assert.ok(longest < 2000, `רשומה של ${longest} תווים — גוף המקטע באינדקס`);
});

// ---------- הדירוג ----------

test('מונחים בעברית לא מייצרים חפיפה — ולכן מבקשים אנגלית', () => {
  assert.deepEqual(queryTerms('דחפים חזקים בערב'), []);
  assert.match(FETCH_ASK, /אנגלית/, 'שלב ה-fetch לא מבקש אנגלית');
});

test('גם בלי מונחים בכלל — תג ה-BCT לבדו מחזיר משהו', () => {
  // זו הרשת שמתחת לכשל השפה: אם המודל בכל זאת יחזיר עברית, האחזור
  // עדיין עובד — פחות טוב, אבל לא ריק.
  const r = pickSections('דחף חזק בלילה', { bct: 'discuss-cravings' });
  assert.ok(r.length, 'שאילתה בעברית החזירה כלום');
});

test('ספר ייעודי לגמילה מנצח ספר CBT כללי באותו תג', () => {
  const r = pickSections('trigger identification', { bct: 'identify-triggers' });
  assert.ok(r.length);
  assert.ok(SMOKING_BOOKS.has(r[0].book),
    `הראשון הוא ${r[0].id} — ספרות כללית גברה על ספרות גמילה`);
});

test('חפיפת מונחים טובה עדיין מנצחת תג לבדו', () => {
  // ההטיה לספרי הגמילה לא אמורה להכריע — יומן מחשבות הוא בק, לא STP.
  const r = pickSections('automatic thoughts evidence record', {});
  assert.ok(r.length);
  assert.ok(!SMOKING_BOOKS.has(r[0].book),
    `${r[0].id} — ההטיה לספרי גמילה הפכה למוחלטת`);
});

test('מקטע שכל הסיגנל שלו הוא התג נופל מול התאמה חזקה', () => {
  // הרצה חיה החזירה, מתחת למקטע רלוונטי, דף עבודה על OCD ודיאלוג
  // שכותרתו זבל — שניהם רק בזכות התג. רעש כזה נכנס לאותו פרומפט
  // שאמור לייצר שאלה ממוקדת.
  const lib = [
    { id: 'strong', book: 'ncsct-stp', title: 'X', src: 's', kind: 'theory',
      words: 500, bcts: ['identify-triggers'], terms: ['trigger'] },
    { id: 'tag-only', book: 'manning-worksheets', title: 'Y', src: 's', kind: 'theory',
      words: 300, bcts: ['identify-triggers'], terms: [] },
  ];
  const r = pickSections('trigger', { bct: 'identify-triggers', library: lib });
  assert.deepEqual(r.map(x => x.id), ['strong'], 'הרעש נכנס');
});

test('כשכל ההתאמות חלשות — עדיין מוחזר מה שיש', () => {
  // הרצפה יחסית ולא מוחלטת: אחרת שאלה על נושא שהקורפוס מכסה חלש
  // הייתה מקבלת אפס מקורות במקום את הטוב שיש.
  const lib = [
    { id: 'a', book: 'beck-basics', title: 'X', src: 's', kind: 'theory',
      words: 300, bcts: ['coping-plan'], terms: [] },
    { id: 'b', book: 'beck-basics', title: 'Y', src: 's', kind: 'theory',
      words: 300, bcts: ['coping-plan'], terms: [] },
  ];
  assert.equal(pickSections('x', { bct: 'coping-plan', library: lib }).length, 2);
});

test('הרצפה בין "רק התג" לבין "התג ועוד משהו"', () => {
  assert.ok(W.bct / (W.bct + W.smoking) < SCORE_FLOOR, 'תג לבדו עובר את הרצפה');
  const weakest = Math.min(W.term, W.kind, W.title, W.smoking);
  assert.ok((W.bct + weakest) / (W.bct + W.smoking) >= SCORE_FLOOR,
    'התג עם סיגנל נוסף נחסם — הרצפה גבוהה מדי');
});

test('שאילתה בלי שום התאמה מחזירה ריק, לא זבל', () => {
  assert.deepEqual(pickSections('zzzq qqzz', {}), []);
});

test('התקציב נשמר', () => {
  for (const q of ['coping plan', 'craving urge', 'relapse lapse prevention']) {
    const r = pickSections(q, {});
    assert.ok(r.length <= MAX_SECTIONS, `${r.length} מקטעים`);
    const total = r.slice(1).reduce((t, e) => t + e.words, 0);
    assert.ok(total <= WORD_BUDGET, `${total} מילים מעל התקציב`);
  }
});

test('מקטע ענק לבדו עדיין נבחר', () => {
  // לדלג עליו היה אומר שהמקטע החזק ביותר בקורפוס לעולם לא ייבחר
  // רק בגלל אורכו.
  const big = LIBRARY.reduce((a, b) => (a.words > b.words ? a : b));
  assert.ok(big.words > WORD_BUDGET, 'אין מקטע שחורג — הבדיקה לא בודקת כלום');
  const r = pickSections(big.terms.slice(0, 6).join(' '), { library: [big] });
  assert.equal(r.length, 1, 'מקטע חורג נזרק');
});

test('המשקלים מדורגים כפי שתועד', () => {
  assert.ok(W.bct > W.term && W.bct > W.kind, 'תג ה-BCT אינו הסיגנל החזק');
  assert.ok(W.smoking < W.bct, 'ההטיה לספרי גמילה מכריעה על הטכניקה');
});

// ---------- החיתוך ----------

test('חיתוך בגבול פסקה ולא באמצע משפט', () => {
  const t = 'פסקה ראשונה שלמה כאן.\n\nפסקה שנייה ' + 'מילה '.repeat(200);
  const c = clip(t, 60);
  assert.ok(c.endsWith('[…]'), 'אין סימון חיתוך');
  assert.ok(c.length < t.length);
});

test('טקסט קצר מהתקציב חוזר שלם', () => {
  assert.equal(clip('שלוש מילים בלבד', 50), 'שלוש מילים בלבד');
});

// ---------- הקריאה מ-KV ----------

test('KV שקורס לא מפיל את התור', () => {
  // אחזור הוא ביסוס לניסוח, לא תנאי לו.
  const env = { KV: { get: async () => { throw new Error('KV down'); } } };
  return retrieverFor(env, { bct: 'discuss-cravings' })('craving')
    .then(r => assert.deepEqual(r, []));
});

test('מקטע חסר ב-KV מדולג, השאר מוחזר', () => {
  let n = 0;
  const env = { KV: { get: async () => (++n === 1 ? null : '> **Source:** X\n\nגוף') } };
  return retrieverFor(env, { bct: 'coping-plan' })('coping plan action')
    .then(r => assert.ok(r.length >= 1, 'מקטע אחד חסר איפס את הכול'));
});

test('המקור מיוחס — בלי זה אי אפשר לצטט', () => {
  const env = { KV: { get: async () => '> **Source:** ספר\n\nגוף המקטע' } };
  return retrieverFor(env, { bct: 'coping-plan' })('coping plan')
    .then(r => { assert.ok(r.length); assert.ok(r[0].src && r[0].id); });
});

// ---------- דוגמאות לפי כלי ----------

test('לכל כלי responsive יש דוגמה משלו', () => {
  // דוגמה גנרית לא מלמדת את הכשל הספציפי של הטכניקה.
  const need = TOOLS.filter(t => t.mode === 'responsive').map(t => t.id);
  const gaps = need.filter(id => !TOOL_EXEMPLARS[id]);
  assert.deepEqual(gaps, [], `בלי דוגמה: ${gaps}`);
});

test('אין דוגמה לכלי שלא מגיע ל-respond', () => {
  // fixed ו-scale לא עוברים במנוע — דוגמה עבורם היא טוקנים על נתיב מת.
  const responsive = new Set(TOOLS.filter(t => t.mode === 'responsive').map(t => t.id));
  const dead = Object.keys(TOOL_EXEMPLARS).filter(id => !responsive.has(id));
  assert.deepEqual(dead, [], `דוגמאות לכלים לא-responsive: ${dead}`);
});

test('כל דוגמה מלאה ומנוגדת', () => {
  for (const [id, e] of Object.entries(TOOL_EXEMPLARS)) {
    // `said` הוא ציטוט של המשתמש ולגיטימי שיהיה קצר — "אני אנסה" הוא
    // בדיוק התשובה המתחמקת שהכלי הזה עוסק בה.
    assert.ok(e.said && e.said.length >= 5, `${id}.said ריק`);
    for (const k of ['bad', 'badWhy', 'good']) {
      assert.ok(e[k] && e[k].length > 20, `${id}.${k} ריק או קצר מדי`);
    }
    assert.notEqual(e.bad, e.good, `${id}: הטוב והרע זהים`);
    // ✅ חייבת להיות שאלה — זה כל ההבדל בין הוראה לגילוי מודרך
    assert.ok(e.good.includes('?'), `${id}: הדוגמה הטובה אינה שואלת`);
  }
});

test('הפרומפט מקבל את הדוגמה של הכלי הפעיל', () => {
  const t = exemplarText('coping-plan');
  assert.ok(t.includes(TOOL_EXEMPLARS['coping-plan'].good),
    'הדוגמה הספציפית לא הגיעה לפרומפט');
  const other = exemplarText('identify-triggers');
  assert.notEqual(t, other, 'כל הכלים מקבלים אותו טקסט');
});

test('בלי כלי — נופל לדוגמאות הכלליות', () => {
  assert.ok(exemplarText().length > 40);
  assert.ok(exemplarText('לא-קיים').length > 40);
});


// ---------- מה שבאמת מגיע לפרומפט ----------

/** לוכד את הפרומפטים שנשלחים, לפי תפקיד */
function spy(replies = {}) {
  const seen = [];
  const call = async (role, prompt) => {
    seen.push({ role, prompt });
    return replies[role] ?? (role === 'triage' ? 'answer' : role === 'critique' ? 'OK' : 'טקסט');
  };
  return { call, seen };
}

const ST = { iso: '2026-08-07', dayNum: 14, cleanDays: 14, gum7: 60, gumTarget: 9,
             patchDays7: 7, mood: 3, fatigue: 2, waves7: 5, slips7: 0,
             triggers: ['ערב מול הטלוויזיה'], pastAttempts: [], confidence: 6,
             homework: null, sessionsDone: [], taperStarted: true };

test('הפרומפט בפועל נושא את הדוגמה של הכלי שרץ', async () => {
  // הבדיקה הקודמת בחנה את הפונקציה, לא את אתר הקריאה — ומוטציה
  // שהחליפה `exemplarText(tool.id)` ב-`exemplarText()` עברה בשקט.
  const { call, seen } = spy();
  const tool = TOOLS.find(t => t.id === 'coping-plan');
  await runTurn({ tool, state: ST, userText: 'לא יודע מה לעשות', call });
  const respond = seen.find(x => x.role === 'respond');
  assert.ok(respond, 'לא נשלח respond');
  assert.ok(respond.prompt.includes(TOOL_EXEMPLARS['coping-plan'].good),
    'הדוגמה של הכלי לא הגיעה לפרומפט');
  assert.ok(!respond.prompt.includes(TOOL_EXEMPLARS['identify-triggers'].good),
    'הגיעה דוגמה של כלי אחר');
});

test('שלב ה-fetch מבקש מונחים באנגלית', async () => {
  const { call, seen } = spy();
  const tool = TOOLS.find(t => t.id === 'discuss-cravings');
  await runTurn({ tool, state: ST, userText: 'היה דחף', call,
                  retrieve: async () => [] });
  const f = seen.find(x => x.role === 'fetch');
  assert.ok(f, 'שלב fetch לא רץ');
  assert.match(f.prompt, /אנגלית/, 'הבקשה לא מציינת אנגלית');
  assert.ok(f.prompt.includes(tool.id), 'ה-id של הכלי לא נשלח — אין על מה לתייג');
});

test('מקורות שאוחזרו מגיעים לפרומפט עם ייחוס', async () => {
  const { call, seen } = spy();
  const tool = TOOLS.find(t => t.id === 'discuss-cravings');
  await runTurn({ tool, state: ST, userText: 'היה דחף', call,
                  retrieve: async () => [{ src: 'ספר X — פרק Y', text: 'תוכן מקצועי' }] });
  const r = seen.find(x => x.role === 'respond');
  assert.ok(r.prompt.includes('תוכן מקצועי'), 'המקור לא הגיע');
  assert.ok(r.prompt.includes('ספר X — פרק Y'), 'המקור בלי ייחוס');
});
