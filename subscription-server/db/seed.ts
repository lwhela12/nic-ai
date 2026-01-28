import { ensureDatabase, createUser, createSubscription, addApiKey } from "./index";
import { createHash } from "crypto";

// Simple encryption for API keys (in production, use a proper KMS)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "dev-encryption-key-32bytes!!!!";

function encryptApiKey(key: string): string {
  const keyBuffer = Buffer.from(key);
  const encKeyBuffer = Buffer.from(ENCRYPTION_KEY);
  const encrypted = Buffer.alloc(keyBuffer.length);

  for (let i = 0; i < keyBuffer.length; i++) {
    encrypted[i] = keyBuffer[i] ^ encKeyBuffer[i % encKeyBuffer.length];
  }

  return encrypted.toString("base64");
}

function hashPassword(password: string): string {
  const hash = createHash("sha256");
  hash.update(password + "claude-pi-salt");
  return hash.digest("hex");
}

async function seed() {
  console.log("Seeding database...\n");

  await ensureDatabase();

  // Create test user
  const testPasswordHash = hashPassword("testpassword123");
  const testUser = await createUser("test@example.com", testPasswordHash);

  if (testUser) {
    console.log(`Created test user: ${testUser.email} (id: ${testUser.id})`);

    // Create subscription for test user
    const subscription = await createSubscription(testUser.id, 14);
    if (subscription) {
      console.log(`Created trial subscription (expires: ${subscription.trial_ends_at})`);
    }
  } else {
    console.log("Test user already exists");
  }

  // Check if we should add real API key from env
  if (process.env.ANTHROPIC_API_KEY) {
    const encrypted = encryptApiKey(process.env.ANTHROPIC_API_KEY);
    const apiKey = await addApiKey(encrypted, "Environment Key");
    if (apiKey) {
      console.log(`Added real API key from environment`);
    }
  } else {
    console.log("\nNote: Set ANTHROPIC_API_KEY env var to add a real API key to the pool");
  }

  console.log("\nSeeding complete!");
  console.log("\nTest credentials:");
  console.log("  Email: test@example.com");
  console.log("  Password: testpassword123");
}

seed().catch(console.error);
