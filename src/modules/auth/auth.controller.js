'use strict';

const service = require('./auth.service');

const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const signup = ah(async (req, res) => {
  const result = await service.signup(req.body);
  return res.status(201).json(result);
});

const login = ah(async (req, res) => {
  const result = await service.login(req.body);
  return res.status(200).json(result);
});

const me = ah(async (req, res) => {
  const result = await service.me(req.user.id);
  return res.status(200).json(result);
});

module.exports = { signup, login, me };
