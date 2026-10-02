'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const service = require('./centres.service');

const list = asyncHandler(async (req, res) => res.status(200).json(await service.listCentres(req.query)));
const getById = asyncHandler(async (req, res) => res.status(200).json(await service.getCentreById(req.params.id)));
const create = asyncHandler(async (req, res) => res.status(201).json(await service.createCentre(req.body)));
const update = asyncHandler(async (req, res) =>
  res.status(200).json(await service.updateCentre(req.params.id, req.body)),
);
const listTests = asyncHandler(async (req, res) =>
  res.status(200).json(await service.listTestsByCentre(req.params.centreId)),
);
const createTest = asyncHandler(async (req, res) =>
  res.status(201).json(await service.createTest(req.params.centreId, req.body)),
);
const updateTest = asyncHandler(async (req, res) =>
  res.status(200).json(await service.updateTest(req.params.centreId, req.params.testId, req.body)),
);

module.exports = { list, getById, create, update, listTests, createTest, updateTest };
