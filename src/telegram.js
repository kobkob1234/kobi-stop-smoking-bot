// ==========================================================================
//  telegram.js — עטיפה דקה סביב Bot API (בלי תלויות)
// ==========================================================================

export function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function call(env, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ ok: false, description: 'bad json' }));
  if (!json.ok) console.log(`TG ${method} failed:`, JSON.stringify(json));
  return json;
}

/**
 * שולח הודעה — ואם טלגרם דוחה את ה-HTML, שולח שוב כטקסט נקי.
 *
 * למה זה חשוב: חלק מהטקסטים נוצרים על ידי מודל, ותג לא מאוזן או תו
 * חריג גורמים לטלגרם להחזיר 400 — כלומר המשתמש לא מקבל כלום. במצב
 * דחף זה בדיוק הכשל שאסור. עדיף הודעה בלי עיצוב מאשר שתיקה.
 */
export async function send(env, chat_id, text, extra = {}) {
  const base = { chat_id, link_preview_options: { is_disabled: true }, ...extra };
  const r = await call(env, 'sendMessage', { ...base, text, parse_mode: 'HTML' });
  if (r.ok) return r;

  const desc = String(r.description || '');
  if (/parse|entity|tag|html/i.test(desc)) {
    const plain = String(text)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    console.log('נפילה לטקסט נקי אחרי שגיאת HTML:', desc.slice(0, 120));
    return call(env, 'sendMessage', { ...base, text: plain });
  }
  return r;
}

export const edit = (env, chat_id, message_id, text, extra = {}) =>
  call(env, 'editMessageText', {
    chat_id, message_id, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra,
  });

export const answer = (env, callback_query_id, text) =>
  call(env, 'answerCallbackQuery', { callback_query_id, text: text || undefined });

export const setCommands = (env, commands) =>
  call(env, 'setMyCommands', { commands, scope: { type: 'default' } });

// ---------- מקלדות ----------
export const btn = (text, data) => ({ text, callback_data: data });
export const inline = rows => ({ inline_keyboard: rows });

// is_persistent הוסר בכוונה: הוא כופה על טלגרם להציג את המקלדת הזאת
// כל הזמן במקום שדה הטקסט הרגיל, וזה מרגיש כאילו אי-אפשר לצאת מהבוט.
// בלעדיו מופיע החץ הרגיל של טלגרם לקיפול המקלדת, ואפשר לחזור לכתיבה
// חופשית או לצאת מהצ׳אט כרגיל. /מקלדת מסתיר או מחזיר אותה לגמרי.
const KB_ROWS = [
  // שלוש דרגות, כל אחת בלחיצה אחת. רק שתי התחתונות מדווחות לשותפה.
  [{ text: '🌊 יש לי דחף עכשיו' }],
  [{ text: '🧠 המחשבות מחפשות דרך לקנות' }],
  [{ text: '🆘 אני בדרך לקנות' }],
  [{ text: '🚪 יוצא מהבית' }, { text: '🍬 מסטיק' }],
  [{ text: '🩹 מדבקה' }, { text: '📊 סטטוס' }],
  [{ text: '🧰 כלים' }],
];

/**
 * שלושה מצבים למקלדת, כי לשניים הראשונים יש חסרון הופכי:
 *
 *  'open'  — is_persistent. המקלדת מוצגת תמיד במקום שדה הכתיבה, ולכן
 *            לחיצה **אחת** בלבד ברגע דחף. החסרון: אין שדה כתיבה גלוי,
 *            וזה מרגיש כאילו אי-אפשר לצאת מהבוט.
 *  'fold'  — ברירת המחדל. המקלדת מתקפלת ונפתחת בכפתור ⊞ של טלגרם,
 *            כלומר שתי לחיצות, אבל שדה הכתיבה תמיד שם.
 *  'off'   — בלי מקלדת בכלל.
 *
 *  ההכרעה בין 'open' ל-'fold' היא העדפה ולא נכונות, ולכן היא שלו.
 *  ומי שרוצה לחיצה אחת גם כשהטלפון נעול — /trigger וקיצור מערכת.
 */
export const mainKb = (mode = 'fold') => mode === 'off'
  ? { remove_keyboard: true }
  : {
      keyboard: KB_ROWS,
      resize_keyboard: true,
      is_persistent: mode === 'open',
      input_field_placeholder: 'כתוב לי מה קורה…',
    };

export const MAIN_KB = mainKb('fold');

export const KB_REMOVE = { remove_keyboard: true };
