'use strict';

const service = require('./centres.service');

const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const list = ah(async (req, res) => {
  const result = await service.listCentres(req.query);
  return res.status(200).json(result);
});

const getById = ah(async (req, res) => {
  const centre = await service.getCentreById(req.params.id);
  return res.status(200).json(centre);
});

const create = ah(async (req, res) => {
  const centre = await service.createCentre(req.body);
  return res.status(201).json(centre);
});

const listTests = ah(async (req, res) => {
  const tests = await service.listTestsByCentre(req.params.centreId);
  return res.status(200).json(tests);
});

const createTest = ah(async (req, res) => {
  const test = await service.createTest(req.params.centreId, req.body);
  return res.status(201).json(test);
});

module.exports = { list, getById, create, listTests, createTest };
