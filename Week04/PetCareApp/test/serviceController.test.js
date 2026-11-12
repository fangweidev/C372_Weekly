const assert = require('node:assert/strict');
const test = require('node:test');
const petModel = require('../models/petModel');
const serviceModel = require('../models/serviceModel');
const serviceBookingModel = require('../models/serviceBookingModel');
const serviceController = require('../controllers/serviceController');

function makeRequest(overrides) {
  const flashes = [];
  return {
    req: {
      session: { user: { id: 7 } },
      query: {},
      body: {},
      flash(type, message) {
        if (message !== undefined) flashes.push({ type, message });
        return [];
      },
      ...overrides
    },
    flashes
  };
}

function makeResponse() {
  return {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
    render(view, locals) {
      this.view = view;
      this.locals = locals;
      return this;
    },
    redirect(path) {
      this.redirectedTo = path;
      return this;
    }
  };
}

function patch(target, key, value, t) {
  const original = target[key];
  target[key] = value;
  t.after(() => {
    target[key] = original;
  });
}

test('renders only the owned pet as a valid preselection and supplies all view locals', (t) => {
  patch(petModel, 'getPetsByOwner', (ownerId, callback) => {
    assert.equal(ownerId, 7);
    callback(null, [{ id: 5, name: 'Mira', species: 'Cat' }]);
  }, t);
  patch(serviceModel, 'getActiveServices', (callback) => {
    callback(null, [{ id: 3, name: 'Basic Bath', price: '25.00' }]);
  }, t);

  const { req } = makeRequest({ query: { petId: '5' } });
  const res = makeResponse();
  serviceController.listServices(req, res);

  assert.equal(res.view, 'services');
  assert.equal(res.locals.selectedPetId, '5');
  assert.equal(res.locals.pets.length, 1);
  assert.equal(res.locals.services.length, 1);
  assert.match(res.locals.today, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(res.locals.messages, []);
  assert.deepEqual(res.locals.errors, []);
  assert.equal(res.locals.session, req.session);
});

test('rejects malformed or impossible dates without attempting a booking', (t) => {
  let bookingAttempts = 0;
  patch(serviceBookingModel, 'createPendingBooking', () => {
    bookingAttempts += 1;
  }, t);

  const { req, flashes } = makeRequest({
    body: { petId: '5', serviceId: '3', bookingDate: '2026-02-30' }
  });
  const res = makeResponse();
  serviceController.createBooking(req, res);

  assert.equal(res.redirectedTo, '/services');
  assert.equal(bookingAttempts, 0);
  assert.deepEqual(flashes, [{
    type: 'error',
    message: 'Choose a pet, service, and valid booking date.'
  }]);
});

test('rejects missing, non-positive, and past form values without attempting a booking', (t) => {
  let bookingAttempts = 0;
  patch(serviceBookingModel, 'createPendingBooking', () => {
    bookingAttempts += 1;
  }, t);

  const submissions = [
    {},
    { petId: '', serviceId: '3', bookingDate: '2999-01-01' },
    { petId: '5', serviceId: 'abc', bookingDate: '2999-01-01' },
    { petId: '0', serviceId: '3', bookingDate: '2999-01-01' },
    { petId: '-1', serviceId: '3', bookingDate: '2999-01-01' },
    { petId: '5', serviceId: '3', bookingDate: '2000-01-01' }
  ];

  for (const body of submissions) {
    const { req, flashes } = makeRequest({ body });
    const res = makeResponse();
    serviceController.createBooking(req, res);
    assert.equal(res.redirectedTo, '/services');
    assert.equal(flashes[0].message, 'Choose a pet, service, and valid booking date.');
  }

  assert.equal(bookingAttempts, 0);
});

test('accepts today, creates a booking, and flashes the no-payment success message', (t) => {
  const today = new Date();
  const bookingDate = [
    String(today.getFullYear()).padStart(4, '0'),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0')
  ].join('-');
  let call;

  patch(serviceBookingModel, 'createPendingBooking', (...args) => {
    call = args;
    args[4](null, { bookingId: 1, paymentId: 2 });
  }, t);

  const { req, flashes } = makeRequest({
    body: { petId: '5', serviceId: '3', bookingDate }
  });
  const res = makeResponse();
  serviceController.createBooking(req, res);

  assert.deepEqual(call.slice(0, 4), [7, 5, 3, bookingDate]);
  assert.equal(res.redirectedTo, '/bookings');
  assert.deepEqual(flashes, [{
    type: 'success',
    message: 'Booking created. Payment is pending; no payment has been processed.'
  }]);
});

test('accepts a future date when the model creates the booking', (t) => {
  let attemptedDate;
  patch(serviceBookingModel, 'createPendingBooking', (...args) => {
    attemptedDate = args[3];
    args[4](null, { bookingId: 1, paymentId: 2 });
  }, t);

  const { req } = makeRequest({
    body: { petId: '5', serviceId: '3', bookingDate: '2999-01-01' }
  });
  const res = makeResponse();
  serviceController.createBooking(req, res);

  assert.equal(attemptedDate, '2999-01-01');
  assert.equal(res.redirectedTo, '/bookings');
});

test('redirects with the unavailable message when the pet/service check fails', (t) => {
  patch(serviceBookingModel, 'createPendingBooking', (...args) => {
    args[4](null, null);
  }, t);

  const { req, flashes } = makeRequest({
    body: { petId: '5', serviceId: '3', bookingDate: '2999-01-01' }
  });
  const res = makeResponse();
  serviceController.createBooking(req, res);

  assert.equal(res.redirectedTo, '/services');
  assert.deepEqual(flashes, [{
    type: 'error',
    message: 'That pet or service is unavailable for booking.'
  }]);
});

test('redirects to the selected pet after a database save error', (t) => {
  const originalConsoleError = console.error;
  console.error = () => {};
  t.after(() => {
    console.error = originalConsoleError;
  });
  patch(serviceBookingModel, 'createPendingBooking', (...args) => {
    args[4](new Error('database unavailable'));
  }, t);

  const { req, flashes } = makeRequest({
    body: { petId: '5', serviceId: '3', bookingDate: '2999-01-01' }
  });
  const res = makeResponse();
  serviceController.createBooking(req, res);

  assert.equal(res.redirectedTo, '/services?petId=5');
  assert.deepEqual(flashes, [{
    type: 'error',
    message: 'Unable to create the booking. Please try again.'
  }]);
});
