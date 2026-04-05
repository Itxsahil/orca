# Orca

Deploy applications to your own VPS with Docker, Traefik, and Redis.

## Overview

Orca is a CLI tool that provides a Heroku/Vercel-like deployment experience for your own VPS servers. It automates:

- Docker container builds and deployments
- Traefik reverse proxy with automatic SSL
- Zero-downtime deployments
- Deployment history tracking with Redis
- Rollback capabilities

## Installation

```bash
npm install
npm run build
npm link  # Makes 'orca' command available globally
```

## Quick Start

### 1. Initialize a Project

```bash
cd your-project
orca init
```

This creates an `orca.yml` configuration file.

### 2. Configure Your Server

Edit `orca.yml`:

```yaml
server:
  host: 1.2.3.4
  user: deploy
  ssh_key: ~/.ssh/id_rsa
  port: 22

git:
  repository: git@github.com:your-org/your-repo.git
  branch: main

app:
  name: myapp
  domain: myapp.com
  port: 3000
```

### 3. Deploy

```bash
orca deploy
```

## Commands

| Command         | Description                            |
| --------------- | -------------------------------------- |
| `orca init`     | Initialize a new Orca project          |
| `orca deploy`   | Deploy the application                 |
| `orca logs`     | View application logs                  |
| `orca rollback` | Rollback to previous deployment        |
| `orca doctor`   | Run preflight checks before deployment |

## `orca.yml` Configuration

```yaml
server:
  host: 1.2.3.4
  user: deploy
  ssh_key: ~/.ssh/id_rsa
  port: 22

git:
  repository: git@github.com:your-org/your-repo.git
  branch: main

app:
  name: myapp
  domain: myapp.com
  port: 3000
  network: traefik
  restart: unless-stopped
  health_check_path: /
  envs:
    NODE_ENV: production
```

### Notes

- `git.repository` and `git.branch` are required for fresh VPS deploys (Orca clones/pulls on the server).
- `app.port` is the internal container port your app listens on.
- App traffic is routed through Traefik; Orca does not publish the app port directly on the host.

## Project Structure

```
orca/
├── bin/
│   └── orca.ts              # CLI entrypoint
├── src/
│   ├── cli/                 # Command handlers
│   ├── config/              # Configuration loading
│   ├── deploy/              # Deployment orchestration
│   ├── docker/              # Container management
│   ├── routing/             # Traefik integration
│   ├── ssh/                 # SSH client
│   ├── storage/             # Redis storage
│   ├── types/               # TypeScript types
│   └── utils/               # Utilities
├── package.json
├── tsconfig.json
└── README.md
```

## Architecture

Orca follows a clean, modular architecture:

- **CLI Layer**: Commander.js commands in `src/cli/`
- **Service Layer**: Orchestration in `src/deploy/deployService.ts`
- **Infrastructure Layer**: SSH, Docker, Redis, Traefik abstractions
- **Type Safety**: Strict TypeScript with shared interfaces

## Development

```bash
# Run in development mode
npm run dev -- init

# Build for production
npm run build

# Run compiled version
npm start
```

## Requirements

- Node.js 18+
- VPS with Docker installed
- Redis server (can run on VPS)
- SSH access to VPS

## License

MIT
