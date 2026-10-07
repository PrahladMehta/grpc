# gRPC + LLM Demo

Users sign up, log in, and ask questions about their own account. An AI (Gemini) answers, and the answer streams back word by word.

## How it works

```
client  ──▶  user-service  ──▶  llm-service  ──▶  Gemini
                 │                   │
             PostgreSQL       reads your data from user-service
```

- **user-service** handles sign-up, login (JWT) and the database.
- **llm-service** asks Gemini and streams the answer back.
- All services talk to each other over **gRPC**.

## Requirements

- Node.js 22+
- Docker
- A Gemini API key from [aistudio.google.com](https://aistudio.google.com)

## Setup

**1. Start the database**

```bash
docker run -d --name upa-postgres -e POSTGRES_USER=upa -e POSTGRES_PASSWORD=secret -e POSTGRES_DB=upa_grpc -p 5433:5432 postgres:18-alpine
```

**2. Add your settings**

Copy `.env.example` to `.env` in both `user-service` and `llm-service`, then fill them in:

`user-service/.env`

```
DATABASE_URL=postgres://upa:secret@localhost:5433/upa_grpc
JWT_SECRET=any-long-random-text
INTERNAL_TOKEN=another-long-random-text
LLM_SERVICE_ADDR=localhost:50052
```

`llm-service/.env`

```
GOOGLE_API_KEY=your-gemini-key
INTERNAL_TOKEN=another-long-random-text
USER_SERVICE_ADDR=localhost:50051
```

`INTERNAL_TOKEN` must be the same in both files.

**3. Install and create the tables**

```bash
cd user-service && npm install && npm run db:setup
cd ../llm-service && npm install
cd ../client && npm install
```

## Run

Open two terminals:

```bash
cd user-service && npm start
```

```bash
cd llm-service && npm start
```

## Try it

```bash
cd client
node cli.js login aarav@example.com password123
node cli.js ask "What did I order?"
```

Other commands:

```bash
node cli.js register "Your Name" you@example.com yourpassword
node cli.js me
```

Demo users (password `password123`): `aarav@example.com`, `priya@example.com`, `rohan@example.com`
