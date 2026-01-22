import { Hono } from "hono";
import { createHash, randomBytes } from "crypto";
import {
  createUser,
  getUserByEmail,
  createSubscription,
  getSubscriptionByUserId,
  createAuthToken,
  getAuthTokenByHash,
  updateTokenLastUsed,
  deleteUserTokens,
  getApiKeyForUser,
  logValidation,
  isSubscriptionActive,
  getSubscriptionExpiry,
} from "../db";

const auth = new Hono();

// Simple encryption key (use proper KMS in production)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "dev-encryption-key-32bytes!!!!";

// Hash password with salt
function hashPassword(password: string): string {
  const hash = createHash("sha256");
  hash.update(password + "claude-pi-salt");
  return hash.digest("hex");
}

// Generate auth token
function generateToken(): string {
  return `claudepi_v1_${randomBytes(32).toString("hex")}`;
}

// Hash token for storage
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Decrypt API key (simple XOR for demo - use proper encryption in production)
function decryptApiKey(encrypted: string): string {
  const encryptedBuffer = Buffer.from(encrypted, "base64");
  const keyBuffer = Buffer.from(ENCRYPTION_KEY);
  const decrypted = Buffer.alloc(encryptedBuffer.length);

  for (let i = 0; i < encryptedBuffer.length; i++) {
    decrypted[i] = encryptedBuffer[i] ^ keyBuffer[i % keyBuffer.length];
  }

  return decrypted.toString();
}

/**
 * Sign up - Create new account with 14-day trial
 */
auth.post("/signup", async (c) => {
  const body = await c.req.json();
  const { email, password } = body;

  // Validate input
  if (!email || !password) {
    return c.json({ error: "Email and password are required" }, 400);
  }

  if (password.length < 8) {
    return c.json({ error: "Password must be at least 8 characters" }, 400);
  }

  // Check if email is valid format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return c.json({ error: "Invalid email format" }, 400);
  }

  // Check if user already exists
  const existingUser = getUserByEmail(email);
  if (existingUser) {
    return c.json({ error: "An account with this email already exists" }, 409);
  }

  // Create user
  const passwordHash = hashPassword(password);
  const user = createUser(email, passwordHash);

  if (!user) {
    return c.json({ error: "Failed to create account" }, 500);
  }

  // Create subscription with 14-day trial
  const subscription = createSubscription(user.id, 14);

  if (!subscription) {
    return c.json({ error: "Failed to create subscription" }, 500);
  }

  // Generate auth token
  const token = generateToken();
  const tokenHash = hashToken(token);
  createAuthToken(user.id, tokenHash, 30);

  // Get API key for user
  const apiKey = getApiKeyForUser(user.id);
  const decryptedKey = apiKey ? decryptApiKey(apiKey.key_encrypted) : null;

  return c.json({
    authToken: token,
    email: user.email,
    anthropicApiKey: decryptedKey,
    subscriptionStatus: subscription.status,
    expiresAt: getSubscriptionExpiry(subscription),
  });
});

/**
 * Login - Authenticate and return token
 */
auth.post("/login", async (c) => {
  const body = await c.req.json();
  const { email, password } = body;

  // Validate input
  if (!email || !password) {
    return c.json({ error: "Email and password are required" }, 400);
  }

  // Find user
  const user = getUserByEmail(email);
  if (!user) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  // Verify password
  const passwordHash = hashPassword(password);
  if (user.password_hash !== passwordHash) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  // Get subscription
  const subscription = getSubscriptionByUserId(user.id);
  if (!subscription) {
    return c.json({ error: "No subscription found" }, 403);
  }

  // Check if subscription is active
  if (!isSubscriptionActive(subscription)) {
    return c.json({
      error: "Subscription expired",
      subscriptionStatus: subscription.status,
    }, 403);
  }

  // Delete old tokens and generate new one
  deleteUserTokens(user.id);
  const token = generateToken();
  const tokenHash = hashToken(token);
  createAuthToken(user.id, tokenHash, 30);

  // Get API key for user
  const apiKey = getApiKeyForUser(user.id);
  const decryptedKey = apiKey ? decryptApiKey(apiKey.key_encrypted) : null;

  // Log validation
  logValidation(
    user.id,
    c.req.header("x-forwarded-for") || c.req.header("x-real-ip"),
    c.req.header("user-agent"),
    true
  );

  return c.json({
    authToken: token,
    email: user.email,
    anthropicApiKey: decryptedKey,
    subscriptionStatus: subscription.status,
    expiresAt: getSubscriptionExpiry(subscription),
  });
});

/**
 * Validate - Daily validation check, returns fresh API key
 */
auth.post("/validate", async (c) => {
  // Get token from Authorization header
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid authorization header" }, 401);
  }

  const token = authHeader.slice(7);
  const tokenHash = hashToken(token);

  // Find valid token
  const authToken = getAuthTokenByHash(tokenHash);
  if (!authToken) {
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  // Update token last used
  updateTokenLastUsed(authToken.id);

  // Get subscription
  const subscription = getSubscriptionByUserId(authToken.user_id);
  if (!subscription) {
    return c.json({ error: "No subscription found" }, 403);
  }

  // Check if subscription is active
  if (!isSubscriptionActive(subscription)) {
    return c.json({
      error: "Subscription expired",
      subscriptionStatus: subscription.status,
    }, 403);
  }

  // Get API key for user
  const apiKey = getApiKeyForUser(authToken.user_id);
  const decryptedKey = apiKey ? decryptApiKey(apiKey.key_encrypted) : null;

  // Log validation
  logValidation(
    authToken.user_id,
    c.req.header("x-forwarded-for") || c.req.header("x-real-ip"),
    c.req.header("user-agent"),
    true
  );

  return c.json({
    anthropicApiKey: decryptedKey,
    subscriptionStatus: subscription.status,
    expiresAt: getSubscriptionExpiry(subscription),
  });
});

/**
 * Logout - Invalidate all tokens for user
 */
auth.post("/logout", async (c) => {
  // Get token from Authorization header
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid authorization header" }, 401);
  }

  const token = authHeader.slice(7);
  const tokenHash = hashToken(token);

  // Find valid token
  const authToken = getAuthTokenByHash(tokenHash);
  if (!authToken) {
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  // Delete all tokens for user
  deleteUserTokens(authToken.user_id);

  return c.json({ success: true });
});

export default auth;
