import { Hono } from "hono";
import Stripe from "stripe";
import { createHash } from "crypto";
import {
  getAuthTokenByHash,
  getSubscriptionByUserId,
  getSubscriptionByStripeCustomerId,
  updateSubscription,
  getUserById,
  ensureDatabase,
} from "../db";

const subscriptions = new Hono();

// Initialize Stripe (only if key is available)
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" as any })
  : null;

// Stripe price ID for the subscription plan
const PRICE_ID = process.env.STRIPE_PRICE_ID || "price_xxx";

// Webhook secret for verifying Stripe events
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

// Hash token for lookup
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Helper to get user from auth header
async function getUserFromAuth(authHeader: string | undefined) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7);
  const tokenHash = hashToken(token);
  const authToken = await getAuthTokenByHash(tokenHash);

  if (!authToken) return null;

  return getUserById(authToken.user_id);
}

/**
 * Create Stripe checkout session for new subscription
 */
subscriptions.post("/create-checkout", async (c) => {
  await ensureDatabase();
  if (!stripe) {
    return c.json({ error: "Stripe not configured" }, 503);
  }

  // Get user from auth
  const user = await getUserFromAuth(c.req.header("Authorization"));
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Get existing subscription
  const subscription = await getSubscriptionByUserId(user.id);
  let customerId = subscription?.stripe_customer_id;

  // Create Stripe customer if doesn't exist
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: {
        userId: user.id.toString(),
      },
    });
    customerId = customer.id;

    // Update subscription with customer ID
    if (subscription) {
      await updateSubscription(user.id, { stripe_customer_id: customerId });
    }
  }

  // Create checkout session
  const body = await c.req.json().catch(() => ({}));
  const successUrl = body.successUrl || "http://localhost:3001/subscription/success";
  const cancelUrl = body.cancelUrl || "http://localhost:3001/subscription/cancel";

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [
      {
        price: PRICE_ID,
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    subscription_data: {
      metadata: {
        userId: user.id.toString(),
      },
    },
  });

  return c.json({ url: session.url });
});

/**
 * Create Stripe customer portal session for managing subscription
 */
subscriptions.post("/portal", async (c) => {
  await ensureDatabase();
  if (!stripe) {
    return c.json({ error: "Stripe not configured" }, 503);
  }

  // Get user from auth
  const user = await getUserFromAuth(c.req.header("Authorization"));
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Get subscription
  const subscription = await getSubscriptionByUserId(user.id);
  if (!subscription?.stripe_customer_id) {
    return c.json({ error: "No subscription found" }, 404);
  }

  // Create portal session
  const body = await c.req.json().catch(() => ({}));
  const returnUrl = body.returnUrl || "http://localhost:3001";

  const session = await stripe.billingPortal.sessions.create({
    customer: subscription.stripe_customer_id,
    return_url: returnUrl,
  });

  return c.json({ url: session.url });
});

/**
 * Stripe webhook handler
 */
subscriptions.post("/webhook", async (c) => {
  await ensureDatabase();
  if (!stripe) {
    return c.json({ error: "Stripe not configured" }, 503);
  }

  // Get raw body for signature verification
  const rawBody = await c.req.text();
  const signature = c.req.header("stripe-signature");

  if (!signature) {
    return c.json({ error: "Missing signature" }, 400);
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return c.json({ error: "Invalid signature" }, 400);
  }

  // Handle different event types
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const customerId = session.customer as string;

      // Find subscription by customer ID
      const sub = await getSubscriptionByStripeCustomerId(customerId);
      if (sub) {
        await updateSubscription(sub.user_id, {
          stripe_subscription_id: session.subscription as string,
          status: "active",
        });
        console.log(`Subscription activated for user ${sub.user_id}`);
      }
      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;

      const sub = await getSubscriptionByStripeCustomerId(customerId);
      if (sub) {
        const status = subscription.status as any;
        await updateSubscription(sub.user_id, {
          status: status === "active" ? "active" : status,
          current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        });
        console.log(`Subscription updated for user ${sub.user_id}: ${status}`);
      }
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;

      const sub = await getSubscriptionByStripeCustomerId(customerId);
      if (sub) {
        await updateSubscription(sub.user_id, {
          status: "canceled",
          canceled_at: new Date().toISOString(),
        });
        console.log(`Subscription canceled for user ${sub.user_id}`);
      }
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;

      const sub = await getSubscriptionByStripeCustomerId(customerId);
      if (sub) {
        await updateSubscription(sub.user_id, {
          status: "past_due",
        });
        console.log(`Payment failed for user ${sub.user_id}`);
      }
      break;
    }

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  return c.json({ received: true });
});

/**
 * Get current subscription status
 */
subscriptions.get("/status", async (c) => {
  await ensureDatabase();
  // Get user from auth
  const user = await getUserFromAuth(c.req.header("Authorization"));
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const subscription = await getSubscriptionByUserId(user.id);
  if (!subscription) {
    return c.json({ error: "No subscription found" }, 404);
  }

  return c.json({
    status: subscription.status,
    trialEndsAt: subscription.trial_ends_at,
    currentPeriodEnd: subscription.current_period_end,
    canceledAt: subscription.canceled_at,
  });
});

export default subscriptions;
