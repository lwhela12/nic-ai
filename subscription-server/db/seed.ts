import { getDatabase, createUser, createSubscription, addApiKey } from "./index";
import { createHash, randomBytes } from "crypto";

// Simple encryption for API keys (in production, use a proper KMS)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "dev-encryption-key-32bytes!!!!";

function encryptApiKey(key: string): string {
  // Simple XOR encryption for demo - use proper encryption in production
  const keyBuffer = Buffer.from(key);
  const encKeyBuffer = Buffer.from(ENCRYPTION_KEY);
  const encrypted = Buffer.alloc(keyBuffer.length);

  for (let i = 0; i < keyBuffer.length; i++) {
    encrypted[i] = keyBuffer[i] ^ encKeyBuffer[i % encKeyBuffer.length];
  }

  return encrypted.toString("base64");
}

async function hashPassword(password: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(password + "claude-pi-salt");
  return hash.digest("hex");
}

async function seed() {
  console.log("Seeding database...\n");

  // Ensure database is initialized
  getDatabase();

  // Create test user
  const testPasswordHash = await hashPassword("testpassword123");
  const testUser = createUser("test@example.com", testPasswordHash);

  if (testUser) {
    console.log(`Created test user: ${testUser.email} (id: ${testUser.id})`);

    // Create subscription for test user
    const subscription = createSubscription(testUser.id, 14);
    if (subscription) {
      console.log(`Created trial subscription (expires: ${subscription.trial_ends_at})`);
    }
  } else {
    console.log("Test user already exists");
  }

  // Add sample API keys (these would be real Anthropic keys in production)
  const sampleKeys = [
    { key: "sk-ant-api03-sample-key-1", name: "Pool Key 1" },
    { key: "sk-ant-api03-sample-key-2", name: "Pool Key 2" },
    { key: "sk-ant-api03-sample-key-3", name: "Pool Key 3" },
  ];

  // Check if we should add real API key from env
  if (process.env.ANTHROPIC_API_KEY) {
    const encrypted = encryptApiKey(process.env.ANTHROPIC_API_KEY);
    const apiKey = addApiKey(encrypted, "Environment Key");
    if (apiKey) {
      console.log(`Added real API key from environment`);
    }
  } else {
    console.log("\nNote: Set ANTHROPIC_API_KEY env var to add a real API key to the pool");
  }

  console.log("\n✓ Seeding complete!");
  console.log("\nTest credentials:");
  console.log("  Email: test@example.com");
  console.log("  Password: testpassword123");
}

seed().catch(console.error);
