-- DreamBike budget reservation, shared by spike/common.py and src/lib/server/budget.ts.
-- One atomic EVAL checks every cap and reserves money before any paid dispatch.
-- All amounts are integer USD microdollars. Keys share one hash tag, so they
-- live in one Redis slot.
--
-- KEYS: 1 lifetime, 2 phase, 3 ticket, 4 global day, 5 visitor day, 6 ip day
--       (hashes with fields spent, reserved, count:<model>; the lifetime hash
--       also stores capProjectMicroUsd and capDailyMicroUsd, set by
--       `spike/ledger.py set-caps`),
--       7 request marker (hash), 8 ledger (list), 9 halt flag (string)
-- ARGV: 1 requestKey, 2 fingerprint, 3 amount, 4 model, 5 route, 6 ticket,
--       7 dayET, 8 nowMs, 9 pendingUntilMs, 10 markerTtlSec, 11 aggregateTtlSec,
--       12..17 caps for KEYS 1..6, 18 visitor count limit, 19 ip count limit
--       (count limit -1 means no count limit for this bucket)
-- Caps 12 (lifetime) and 15 (global day) are clamped to the stored values:
-- the effective cap is the smaller one, so a wrong environment value can never
-- raise the project or daily limit. Visitor and IP day keys expire after
-- ARGV[10] (48 h); the other aggregates after ARGV[11].
--
-- Returns {"OK", amount} or {"DENIED", bucket} or {"DUPLICATE", state}
-- or {"UNAVAILABLE", reason}
-- (reason: invalid_amount, invalid_cap, lifetime_uninitialized, caps_uninitialized,
-- halted). invalid_cap: any ARGV cap or count limit that is missing, NaN, infinite
-- or not an integer (caps must be >= 0, count limits >= -1).

local BUCKETS = { "lifetime", "phase", "ticket", "global_day", "visitor_day", "ip_day" }

local function num(key, field)
  return tonumber(redis.call("HGET", key, field) or "0")
end

local amount = tonumber(ARGV[3])
if amount == nil or amount < 0 or amount ~= math.floor(amount) then
  return { "UNAVAILABLE", "invalid_amount" }
end

-- Every ARGV cap and count limit must be a finite integer, or nothing is reserved.
local function wholeNumber(text, minimum)
  local v = tonumber(text)
  if v == nil or v ~= v or v == math.huge or v == -math.huge or v ~= math.floor(v) or v < minimum then
    return nil
  end
  return v
end
for i = 12, 17 do
  if wholeNumber(ARGV[i], 0) == nil then
    return { "UNAVAILABLE", "invalid_cap" }
  end
end
for i = 18, 19 do
  if wholeNumber(ARGV[i], -1) == nil then
    return { "UNAVAILABLE", "invalid_cap" }
  end
end

-- A missing lifetime total is an accounting failure, never a free reset.
if redis.call("EXISTS", KEYS[1]) == 0 then
  return { "UNAVAILABLE", "lifetime_uninitialized" }
end
-- The stored caps are the ceiling for lifetime and global day. Missing or
-- malformed stored caps are an accounting failure too.
local function storedCap(field)
  local v = tonumber(redis.call("HGET", KEYS[1], field) or "")
  if v == nil or v ~= v or v == math.huge or v < 0 or v ~= math.floor(v) then
    return nil
  end
  return v
end
local storedProject = storedCap("capProjectMicroUsd")
local storedDaily = storedCap("capDailyMicroUsd")
if storedProject == nil or storedDaily == nil then
  return { "UNAVAILABLE", "caps_uninitialized" }
end
if redis.call("EXISTS", KEYS[9]) == 1 then
  return { "UNAVAILABLE", "halted" }
end

local existing = redis.call("HGET", KEYS[7], "state")
if existing then
  if redis.call("HGET", KEYS[7], "fingerprint") ~= ARGV[2] then
    return { "DUPLICATE", "conflict" }
  end
  return { "DUPLICATE", existing }
end

-- spent + outstanding reservations + this request must fit every cap.
for i = 1, 6 do
  local cap = tonumber(ARGV[11 + i])
  if cap ~= nil and i == 1 and storedProject < cap then
    cap = storedProject
  elseif cap ~= nil and i == 4 and storedDaily < cap then
    cap = storedDaily
  end
  local used = num(KEYS[i], "spent") + num(KEYS[i], "reserved")
  if cap == nil or used + amount > cap then
    return { "DENIED", BUCKETS[i] }
  end
end

local countField = "count:" .. ARGV[4]
local visitorLimit = tonumber(ARGV[18])
local ipLimit = tonumber(ARGV[19])
if visitorLimit >= 0 and num(KEYS[5], countField) + 1 > visitorLimit then
  return { "DENIED", "visitor_count" }
end
if ipLimit >= 0 and num(KEYS[6], countField) + 1 > ipLimit then
  return { "DENIED", "ip_count" }
end

for i = 1, 6 do
  redis.call("HINCRBY", KEYS[i], "reserved", amount)
end
-- Attempt counters only grow; a released 429 still counts as an attempt.
for i = 4, 6 do
  redis.call("HINCRBY", KEYS[i], countField, 1)
  -- Visitor and IP identifiers expire after 48 h; the global day aggregate stays.
  if i == 4 then
    redis.call("EXPIRE", KEYS[i], tonumber(ARGV[11]))
  else
    redis.call("EXPIRE", KEYS[i], tonumber(ARGV[10]))
  end
end

redis.call("HSET", KEYS[7],
  "state", "reserved", "requestKey", ARGV[1], "fingerprint", ARGV[2],
  "amount", amount, "charged", 0,
  "model", ARGV[4], "route", ARGV[5], "ticket", ARGV[6], "day", ARGV[7],
  "createdMs", ARGV[8], "pendingUntilMs", ARGV[9],
  "k1", KEYS[1], "k2", KEYS[2], "k3", KEYS[3], "k4", KEYS[4], "k5", KEYS[5], "k6", KEYS[6])
redis.call("EXPIRE", KEYS[7], tonumber(ARGV[10]))

redis.call("RPUSH", KEYS[8], table.concat({
  "t=" .. ARGV[8], "ev=reserve", "req=" .. ARGV[1], "route=" .. ARGV[5],
  "model=" .. ARGV[4], "ticket=" .. ARGV[6], "day=" .. ARGV[7], "amount=" .. amount
}, ";"))

return { "OK", tostring(amount) }
