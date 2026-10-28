-- DreamBike budget settlement, shared by spike/common.py and src/lib/server/budget.ts.
-- Moves one reservation to spent. Unknown outcomes keep the full reservation
-- charged. Only a definite unbilled upstream 429 may release money.
--
-- KEYS: the same 1..9 keys the reservation used (the caller reads k1..k6 from
--       the request marker first; this script verifies they match).
-- ARGV: 1 outcome ("settled" | "unknown" | "released"), 2 chargedMicroUsd
--       (used only for "settled"), 3 nowMs
--
-- Returns {"OK", outcome, charged} or {"NOOP", state} or {"ERROR", reason}.
-- A settled charge above the reservation sets the halt flag: further paid
-- calls stop until the owner reconciles the ledger.

local state = redis.call("HGET", KEYS[7], "state")
if not state then
  return { "NOOP", "missing" }
end
if state ~= "reserved" then
  return { "NOOP", state }
end

for i = 1, 6 do
  if redis.call("HGET", KEYS[7], "k" .. i) ~= KEYS[i] then
    return { "ERROR", "key_mismatch" }
  end
end

local amount = tonumber(redis.call("HGET", KEYS[7], "amount"))
local outcome = ARGV[1]
local charged

if outcome == "settled" then
  charged = tonumber(ARGV[2])
  if charged == nil or charged < 0 or charged ~= math.floor(charged) then
    return { "ERROR", "invalid_charge" }
  end
elseif outcome == "unknown" then
  charged = amount
elseif outcome == "released" then
  charged = 0
else
  return { "ERROR", "invalid_outcome" }
end

for i = 1, 6 do
  redis.call("HINCRBY", KEYS[i], "reserved", -amount)
  if charged > 0 then
    redis.call("HINCRBY", KEYS[i], "spent", charged)
  end
end

if charged > amount then
  redis.call("SET", KEYS[9], "over_reservation")
end

redis.call("HSET", KEYS[7], "state", outcome, "charged", charged, "settledMs", ARGV[3])

redis.call("RPUSH", KEYS[8], table.concat({
  "t=" .. ARGV[3], "ev=settle", "req=" .. (redis.call("HGET", KEYS[7], "requestKey") or ""),
  "route=" .. (redis.call("HGET", KEYS[7], "route") or ""),
  "outcome=" .. outcome, "amount=" .. amount, "charged=" .. charged
}, ";"))

return { "OK", outcome, tostring(charged) }
