const assert = require('node:assert/strict');
const test = require('node:test');
const connection = require('../config/db');
const serviceBookingModel = require('../models/serviceBookingModel');

function installConnectionStub(connectionStub) {
  const originalGetConnection = connection.getConnection;
  connection.getConnection = connectionStub;
  return () => {
    connection.getConnection = originalGetConnection;
  };
}

function makeTransactionConnection(options) {
  const state = {
    bookingSql: '',
    bookingParams: null,
    paymentSql: '',
    paymentParams: null,
    commits: 0,
    rollbacks: 0,
    releases: 0
  };

  const transactionConnection = {
    beginTransaction(callback) {
      callback(options.beginError || null);
    },
    query(sql, params, callback) {
      if (sql.includes('INSERT INTO service_bookings')) {
        state.bookingSql = sql;
        state.bookingParams = params;
        callback(options.bookingError || null, options.bookingResult);
      } else {
        state.paymentSql = sql;
        state.paymentParams = params;
        callback(options.paymentError || null, options.paymentResult);
      }
    },
    commit(callback) {
      state.commits += 1;
      callback(options.commitError || null);
    },
    rollback(callback) {
      state.rollbacks += 1;
      callback(options.rollbackError || null);
    },
    release() {
      state.releases += 1;
    }
  };

  return { state, transactionConnection };
}

test('creates a pending booking and payment using the database booking price', async (t) => {
  const { state, transactionConnection } = makeTransactionConnection({
    bookingResult: { affectedRows: 1, insertId: 17 },
    paymentResult: { affectedRows: 1, insertId: 29 }
  });
  const restore = installConnectionStub((callback) => callback(null, transactionConnection));
  t.after(restore);

  const result = await new Promise((resolve, reject) => {
    serviceBookingModel.createPendingBooking(4, 5, 6, '2026-12-01', (error, booking) => {
      if (error) return reject(error);
      resolve(booking);
    });
  });

  assert.deepEqual(result, { bookingId: 17, paymentId: 29 });
  assert.deepEqual(state.bookingParams, ['2026-12-01', 6, 5, 4]);
  assert.match(state.bookingSql, /services\.price/);
  assert.match(state.bookingSql, /pets\.owner_id = \?/);
  assert.match(state.bookingSql, /services\.is_active = 1/);
  assert.match(state.paymentSql, /SELECT id, booked_price, 'pending', NULL/);
  assert.deepEqual(state.paymentParams, [17]);
  assert.equal(state.commits, 1);
  assert.equal(state.rollbacks, 0);
  assert.equal(state.releases, 1);
});

test('loads only the owner booking history with optional payments and stable newest-first ordering', (t) => {
  const originalQuery = connection.query;
  let actualSql;
  let actualParams;
  connection.query = (sql, params, callback) => {
    actualSql = sql;
    actualParams = params;
    callback(null, []);
  };
  t.after(() => {
    connection.query = originalQuery;
  });

  serviceBookingModel.getBookingsByOwner(4, (error, bookings) => {
    assert.ifError(error);
    assert.deepEqual(bookings, []);
  });

  assert.deepEqual(actualParams, [4]);
  assert.match(actualSql, /LEFT JOIN payments/);
  assert.match(actualSql, /WHERE pets\.owner_id = \?/);
  assert.match(actualSql, /ORDER BY service_bookings\.created_at DESC, service_bookings\.id DESC/);
  assert.match(actualSql, /DATE_FORMAT\(service_bookings\.booking_date, '%Y-%m-%d'\)/);
});

test('rolls back and returns unavailable when no owned-pet/active-service match exists', async (t) => {
  const { state, transactionConnection } = makeTransactionConnection({
    bookingResult: { affectedRows: 0, insertId: 0 }
  });
  const restore = installConnectionStub((callback) => callback(null, transactionConnection));
  t.after(restore);

  const result = await new Promise((resolve, reject) => {
    serviceBookingModel.createPendingBooking(4, 5, 6, '2026-12-01', (error, booking) => {
      if (error) return reject(error);
      resolve(booking);
    });
  });

  assert.equal(result, null);
  assert.equal(state.paymentSql, '');
  assert.equal(state.commits, 0);
  assert.equal(state.rollbacks, 1);
  assert.equal(state.releases, 1);
});

test('rolls back a booking when payment insertion fails', async (t) => {
  const paymentError = new Error('payment insert failed');
  const { state, transactionConnection } = makeTransactionConnection({
    bookingResult: { affectedRows: 1, insertId: 17 },
    paymentError
  });
  const restore = installConnectionStub((callback) => callback(null, transactionConnection));
  t.after(restore);

  const error = await new Promise((resolve) => {
    serviceBookingModel.createPendingBooking(4, 5, 6, '2026-12-01', (resultError) => {
      resolve(resultError);
    });
  });

  assert.equal(error, paymentError);
  assert.equal(state.commits, 0);
  assert.equal(state.rollbacks, 1);
  assert.equal(state.releases, 1);
});

test('rolls back when commit fails and reports the database error', async (t) => {
  const commitError = new Error('commit failed');
  const { state, transactionConnection } = makeTransactionConnection({
    bookingResult: { affectedRows: 1, insertId: 17 },
    paymentResult: { affectedRows: 1, insertId: 29 },
    commitError
  });
  const restore = installConnectionStub((callback) => callback(null, transactionConnection));
  t.after(restore);

  const error = await new Promise((resolve) => {
    serviceBookingModel.createPendingBooking(4, 5, 6, '2026-12-01', (resultError) => {
      resolve(resultError);
    });
  });

  assert.equal(error, commitError);
  assert.equal(state.commits, 1);
  assert.equal(state.rollbacks, 1);
  assert.equal(state.releases, 1);
});
