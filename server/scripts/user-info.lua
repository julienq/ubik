local uid = ARGV[1]
if redis.call("SISMEMBER", "users:0", uid) == 1 then
  return redis.call("HGETALL", "user:0:" .. uid)
else
  return 404
end
