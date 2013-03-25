local uid = ARGV[1]
local fid = ARGV[2]
local date = ARGV[3]
if redis.call("SISMEMBER", "users:0", uid) == 1 then
  if redis.call("SISMEMBER", "users:0", fid) == 1 then
    redis.call("ZADD", string.format("user:0:%s:following", uid), date, fid)
    redis.call("ZADD", string.format("user:0:%s:followers", fid), date, uid)
  end
end
