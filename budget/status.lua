-- DreamBike budget status, read-only. Used by src/lib/server/budget.ts for
-- /api/budget and the health check. It never writes, so it can run at any time.
--
-- KEYS: 1 lifetime, 2 phase, 3 ticket, 4 global day, 5 visitor day, 6 ip day,
--       7 halt flag (string)
-- ARGV: model names whose attempt counts to report (may be empty)
--
-- Returns {"UNAVAILABLE", reason} when the lifetime hash or its stored caps are
-- missing or invalid (caps_uninitialized), or a present spent/reserved/count field
-- is not a non-negative integer (bad_total): an accounting failure, never zero spend. Otherwise
-- {"OK", halted(0|1), capProject, capDaily,
--  spent1, reserved1, ... spent6, reserved6,
--  visitorCount1, ipCount1, ... for each model in ARGV order}.
-- Missing day, visitor, or IP hashes are real zeros; every number is a decimal
-- string of an integer.
--
-- Redis command count (Upstash bills every command inside a script): 2 EXISTS
-- (lifetime, halt) + 6 HMGET (one per bucket, counts included) = 8 per call.

-- A present field must be a non-negative integer; a missing one is a real zero.
-- Returns nil for anything malformed, which becomes {"UNAVAILABLE","bad_total"}.
local function whole(v)
  if v == nil or v ~= v or v == math.huge or v < 0 or v ~= math.floor(v) then
    return nil
  end
  return v
end

-- HMGET gives false for a missing field. Missing is a real zero; malformed is nil.
local function field(raw)
  if not raw then
    return 0
  end
  return whole(tonumber(raw))
end

if redis.call("EXISTS", KEYS[1]) == 0 then
  return { "UNAVAILABLE", "lifetime_uninitialized" }
end
-- Same stored-cap validation as reserve.lua. A missing cap is not a zero.
local life = redis.call("HMGET", KEYS[1], "capProjectMicroUsd", "capDailyMicroUsd", "spent", "reserved")
local capProject = life[1] and whole(tonumber(life[1])) or nil
local capDaily = life[2] and whole(tonumber(life[2])) or nil
if capProject == nil or capDaily == nil then
  return { "UNAVAILABLE", "caps_uninitialized" }
end

local out = { "OK", "0", string.format("%d", capProject), string.format("%d", capDaily) }
if redis.call("EXISTS", KEYS[7]) == 1 then
  out[2] = "1"
end
local function push(raw)
  local v = field(raw)
  if v == nil then
    return false
  end
  out[#out + 1] = string.format("%d", v)
  return true
end
-- Spent and reserved for the six buckets; the lifetime pair came with the caps.
local rows = { life }
for i = 2, 4 do
  rows[i] = redis.call("HMGET", KEYS[i], "spent", "reserved")
end
local fields = { "spent", "reserved" }
for _, m in ipairs(ARGV) do
  fields[#fields + 1] = "count:" .. m
end
for i = 5, 6 do
  -- Visitor and IP hashes: spent, reserved and every model count in one call.
  rows[i] = redis.call("HMGET", KEYS[i], unpack(fields))
end
local pairsAt = { { 3, 4 }, { 1, 2 }, { 1, 2 }, { 1, 2 }, { 1, 2 }, { 1, 2 } }
for i = 1, 6 do
  if not (push(rows[i][pairsAt[i][1]]) and push(rows[i][pairsAt[i][2]])) then
    return { "UNAVAILABLE", "bad_total" }
  end
end
for i = 1, #ARGV do
  if not (push(rows[5][2 + i]) and push(rows[6][2 + i])) then
    return { "UNAVAILABLE", "bad_total" }
  end
end
return out
