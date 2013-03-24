local uid = ARGV[1]

redis.call("SADD", "users:0", uid)
local key = "user:0:" .. uid
redis.call("HSET", key, "uid", uid)
redis.call("HSET", key, "remote", 0)
local i = 2
while i <= #ARGV + 1 do
  redis.call("HSET", key, ARGV[i], ARGV[i + 1])
  i = i + 2
end
