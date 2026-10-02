'use strict';

const express = require('express');
const { auth } = require('../../middlewares/auth');
const { validate } = require('../../middlewares/validate');
const { authLimiter } = require('../../middlewares/rateLimit');
const controller = require('./auth.controller');
const { signupSchema, loginSchema } = require('./auth.schemas');

const router = express.Router();

/**
 * @openapi
 * /auth/signup:
 *   post:
 *     tags: [Auth]
 *     summary: Create an account (role USER). Emails are case-insensitive.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name: { type: string }
 *               email: { type: string, format: email }
 *               password: { type: string, minLength: 6, maxLength: 72 }
 *     responses:
 *       201: { description: '{ user, token }' }
 *       409: { description: Email already registered }
 *       422: { description: Validation error }
 *       429: { description: Rate limited }
 */
router.post('/signup', authLimiter, validate(signupSchema), controller.signup);

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Exchange credentials for a JWT
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string }
 *     responses:
 *       200: { description: '{ user, token }' }
 *       401: { description: Invalid credentials }
 *       422: { description: Validation error }
 */
router.post('/login', authLimiter, validate(loginSchema), controller.login);

/**
 * @openapi
 * /auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Current user
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: '{ user }' }
 *       401: { description: Missing or invalid token }
 */
router.get('/me', auth, controller.me);

module.exports = router;
