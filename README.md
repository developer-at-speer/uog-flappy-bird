# Flappy Word

A Bun-powered Flappy Bird game with anonymous score persistence.

## Local development

1. Install dependencies:

```bash
bun install
```

2. Start Postgres for local development:

```bash
docker compose up -d postgres
```

3. Apply the database schema:

```bash
bun run migrate
```

4. Start the app:

```bash
bun dev
```

The app serves the game and exposes the anonymous score API on the same origin.

## Environment

Copy [.env.example](.env.example) to `.env` and adjust the database URL if needed:

```bash
cp .env.example .env
```

Expected values:

- `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres`
- `NODE_ENV=development`

## Production notes

This project is designed around a long-lived Bun server and Postgres database. Netlify static hosting is not sufficient for the backend routes or database connections. The app should be deployed to a host that supports a running Bun process, such as Fly.io, Railway, Render, or another server-based platform.

## Useful commands

```bash
bun test
bun run migrate
bun dev
bun start
```
