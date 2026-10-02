'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./docs/swagger');
const requestLogger = require('./middlewares/requestLogger');
const { errorHandler, notFound } = require('./middlewares/errorHandler');
const authRoutes = require('./modules/auth/auth.routes');
const centresRoutes = require('./modules/centres/centres.routes');
const catalogRoutes = require('./modules/tests-catalog/catalog.routes');
const bookingsRoutes = require('./modules/bookings/bookings.routes');
const paymentsRoutes = require('./modules/payments/payments.routes');

const app = express();

// CSP disabled so the bundled Swagger UI (inline scripts/styles) renders.
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());
// The webhook signature is computed over the exact bytes received, so keep them.
app.use(express.json({ limit: '100kb', verify: (req, res, buf) => { req.rawBody = buf.toString('utf8'); } }));
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

module.exports = { app };
