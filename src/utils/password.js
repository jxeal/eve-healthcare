'use strict';

const bcrypt = require('bcryptjs');

async function hash(password) {
  return bcrypt.hash(password, 10);
}

async function compare(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

module.exports = { hash, compare };
