# Deployment Guide for WebSocket Server

## Docker Deployment (Recommended)

### Local Testing with Docker

1. **Build the Docker image:**

   ```bash
   docker build -t kiro-ws-server .
   ```

2. **Run the container:**

   ```bash
   docker run -p 8000:8000 \
     -e NEXT_OPENAI_KEY=your_openai_key \
     -e NEXT_TWILIO_SID=your_twilio_sid \
     -e NEXT_TWILIO_AUTH_TOKEN=your_twilio_token \
     -e NEXT_VIRTUAL_NUMBER=your_virtual_number \
     -e NEXT_APP_URL=your_frontend_url \
     -e NEXT_PUBLIC_CONVEX_URL=your_convex_url \
     -e NEXT_GEMINI_API_KEY=your_gemini_key \
     kiro-ws-server
   ```

3. **Or use docker-compose:**
   ```bash
   # Create a .env file with your environment variables
   docker-compose up --build
   ```

### Render Docker Deployment

1. **Connect your GitHub repository to Render**
2. **Create a new Web Service**
3. **Configure the service:**

   - **Environment**: Docker
   - **Dockerfile Path**: `./Dockerfile` (or leave empty if Dockerfile is in root)
   - **Plan**: Starter (or higher based on your needs)

4. **Add Environment Variables** (see list below)
5. **Deploy**

## Render Deployment (Alternative)

### Build Commands

- **Build Command**: `npm run server:deploy`
- **Start Command**: `npm run server:start:prod`

### Environment Variables Required

Add these environment variables in your Render dashboard:

#### Required Variables:

1. **NEXT_OPENAI_KEY** - Your OpenAI API key for the realtime API
2. **NEXT_TWILIO_SID** - Your Twilio Account SID
3. **NEXT_TWILIO_AUTH_TOKEN** - Your Twilio Auth Token
4. **NEXT_VIRTUAL_NUMBER** - Your Twilio virtual phone number (e.g., +1234567890)
5. **NEXT_APP_URL** - The URL of your Next.js frontend (e.g., https://your-app.onrender.com)
6. **NEXT_PUBLIC_CONVEX_URL** - Your Convex deployment URL
7. **NEXT_GEMINI_API_KEY** - Your Google Gemini API key (if using Gemini features)

#### Optional Variables:

- **NEXT_BACKEND_PORT** - Port for the server (defaults to 8000)
- **NODE_ENV** - Set to "production" for production deployments

### Manual Deployment Steps

1. **Connect your GitHub repository to Render**
2. **Create a new Web Service**
3. **Configure the service:**

   - **Build Command**: `npm run server:deploy`
   - **Start Command**: `npm run server:start:prod`
   - **Environment**: Node
   - **Plan**: Starter (or higher based on your needs)

4. **Add Environment Variables** (see list above)
5. **Deploy**

### Local Testing

To test the production build locally:

```bash
# Build the server
npm run server:build:prod

# Start the production server
npm run server:start:prod
```

### Important Notes

- The server will be available at `https://your-service-name.onrender.com`
- Make sure to update your Twilio webhook URLs to point to your Render deployment
- The server handles both incoming calls (`/incoming-call`) and callback requests (`/callback`)
- WebSocket connections are supported for real-time communication with Twilio

### Troubleshooting

- If the build fails, check that all dependencies are properly installed
- Ensure all environment variables are set correctly
- Check Render logs for any runtime errors
- Verify that your Twilio credentials are correct and the virtual number is active

## Testing Stripe (US billing) locally

US tenants (`country: "US"`) check out through **Stripe** in recurring
subscription mode; Nigerian tenants continue to use Paystack. To exercise the
Stripe path end to end on your machine:

### 1. Configure test keys

Add your Stripe **test** credentials to `.env.local` (gitignored):

```
STRIPE_SECRET_KEY=sk_test_...        # dashboard.stripe.com/test/apikeys
STRIPE_WEBHOOK_SECRET=whsec_...       # printed by `stripe listen` (step 2)
```

If you use the Stripe CLI, `stripe login` provisions a temporary `sk_test_`
key (it expires ~90 days, re-run `stripe login` if you see `api_key_expired`).

### 2. Forward webhooks to the local route

```bash
stripe login
stripe listen --forward-to localhost:3000/client/api/v1/webhooks/stripe
```

Copy the `whsec_...` it prints into `STRIPE_WEBHOOK_SECRET`, then **restart
`npm run dev`** so the API routes pick up the new env.

### 3. Run a checkout

Onboard (or upgrade) a **US** business and pick a plan. You'll be redirected to
Stripe Checkout, pay with the test card `4242 4242 4242 4242` (any future
expiry / any CVC / any ZIP).

### 4. Verify the lifecycle

Watch the `stripe listen` window: each forwarded event should return `[200]`.
The subscription record transitions through:

- `checkout.session.completed` → `status: active`, `stripeSubscriptionId` /
  `stripeCustomerId` linked
- `invoice.paid` → period extended, a `paid` invoice recorded
- `invoice.payment_failed` → `status: past_due`
- `customer.subscription.deleted` → `status: cancelled`

You can simulate renewals/failures without a real charge:

```bash
stripe trigger invoice.paid
stripe trigger invoice.payment_failed
```

### Endpoints

- Checkout (provider auto-selected by tenant country): `POST /client/api/v1/billing/checkout`
- Stripe webhook: `POST /client/api/v1/webhooks/stripe`
- Paystack webhook (Nigeria): `POST /client/api/v1/webhooks/paystack`

### Production

Register a webhook endpoint in the Stripe dashboard pointing at
`https://<your-domain>/client/api/v1/webhooks/stripe`, subscribing to at least:
`checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`,
`customer.subscription.deleted`. Use the endpoint's signing secret as
`STRIPE_WEBHOOK_SECRET` and a live `sk_live_...` key as `STRIPE_SECRET_KEY`.
