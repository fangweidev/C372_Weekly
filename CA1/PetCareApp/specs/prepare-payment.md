# Feature: Prepare payment details

## 1. User goal
A pet owner wants to review their selected service name and total cost before committing to a payment.

## 2. Scope
- What it does: Returns service details, fixed catalogue price, currency ('sgd'), and preparation status ('READY_FOR_PAYMENT') as JSON.
- What it does NOT do: It does NOT charge money, connect to any payment gateway, modify databases, accept user-defined prices, or render EJS pages.

## 3. Request
- HTTP Method: GET
- URL: /payments/prepare/:serviceId
- Input: serviceId passed as a URL route parameter.

## 4. Service catalogue
| ID (number) | Service name (string) | Price (number) |
| :--- | :--- | :--- |
| 1 | Vaccination | 35 |
| 2 | Pet Grooming | 50 |
| 3 | Boarding | 80 |

## 5. Successful response
- HTTP Status: 200 OK
- Format: JSON (exact 5 fields)
- Body:
{
  "serviceId": 1,
  "serviceName": "Vaccination",
  "amount": 35,
  "currency": "sgd",
  "status": "READY_FOR_PAYMENT"
}
- Types: `serviceId` (number), `serviceName` (string), `amount` (number), `currency` (string, 'sgd'), `status` (string, 'READY_FOR_PAYMENT').

## 6. Unsuccessful response
- HTTP Status: 404 Not Found
- Condition: When `serviceId` does not match 1, 2, or 3 in the catalogue.
- Body:
{
  "error": "Service not found"
}

## 7. Acceptance criteria
- AC1: When GET /payments/prepare/1 is requested, return HTTP 200 with serviceName "Vaccination" and amount 35.
- AC2: When GET /payments/prepare/2 is requested, return HTTP 200 with serviceName "Pet Grooming" and amount 50.
- AC3: When GET /payments/prepare/3 is requested, return HTTP 200 with serviceName "Boarding" and amount 80.
- AC4: When GET /payments/prepare/999 is requested, return HTTP 404 with JSON {"error":"Service not found"}.
- AC5: Any successful response contains exactly the 5 agreed fields with matching data types and fixed values ('sgd', 'READY_FOR_PAYMENT').

## 8. Open questions
- Should non-numeric strings passed as `serviceId` (e.g., `/payments/prepare/abc`) return 400 Bad Request or 404 Not Found? (Defaulting to 404 for this lesson).
- How will authentication and real transaction tokens be integrated in future weeks?