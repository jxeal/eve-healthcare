const { app } = require('../../src/app');

// One listening server per test file. Letting supertest open and close a server per
// request flakes with "socket hang up" / "Parse Error" when ports get reused.
function getApp() {
  if (!global.__testServer) global.__testServer = app.listen(0);
  return global.__testServer;
}

module.exports = { getApp };
