"use strict";

// TODO: add remote -> give each remote an id (from count) for all info from
// that remote; local is 0

var fs = require("fs");
var path = require("path");
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

// Load a Lua script from the scripts directory and return its hash so that it
// can be called with EVALSHA.
// TODO function to run the script directly
function get_script(name, k) {
  if (get_script[name]) {
    k(undefined, get_script[name]);
  } else {
    fs.readFile(path.join("scripts", name + ".lua"), function (err, data) {
      if (err) {
        k(err);
      } else {
        redis.send_command("SCRIPT", ["LOAD", data], function (err, reply) {
          if (err) {
            k(err);
          } else {
            get_script[name] = reply;
            k(undefined, reply);
          }
        });
      }
    });
  }
}

// Run a script with the given args, then call done with the reply. next is
// required to handle errors
function run_script(name, args, next, done) {
  get_script(name, function (err, script) {
    if (err) {
      next(err);
    } else {
      args.unshift(script);
      args.push(function (err, reply) {
        if (err) {
          next(err);
        } else {
          done(reply);
        }
      });
      redis.EVALSHA.apply(redis, args);
    }
  });
}

// Zip a HGETALL reply into a regular object
function zip_hgetall(reply) {
  if (Array.isArray(reply) && reply.length % 2 === 0) {
    var h = {};
    for (var i = 0, n = reply.length; i < n; i += 2) {
      h[reply[i]] = reply[i + 1];
    }
    return h;
  }
  return reply;
}


// TODO wait for redis connection to start the server
var app = express();

app.use(express.bodyParser());

// Add a new user:
// curl -X PUT -d '{"first":...,"last":...}' -H "Content-type: application/json"
//   http://127.0.0.1:7000/user/<uid>
app.put("/user/:uid", function (req, res, next) {
  var args = [0, req.params.uid];
  for (var k in req.body) {
    args.push(k);
    args.push(req.body[k]);
  }
  run_script("add-user", args, next, function (reply) {
    res.send(201);
  });
});

// Get the public info for a user, TODO: status updates
app.get("/user/:uid", function (req, res, next) {
  run_script("user-info", [0, req.params.uid], next, function (reply) {
    res.send(hzip(reply));
  });
});

// Make a new status update
app.put("/user/:uid/status", function (req, res, next) {
  run_script("status-update", [0, req.params.uid, req.body.date || Date.now(),
    req.body.body], next, function (reply) {
      res.send(201);
    });
});

// Local user starts following another (possibly remote) user given by an id in
// the body of the request
app.put("/user/:uid/following", function (req, res, next) {
  if (req.body.remote) {
    // TODO following a remote user
    res.send(501);
  } else {
    get_script("follow-local", function (err, script) {
      if (err) {
        next(err);
      } else {
        redis.EVALSHA(script, 0, req.params.uid, req.body.fid,
          req.body.date || Date.now(), function (err, reply) {
            if (err) {
              next(err);
            } else {
              res.send(201);
            }
          });
      }
    });
  }
});

/*

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

*/

// Error handling
app.use(function (err, req, res, next) {
  res.send(500, err.toString());
});

app.listen(args.port);
console.log("HTTP server on port %0".fmt(args.port));
