# Dinee - AI Voice Agent for Restaurants

A comprehensive restaurant call management system enabling restaurant owners to manage AI-powered phone calls and orders through a web dashboard. The application bridges automated AI agents handling customer calls with restaurant staff managing orders and operations.

## Features

### Core Capabilities
- **AI-Powered Call Management**: Virtual numbers, real-time monitoring, transcription
- **Order Processing**: Automated capture, menu integration, status tracking
- **Multi-Location Support**: Branch management with intelligent order routing
- **Real-time Dashboard**: Live call monitoring, order management, analytics

### Nigeria Market Features
- **Multi-Tenancy**: Platform-level management for multiple restaurants
- **Nigerian Payments**: Paystack, Flutterwave, Cash on Delivery (COD)
- **WhatsApp Integration**: Order confirmations and status updates
- **Voice Support**: Nigerian English and Pidgin language support
- **Delivery Tracking**: Real-time rider status and delivery updates
- **Fraud Detection**: Automated blocking of suspicious activity

### Partner API
- RESTful API for third-party integrations
- Webhook subscriptions for real-time events
- API key management with rate limiting

## Tech Stack

- **Frontend**: Next.js 15, React 19, TypeScript, Tailwind CSS v4
- **Backend**: Convex (real-time database & serverless functions)
- **AI Integration**: Google Gemini API for menu data extraction
- **Voice**: OpenAI Live API, Twilio
- **Payments**: Paystack, Flutterwave
- **Messaging**: WhatsApp Business API

## Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn
- Convex account (free tier available)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd Dinee
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env.local
```

4. Configure your `.env.local` with required credentials:
```env
# Convex (auto-populated on first run)
CONVEX_DEPLOYMENT=
NEXT_PUBLIC_CONVEX_URL=

# Google Gemini API
GEMINI_API_KEY=

# Twilio (for voice calls)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=

# Payment Providers (optional)
PAYSTACK_SECRET_KEY=
FLUTTERWAVE_SECRET_KEY=
```

### Running the Application

Start both Convex backend and Next.js frontend:

**Terminal 1 - Convex backend:**
```bash
npm run convex:dev
```

**Terminal 2 - Next.js frontend:**
```bash
npm run dev
```

The app will be available at `http://localhost:3000`.

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Next.js development server |
| `npm run convex:dev` | Start Convex development server |
| `npm run build` | Build for production |
| `npm run lint` | Run ESLint |
| `npm run type-check` | Run TypeScript type checking |
| `npm run server:start:dev` | Start WebSocket server (for voice) |

## Project Structure

```
├── convex/                 # Convex backend (database schema, mutations, queries)
│   ├── schema.ts          # Database schema definitions
│   ├── orders.ts          # Order-related operations
│   ├── calls.ts           # Call management
│   ├── restaurants.ts     # Restaurant operations
│   └── ...
├── src/
│   ├── app/               # Next.js App Router
│   │   ├── client/        # Client-side routes and API
│   │   └── ws-server/     # WebSocket server for voice
│   ├── components/        # React components
│   │   ├── dashboard/     # Dashboard feature components
│   │   ├── onboarding/    # Onboarding flow components
│   │   └── ui/            # Reusable UI components
│   ├── contexts/          # React Context providers
│   ├── hooks/             # Custom React hooks
│   └── lib/               # Utility libraries and services
│       ├── analytics/     # Analytics and metrics
│       ├── billing/       # Subscription management
│       ├── delivery/      # Delivery tracking
│       ├── fraud/         # Fraud detection
│       ├── messaging/     # WhatsApp/SMS messaging
│       ├── monitoring/    # System monitoring
│       ├── partner-api/   # Partner API services
│       ├── payment/       # Payment providers
│       ├── routing/       # Order routing
│       └── voice/         # Voice service providers
└── .kiro/                 # Kiro IDE configuration
    └── specs/             # Feature specifications
```

## Architecture

### Data Flow
1. **Incoming Calls**: Twilio → WebSocket Server → OpenAI Live API → Convex
2. **Orders**: AI Agent → Convex → Real-time Dashboard
3. **Payments**: Customer → Paystack/Flutterwave → Webhook → Convex
4. **Notifications**: Order Events → WhatsApp/SMS → Customer

### Multi-Tenancy Model
- **Platform**: Top-level organization managing multiple restaurants
- **Restaurant**: Business entity with settings and menu
- **Branch**: Physical location with operating hours and capacity

## Development

### Code Style
- TypeScript strict mode enabled
- ESLint for code quality
- Tailwind CSS v4 with CSS-first configuration
- Component-based architecture with custom hooks

### Adding New Features
1. Define schema changes in `convex/schema.ts`
2. Create mutations/queries in `convex/`
3. Build UI components in `src/components/`
4. Add service logic in `src/lib/`

## Deployment

### Convex Backend
```bash
npx convex deploy
```

### Next.js Frontend
Deploy to Vercel, Render, or any Node.js hosting platform.

See `DEPLOYMENT.md` for detailed deployment instructions.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Acknowledgments

- Built with [Kiro IDE](https://kiro.dev)
- Powered by [Convex](https://convex.dev)
- Voice AI by [OpenAI](https://openai.com)
