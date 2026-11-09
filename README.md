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
  # Optional: pin the server's SSH host key
  # host_key: SHA256:...
  # Refuse servers whose host key isn't already known (recommended in CI)
  strict_host_key_checking: false

git:
  repository: git@github.com:your-org/your-repo.git
  branch: main

app:
  name: myapp # lowercase letters, digits and "-"
  domain: myapp.com
  port: 3000
  network: traefik
  restart: unless-stopped # no | on-failure | always | unless-stopped
  health_check_path: /
  envs: # non-secret settings only: orca.yml is meant to be committed
    NODE_ENV: production
  env_file: .env # secrets; path relative to orca.yml, keep it gitignored
```

### Notes

- `git.repository` and `git.branch` are required for fresh VPS deploys (Orca clones/pulls on the server).
- `app.port` is the internal container port your app listens on.
- App traffic is routed through Traefik; Orca does not publish the app port directly on the host.
- `app.env_file` is a dotenv file (`KEY=value`, `export KEY=value`, quoted values, `#` comments).
  Its values are merged with `app.envs`; inline `envs` win on conflicts. Values cannot contain line
  breaks (Docker env files can't carry them), so base64-encode multi-line secrets.
- Orca warns if `app.envs` contains names that look like secrets (`*_PASSWORD`, `*_TOKEN`, `API_KEY`, ...).

## Security

### SSH host key verification

Every connection checks the server's host key, in this order:

1. `server.host_key` in `orca.yml`, if set. The server must present exactly this key. Get the
   fingerprint with `ssh-keyscan <host> | ssh-keygen -lf -`.
2. `~/.ssh/known_hosts` and `~/.orca/known_hosts` (hashed entries, `[host]:port` and wildcards are
   supported).
3. Unknown host: with `strict_host_key_checking: false` (default) the key is trusted on first use and
   saved to `~/.orca/known_hosts`. With `true`, the connection is refused.

If a known host presents a **different** key, Orca always refuses to connect. That is what a
man-in-the-middle attack looks like. If you reinstalled the server, remove the old entry
(`ssh-keygen -R <host>`, or edit `~/.orca/known_hosts`) and connect again.

### Deployment state (Redis)

- Redis on the VPS is published on `127.0.0.1:6379` only. The CLI reaches it through an SSH tunnel,
  so port 6379 never needs to be open in your firewall.
- It requires a password: a random 256-bit value generated on first setup and stored in
  `~/.orca/redis.pass` on the VPS (mode `600`, inside a `700` directory). It is passed to Redis via a
  config file, never on a command line.
- It is **not** attached to the app network, so a compromised or SSRF-vulnerable app container
  cannot reach it.
- Servers set up by older Orca versions (Redis on `0.0.0.0:6379`, no password) are migrated
  automatically on the next `orca deploy`. The container is re-created and the data volume is kept.
  `orca doctor` reports if Redis is still exposed.

### Secrets and command injection

- App environment variables are written to a mode-`600` file on the VPS over SFTP and passed with
  `docker run --env-file`, then the file is deleted. They never appear in the remote process list
  (`ps`) or shell history.
- Every value interpolated into a remote shell command is quoted, and config values that reach
  shell commands, Docker flags or Traefik rules (`app.name`, `app.domain`, `app.network`,
  `app.restart`, env var names, `git.branch`, `git.repository`, `health_check_path`) are validated
  against strict formats when `orca.yml` is loaded.

### Things to be aware of

- Traefik mounts the Docker socket (read-only). Docker socket access is root-equivalent on the host,
  so keep Traefik updated and its dashboard disabled (the default).
- Anyone in the VPS `docker` group can read container environment variables with `docker inspect`.
  Docker group membership is root-equivalent, so treat it that way.
- If Docker is missing, `orca deploy` installs it with the official `get.docker.com` script using
  `sudo`. Install Docker yourself if you prefer to review that step.

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
- VPS with Docker and Git installed (Orca can install Docker for you)
- SSH access to the VPS with a key
- Redis is set up on the VPS automatically; nothing to install yourself

## License

MIT
