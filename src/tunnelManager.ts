import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { LocalDomain } from './domainScanner';

export class TunnelManager {
  private process?: ChildProcessWithoutNullStreams;
  private output = vscode.window.createOutputChannel('LocalFlare');

  async login(): Promise<void> {
    await this.runOneShot(['tunnel', 'login']);
  }

  async startQuickTunnel(domain: LocalDomain): Promise<void> {
    this.stop();
    this.start(['tunnel', '--url', domain.origin], `Quick tunnel for ${domain.host}`);
  }

  async startNamedTunnel(domain: LocalDomain, hostname: string, tunnelName: string): Promise<void> {
    this.stop();
    await this.runOneShot(['tunnel', 'create', tunnelName], true);
    await this.runOneShot(['tunnel', 'route', 'dns', tunnelName, hostname], true);
    this.start(['tunnel', 'run', '--url', domain.origin, tunnelName], `${hostname} → ${domain.origin}`);
  }

  stop(): void {
    if (!this.process) return;
    this.process.kill();
    this.output.appendLine('Stopped active cloudflared process.');
    this.process = undefined;
  }

  private start(args: string[], label: string): void {
    const executable = vscode.workspace.getConfiguration('localflare').get<string>('cloudflaredPath', 'cloudflared');
    this.output.show(true);
    this.output.appendLine(`Starting ${label}`);
    this.output.appendLine(`$ ${executable} ${args.join(' ')}`);

    this.process = spawn(executable, args);
    this.process.stdout.on('data', (data: Buffer) => this.handleOutput(data.toString()));
    this.process.stderr.on('data', (data: Buffer) => this.handleOutput(data.toString()));
    this.process.on('error', (error) => vscode.window.showErrorMessage(`cloudflared failed: ${error.message}`));
    this.process.on('exit', (code) => {
      this.output.appendLine(`cloudflared exited with code ${code ?? 'unknown'}.`);
      this.process = undefined;
    });
  }

  private handleOutput(text: string): void {
    this.output.append(text);
    const url = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)?.[0];
    if (url) {
      vscode.window.showInformationMessage(`LocalFlare tunnel is online: ${url}`, 'Copy URL')
        .then((choice: string | undefined) => choice === 'Copy URL' ? vscode.env.clipboard.writeText(url) : undefined);
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
