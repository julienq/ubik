local uid = ARGV[1]
if redis.call("SISMEMBER", "users:0", uid) == 1 then
  local k = redis.call("INCR", "counter")
  local date = tonumber(ARGV[2])
  redis.call("ZADD", string.format("user:0:%s:status", uid), date, k)
  local key = string.format("status:0:%d", k)
  redis.call("HSET", key, "id", k)
  redis.call("HSET", key, "user", uid)
  redis.call("HSET", key, "date", date)
  redis.call("HSET", key, "body", ARGV[3])
  return k
end
