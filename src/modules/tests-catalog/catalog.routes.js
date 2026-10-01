'use strict';

const express = require('express');
const { auth } = require('../../middlewares/auth');
const controller = require('./catalog.controller');

const router = express.Router();

router.get('/', controller.list);

// Placeholder to keep the owned-dir shape; flat reads stay public.
void auth;

module.exports = router;
module.exports.catalogRoutes = router;
