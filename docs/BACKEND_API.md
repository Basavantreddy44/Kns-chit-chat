# KNS Chit-Chat — Backend API contract for authentication

The frontend talks to the backend only through `src/services/*`. Set
`VITE_AUTH_MODE=api` and `VITE_API_BASE_URL` to switch from the mock to your
server. All endpoints are relative to `VITE_API_BASE_URL` and must be served
over **HTTPS** in production.

## Endpoints

### `POST /auth/register`

```json
{
  "fullName": "John Smith",
  "username": "johnsmith",
  "email": "john@example.com",
  "password": "SecurePassword123!"
}
```

| Status | Body | Meaning |
| --- | --- | --- |
| `201` | `{ "user": { "id", "name", "username", "email" } }` | Created. The user is **not** logged in; the app sends them to Login. |
| `409` | `{ "field": "username" }` or `{ "field": "email" }` | Duplicate. |
| `422` | `{ "errors": { "password": "…" } }` | Validation failed (keys: `fullName`, `username`, `email`, `password`). |
| `429` | — | Rate-limited. |
| `5xx` | — | The UI shows a generic message; nothing from the body is displayed. |

### `GET /auth/check-username?username=johnsmith`
### `GET /auth/check-email?email=john@example.com`

`200 { "available": true | false }` — used for live feedback while typing.
These are a convenience only; `/auth/register` must enforce uniqueness itself.

### `POST /auth/login`

`{ identifier, password, rememberMe }` → `200 { token, user }`.
`401` for wrong credentials (same message whether the account exists or not),
`403` locked, `429` rate-limited.

## Server-side rules (must be enforced by the backend)

1. **Re-validate every field.** Mirror `src/utils/validation.js`:
   - fullName 2–50 chars; username 3–30 of `[a-zA-Z0-9._]`, no leading/trailing
     or double periods; valid email ≤ 254 chars; password ≥ 8 chars with
     upper, lower, number and special character, no spaces.
2. **Normalise** username and email to lowercase, trim the name.
3. **Uniqueness at the database level** — unique indexes on `username` and
   `email`. Catch the duplicate-key error and return `409`; this is what
   protects against two people registering the same name at the same moment.
4. **Hash passwords** with Argon2id or bcrypt (cost ≥ 12). Never store, log or
   return the plain-text password or the hash.
5. **Never leak internals** — no stack traces, SQL or other users' data in
   error bodies.
6. **Rate-limit** `/auth/register`, `/auth/login` and both availability
   endpoints (per IP), since availability checks can be used to discover
   which emails are registered.
7. **HTTPS only** in production; set `Secure`, `HttpOnly`, `SameSite` on cookies.

## Reference implementation (Node.js + Express)

Illustrative — adapt to your stack and database.

```js
// npm install express bcrypt express-rate-limit
import express from 'express';
import bcrypt from 'bcrypt';
import rateLimit from 'express-rate-limit';
import { db } from './db.js'; // your data layer; users table has UNIQUE(username), UNIQUE(email)
import { validateRegistration } from './validation.js'; // same rules as the frontend

const router = express.Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50 });

router.get('/auth/check-username', limiter, async (req, res) => {
  const username = String(req.query.username || '').trim().toLowerCase();
  res.json({ available: !(await db.users.existsByUsername(username)) });
});

router.get('/auth/check-email', limiter, async (req, res) => {
  const email = String(req.query.email || '').trim().toLowerCase();
  res.json({ available: !(await db.users.existsByEmail(email)) });
});

router.post('/auth/register', limiter, async (req, res) => {
  const input = {
    fullName: String(req.body.fullName || '').trim().replace(/\s+/g, ' '),
    username: String(req.body.username || '').trim().toLowerCase(),
    email: String(req.body.email || '').trim().toLowerCase(),
    password: String(req.body.password || ''),
  };

  const errors = validateRegistration(input);
  if (Object.keys(errors).length) return res.status(422).json({ errors });

  try {
    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await db.users.create({
      name: input.fullName,
      username: input.username,
      email: input.email,
      passwordHash,
    });
    return res.status(201).json({
      user: { id: user.id, name: user.name, username: user.username, email: user.email },
    });
  } catch (err) {
    if (err.code === 'UNIQUE_VIOLATION') {
      // err.constraint tells you which column clashed
      return res.status(409).json({ field: err.constraint === 'users_email_key' ? 'email' : 'username' });
    }
    console.error('register failed', err.message); // log server-side only
    return res.status(500).json({ message: 'Something went wrong.' });
  }
});

export default router;
```
