'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const service = require('./catalog.service');

const list = asyncHandler(async (req, res) => res.status(200).json(await service.listTestsFlat(req.query)));

module.exports = { list };
