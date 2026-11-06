/**
 * ⚠️  MOCK USER DATABASE — DEVELOPMENT ONLY ⚠️
 *
 * Stands in for the backend's users table so you can register and then log
 * in with the new account without a server. Data lives in this browser's
 * localStorage under "orbit.mock.users".
 *
 * Passwords are never stored in plain text, even here: we keep a SHA-256
 * digest. A REAL backend must use a slow, salted algorithm such as
 * Argon2id or bcrypt — SHA-256 is only acceptable because this is a mock.
 *
 * The demo account from .env.development is seeded automatically.
 */

const STORE_KEY = 'orbit.mock.users';
const MOCK_HASH_PEPPER = 'orbit-dev-mock'; // not a secret — dev mock only

/** Usernames a real platform would typically block. */
const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'root', 'system', 'support', 'help',
  'orbit', 'official', 'security', 'moderator', 'api', 'login', 'signup',
]);

export async function hashPassword(password) {
  const bytes = new TextEncoder().encode(`${MOCK_HASH_PEPPER}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function readUsers() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeUsers(users) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(users));
  } catch {
    // Storage blocked — users simply won't persist across reloads.
  }
}

let seedPromise = null;

/** Adds the .env demo account once, if it is configured and not yet stored. */
function ensureSeeded() {
  if (!seedPromise) {
    seedPromise = (async () => {
      const env = import.meta.env;
      const email = (env.VITE_MOCK_USER_EMAIL || '').toLowerCase();
      const username = (env.VITE_MOCK_USER_USERNAME || '').toLowerCase();
      const password = env.VITE_MOCK_USER_PASSWORD;
      if (!password || (!email && !username)) return;

      const users = readUsers();
      if (users.some((u) => u.id === 'mock-demo-user')) return;

      users.push({
        id: 'mock-demo-user',
        name: env.VITE_MOCK_USER_NAME || 'KNS User',
        username,
        email,
        passwordHash: await hashPassword(password),
        createdAt: new Date().toISOString(),
      });
      writeUsers(users);
    })();
  }
  return seedPromise;
}

function toPublicUser({ passwordHash, ...user }) {
  return user; // never let the hash leave the "database"
}

export async function isUsernameTaken(username) {
  await ensureSeeded();
  const value = username.trim().toLowerCase();
  return RESERVED_USERNAMES.has(value) || readUsers().some((u) => u.username === value);
}

export async function isEmailTaken(email) {
  await ensureSeeded();
  const value = email.trim().toLowerCase();
  return readUsers().some((u) => u.email === value);
}

export async function createUser({ fullName, username, email, password }) {
  await ensureSeeded();
  const user = {
    id: `mock-${crypto.randomUUID()}`,
    name: fullName,
    username: username.toLowerCase(),
    email: email.toLowerCase(),
    passwordHash: await hashPassword(password),
    createdAt: new Date().toISOString(),
  };
  writeUsers([...readUsers(), user]);
  return toPublicUser(user);
}

/** Returns the public user when credentials match, otherwise null. */
export async function verifyCredentials(identifier, password) {
  await ensureSeeded();
  const value = identifier.trim().toLowerCase();
  const user = readUsers().find((u) => u.email === value || u.username === value);
  if (!user) return null;
  const passwordHash = await hashPassword(password);
  return passwordHash === user.passwordHash ? toPublicUser(user) : null;
}
