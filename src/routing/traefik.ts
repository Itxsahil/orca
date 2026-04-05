import { TraefikConfig } from '../types/config';

export class Traefik {
  generateLabels(config: TraefikConfig): Record<string, string> {
    const labels: Record<string, string> = {};

    // Enable Traefik for this container
    labels['traefik.enable'] = 'true';

    // HTTP router configuration
    const routerName = config.appName;
    labels[`traefik.http.routers.${routerName}.rule`] = `Host(\`${config.domain}\`)`;
    labels[`traefik.http.routers.${routerName}.entrypoints`] = 'websecure';
    labels[`traefik.http.routers.${routerName}.tls`] = 'true';
    labels[`traefik.http.routers.${routerName}.tls.certresolver`] = 'letsencrypt';

    // HTTP to HTTPS redirect (optional but recommended)
    labels[`traefik.http.routers.${routerName}-http.rule`] = `Host(\`${config.domain}\`)`;
    labels[`traefik.http.routers.${routerName}-http.entrypoints`] = 'web';
    labels[`traefik.http.routers.${routerName}-http.middlewares`] = `${routerName}-redirect`;

    // Redirect middleware
    labels[`traefik.http.middlewares.${routerName}-redirect.redirectscheme.scheme`] = 'https';

    // Service configuration (which port to route to)
    labels[`traefik.http.services.${routerName}.loadbalancer.server.port`] = config.port.toString();

    return labels;
  }

  getNetworkName(): string {
    return 'traefik';
  }

  generateTraefikCompose(): string {
    return `
version: '3.8'

services:
  traefik:
    image: traefik:v3.0
    container_name: traefik
    restart: unless-stopped
    command:
      - "--api.dashboard=true"
      - "--providers.docker=true"
      - "--providers.docker.exposedbydefault=false"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.letsencrypt.acme.tlschallenge=true"
      - "--certificatesresolvers.letsencrypt.acme.email=admin@example.com"
      - "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json"
      - "--log.level=INFO"
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./letsencrypt:/letsencrypt
    networks:
      - traefik
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.dashboard.rule=Host(\`traefik.localhost\`)"
      - "traefik.http.routers.dashboard.service=api@internal"
      - "traefik.http.routers.dashboard.middlewares=auth"

networks:
  traefik:
    name: traefik
    external: false
`.trim();
  }

  generateEnvVars(config: TraefikConfig): Record<string, string> {
    return {
      // Pass domain to app for CORS or redirects
      DOMAIN: config.domain,
      // Tell app which port to listen on
      PORT: config.port.toString(),
    };
  }
}
