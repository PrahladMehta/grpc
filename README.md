# gRPC user service + LLM service (Node, PostgreSQL, Gemini)

```
client (cli.js)
   │  gRPC  Register / Login  ──▶ JWT
   │  gRPC  Ask + "authorization: Bearer <jwt>"
   ▼
user-service :50051 ── PostgreSQL (users, orders)
   │  checks the JWT, then
   │  gRPC  LlmService.Ask(user_id, question)   + x-internal-token
   ▼
llm-service :50052 ── LangChain agent ── Gemini
   │  tool get_my_account
   │  gRPC  UserService.GetUser(user_id)        + x-internal-token
   └──────────────▶ user-service

The answer streams back the same way (server streaming): Gemini → llm-service → user-service → client.
```

- **user-service** owns users, auth and the database. `Register`/`Login` hash passwords with bcrypt and return a 1-hour JWT. `GetProfile` and `Ask` need that JWT.
- **llm-service** is internal. Its only tool reads the *authenticated* user's own account, so a user can't ask about anyone else.
- Service-to-service calls (`LlmService.Ask`, `UserService.GetUser`) need a shared `INTERNAL_TOKEN`, so clients can't call them directly.

## Setup

1. Start PostgreSQL in Docker (port 5433, so it doesn't clash with a local install):

```bash
docker run -d --name upa-postgres --restart unless-stopped \
  -e POSTGRES_USER=upa -e POSTGRES_PASSWORD=<password> -e POSTGRES_DB=upa_grpc \
  -p 127.0.0.1:5433:5432 -v upa-postgres-data:/var/lib/postgresql postgres:18-alpine
```

   and set `DATABASE_URL=postgres://upa:<password>@localhost:5433/upa_grpc` in `user-service/.env`.
2. Install and create the tables and demo users:

```bash
cd user-service && npm install && npm run db:setup   # tables + demo users
cd ../llm-service && npm install
cd ../client && npm install
```

## Run (two terminals)

```bash
cd user-service && npm start     # :50051
cd llm-service && npm start      # :50052
```

## Use

```bash
cd client
node cli.js register "Neha Gupta" neha@example.com supersecret1 29 Pune
node cli.js login aarav@example.com password123        # demo user
node cli.js me
node cli.js ask "What did I order and what is still not delivered?"
```

Demo users (password `password123`): `aarav@example.com`, `priya@example.com`, `rohan@example.com`.

## Env vars

| Service | Variable | Default |
|---|---|---|
| user-service | `DATABASE_URL`, `JWT_SECRET`, `INTERNAL_TOKEN` | required |
| user-service | `USER_SERVICE_PORT`, `LLM_SERVICE_ADDR` | 50051, localhost:50052 |
| llm-service | `GOOGLE_API_KEY`, `INTERNAL_TOKEN` | required |
| llm-service | `LLM_SERVICE_PORT`, `USER_SERVICE_ADDR`, `GEMINI_MODEL` | 50052, localhost:50051, gemini-3.8-flash (this machine's .env uses gemini-3.5-flash-lite) |
| client | `USER_SERVICE_ADDR` | localhost:50051 |
