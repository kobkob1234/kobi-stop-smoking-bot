#!/usr/bin/env bash
# ==========================================================================
#  setup.sh — התקנה מקצה לקצה בפקודה אחת.
#
#  לפני ההרצה צריך פעם אחת:  npx wrangler login
#  (זה הדבר היחיד שדורש דפדפן. כל השאר קורה כאן.)
#
#  הרצה:
#     BOT_TOKEN='123:ABC...' ./setup.sh
#
#  הסקריפט אידמפוטנטי — אפשר להריץ אותו שוב בבטחה.
# ==========================================================================
set -euo pipefail
cd "$(dirname "$0")"

say()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ---------- 0 · דרישות ----------
say "בודק דרישות"
command -v node >/dev/null || die "Node.js לא מותקן. https://nodejs.org"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 18 ] || die "צריך Node 18+. יש $(node -v)"
ok "Node $(node -v)"

: "${BOT_TOKEN:=}"
if [ -z "$BOT_TOKEN" ] && [ -f .env ]; then
  BOT_TOKEN=$(grep -E '^BOT_TOKEN=' .env | head -1 | cut -d= -f2- | tr -d '"'"'" || true)
fi
[ -n "$BOT_TOKEN" ] || die "חסר BOT_TOKEN. הרץ:  BOT_TOKEN='הטוקן-שלך' ./setup.sh"

# ---------- 1 · תלויות ----------
say "מתקין תלויות"
[ -d node_modules ] || npm install --silent
ok "node_modules מוכן"

WR="npx --yes wrangler"

# ---------- 2 · אימות הטוקן של הבוט ----------
say "מאמת את הטוקן של הבוט"
BOT_USER=$(curl -fsS "https://api.telegram.org/bot${BOT_TOKEN}/getMe" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);if(!j.ok)process.exit(1);console.log(j.result.username)})') \
  || die "הטוקן לא תקין. בדוק אותו ב-BotFather."
ok "@$BOT_USER"

# ---------- 3 · התחברות ל-Cloudflare ----------
say "בודק התחברות ל-Cloudflare"
# שים לב: `wrangler whoami` מחזיר קוד יציאה 0 גם כשלא מחוברים,
# אז בודקים את הטקסט ולא את קוד היציאה.
WHO=$($WR whoami 2>&1 || true)
if printf '%s' "$WHO" | grep -qi 'not authenticated'; then
  if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
    ok "משתמש ב-CLOUDFLARE_API_TOKEN"
  else
    die "לא מחובר ל-Cloudflare — זה הצעד היחיד שדורש אותך.

     הרץ פעם אחת:   npx wrangler login
     (נפתח דפדפן, לוחצים Allow, וזה הכול)

     ואז שוב:       BOT_TOKEN='...' ./setup.sh

     חלופה בלי דפדפן: צור API Token עם הרשאת \"Edit Cloudflare Workers\"
     ב-dash.cloudflare.com/profile/api-tokens, ואז:
       export CLOUDFLARE_API_TOKEN='...' && ./setup.sh"
  fi
else
  ACCT=$(printf '%s' "$WHO" | grep -Eo '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+' | head -1)
  ok "מחובר${ACCT:+ · $ACCT}"
fi

# ---------- 4 · מאגר KV ----------
say "מכין את מאגר ה-KV"
CURRENT_ID=$(grep -A2 'kv_namespaces' wrangler.toml | grep -E '^id' | sed -E 's/.*"(.*)".*/\1/' || true)
if [ -n "$CURRENT_ID" ] && [ "$CURRENT_ID" != "REPLACE_WITH_YOUR_KV_NAMESPACE_ID" ]; then
  ok "כבר מוגדר ($CURRENT_ID)"
else
  KV_OUT=$($WR kv namespace create BOT_KV 2>&1 || true)
  KV_ID=$(printf '%s' "$KV_OUT" | grep -Eo '"?id"?[[:space:]]*[:=][[:space:]]*"[a-f0-9]{32}"' | grep -Eo '[a-f0-9]{32}' | head -1)
  if [ -z "$KV_ID" ]; then
    # אולי הוא כבר קיים — ננסה למצוא אותו ברשימה
    KV_ID=$($WR kv namespace list 2>/dev/null \
      | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s.slice(s.indexOf("[")));const h=a.find(x=>/BOT_KV/.test(x.title));if(h)console.log(h.id)}catch(e){}})' || true)
  fi
  [ -n "$KV_ID" ] || die "לא הצלחתי ליצור/למצוא מאגר KV. הפלט היה:
$KV_OUT"
  node -e '
    const fs=require("fs");const p="wrangler.toml";
    fs.writeFileSync(p, fs.readFileSync(p,"utf8").replace("REPLACE_WITH_YOUR_KV_NAMESPACE_ID", process.argv[1]));
  ' "$KV_ID"
  ok "נוצר והוגדר ($KV_ID)"
fi

# ---------- 5 · סודות ----------
say "מגדיר סודות ב-Worker"
if [ -f .webhook-secret ]; then
  HOOK_SECRET=$(cat .webhook-secret)
else
  HOOK_SECRET=$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')
  printf '%s' "$HOOK_SECRET" > .webhook-secret
fi
printf '%s' "$BOT_TOKEN"    | $WR secret put BOT_TOKEN      >/dev/null && ok "BOT_TOKEN"
printf '%s' "$HOOK_SECRET"  | $WR secret put WEBHOOK_SECRET >/dev/null && ok "WEBHOOK_SECRET"

# ---------- 6 · פריסה ----------
say "פורס ל-Cloudflare"
DEPLOY_OUT=$($WR deploy 2>&1) || die "הפריסה נכשלה:
$DEPLOY_OUT"
WORKER_URL=$(printf '%s' "$DEPLOY_OUT" | grep -Eo 'https://[a-zA-Z0-9._-]*workers\.dev' | head -1)
[ -n "$WORKER_URL" ] || die "לא מצאתי את כתובת ה-Worker בפלט:
$DEPLOY_OUT"
ok "$WORKER_URL"

# ---------- 7 · חיבור ה-webhook ----------
say "מחבר את הבוט ל-Worker"
BOT_TOKEN="$BOT_TOKEN" WORKER_URL="$WORKER_URL" WEBHOOK_SECRET="$HOOK_SECRET" \
  node scripts/set-webhook.mjs set >/dev/null
ok "webhook נרשם"

# ---------- 8 · בדיקת שפיות ----------
say "בודק שהכול חי"
sleep 2
DIAG=$(curl -fsS "${WORKER_URL}/diag?key=${HOOK_SECRET}") || die "ה-Worker לא עונה"
printf '%s\n' "$DIAG" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);
  console.log("  שעון ישראל: "+j.israelTime);
  console.log("  יום "+j.day+" מתוך 70 · מדבקה "+j.dose+" מ\"ג · "+j.cleanDays+" ימים נקיים");
  console.log("  נושאים בבסיס הידע: "+j.kbTopics+" · שיחה חופשית: "+j.ai);
  console.log("  מחובר לצ׳אט: "+(j.linked?"כן":"עדיין לא — שלח /start"));})'

# ---------- 9 · שמירת קונפיג מקומי ----------
cat > .env <<EOF
BOT_TOKEN=$BOT_TOKEN
WORKER_URL=$WORKER_URL
WEBHOOK_SECRET=$HOOK_SECRET
EOF

printf '\n\033[1;32m════════════════════════════════════════\033[0m\n'
printf '\033[1;32m  ✅ הבוט חי ורץ בענן.\033[0m\n'
printf '\033[1;32m════════════════════════════════════════\033[0m\n\n'
printf '  👉 פתח את הבוט ושלח \033[1m/start\033[0m:\n'
printf '     \033[4mhttps://t.me/%s\033[0m\n\n' "$BOT_USER"
printf '  זה מה שמלמד אותו לאן לשלוח את הבוקר והערב.\n'
printf '  מהרגע הזה הוא עובד גם כשהמחשב כבוי — הוא לא רץ כאן.\n\n'
printf '  לוגים בזמן אמת:  npx wrangler tail\n'
printf '  בדיקת מצב:       curl "%s/diag?key=$(cat .webhook-secret)"\n\n' "$WORKER_URL"
