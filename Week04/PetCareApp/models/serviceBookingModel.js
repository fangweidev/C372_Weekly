const connection = require('../config/db');

function createPendingBooking(ownerId, petId, serviceId, bookingDate, callback) {
  connection.getConnection((connectionError, transactionConnection) => {
    if (connectionError) return callback(connectionError);

    let transactionStarted = false;
    let finished = false;

    function finish(error, result) {
      if (finished) return;
      finished = true;

      try {
        transactionConnection.release();
      } catch (releaseError) {
        if (error) {
          console.error('Failed to release booking transaction connection:', releaseError);
        } else {
          error = releaseError;
        }
      }

      callback(error || null, error ? undefined : result);
    }

    function rollback(error, result) {
      if (!transactionStarted) return finish(error, result);

      transactionConnection.rollback((rollbackError) => {
        transactionStarted = false;
        if (rollbackError) {
          if (error) {
            console.error('Failed to roll back booking transaction:', rollbackError);
            return finish(error);
          }
          return finish(rollbackError);
        }
        finish(error, result);
      });
    }

    transactionConnection.beginTransaction((beginError) => {
      if (beginError) return finish(beginError);
      transactionStarted = true;

      const bookingSql = `
        INSERT INTO service_bookings
          (pet_id, service_id, booking_date, booked_price, booking_status)
        SELECT pets.id, services.id, ?, services.price, 'pending'
        FROM pets
        JOIN services ON services.id = ?
        WHERE pets.id = ?
          AND pets.owner_id = ?
          AND services.is_active = 1
      `;

      transactionConnection.query(
        bookingSql,
        [bookingDate, serviceId, petId, ownerId],
        (bookingError, bookingResult) => {
          if (bookingError) return rollback(bookingError);
          if (bookingResult.affectedRows === 0) return rollback(null, null);
          if (bookingResult.affectedRows !== 1) {
            return rollback(new Error('Expected exactly one booking to be created.'));
          }

          const paymentSql = `
            INSERT INTO payments
              (booking_id, amount, payment_status, payment_reference)
            SELECT id, booked_price, 'pending', NULL
            FROM service_bookings
            WHERE id = ?
          `;

          transactionConnection.query(
            paymentSql,
            [bookingResult.insertId],
            (paymentError, paymentResult) => {
              if (paymentError) return rollback(paymentError);
              if (paymentResult.affectedRows !== 1) {
                return rollback(new Error('Expected exactly one pending payment to be created.'));
              }

              transactionConnection.commit((commitError) => {
                if (commitError) return rollback(commitError);
                transactionStarted = false;
                finish(null, {
                  bookingId: bookingResult.insertId,
                  paymentId: paymentResult.insertId
                });
              });
            }
          );
        }
      );
    });
  });
}

function getBookingsByOwner(ownerId, callback) {
  const sql = `
    SELECT
      service_bookings.id AS booking_id,
      DATE_FORMAT(service_bookings.booking_date, '%Y-%m-%d') AS booking_date,
      pets.name AS pet_name,
      services.name AS service_name,
      service_bookings.booked_price,
      service_bookings.booking_status,
      payments.payment_status,
      payments.payment_reference,
      service_bookings.created_at
    FROM service_bookings
    JOIN pets ON pets.id = service_bookings.pet_id
    JOIN services ON services.id = service_bookings.service_id
    LEFT JOIN payments ON payments.booking_id = service_bookings.id
    WHERE pets.owner_id = ?
    ORDER BY service_bookings.created_at DESC, service_bookings.id DESC
  `;
  connection.query(sql, [ownerId], callback);
}

module.exports = { createPendingBooking, getBookingsByOwner };
