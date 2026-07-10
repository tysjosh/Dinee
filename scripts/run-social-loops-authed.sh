#!/usr/bin/env bash
# Drive the AUTH-GATED campus-social-loops happy paths over curl using a real
# Convex Auth session token, against seeded fixtures (see devSeed.ts).
#
# Prereq: run the seed first:
#   curl .../api/mutation -d '{"path":"campus/social/devSeed:seedSocialFixtures",
#     "args":{"ownerUserId":"<authUserId>"},"format":"json"}'

set -uo pipefail
BASE="${CONVEX_URL:-https://neat-clam-779.convex.cloud}"
EMAIL="${EMAIL:-curl-tester@example.com}"
PASSWORD="${PASSWORD:-Curl-Test-Passw0rd!}"

MINE="CURLAGENT_MINE"; X="CURLAGENT_X"
CHAL="CURLCHAL_1"; ENTRY="CURLENTRY_1"; BATTLE="CURLBATTLE_1"
QUEST="CURLQUEST_1"; STEP1="CURLSTEP_1"

echo "===== Signing in to obtain a Convex Auth bearer token ====="
SIGNIN=$(curl -sS -X POST "$BASE/api/action" -H "Content-Type: application/json" \
  -d "{\"path\":\"auth:signIn\",\"args\":{\"provider\":\"password\",\"params\":{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"flow\":\"signIn\"}},\"format\":\"json\"}")
TOKEN=$(printf '%s' "$SIGNIN" | grep -o '"token":"[^"]*"' | head -1 | sed 's/"token":"//;s/"$//')
if [ -z "$TOKEN" ]; then echo "FAILED to get token: $SIGNIN"; exit 1; fi
echo "Token acquired (len ${#TOKEN})."

N=0
acall() {
  local kind="$1" path="$2" args="$3" desc="$4"
  N=$((N + 1))
  echo "────────────────────────────────────────────────────────────────────"
  echo "[$N] $desc"
  echo "    $kind  $path   args: $args"
  echo -n "    ->  "
  curl -sS -X POST "$BASE/api/$kind" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"path\":\"$path\",\"args\":$args,\"format\":\"json\"}"
  echo
}

echo
echo "########## Challenge_Service (authed) ##########"
acall query    "campus/social/challenges:getChallengeLeaderboard" "{\"challengeId\":\"$CHAL\"}" \
  "Leaderboard shows the seeded entry"
acall mutation "campus/social/challenges:castChallengeVote" "{\"challengeId\":\"$CHAL\",\"entryId\":\"$ENTRY\"}" \
  "Cast a challenge vote (expect accepted)"
acall mutation "campus/social/challenges:castChallengeVote" "{\"challengeId\":\"$CHAL\",\"entryId\":\"$ENTRY\"}" \
  "Re-vote (idempotent, latest wins)"
acall query    "campus/social/challenges:getChallengeLeaderboard" "{\"challengeId\":\"$CHAL\"}" \
  "Leaderboard reflects 1 vote"

echo
echo "########## Battle_Service (authed) ##########"
acall mutation "campus/social/battles:castVote" "{\"battleId\":\"$BATTLE\",\"choiceAgentId\":\"$X\"}" \
  "Vote in an open battle (caller is not an owner -> accepted)"
acall query    "campus/social/battles:getBattleRanking" "{\"campusTag\":\"curl-campus\"}" \
  "Battle ranking (battle still open, not yet resolved)"

echo
echo "########## Quest_Service (authed) ##########"
acall mutation "campus/social/quests:acceptQuest" "{\"questId\":\"$QUEST\"}" \
  "Accept the quest (expect progress created)"
acall query    "campus/social/quests:getQuestProgress" "{\"questId\":\"$QUEST\"}" \
  "Progress: all steps incomplete"
acall mutation "campus/social/quests:completeStep" "{\"questId\":\"$QUEST\",\"stepId\":\"$STEP1\"}" \
  "Complete step 1 (references a published agent)"
acall mutation "campus/social/quests:completeStep" "{\"questId\":\"$QUEST\",\"stepId\":\"$STEP1\"}" \
  "Re-complete step 1 (idempotent -> already_complete)"
acall query    "campus/social/quests:getQuestProgress" "{\"questId\":\"$QUEST\"}" \
  "Progress: step 1 complete, step 2 remains"

echo
echo "########## GroupChat_Service (authed) ##########"
SESS=$(curl -sS -X POST "$BASE/api/action" -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"path\":\"campus/social/groupchat:startSession\",\"args\":{\"agentId\":\"$MINE\"},\"format\":\"json\"}")
echo "────────────────────────────────────────────────────────────────────"
echo "[startSession] $SESS"
GTOKEN=$(printf '%s' "$SESS" | grep -o '"token":"[^"]*"' | head -1 | sed 's/"token":"//;s/"$//')
SESSION_ID=$(printf '%s' "$SESS" | grep -o '"sessionId":"[^"]*"' | head -1 | sed 's/"sessionId":"//;s/"$//')
acall mutation "campus/social/groupchat:joinSession" "{\"token\":\"$GTOKEN\"}" \
  "Join the session with the issued token (expect admitted)"
acall mutation "campus/social/groupchat:closeSession" "{\"sessionId\":\"$SESSION_ID\"}" \
  "Close the session (owner-gated)"
acall mutation "campus/social/groupchat:joinSession" "{\"token\":\"$GTOKEN\"}" \
  "Join after close (expect session_closed)"

echo
echo "########## Clip_Studio (authed) ##########"
acall mutation "campus/social/clips:generateClipUploadUrl" "{\"agentId\":\"$MINE\"}" \
  "Generate a clip upload URL for an owned agent"

echo "────────────────────────────────────────────────────────────────────"
echo "Done. $N authed calls issued."
