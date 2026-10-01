'use strict';

const express = require('express');
const { auth } = require('../../middlewares/auth');
const { validate } = require('../../middlewares/validate');
const { authLimiter } = require('../../middlewares/rateLimit');
const controller = require('./auth.controller');
const { signupSchema, loginSchema } = require('./auth.schemas');

const router = express.Router();

router.post('/signup', authLimiter, validate(signupSchema), controller.signup);
router.post('/login', authLimiter, validate(loginSchema), controller.login);
router.get('/me', auth, controller.me);

module.exports = router;
module.exports.authRoutes = router;
