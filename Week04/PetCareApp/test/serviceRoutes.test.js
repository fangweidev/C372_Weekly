const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const session = require('express-session');
const serviceRoutes = require('../routes/serviceRoutes');

test('redirects signed-out visitors from all booking routes to login', async (t) => {
  const app = express();
  app.use(session({
    secret: 'service-route-test',
    resave: false,
    saveUninitialized: false
  }));
  app.use(express.urlencoded({ extended: true }));
  app.use(serviceRoutes);

  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const requests = [
    ['GET', '/services'],
    ['POST', '/services/book'],
    ['GET', '/bookings']
  ];

  for (const [method, path] of requests) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      redirect: 'manual',
      headers: method === 'POST'
        ? { 'Content-Type': 'application/x-www-form-urlencoded' }
        : undefined,
      body: method === 'POST' ? 'petId=1&serviceId=1&bookingDate=2999-01-01' : undefined
    });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/login');
  }
});
