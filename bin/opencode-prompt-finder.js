#!/usr/bin/env node

const { main } = require('../opencode_prompt_finder');

const code = main(process.argv.slice(2));
process.exitCode = code;
