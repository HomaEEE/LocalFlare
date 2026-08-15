import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
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

export class TunnelManager {
  private process?: ChildProcessWithoutNullStreams;
  private activeTunnel?: ActiveTunnel;
  private output = vscode.window.createOutputChannel('LocalFlare');
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTunnels = this.changeEmitter.event;

  getTunnels(): ActiveTunnel[] {
    return this.activeTunnel ? [this.activeTunnel] : [];
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
    this.start(['tunnel', '--url', domain.origin], `Quick tunnel for ${domain.host}`);
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
    this.start(['tunnel', 'run', '--url', domain.origin, tunnelName], `${hostname} → ${domain.origin}`);
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

  private start(args: string[], label: string): void {
    const executable = vscode.workspace.getConfiguration('localflare').get<string>('cloudflaredPath', 'cloudflared');
    this.output.show(true);
    this.output.appendLine(`Starting ${label}`);
    this.output.appendLine(`$ ${executable} ${args.join(' ')}`);

    this.process = spawn(executable, args);
    this.process.stdout.on('data', (data: Buffer) => this.handleOutput(data.toString()));
    this.process.stderr.on('data', (data: Buffer) => this.handleOutput(data.toString()));
    this.process.on('error', (error) => {
      if (this.activeTunnel) this.activeTunnel.status = 'failed';
      this.changeEmitter.fire();
      vscode.window.showErrorMessage(`cloudflared failed: ${error.message}`);
    });
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
    const executable = vscode.workspace.getConfiguration('localflare').get<string>('cloudflaredPath', 'cloudflared');
    this.output.show(true);
    this.output.appendLine(`$ ${executable} ${args.join(' ')}`);

    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable, args);
      let combined = '';
      child.stdout.on('data', (data: Buffer) => { combined += data.toString(); this.output.append(data.toString()); });
      child.stderr.on('data', (data: Buffer) => { combined += data.toString(); this.output.append(data.toString()); });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0 || (tolerateExisting && /already exists|already has/i.test(combined))) resolve();
        else reject(new Error(`cloudflared exited with code ${code ?? 'unknown'}`));
      });
    });
  }
}
