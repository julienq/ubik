"use strict";

var port = 7000;
var port_redis = 7007;

var flexo = require("../flexo.js");
var express = require("express");
var redis = require("redis").createClient(port_redis);

function html(params, head, body) {
  if (head == null) {
    head = "";
  }
  if (!params.DOCTYPE) {
    params.DOCTYPE = "<!DOCTYPE html>";
  }
  if (!params.title) {
    params.title = "Untilted";
  }
  if (!params.charset) {
    params.charset = "UTF-8";
  }
  return params.DOCTYPE + "\n" +
    flexo.$html({ lang: params.lang },
      flexo.$head(
        flexo.$title(params.title),
        flexo.$meta({ charset: params.charset }, true),
        head),
      flexo.$body(body));
}

function check_uid(uid, next, notfound, found) {
  redis.SISMEMBER("users", uid, function (err, reply) {
    if (err) {
      next(err);
    } else if (reply === 0) {
      notfound("No user %0".fmt(uid));
    } else {
      found(uid);
    }
  });
}

// Zip results of ZRANGE with scores, returning a list of (value, score) pairs
function ziprange(range) {
  for (var i = 0, z = [], n = range.length - 1; i < n; i += 2) {
    z.push([range[i], range[i + 1]]);
  }
  return z;
}

var app = express();

app.use(express.bodyParser());
app.use("/static", express.static(__dirname + "/static"));


// Add a new user:
// curl -X PUT -d '{"first":...,"last":...}' -H "Content-type: application/json"
//   http://127.0.0.1:7000/user/<uid>
app.put("/user/:uid", function (req, res, next) {
  var m = redis.multi();
  m.SADD("users", req.params.uid);
  var key = "user:%0".fmt(req.params.uid);
  m.HSET(key, "uid", req.params.uid);
  ["first", "last", "avatar"].forEach(function (param) {
    if (req.body[param]) {
      m.HSET(key, param, req.body[param]);
    }
  });
  m.exec(function (err) {
    if (err) {
      next(err);
    } else {
      res.send(201);
    }
  });
});

// Status update
// curl -X PUT -d '{"msg":...}' -H "Content-type: application/json"
//   http://127.0.0.1:7000/user/<uid>/status
app.put("/user/:uid/status", function (req, res, next) {
  check_uid(req.params.uid, next, next, function (uid) {
    var date = req.body.date || Date.now();
    redis.INCR("counter", function (err, reply) {
      if (err) {
        next(err);
      } else {
        var id = reply.toString(36);
        redis.multi()
          .ZADD("user:%0:status".fmt(uid), date, id)
          .HSET("status:%0".fmt(id), "id", id)
          .HSET("status:%0".fmt(id), "date", date)
          .HSET("status:%0".fmt(id), "from", uid)
          .HSET("status:%0".fmt(id), "msg", req.body.msg)
        .exec(function (err) {
          if (err) {
            next(err);
          } else {
            res.send(201);
          }
        });
      }
    });
  });
});

// Follow someone
app.put("/user/:srcid/follow/:destid", function (req, res, next) {
  check_uid(req.params.srcid, next, next, function (srcid) {
    check_uid(req.params.destid, next, next, function (destid) {
      var now = Date.now();
      redis.multi()
        .ZADD("user:%0:following".fmt(srcid), now, destid)
        .ZADD("user:%0:followers".fmt(destid), now, srcid)
        .exec(function (err) {
          if (err) {
            next(err);
          } else {
            res.send(201);
          }
        });
    });
  });
});

app.get("/user/:uid", function (req, res, next) {
  redis.multi()
    .HGETALL("user:%0".fmt(req.params.uid))
    .ZRANGE("user:%0:following".fmt(req.params.uid), 0, -1)
    .ZRANGE("user:%0:followers".fmt(req.params.uid), 0, -1)
  .exec(function (err, replies) {
    if (err) {
      next(err);
    } else if (!replies[0]) {
      res.send(404);
    } else {
      var uid = replies[0].uid;
      var user = "%0 %1".fmt(replies[0].first, replies[0].last);
      var info = flexo.$div({ "class": "user-info" },
        flexo.$p(
          flexo.$span({ "class": "uid" }, uid),
          " (%0)".fmt(user)),
        flexo.$p(
          "Following: ",
          replies[1].map(function (v) {
            return flexo.$a({ href: "/user/%0".fmt(v)}, v);
          }).join(", ") || "nobody"),
        flexo.$p(
          "Followers: ",
          replies[2].map(function (v) {
            return flexo.$a({ href: "/user/%0".fmt(v)}, v);
          }).join(", ") || "none"));
      var union = ["status", 1 + replies[1].length,
          "user:%0:status".fmt(uid)];
      replies[1].forEach(function (v) {
        union.push("user:%0:status".fmt(v));
      });
      var m = redis.multi();
      m.ZUNIONSTORE.apply(m, union);
      m.ZREVRANGE("status", 0, -1).DEL("status")
      .exec(function (err, replies) {
        if (err) {
          next(err);
        } else {
          var m = redis.multi();
          replies[1].forEach(function (v) {
            m.HGETALL("status:%0".fmt(v));
          });
          m.exec(function (err, replies) {
            if (err) {
              next(err);
            } else {
              var status = flexo.$ul({ "class": "status" },
                replies.map(function (update) {
                  return flexo.$li(
                    flexo.$span({ "class": "uid" }, update.from),
                    ": ",
                    flexo.$span({ "class": "msg" }, "“%0”".fmt(update.msg)),
                    " ",
                    flexo.$span({ "class": "date" },
                      new Date(parseFloat(update.date)).toString()));
                }).join(""));
              res.send(200, html({ title: "Ubik | %0".fmt(uid) },
                  flexo.$link({ rel: "stylesheet", href: "/static/ubik.css" }),
                  flexo.$h1("UBIK") + info + status));
            }
          });
        }
      });
    }
  });
});

// Error handling
app.use(function (err, req, res, next) {
  res.send(500, err.toString());
});

app.listen(port);
console.log("HTTP server on port %0".fmt(port));
