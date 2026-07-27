const express = require("express");
const path = require("path");

const app = express();

// Static files
app.use(express.static("public"));

// View engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "../views"));

module.exports = app;