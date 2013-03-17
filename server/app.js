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

var app = express();

app.use(express.bodyParser());
app.use("/static", express.static(__dirname + "/static"));

// A user is defined by:
// users = set of user ids
// user:<uid> = { first, last, avatar? }
// user:<uid>:follows = set of followed uids
// user:<uid>:followers = set of follower uids
// user:<uid>:status = sorted set of status updates (just text)
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
  m.ZADD(key + ":status", Date.now(), "I just joined Ubik. Whoa!");
  m.exec(function (err) {
    if (err) {
      next(err);
    } else {
      res.send(201);
    }
  });
});

app.put("/user/:uid/status", function (req, res, next) {
  redis.SISMEMBER("users", req.params.uid, function (err, reply) {
    if (err) {
      next(err);
    } else if (reply === 0) {
      next("No user %0".fmt(req.params.uid));
    } else {
      var date = req.body.date || Date.now();
      redis.ZADD("user:%0:status".fmt(req.params.uid), date, req.body.msg,
        function (err, reply) {
          if (err) {
            next(err);
          } else {
            res.send(201);
          }
        });
    }
  });
});

app.get("/user/:uid", function (req, res, next) {
  redis.HGETALL("user:%0".fmt(req.params.uid), function (err, reply) {
    if (err) {
      next(err);
    } else if (!reply) {
      res.send(404);
    } else {
      var user = "%0 %1".fmt(reply.first, reply.last);
      redis.ZREVRANGE("user:%0:status".fmt(req.params.uid), 0, -1, "WITHSCORES",
        function (err, reply) {
          for (var i = 0, updates = "", n = reply.length; i < n; i += 2) {
            var msg = reply[i];
            var date = new Date(parseFloat(reply[i + 1]));
            updates += flexo.$p("%0 said: “%1” (on %2)".fmt(user, msg, date));
          }
          res.send(200, html({ title: "Ubik | %0".fmt(reply.uid) },
              flexo.$link({ rel: "stylesheet", href: "/static/ubik.css" }),
              flexo.$h1("UBIK") + updates));
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
