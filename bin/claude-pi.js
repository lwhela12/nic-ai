#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Config paths
const CONFIG_DIR = join(homedir(), '.claude-pi');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

// Subscription server URL (configurable via env)
const SUBSCRIPTION_SERVER = process.env.CLAUDE_PI_SERVER || 'https://api.claude-pi.com';

// Grace period for offline usage (48 hours in milliseconds)
const OFFLINE_GRACE_PERIOD = 48 * 60 * 60 * 1000;

/**
 * Load local config file
 */
function loadConfig() {
  if (!existsSync(CONFIG_FILE)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Save config to file
 */
function saveConfig(config) {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Check if config is within grace period
 */
function isWithinGracePeriod(config) {
  if (!config?.lastValidated) return false;
  const lastValidated = new Date(config.lastValidated).getTime();
  const now = Date.now();
  return now - lastValidated < OFFLINE_GRACE_PERIOD;
}

/**
 * Validate subscription with remote server
 */
async function validateSubscription(authToken) {
  try {
    const response = await fetch(`${SUBSCRIPTION_SERVER}/v1/auth/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      }
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (error) {
    // Network error - will use offline grace period if available
    console.error('Could not reach subscription server:', error.message);
    return null;
  }
}

/**
 * Check if validation is needed (more than 24 hours since last validation)
 */
function needsValidation(config) {
  if (!config?.lastValidated) return true;
  const lastValidated = new Date(config.lastValidated).getTime();
  const now = Date.now();
  const twentyFourHours = 24 * 60 * 60 * 1000;
  return now - lastValidated > twentyFourHours;
}

/**
 * Display offline warning banner
 */
function displayOfflineWarning(config) {
  const lastValidated = new Date(config.lastValidated);
  const hoursAgo = Math.floor((Date.now() - lastValidated.getTime()) / (1000 * 60 * 60));
  console.log('\n⚠️  OFFLINE MODE');
  console.log(`   Last validated ${hoursAgo} hours ago.`);
  console.log('   Please reconnect to the internet to validate your subscription.\n');
}

/**
 * Main entry point
 */
async function main() {
  console.log('\n🏛️  Jason AI - Personal Injury Case Management\n');

  // Load existing config
  let config = loadConfig();

  // No config - need to authenticate
  if (!config || !config.authToken) {
    console.log('No authentication found.');
    console.log('Starting server - please log in through the browser.\n');

    // Set env to indicate auth needed
    process.env.CLAUDE_PI_AUTH_REQUIRED = 'true';
    process.env.CLAUDE_PI_CONFIG_DIR = CONFIG_DIR;

    // Start server
    await startServer();
    return;
  }

  // Check if validation is needed
  if (needsValidation(config)) {
    console.log('Validating subscription...');

    const validation = await validateSubscription(config.authToken);

    if (validation) {
      // Update config with fresh data
      config = {
        ...config,
        anthropicApiKey: validation.anthropicApiKey,
        lastValidated: new Date().toISOString(),
        subscriptionStatus: validation.subscriptionStatus,
        expiresAt: validation.expiresAt
      };
      saveConfig(config);
      console.log('✓ Subscription validated\n');
    } else {
      // Validation failed - check grace period
      if (isWithinGracePeriod(config)) {
        displayOfflineWarning(config);
      } else {
        console.error('\n❌ Subscription validation failed and grace period expired.');
        console.error('   Please check your internet connection and subscription status.\n');
        process.exit(1);
      }
    }
  } else {
    console.log('✓ Subscription valid\n');
  }

  // Set API key from config
  if (config.anthropicApiKey) {
    process.env.ANTHROPIC_API_KEY = config.anthropicApiKey;
  }

  // Set config path for server
  process.env.CLAUDE_PI_CONFIG_DIR = CONFIG_DIR;
  process.env.CLAUDE_PI_CONFIG = JSON.stringify(config);

  // Start the server
  await startServer();
}

/**
 * Start the Hono server
 */
async function startServer() {
  // Determine server path
  const serverPath = join(__dirname, '..', 'server', 'index.ts');
  const distPath = join(__dirname, '..', 'dist', 'index.js');

  // Use dist in production, source in development
  const serverModule = existsSync(distPath)
    ? distPath
    : serverPath;

  console.log(`Starting server from: ${serverModule}`);

  try {
    // Import and start the server
    const server = await import(serverModule);

    const port = server.default?.port || 3001;
    console.log(`\n🚀 Server running at http://localhost:${port}`);
    console.log('   Open this URL in your browser to use Jason AI\n');
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Run main
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
