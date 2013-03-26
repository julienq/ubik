"use strict";

var http = require("http");
var path = require("path");
var flexo = require("flexo");
var express = require("express");

// Parse arguments from the command line
function parse_args(argv) {
  var m;
  var args = { port: 7777, ubik: "http://127.0.0.1:7000" };
  argv.forEach(function (arg) {
    if (m = arg.match(/^-?-?port=(\d+)/i)) {
      args.port = parseInt(m[1], 10);
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
  console.log("  ubik=<url>: URL of the Ubik data server");
  console.log("");
  process.exit(0);
}

function html(params, head, body) {
  if (typeof params !== "object") {
    params = {};
  }
  if (head == null) {
    head = "";
  }
  if (!params.DOCTYPE) {
    params.DOCTYPE = "<!DOCTYPE html>";
  }
  if (!params.title) {
    params.title = "Ubik";
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

var argv = process.argv.slice(2);
var args = parse_args(argv);
if (args.help) {
  show_help.apply(null, process.argv);
}

var app = express();

app.use(express.bodyParser());
app.use(express.static(path.join(__dirname, "static")));

app.get("/", function (req, res, next) {
  res.send(200,
    html({ title: "Welcome to Ubik", lang: "en" },
      flexo.$link({ rel: "stylesheet", href: "ubik.css" }),
      flexo.$h1("Ubik") +
      flexo.$p("Welcome to Ubik!") +
      flexo.$p(
        flexo.$form({ action: "/login", method: "POST" },
          flexo.$label(
            "User name:",
            flexo.$input({ type: "text", name: "user" }))))));
});

app.post("/login", function (req, res, next) {
  http.get("%0/user/%1".fmt(args.ubik, req.body.user), function (res_) {
    if (res_.statusCode === 200) {
      var data = "";
      res_.on("data", function (chunk) {
        data += chunk.toString();
      });
      res_.on("end", function () {
        try {
          var user = JSON.parse(data);
          res.send(200,
            html({ title: "Ubik login", lang: "en" },
              flexo.$link({ rel: "stylesheet", href: "ubik.css" }),
              flexo.$h1("Ubik") +
              flexo.$p("Hello %0 %1 in %2"
                .fmt(user.first, user.last, user.location))));
        } catch(e) {
          res.send(500);
        }
      });
    } else {
      res.send(res_.statusCode);
    }
  }).on("error", function (err) {
    next(err);
  });
});

// Error handling
app.use(function (err, req, res, next) {
  res.send(500, err.toString());
});

app.listen(args.port);
console.log("HTTP server on port %0".fmt(args.port));
