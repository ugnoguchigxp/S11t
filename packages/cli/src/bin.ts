#!/usr/bin/env node

import { runCli } from "./main.js";

process.exitCode = runCli(process.argv.slice(2));
