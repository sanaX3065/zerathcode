/**
 * src/agents/infrastructureAgent.js
 * ZerathCode — Infrastructure Agent
 * Zero npm deps. Pure Node.js child_process.
 *
 * Commands:
 *   zerath infra deploy  --port 3000 --name myapp --dir .
 *   zerath infra tunnel  --port 3000
 *   zerath infra status
 *   zerath infra stop    --name myapp
 */

"use strict";

const { exec, spawn } = require("child_process");
const { promisify }   = require("util");
const path            = require("path");
const fs              = require("fs");
const os              = require("os");
const renderer        = require("../ui/renderer");

const execAsync = promisify(exec);

class InfrastructureAgent {
  constructor(opts = {}) {
    this.permManager = opts.permManager || null;
    this.keyManager  = opts.keyManager  || null;
  }

  async run(args = []) {
    const sub   = args[0] || "status";
    const port  = this._flag(args, "--port")  || "3000";
    const name  = this._flag(args, "--name")  || "zerathapp";
    const dir   = this._flag(args, "--dir")   || process.cwd();
    const domain= this._flag(args, "--domain");

    switch (sub) {
      case "deploy": return this._deploy({ port, name, dir, domain });
      case "tunnel": return this._startTunnel({ port, domain });
      case "status": return this._status();
      case "stop":   return this._stop({ name });
      default:
        console.error(`\x1b[31m✖  Unknown infra command: "${sub}". Use deploy|tunnel|status|stop\x1b[0m`);
    }
  }

  // ── DEPLOY ────────────────────────────────────────────────────────────────
  async _deploy({ port, name, dir, domain }) {
    renderer.agentLog("infra", "deploy", `Starting deploy: ${name} on :${port}`);

    // 1. Start with PM2
    const pm2Ok = await this._pm2Start({ name, dir, port });

    // 2. Nginx config
    const nginxOk = await this._setupNginx({ name, port });

    // 3. Cloudflare tunnel
    const tunnelUrl = await this._startTunnel({ port, domain });

    renderer.deployPanel({
      appName:     name,
      port,
      tunnelUrl:   tunnelUrl || null,
      pm2Running:  pm2Ok,
      nginxRunning:nginxOk,
    });
  }

  // ── PM2 ───────────────────────────────────────────────────────────────────
  async _pm2Start({ name, dir, port }) {
    renderer.agentLog("infra", "run", `PM2: starting ${name}`);

    const hasPm2 = await this._which("pm2");
    if (!hasPm2) {
      renderer.agentLog("infra", "warn", "PM2 not found — install: npm install -g pm2");
      return this._nodeStart({ name, dir, port });
    }

    try {
      await execAsync(`pm2 delete ${name} 2>/dev/null || true`);
      await execAsync(`PORT=${port} pm2 start ${dir} --name ${name} --no-autorestart 2>&1 || pm2 start ${dir}/index.js --name ${name}`);
      await execAsync("pm2 save 2>/dev/null || true");
      renderer.agentLog("infra", "ok", `PM2: ${name} started on :${port}`);
      return true;
    } catch (err) {
      renderer.agentLog("infra", "error", `PM2 failed: ${err.message.slice(0, 80)}`);
      return false;
    }
  }

  async _nodeStart({ name, dir, port }) {
    const main = ["index.js", "server.js", "app.js"]
      .map(f => path.join(dir, f))
      .find(f => fs.existsSync(f));

    if (!main) {
      renderer.agentLog("infra", "warn", "No index.js/server.js found");
      return false;
    }

    const child = spawn("node", [main], {
      env:      { ...process.env, PORT: port },
      detached: true,
      stdio:    "ignore",
    });
    child.unref();
    renderer.agentLog("infra", "ok", `Node: ${name} started (PID ${child.pid}) on :${port}`);
    return true;
  }

  // ── NGINX ─────────────────────────────────────────────────────────────────
  async _setupNginx({ name, port }) {
    const hasNginx = await this._which("nginx");
    if (!hasNginx) {
      renderer.agentLog("infra", "warn", "Nginx not found — install: pkg install nginx");
      return false;
    }

    const conf = `
server {
    listen 8080;
    server_name localhost;
    location / {
        proxy_pass         http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_cache_bypass $http_upgrade;
    }
    location /health {
        proxy_pass http://127.0.0.1:${port}/health;
    }
}`.trim();

    const confDir = `${os.homedir()}/etc/nginx/sites-enabled`;
    try {
      if (!fs.existsSync(confDir)) fs.mkdirSync(confDir, { recursive: true });
      fs.writeFileSync(path.join(confDir, `${name}.conf`), conf);
      await execAsync("nginx -t 2>&1 && (nginx -s reload 2>/dev/null || nginx 2>/dev/null) || true");
      renderer.agentLog("infra", "ok", `Nginx: :8080 → :${port}`);
      return true;
    } catch {
      renderer.agentLog("infra", "warn", "Nginx config applied but reload may need manual restart");
      return false;
    }
  }

  // ── CLOUDFLARE TUNNEL ─────────────────────────────────────────────────────
  async _startTunnel({ port, domain }) {
    renderer.agentLog("tunnel", "tunnel", `Starting Cloudflare tunnel for :${port}`);

    const hasCloudflared = await this._which("cloudflared");
    if (!hasCloudflared) {
      renderer.agentLog("tunnel", "warn", "cloudflared not found — install: pkg install cloudflared");
      return null;
    }

    const domainFlag = domain ? `--hostname ${domain}` : "";
    const cmd        = `cloudflared tunnel --url http://localhost:${port} ${domainFlag} --no-autoupdate`;

    return new Promise((resolve) => {
      const proc = spawn("sh", ["-c", cmd], {
        detached: true,
        stdio:    ["ignore", "pipe", "pipe"],
      });

      let url     = null;
      const timer = setTimeout(() => {
        renderer.agentLog("tunnel", "warn", "Tunnel started (URL detection timed out — check cloudflared logs)");
        resolve(null);
      }, 18000);

      const onData = (chunk) => {
        const text  = chunk.toString();
        const match = text.match(/https?:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (match && !url) {
          url = match[0];
          clearTimeout(timer);
          renderer.agentLog("tunnel", "ok", `Public URL: ${url}`);
          console.log(`\n  \x1b[92m🌐  ${url}\x1b[0m\n`);
          resolve(url);
        }
      };

      proc.stdout?.on("data", onData);
      proc.stderr?.on("data", onData);
      proc.unref();
    });
  }

  // ── STATUS ────────────────────────────────────────────────────────────────
  async _status() {
    renderer.section("INFRASTRUCTURE STATUS");

    const hasPm2   = await this._which("pm2");
    const hasNginx = await this._which("nginx");
    const hasCf    = await this._which("cloudflared");

    console.log(`  PM2         : ${hasPm2   ? "\x1b[92m✔ installed\x1b[0m" : "\x1b[90m✖ not found\x1b[0m"}`);
    console.log(`  Nginx       : ${hasNginx ? "\x1b[92m✔ installed\x1b[0m" : "\x1b[90m✖ not found\x1b[0m"}`);
    console.log(`  cloudflared : ${hasCf    ? "\x1b[92m✔ installed\x1b[0m" : "\x1b[90m✖ not found\x1b[0m"}`);
    console.log("");

    if (hasPm2) {
      try {
        const { stdout } = await execAsync("pm2 list --no-color 2>/dev/null");
        console.log(stdout);
      } catch {}
    }
  }

  // ── STOP ──────────────────────────────────────────────────────────────────
  async _stop({ name }) {
    const hasPm2 = await this._which("pm2");
    if (hasPm2) {
      try {
        await execAsync(`pm2 stop ${name} && pm2 delete ${name}`);
        renderer.agentLog("infra", "ok", `Stopped: ${name}`);
      } catch {
        renderer.agentLog("infra", "warn", `Could not stop PM2 app: ${name}`);
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  async _which(cmd) {
    try { await execAsync(`which ${cmd}`); return true; } catch { return false; }
  }

  _flag(args, name) {
    const idx = args.indexOf(name);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
  }
}

module.exports = InfrastructureAgent;
