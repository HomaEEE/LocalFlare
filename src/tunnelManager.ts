import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { LocalDomain } from './domainScanner';

export type TunnelKind = 'quick' | 'named';
export type TunnelStatus = 'starting' | 'online' | 'stopped' | 'failed';

export interface ActiveTunnel {
  id: string;
  kind: TunnelKind;
  domain: LocalDomain;
  label: string;
  origin: string;
  publicUrl?: string;
  hostname?: string;
  status: TunnelStatus;
}

const COMMON_CLOUDFLARED_PATHS = [
  '/opt/homebrew/bin/cloudflared',
  '/usr/local/bin/cloudflared',
  '/usr/bin/cloudflared',
  '/snap/bin/cloudflared',
];

export class TunnelManager {
  private process?: ChildProcessWithoutNullStreams;
  private activeTunnel?: ActiveTunnel;
  private output = vscode.window.createOutputChannel('LocalFlare');
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTunnels = this.changeEmitter.event;

  getTunnels(): ActiveTunnel[] {
    return this.activeTunnel ? [this.activeTunnel] : [];
  }

  async configureCloudflaredPath(): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: 'Use cloudflared',
      title: 'Select cloudflared executable',
    });
    const selected = picked?.[0]?.fsPath;
    if (!selected) return;

    await vscode.workspace.getConfiguration('localflare').update('cloudflaredPath', selected, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`LocalFlare cloudflared path set to ${selected}`);
  }

  async login(): Promise<void> {
    await this.runOneShot(['tunnel', 'login']);
  }

  async startQuickTunnel(domain: LocalDomain): Promise<void> {
    this.stop();
    this.activeTunnel = {
      id: `quick:${domain.origin}`,
      kind: 'quick',
      domain,
      label: `Quick tunnel: ${domain.host}`,
      origin: domain.origin,
      status: 'starting',
    };
    this.changeEmitter.fire();
    await this.start(['tunnel', '--url', domain.origin], `Quick tunnel for ${domain.host}`);
  }

  async startNamedTunnel(domain: LocalDomain, hostname: string, tunnelName: string): Promise<void> {
    this.stop();
    await this.runOneShot(['tunnel', 'create', tunnelName], true);
    await this.runOneShot(['tunnel', 'route', 'dns', tunnelName, hostname], true);
    this.activeTunnel = {
      id: `named:${tunnelName}`,
      kind: 'named',
      domain,
      label: `${hostname} → ${domain.host}`,
      origin: domain.origin,
      hostname,
      publicUrl: `https://${hostname}`,
      status: 'starting',
    };
    this.changeEmitter.fire();
    await this.start(['tunnel', 'run', '--url', domain.origin, tunnelName], `${hostname} → ${domain.origin}`);
  }

  stop(): void {
    if (this.process) {
      this.process.kill();
      this.process = undefined;
      this.output.appendLine('Stopped active cloudflared process.');
    }
    if (this.activeTunnel) {
      this.activeTunnel.status = 'stopped';
      this.changeEmitter.fire();
    }
  }

  private async start(args: string[], label: string): Promise<void> {
    const executable = await this.resolveCloudflaredExecutable();
    if (!executable) {
      this.markFailed();
      return;
    }

    this.output.show(true);
    this.output.appendLine(`Starting ${label}`);
    this.output.appendLine(`$ ${executable} ${args.join(' ')}`);

    this.process = spawn(executable, args);
    this.process.stdout.on('data', (data: Buffer) => this.handleOutput(data.toString()));
    this.process.stderr.on('data', (data: Buffer) => this.handleOutput(data.toString()));
    this.process.on('error', (error) => this.handleProcessError(error));
    this.process.on('exit', (code) => {
      this.output.appendLine(`cloudflared exited with code ${code ?? 'unknown'}.`);
      if (this.activeTunnel && this.activeTunnel.status !== 'stopped') {
        this.activeTunnel.status = code === 0 ? 'stopped' : 'failed';
      }
      this.process = undefined;
      this.changeEmitter.fire();
    });
  }

  private handleOutput(text: string): void {
    this.output.append(text);
    const quickUrl = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)?.[0];
    if (quickUrl && this.activeTunnel) {
      this.activeTunnel.publicUrl = quickUrl;
      this.activeTunnel.status = 'online';
      this.changeEmitter.fire();
      vscode.window.showInformationMessage(`LocalFlare tunnel is online: ${quickUrl}`, 'Copy URL')
        .then((choice: string | undefined) => choice === 'Copy URL' ? vscode.env.clipboard.writeText(quickUrl) : undefined);
    }
    if (/connection registered|registered tunnel connection|serving tunnel/i.test(text) && this.activeTunnel) {
      this.activeTunnel.status = 'online';
      this.changeEmitter.fire();
    }
  }

  private async runOneShot(args: string[], tolerateExisting = false): Promise<void> {
    const executable = await this.resolveCloudflaredExecutable();
    if (!executable) throw new Error('cloudflared executable is not configured.');

    this.output.show(true);
    this.output.appendLine(`$ ${executable} ${args.join(' ')}`);

    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable, args);
      let combined = '';
      child.stdout.on('data', (data: Buffer) => { combined += data.toString(); this.output.append(data.toString()); });
      child.stderr.on('data', (data: Buffer) => { combined += data.toString(); this.output.append(data.toString()); });
      child.on('error', (error) => {
        this.handleProcessError(error);
        reject(error);
      });
      child.on('exit', (code) => {
        if (code === 0 || (tolerateExisting && /already exists|already has/i.test(combined))) resolve();
        else reject(new Error(`cloudflared exited with code ${code ?? 'unknown'}`));
      });
    });
  }

  private async resolveCloudflaredExecutable(): Promise<string | undefined> {
    const configured = vscode.workspace.getConfiguration('localflare').get<string>('cloudflaredPath', 'cloudflared').trim();
    if (configured && configured !== 'cloudflared') return configured;

    for (const candidate of COMMON_CLOUDFLARED_PATHS) {
      if (await isExecutable(candidate)) return candidate;
    }

    return await new Promise<string | undefined>((resolve) => {
      const child = spawn(process.platform === 'win32' ? 'where' : 'which', ['cloudflared']);
      let found = '';
      child.stdout.on('data', (data: Buffer) => { found += data.toString(); });
      child.on('error', () => resolve(undefined));
      child.on('exit', (code) => resolve(code === 0 ? found.split(/\r?\n/)[0]?.trim() || undefined : undefined));
    });
  }

  private handleProcessError(error: Error): void {
    this.markFailed();
    if ((error as { code?: string }).code === 'ENOENT') {
      vscode.window.showErrorMessage(
        'cloudflared не найден. Установите Cloudflare Tunnel или укажите путь к бинарнику в LocalFlare.',
        'Set Path',
        'Install Docs',
      ).then((choice: string | undefined) => {
        if (choice === 'Set Path') return this.configureCloudflaredPath();
        if (choice === 'Install Docs') return vscode.env.openExternal(vscode.Uri.parse('https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/'));
        return undefined;
      });
      return;
    }
    vscode.window.showErrorMessage(`cloudflared failed: ${error.message}`);
  }

  private markFailed(): void {
    if (this.activeTunnel) this.activeTunnel.status = 'failed';
    this.changeEmitter.fire();
  }
}

async function isExecutable(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
