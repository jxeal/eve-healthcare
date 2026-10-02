const { app } = require('../../src/app');

// One server per test file; supertest's per-request servers flake with "socket hang up" on port reuse.
function getApp() {
  if (!global.__testServer) global.__testServer = app.listen(0);
  return global.__testServer;
}

module.exports = { getApp };
