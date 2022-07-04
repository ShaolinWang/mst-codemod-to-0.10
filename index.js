#! /usr/bin/env node
var runCodemod = require("./lib/index.js").default
runCodemod(process.argv.slice(2), { allowJs: true })
