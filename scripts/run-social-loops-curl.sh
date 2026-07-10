#!/usr/bin/env bash
# Exercise every publicly-callable campus-social-loops Convex function over HTTP with curl.
# Dev deployment: https://neat-clam-779.convex.cloud
#
# Convex HTTP API:
#   POST /api/query    { "path": "module:fn", "args": {...}, "format": "json" }
#   POST /api/mutation { ... }
#   POST /api/action   { ... }
#
# Auth-gated functions (getCurrentUserRecord) return not_authenticated without a
# Convex Auth token; that still demonstrates the gate. Internal functions
# (persist*/getContext*/scheduled resolvers) are not exposed over HTTP by design.

set -uo pipefail

BASE="${CONVEX_URL:-https://neat-clam-779.convex.cloud}"
N=0

call() {
  local kind="$1" path="$2" args="$3" desc="$4"
  N=$((N + 1))
  echo "────────────────────────────────────────────────────────────────────"
  echo "[$N] $desc"
  echo "    $kind  $path"
  echo "    args: $args"
  echo -n "    ->  "
  curl -sS -X POST "$BASE/api/$kind" \
    -H "Content-Type: application/json" \
    -d "{\"path\":\"$path\",\"args\":$args,\"format\":\"json\"}"
  echo
}

echo "===================== CAMPUS SOCIAL LOOPS — curl smoke run ====================="
echo "Deployment: $BASE"

echo
echo "########## Gamification_Service ##########"
call query    "campus/social/gamification:getGamificationProfile" '{"userId":"curl-user-1"}' \
  "Profile before any activity (expect zeros, no badges)"
call mutation "campus/social/gamification:recordActivity" '{"userId":"curl-user-1","activityType":"battles_won","kind":"creator"}' \
  "Record a creator Qualifying_Activity (battles_won)"
call mutation "campus/social/gamification:recordActivity" '{"userId":"curl-user-1","activityType":"agents_discovered","kind":"caller"}' \
  "Record a caller Qualifying_Activity (agents_discovered)"
call query    "campus/social/gamification:getGamificationProfile" '{"userId":"curl-user-1"}' \
  "Profile after activity (expect streaks advanced)"

echo
echo "########## Battle_Service ##########"
call query    "campus/social/battles:getBattleRanking" '{"campusTag":"curl-campus"}' \
  "Per-campus Battle_Ranking (expect empty-state)"
call action   "campus/social/battles:createBattle" '{"format":"roast_battle","participantAgentIds":["A1","A2"]}' \
  "Create battle (auth-gated action)"
call mutation "campus/social/battles:castVote" '{"battleId":"BATTLE_missing","choiceAgentId":"A1"}' \
  "Cast battle vote on a missing battle"

echo
echo "########## Challenge_Service ##########"
call query    "campus/social/challenges:getChallengeLeaderboard" '{"challengeId":"CHAL_missing"}' \
  "Challenge leaderboard for a missing challenge (expect empty-state)"
call action   "campus/social/challenges:submitEntry" '{"challengeId":"CHAL_missing","agentId":"A1","responseText":"My best freshman advice: go to office hours."}' \
  "Submit challenge entry (auth-gated action)"
call mutation "campus/social/challenges:castChallengeVote" '{"challengeId":"CHAL_missing","entryId":"E1"}' \
  "Cast challenge vote (auth-gated)"

echo
echo "########## GroupChat_Service ##########"
call mutation "campus/social/groupchat:joinSession" '{"token":"bogus-token"}' \
  "Join with an invalid token (expect access_denied, nothing disclosed)"
call action   "campus/social/groupchat:startSession" '{"agentId":"A1"}' \
  "Start group session (auth-gated action)"
call action   "campus/social/groupchat:submitQuestion" '{"token":"bogus-token","body":"hello?"}' \
  "Submit group question with invalid token"
call mutation "campus/social/groupchat:closeSession" '{"sessionId":"GS_missing"}' \
  "Close group session (auth-gated)"

echo
echo "########## Quest_Service ##########"
call mutation "campus/social/quests:acceptQuest" '{"questId":"Q_missing"}' \
  "Accept quest (auth-gated)"
call mutation "campus/social/quests:completeStep" '{"questId":"Q_missing","stepId":"S1"}' \
  "Complete quest step (auth-gated)"
call query    "campus/social/quests:getQuestProgress" '{"questId":"Q_missing"}' \
  "Quest progress (auth-gated -> found:false)"

echo
echo "########## Clip_Studio ##########"
call action   "campus/social/clips:onCallComplete" '{"callId":"call_missing"}' \
  "Clip suggestion on a missing call"
# generateShareClip requires content + sharingConsent + a real uploaded
# storageId (v.id("_storage") minted by generateClipUploadUrl for an authed
# owner), so it cannot be meaningfully driven by anonymous curl; documented only.
echo "    (skipped) campus/social/clips:generateShareClip needs an authed owner + uploaded storageId"
call mutation "campus/social/clips:generateClipUploadUrl" '{"agentId":"A1"}' \
  "Generate clip upload URL (auth-gated)"
call mutation "campus/social/clips:discardClipSuggestion" '{"shareClipId":"SHARECLIP_missing"}' \
  "Discard clip suggestion (auth-gated)"

echo
echo "########## Companion_Safety ##########"
call action   "campus/social/companion:escalateSelfHarmDisclosure" '{"content":"I want to hurt myself","agentId":"A1"}' \
  "Self-harm escalation routing (expect triggered within 5s budget)"

echo "────────────────────────────────────────────────────────────────────"
echo "Done. $N calls issued."
