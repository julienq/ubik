"use strict";

// TODO: add remote -> give each remote an id (from count) for all info from
// that remote; local is 0

var flexo = require("../flexo.js");
var express = require("express");

// Parse arguments from the command line
function parse_args(argv) {
  var m;
  var args = { port: 7000, port_redis: 7007 };
  argv.forEach(function (arg) {
    if (m = arg.match(/^-?-?port=(\d+)/i)) {
      args.port = parseInt(m[1], 10);
    } else if (m = arg.match(/^-?-?redis=(\d+)/i)) {
      args.port_redis = parseInt(m[1], 10);
    } else if (arg.match(/^-?-?h(elp)?$/i)) {
      args.help = true;
    }
  });
  return args;
}

// Show help info and quit
function show_help(node, name) {
  console.log("\nUsage: %0 %1 [options]\n\nOptions:".fmt(node, name));
  console.log("  help: show this help message");
  console.log("  port=<port number>: port number for the server");
  console.log("  redis=<port number>: port number for the Redis server");
  console.log("");
  process.exit(0);
}

var argv = process.argv.slice(2);
var args = parse_args(argv);
if (args.help) {
  show_help.apply(null, process.argv);
}

var redis = require("redis").createClient(args.port_redis);

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

function error_page(res, status, body) {
  res.send(status, html({ title: "Ubik | Error %0".fmt(status) },
      flexo.$link({ rel: "stylesheet", href: "/static/ubik.css" }),
      flexo.$h1("UBIK") + body));
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
  m.SADD("remotes:users:%0".fmt(req.params.uid), "");
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

// Get status updates from the user
app.get("/user/:uid/status", function (req, res, next) {
  check_uid(req.params.uid, next, next, function (uid) {
    redis.ZRANGE("user:%0:status".fmt(uid), 0, -1, function (err, range) {
      if (err) {
        next(err)
      } else {
        var m = redis.multi();
        range.forEach(function (id) {
          m.HGETALL("status:%0".fmt(id));
        });
        m.exec(function (err, replies) {
          if (err) {
            next(err);
          } else {
            res.json(replies);
          }
        });
      }
    });
  });
});

// Follow someone: srcid starts following destid
// curl -X PUT -d '{"srcid":<srcid>,"remote":<remote>}'
//   -H "Content-type: application/json"
//   http://127.0.0.1:7000/followers/<destid>
// TODO don't do anything if srcid already follows destid
// TODO include a token from remote requests?
app.put("/user/:destid/followers", function (req, res, next) {
  if (req.body.remote) {
    // srcid is a remote user
    http.get(path.join(req.body.remote, "/user/%0/info".fmt(req.body.srcid)),
      function (response) {
        if (response.statusCode === 200) {
          var ruser = JSON.parse(response.responseText);
          ruser.remote = req.body.remote;
          // m.SADD("remotes:users:%0".fmt(req.body.srcid), remote);
        } else {
          next("Got response %0".fmt(response.statusCode));
        }
      }).on("error", next);
  } else {
    // Two local users
    check_uid(req.body.srcid, next, next, function (srcid) {
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
  }
});

app.get("/user/:uid/info", function (req, res, next) {
  redis.HGETALL("user:%0".fmt(req.params.uid), function (err, reply) {
    if (err) {
      next(err);
    } else if (!reply) {
      error_page(res, 404, flexo.$p("User %0 not found".fmt(req.params.uid)));
    } else {
      res.json(reply);
    }
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
      error_page(res, 404, flexo.$p("User %0 not found".fmt(req.params.uid)));
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
  res.send(500, err.toString())
});

app.listen(args.port);
console.log("HTTP server on port %0".fmt(args.port));
