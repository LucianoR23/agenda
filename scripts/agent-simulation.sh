#!/usr/bin/env bash
# Reproduces Agenbot's daily flow against a running Agenda (curl + node, no other deps).
#
#   AGENT_TOKEN=... BASE_URL=http://localhost:3000 DATE=2026-10-19 scripts/agent-simulation.sh
#
# Steps: health → contract → planning context → 07:00 PUT → retry (idempotent) → read back →
# "elegí la A" → mirror a Google Calendar change → "ya fui al gym" → re-plan (proposal) → answer "Pedir ajuste"
# requests → my changes → metrics.
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
TOKEN="${AGENT_TOKEN:?set AGENT_TOKEN (pnpm agent:token prints one)}"
DATE="${DATE:-$(node -e 'console.log(new Date(Date.now()-3*3600e3).toISOString().slice(0,10))')}"
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
command -v cygpath >/dev/null && TMP="$(cygpath -m "$TMP")" && HERE="$(cygpath -m "$HERE")"
trap 'rm -rf "$TMP"' EXIT
LAURA="7h3n1p5r8s2t4v6x9z0b1d3f5g"
pass=0

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# call METHOD PATH EXPECTED_STATUSES [BODY_FILE] [EXTRA_HEADER...] → body in $TMP/body.json, status in $STATUS
call() {
  local method="$1" path="$2" expect="$3" body="${4:-}"
  shift 4 2>/dev/null || shift $#
  local args=(-sS -X "$method" "$BASE_URL$path" -H "Authorization: Bearer $TOKEN" -D "$TMP/headers.txt" -o "$TMP/body.json" -w '%{http_code}')
  [ -n "$body" ] && args+=(-H "Content-Type: application/json" --data-binary "@$body")
  for h in "$@"; do args+=(-H "$h"); done
  STATUS="$(curl "${args[@]}")"
  if [[ ",$expect," != *",$STATUS,"* ]]; then
    echo "  ✗ $method $path → $STATUS (expected $expect)"
    cat "$TMP/body.json"; echo
    exit 1
  fi
  echo "  ✓ $method $path → $STATUS"
  pass=$((pass + 1))
}

# j 'expression over d' → evaluates against the last body
j() { node -e "const d=require('$TMP/body.json'); const v=($1); console.log(typeof v==='object'?JSON.stringify(v):v)"; }
jbody() { printf '%s' "$1" > "$TMP/req.json"; echo "$TMP/req.json"; }

bold "1. Health"
call GET /api/health 200
echo "    $(j 'd.status + " · db " + d.db + " · " + d.version')"

bold "2. Contract (compact OpenAPI)"
call GET /api/openapi.json 200
echo "    $(j 'Object.keys(d.paths).length') paths · $(wc -c < "$TMP/body.json") bytes"

bold "3. Planning context for $DATE"
call GET "/api/agent/context?date=$DATE" 200
echo "    weekly gym: $(j 'd.weeklyGym') · pending habits: $(j 'd.habitsPendingToday.map(h=>h.slug).join(", ") || "-"')"
echo "    yesterday: $(j 'd.yesterday ? Math.round((d.yesterday.completion??0)*100)+"% done" : "no plan"') · skipped patterns: $(j 'd.skippedPatterns.length')"

bold "4. 07:00 load (2 options, calendar calls with leads, checklist)"
call PUT "/api/days/$DATE" 201,200,202 "$HERE/fixtures/agenbot-0700.json" "Idempotency-Key: agenbot-$DATE-0700"
echo "    result: $(j 'd.result') · status $(j 'd.day.status') · options $(j 'd.day.options.map(o=>o.label+":"+o.blocks.length).join(" ")') · tasks $(j 'd.day.tasks.length')"
FIRST="$(cat "$TMP/body.json")"

bold "5. Network retry with the same Idempotency-Key → replayed, not re-applied"
call PUT "/api/days/$DATE" 201,200,202 "$HERE/fixtures/agenbot-0700.json" "Idempotency-Key: agenbot-$DATE-0700"
grep -qi '^idempotent-replayed: true' "$TMP/headers.txt" && echo "    Idempotent-Replayed: true"
[ "$(cat "$TMP/body.json")" = "$FIRST" ] && echo "    identical response"

bold "6. Read back"
call GET "/api/days/$DATE" 200
echo "    version $(j 'd.version') · ETag $(grep -i '^etag' "$TMP/headers.txt" | tr -d '\r' | cut -d' ' -f2) · calls: $(j 'd.options[0].blocks.filter(b=>b.type==="call").map(b=>b.start+" "+b.lead.name).join(", ")')"
GYM_ID="$(j '(d.options.find(o=>o.id===d.chosenOptionId)||d.options[0]).blocks.find(b=>b.type==="gym").id')"

bold "7. Luciano por chat: \"elegí la A\""
call POST "/api/days/$DATE/choose" 200,409 "$(jbody '{"option":"A"}')"
echo "    status: $(j 'd.status || d.code')"

bold "8. Laura moved to 15:00 in Google Calendar → mirror it"
call PATCH "/api/days/$DATE/blocks/by-external/$LAURA" 200 "$(jbody '{"start":"15:00","end":"15:45"}')"
echo "    copies updated: $(j 'd.blocks.length') → $(j 'd.blocks.map(b=>b.start).join(", ")')"

bold "9. Luciano: \"ya fui al gym\""
GYM_ID="$(call GET "/api/days/$DATE" 200 >/dev/null; j '(d.options.find(o=>o.id===d.chosenOptionId)||d.options[0]).blocks.find(b=>b.type==="gym").id')"
call PATCH "/api/days/$DATE/blocks/$GYM_ID" 200,409 "$(jbody '{"status":"done"}')"
echo "    gym: $(j 'd.status || d.code')"

bold "10. Re-plan the afternoon → proposal for Luciano (day already chosen)"
call PUT "/api/days/$DATE" 202,200 "$HERE/fixtures/agenbot-replan.json" "Idempotency-Key: agenbot-$DATE-replan"
echo "    result: $(j 'd.result') · diff: $(j 'd.proposal ? d.proposal.diff.moved.map(m=>m.block.title+" "+m.from.start+"→"+m.to.start).join(", ") || "no moves" : "-"')"

bold "11. \"Pedir ajuste\": answer Luciano's pending requests (proposal + note)"
call GET "/api/adjustments?date=$DATE&status=pending" 200
IDS="$(j 'd.adjustments.map(a=>a.id)')"
if [ "$IDS" != "[]" ]; then
  node -e "const b=require('$HERE/fixtures/agenbot-replan.json'); b.adjustmentIds=$IDS; b.reason='Respondo tu pedido: muevo la lectura a las 14:00.'; require('fs').writeFileSync('$TMP/adjust.json', JSON.stringify(b))"
  call PUT "/api/days/$DATE" 202,200 "$TMP/adjust.json" "Idempotency-Key: agenbot-$DATE-adjust-$(date +%s)"
  echo "    result: $(j 'd.result') · answered: $IDS"
  for ID in $(node -e "console.log($IDS.join(' '))"); do
    call PATCH "/api/adjustments/$ID" 200 "$(jbody '{"status":"done","agentNote":"Moví la lectura a las 14:00; la propuesta te espera en Hoy."}')"
    echo "    $ID → $(j 'd.status') · proposal $(j 'd.proposal ? d.proposal.status : "-"')"
  done
else
  echo "    none pending (send one from Hoy → + → Pedido a Agenbot)"
fi

bold "12. What Luciano changed today (ChangeLog, actor=user)"
call GET "/api/changelog?from=$DATE&to=$DATE&actor=user" 200
echo "    $(j 'd.entries.length') entries: $(j 'd.entries.slice(0,5).map(e=>e.entity+"/"+e.action).join(", ") || "-"')"

bold "13. Weekly metrics"
call GET "/api/metrics?range=week&anchor=$DATE" 200
echo "    blocks done $(j 'd.blocks.done')/$(j 'd.blocks.total') · calls $(j 'd.calls.total') · gym $(j 'd.gym.total')"

bold "✓ $pass requests OK"
