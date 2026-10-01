'use strict';

const service = require('./catalog.service');

const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const list = ah(async (req, res) => {
  const result = await service.listTestsFlat(req.query);
  return res.status(200).json(result);
});

module.exports = { list };
