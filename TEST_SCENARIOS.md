# Orca End-to-End Scenarios and Sanity Checklist

This document lists practical scenarios to validate Orca before production usage.
It covers happy paths, failure paths, and corner cases.

## Scope

- Fresh VPS bootstrap
- Configuration validation
- Deployment lifecycle
- Rollback behavior
- Logs and observability checks
- Risk and edge-case scenarios

## Baseline Assumptions

- VPS has public DNS A record for your app domain.
- Ports `80` and `443` are open in VPS firewall/security group.
- SSH access works for `server.user` with `server.ssh_key`.
- The repo in `git.repository` has a valid `Dockerfile` at root.
- The app listens on `app.port` inside the container.

## Reference `orca.yml`

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

## Scenario 1: Project Initialization

1. Run `orca init`.
2. Confirm `orca.yml` is created.
3. Re-run `orca init` without `--force`.
4. Confirm existing file is not overwritten.
5. Run `orca init --force`.
6. Confirm file is overwritten.

Expected:

- Correct file creation behavior.
- No invalid template fields.

## Scenario 2: Config Validation Fail-Fast

Create invalid configs and run `orca deploy` each time.

Cases:

- Missing `server`.
- Missing `git`.
- Missing `git.repository`.
- Missing `app`.
- Missing `app.port`.
- `server.port` as string.

Expected:

- Command fails immediately with a precise parse/validation message.

## Scenario 3: Preflight Checks (`doctor`)

1. Run `orca doctor`.
2. Validate checks:

- SSH connectivity
- Docker installed
- Git installed
- Docker command usable
- Repository reachable
- Ports 80/443 available

Expected:

- All checks pass on ready VPS.
- Any failed check blocks deployment.

## Scenario 4: Fresh VPS Bootstrap (No Docker)

1. Use a new VPS where Docker is absent.
2. Run `orca deploy`.

Expected:

- Orca attempts Docker installation.
- Orca ensures Traefik network exists.
- Orca starts Redis container and Traefik container.
- Deployment proceeds after bootstrap.

Notes:

- Requires `sudo` capability for Docker installation path.

## Scenario 5: First Deployment Happy Path

1. Ensure `git.repository` and `git.branch` are valid.
2. Run `orca deploy`.

Expected:

- Repo cloned to `/opt/orca/apps/<app-name>`.
- Docker image built.
- New app container started on Traefik network.
- Traefik labels applied.
- Deployment state saved to Redis.
- Success output includes URL.

## Scenario 6: Re-Deploy (Zero-Downtime Style)

1. Push a small app change to the same branch.
2. Run `orca deploy` again.

Expected:

- New container starts first.
- Health check confirms running state.
- Previous container is stopped and removed after new one is healthy.

## Scenario 7: Deployment Failure During Health Check

1. Intentionally break runtime startup (for example invalid env).
2. Run `orca deploy`.

Expected:

- Deployment fails.
- Newly created failed container is cleaned up automatically.
- Existing stable container remains active if present.

## Scenario 8: Logs Retrieval

1. Run `orca logs -n 200`.

Expected:

- Finds latest running deployment from Redis.
- Fetches logs from corresponding container via SSH.

## Scenario 9: Rollback

Precondition:

- At least 2 deployments exist.

1. Run `orca rollback`.

Expected:

- Current deployment container is stopped.
- Previous container is started if it is not running.
- Redis status updates reflect new active deployment.

## Scenario 10: Network and Routing Validation

1. Verify app container has Traefik labels:
   - `traefik.enable=true`
   - router rule for `Host(\`<domain>\`)`
2. Verify app container is attached to `traefik` network.
3. Validate external access:
   - `http://<domain>` redirects to HTTPS
   - `https://<domain>` serves app

Expected:

- Host-based routing works.
- TLS is terminated by Traefik.

## Scenario 11: SSL Issuance and Renewal Basics

1. Deploy with DNS correctly pointing to VPS.
2. Validate certificate is issued by Let's Encrypt.

Expected:

- HTTPS certificate issued on first successful request flow.

Important:

- Current implementation uses hardcoded ACME email in Traefik startup.
- SSL customization from `orca.yml` is not yet wired.

## Scenario 12: Git/Auth Failure Modes

Cases:

- Invalid SSH deploy key on VPS for private repo.
- Wrong repository URL.
- Wrong branch name.

Expected:

- `prepareSourceCode` step fails with clear git error.
- No partial deploy state marked as successful.

## Scenario 13: Port Conflict Cases

Case A:

- Port `80` or `443` already in use by another process.

Expected:

- `doctor` should fail port availability check.
- Deploy should not be attempted until resolved.

Case B:

- App internal port mismatch (container app not listening on `app.port`).

Expected:

- Health check fails.
- New container gets cleaned up.

## Scenario 14: Redis Availability Edge Case

1. Stop Redis container manually on VPS.
2. Run `orca deploy` or `orca logs`.

Expected:

- Deploy path should re-ensure infra and recover.
- Logs/rollback should fail clearly if Redis is unavailable.

## Scenario 15: SSH Port and Key Edge Cases

Cases:

- Non-default SSH port.
- Invalid key path.
- Wrong key permissions or key mismatch.

Expected:

- SSH connection failure is explicit.
- Fixing key path/port resolves issue without code changes.

## Scenario 16: Disaster/Recovery Smoke

1. Reboot VPS.
2. Verify containers with restart policy come back:
   - Traefik
   - Redis
   - Active app container
3. Run `orca logs`.

Expected:

- Core containers auto-restart.
- Logs command still resolves active deployment container.

## Scenario 17: Security Checks

Validate:

- Redis exposure policy (`6379`) in your network/firewall.
- SSH user privilege level and least privilege model.
- Secret handling in `app.envs` (avoid committing sensitive values in plaintext).

Expected:

- Only required ports exposed publicly.
- Secure key and firewall posture.

## Scenario 18: Load/Scale Reality Check

Current state:

- One application container per deployment rollout.
- No configurable replica count (`instances`) yet.

Action:

- If horizontal scaling is required, add `app.instances` implementation before production launch.

## Quick End-to-End Command Runbook

1. `orca init`
2. Edit `orca.yml` with real values.
3. `orca doctor`
4. `orca deploy`
5. `orca logs -n 200`
6. Push change and run `orca deploy` again.
7. `orca rollback`
8. Validate app URL over HTTPS.

## Pass/Fail Gate Before Production

A release is considered ready when all are true:

- `doctor` passes.
- First deploy succeeds on fresh VPS.
- Second deploy and rollback both succeed.
- HTTPS route is reachable by domain.
- Failure injection scenario confirms safe rollback/cleanup behavior.
- SSH/key and repo auth are stable for private repositories.
