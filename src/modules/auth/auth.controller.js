'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const service = require('./auth.service');

const signup = asyncHandler(async (req, res) => res.status(201).json(await service.signup(req.body)));
const login = asyncHandler(async (req, res) => res.status(200).json(await service.login(req.body)));
const me = asyncHandler(async (req, res) => res.status(200).json(await service.me(req.user.id)));

module.exports = { signup, login, me };
