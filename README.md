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

## Project structure

A [Turborepo](https://turborepo.dev) monorepo:

```
apps/
  user-service/   gRPC server: auth + database
  llm-service/    gRPC server: Gemini via LangChain
  client/         command-line client
packages/
  proto/          shared .proto files, used by all apps
```

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

Copy `.env.example` to `.env` in both `apps/user-service` and `apps/llm-service`, then fill them in:

`apps/user-service/.env`

```
DATABASE_URL=postgres://upa:secret@localhost:5433/upa_grpc
JWT_SECRET=any-long-random-text
INTERNAL_TOKEN=another-long-random-text
LLM_SERVICE_ADDR=localhost:50052
```

`apps/llm-service/.env`

```
GOOGLE_API_KEY=your-gemini-key
INTERNAL_TOKEN=another-long-random-text
USER_SERVICE_ADDR=localhost:50051
```

`INTERNAL_TOKEN` must be the same in both files.

**3. Install and create the tables**

```bash
npm install
npm run db:setup
```

## Run

Start both services with one command:

```bash
npm run dev
```

They restart automatically when you change the code.

## Try it

In a second terminal:

```bash
npm run client
```

This opens an interactive session. Log in, then type questions:

```
guest> login
Email: aarav@example.com
Password: ***********
Logged in as Aarav Sharma.
Aarav> What did I order?
You ordered a Wireless Mouse and a Mechanical Keyboard...
```

| Command | What it does |
|---|---|
| `login` | Log in |
| `register` | Create an account |
| `me` | Show your profile and orders |
| `logout` | Log out |
| `help` | Show all commands |
| `exit` | Quit |

Anything else you type is sent to the AI as a question. Press `Ctrl+C` to stop an answer midway.

You can also run single commands:

```bash
cd apps/client
node cli.js login aarav@example.com password123
node cli.js ask "What did I order?"
node cli.js me
```

Demo users (password `password123`): `aarav@example.com`, `priya@example.com`, `rohan@example.com`
