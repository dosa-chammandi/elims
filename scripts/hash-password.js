#!/usr/bin/env node
/**
 * Generate a bcrypt hash for the admin password.
 * Usage:  npm run hash-password -- "your-strong-password"
 */
'use strict';

const bcrypt = require('bcryptjs');

const pw = process.argv[2];
if (!pw) {
  console.error('Usage: npm run hash-password -- "<password>"');
  process.exit(1);
}
if (pw.length < 10) {
  console.error('Password should be at least 10 characters.');
  process.exit(1);
}

const hash = bcrypt.hashSync(pw, 12);
console.log('\nADMIN_PASS_HASH=' + hash + '\n');
console.log('Copy the line above into your .env file (or your host\'s env settings).');
