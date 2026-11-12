const assert = require('node:assert/strict');
const test = require('node:test');
const connection = require('../config/db');
const serviceModel = require('../models/serviceModel');

test('loads active services from the database in name order', (t) => {
  const originalQuery = connection.query;
  let actualSql;
  connection.query = (sql, callback) => {
    actualSql = sql;
    callback(null, []);
  };
  t.after(() => {
    connection.query = originalQuery;
  });

  serviceModel.getActiveServices((error, services) => {
    assert.ifError(error);
    assert.deepEqual(services, []);
  });

  assert.match(actualSql, /FROM services/);
  assert.match(actualSql, /WHERE is_active = 1/);
  assert.match(actualSql, /ORDER BY name/);
});
