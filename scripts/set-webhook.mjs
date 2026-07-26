#!/usr/bin/env node
// ==========================================================================
//  set-webhook.mjs — רישום/בדיקה/מחיקה של ה-webhook בטלגרם
//
//  שימוש:
//    BOT_TOKEN=... WORKER_URL=https://xxx.workers.dev WEBHOOK_SECRET=... \
//      node scripts/set-webhook.mjs set
//    BOT_TOKEN=... node scripts/set-webhook.mjs info
//    BOT_TOKEN=... node scripts/set-webhook.mjs delete
//
//  אפשר גם לשים את המשתנים בקובץ .env בתיקיית הפרויקט (לא נכנס ל-git).
// ==========================================================================

import { readFileSync, existsSync } from 'node:fs';

// טעינת .env אם קיים (בלי תלויות)
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const { BOT_TOKEN, WORKER_URL, WEBHOOK_SECRET } = process.env;
const action = process.argv[2] || 'set';

if (!BOT_TOKEN) {
  console.error('❌ חסר BOT_TOKEN');
  process.exit(1);
}

const api = (method, body) =>
  fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  }).then(r => r.json());

const show = j => console.log(JSON.stringify(j, null, 2));

if (action === 'info') {
  show(await api('getWebhookInfo'));
} else if (action === 'delete') {
  show(await api('deleteWebhook', { drop_pending_updates: true }));
} else {
  if (!WORKER_URL) { console.error('❌ חסר WORKER_URL (למשל https://kobi-stop-smoking-bot.xxx.workers.dev)'); process.exit(1); }
  if (!WEBHOOK_SECRET) { console.error('❌ חסר WEBHOOK_SECRET — חייב להיות זהה ל-secret שהוגדר ב-Worker'); process.exit(1); }

  const me = await api('getMe');
  if (!me.ok) { console.error('❌ הטוקן לא תקין:'); show(me); process.exit(1); }
  console.log(`✅ הבוט: @${me.result.username}`);

  show(await api('setWebhook', {
    url: WORKER_URL.replace(/\/+$/, '') + '/',
    secret_token: WEBHOOK_SECRET,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
    max_connections: 10,
  }));

  show(await api('getWebhookInfo'));
  console.log('\n👉 עכשיו פתח את הבוט בטלגרם ושלח /start');
}
