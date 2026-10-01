'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./docs/swagger');
const requestLogger = require('./middlewares/requestLogger');
const { errorHandler, notFound } = require('./middlewares/errorHandler');

function pick(mod, named) {
  if (!mod) return null;
  if (typeof mod === 'function') return mod;
  if (mod[named] && typeof mod[named] === 'function') return mod[named];
  return mod;
}

const authRoutes = pick(require('./modules/auth/auth.routes'), 'authRoutes');
const centresRoutes = pick(require('./modules/centres/centres.routes'), 'centresRoutes');
const catalogRoutes = pick(require('./modules/tests-catalog/catalog.routes'), 'catalogRoutes');
const bookingsRoutes = pick(require('./modules/bookings/bookings.routes'), 'bookingsRoutes');
const paymentsRoutes = pick(require('./modules/payments/payments.routes'), 'paymentsRoutes');

const app = express();

// CSP disabled so the bundled Swagger UI (inline scripts/styles) renders.
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(requestLogger);

app.get('/health', (req, res) => res.status(200).json({ ok: true }));

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/api-docs.json', (req, res) => res.status(200).json(swaggerSpec));

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/centres', centresRoutes);
app.use('/api/v1/tests', catalogRoutes);
app.use('/api/v1/bookings', bookingsRoutes);
app.use('/api/v1/payments', paymentsRoutes);

app.use(notFound);
app.use(errorHandler);

function createApp() {
  return app;
}

module.exports = { app, createApp };
