# Supago Backend

Backend API server for the Supago Chrome Extension.

## Quick Start

### 1. Start PostgreSQL Database
```bash
cd backend
docker-compose up -d
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Setup

The backend uses environment variables for configuration:

- **Production/Development**: Uses `.env` file (not in git, create from `.env.example`)
- **Staging/Testing**: Uses `.env.example` file automatically when `NODE_ENV=staging` or `NODE_ENV=test`

#### For Production/Development:
```bash
# Copy .env.example to .env and update values
cp .env.example .env
# Edit .env with your production values
```

#### For Staging/Testing:
The `.env.example` file is automatically used when running in staging mode.

### 4. Start API Server

**Production/Development:**
```bash
npm start
# or for development with auto-reload
npm run dev
```

**Staging:**
```bash
npm run staging
# or for development with auto-reload
npm run staging:dev
```

**Testing:**
```bash
npm run test
```

### 5. Verify Setup
```bash
curl http://localhost:3000/health
```

## API Endpoints

- `GET /health` - Health check
- `POST /api/orders` - Save new order
- `GET /api/orders/:order_id` - Get order by ID
- `GET /api/orders/exists/:order_hash` - Check if order exists
- `PUT /api/orders/hash/:order_hash/status` - Update order status
- `GET /api/orders/status/:status` - Get orders by status
- `GET /api/orders` - Get all orders

## Environment Variables

The following environment variables are available (defined in `.env` or `.env.example`):

### Database Configuration
- `DB_USER` - PostgreSQL username (default: `postgres`)
- `DB_HOST` - Database host (default: `localhost`)
- `DB_NAME` - Database name (default: `supago_bot`)
- `DB_PASSWORD` - Database password (default: `postgres`)
- `DB_PORT` - Database port (default: `5434` - Docker PostgreSQL port)

### Server Configuration
- `PORT` - API server port (default: `3000`)

### GatewayHub API Keys
- `GATEWAYHUB_WINFIX_PUBLIC_KEY` - Public key for WINFIX website
- `GATEWAYHUB_WINFIX_PRIVATE_KEY` - Private key for WINFIX website
- `GATEWAYHUB_AUTOEXCHANGE_PUBLIC_KEY` - Public key for AUTOEXCHANGE website
- `GATEWAYHUB_AUTOEXCHANGE_PRIVATE_KEY` - Private key for AUTOEXCHANGE website
- `GATEWAYHUB_API_URL` - GatewayHub API endpoint URL

## Database

PostgreSQL 15 running in Docker on port 5434 (mapped from container port 5432).

**Default Credentials:**
- User: `postgres`
- Password: `postgres`
- Database: `supago_bot`
- Port: `5434` (host) → `5432` (container)

## Environment Modes

- **Production**: Uses `.env` file (create from `.env.example`)
- **Staging**: Uses `.env.example` automatically when `NODE_ENV=staging`
- **Testing**: Uses `.env.example` automatically when `NODE_ENV=test`
