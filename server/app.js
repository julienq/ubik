var port = 7700;
var port_redis = 7007;

var util = require("util");
var express = require("express");
var redis = require("redis").createClient(port_redis);
var app = express();

app.get(/^\/user\/(\w+)$/, function (req, res) {
  var user_id = req.params[0];
  res.send(util.format("User: %s", user_id));
});

app.listen(port);
console.log("HTTP server on port 7700");
