# Claude PI Subscription Server

Backend service for managing user subscriptions, authentication, and API key distribution for Claude PI.

## Setup

1. Install dependencies:
```bash
cd subscription-server
bun install
```

2. Copy and configure environment:
```bash
cp .env.example .env
# Edit .env with your Stripe keys and secrets
```

3. Initialize database:
```bash
bun run db:migrate
```

4. (Optional) Seed with test data:
```bash
bun run db:seed
```

5. Run the server:
```bash
bun run dev
```

## API Endpoints

### Authentication

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/auth/signup` | POST | Create new account (14-day trial) |
| `/v1/auth/login` | POST | Login and get auth token |
| `/v1/auth/validate` | POST | Daily validation, returns fresh Anthropic and Groq keys |
| `/v1/auth/logout` | POST | Invalidate auth tokens |

### Subscriptions

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/subscriptions/create-checkout` | POST | Create Stripe checkout session |
| `/v1/subscriptions/portal` | POST | Create Stripe billing portal session |
| `/v1/subscriptions/webhook` | POST | Stripe webhook handler |
| `/v1/subscriptions/status` | GET | Get current subscription status |

### Admin (Requires ADMIN_API_KEY)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/admin/api-keys` | GET | List all API keys |
| `/v1/admin/api-keys` | POST | Add new API key to pool |
| `/v1/admin/api-keys/:id` | PATCH | Update API key |
| `/v1/admin/api-keys/:id` | DELETE | Remove API key |
| `/v1/admin/users` | GET | List all users |
| `/v1/admin/stats` | GET | Get usage statistics |
| `/v1/admin/maintenance` | POST | Run cleanup tasks |

## Database Schema

- **users** - User accounts (email, password hash)
- **subscriptions** - Subscription status and Stripe IDs
- **auth_tokens** - Session tokens (30-day expiry)
- **api_key_pool** - Anthropic and Groq API keys for distribution
- **daily_validations** - Audit log of validation requests
- **usage_logs** - Token consumption tracking

## Stripe Integration

1. Create a product and price in Stripe Dashboard
2. Set the `STRIPE_PRICE_ID` in your environment
3. Configure webhook endpoint: `https://your-domain/v1/subscriptions/webhook`
4. Enable these webhook events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`

## Security Notes

- Change `ENCRYPTION_KEY` and `ADMIN_API_KEY` in production
- Use a proper KMS for API key encryption in production
- Store the SQLite database securely (consider PostgreSQL for production)
- Enable HTTPS in production
