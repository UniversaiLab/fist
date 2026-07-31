import * as store from './redis.js';
import * as jwt from './jwt.js';

function publicUser(user) {
  return { id: user.id, email: user.email, displayName: user.displayName };
}

async function register(c) {
  const body = await c.req.json().catch(() => ({}));
  const { email, password, displayName } = body;
  if (!email || !password || !displayName) {
    return c.json({ error: 'email, password, and displayName are required' }, 400);
  }
  if (String(password).length < 6) {
    return c.json({ error: 'password must be at least 6 characters' }, 400);
  }

  const existing = await store.getUserByEmail(email);
  if (existing) {
    return c.json({ error: 'an account with this email already exists' }, 409);
  }

  const passwordHash = await Bun.password.hash(password);
  const user = await store.createUser({ email, passwordHash, displayName });

  return c.json({ token: jwt.sign({ sub: user.id }), user: publicUser(user) }, 201);
}

async function login(c) {
  const body = await c.req.json().catch(() => ({}));
  const { email, password } = body;
  if (!email || !password) {
    return c.json({ error: 'email and password are required' }, 400);
  }

  const user = await store.getUserByEmail(email);
  if (!user || !(await Bun.password.verify(password, user.passwordHash))) {
    return c.json({ error: 'invalid email or password' }, 401);
  }

  return c.json({ token: jwt.sign({ sub: user.id }), user: publicUser(user) });
}

async function requireAuth(c, next) {
  const header = c.req.header('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return c.json({ error: 'missing bearer token' }, 401);

  try {
    const payload = jwt.verify(token);
    const user = await store.getUserById(payload.sub);
    if (!user) return c.json({ error: 'user no longer exists' }, 401);
    c.set('user', user);
    await next();
  } catch {
    return c.json({ error: 'invalid or expired token' }, 401);
  }
}

export { register, login, requireAuth, publicUser };
