'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const ordersRouter = require('./routes/orders');

const app = express();

const allowedOrigins = (process.env.ALLOWED_ORIGIN || '')
  .split(',')
  .map(function (origin) { return origin.trim(); })
  .filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('CORS blocked origin'));
  },
  methods: ['GET'],
  allowedHeaders: ['x-api-key', 'content-type']
}));

app.use(express.json());

app.get('/health', function (_req, res) {
  res.json({
    success: true,
    status: 'ok',
    shop: process.env.SHOPIFY_SHOP,
    api_version: process.env.SHOPIFY_API_VERSION,
    timestamp: new Date().toISOString()
  });
});

app.use('/api', ordersRouter);

app.use(function (_req, res) {
  res.status(404).json({ success: false, error: 'Not found' });
});

app.use(function (err, _req, res, _next) {
  console.error('Server error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, function () {
  console.log('iPro Order API v2 running on port ' + PORT);
});
