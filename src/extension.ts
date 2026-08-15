import * as vscode from 'vscode';
import { LocalDomain, scanLocalDomains } from './domainScanner';
import { TunnelManager } from './tunnelManager';

export function activate(context: vscode.ExtensionContext): void {
  const tunnelManager = new TunnelManager();
  const provider = new DomainsProvider();
  context.subscriptions.push(vscode.window.registerTreeDataProvider('localflare.domains', provider));

  context.subscriptions.push(
    vscode.commands.registerCommand('localflare.scanDomains', async () => provider.refresh()),
    vscode.commands.registerCommand('localflare.startQuickTunnel', async () => {
      const domain = await pickDomain(provider);
      if (domain) await tunnelManager.startQuickTunnel(domain);
    }),
    vscode.commands.registerCommand('localflare.loginCloudflare', async () => tunnelManager.login()),
    vscode.commands.registerCommand('localflare.startNamedTunnel', async () => {
      const domain = await pickDomain(provider);
      if (!domain) return;
      const hostname = await vscode.window.showInputBox({ prompt: 'Custom hostname in your Cloudflare zone, e.g. demo.example.com' });
      if (!hostname) return;
      const tunnelName = await vscode.window.showInputBox({ prompt: 'Cloudflare tunnel name', value: `localflare-${domain.host.replace(/[^a-z0-9-]/gi, '-')}` });
      if (!tunnelName) return;
      await tunnelManager.startNamedTunnel(domain, hostname, tunnelName);
    }),
    vscode.commands.registerCommand('localflare.stopTunnel', () => tunnelManager.stop()),
  );

  provider.refresh();
}

export function deactivate(): void {}

async function pickDomain(provider: DomainsProvider): Promise<LocalDomain | undefined> {
  const domains = await provider.getDomains();
  if (domains.length === 0) {
    vscode.window.showWarningMessage('No local domains found. Add localflare.extraDomains or create a Herd/Valet/MAMP site.');
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(
    domains.map((domain) => ({ label: domain.host, description: domain.source, detail: domain.origin, domain })),
    { placeHolder: 'Select local domain to expose through Cloudflare Tunnel' },
  );
  return picked?.domain;
}

class DomainsProvider implements vscode.TreeDataProvider<DomainItem> {
  private domains: LocalDomain[] = [];
  private readonly changeEmitter = new vscode.EventEmitter<DomainItem | undefined | null | void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  async refresh(): Promise<void> {
    this.domains = await scanLocalDomains();
    this.changeEmitter.fire();
    vscode.window.showInformationMessage(`LocalFlare found ${this.domains.length} local domain(s).`);
  }

  async getDomains(): Promise<LocalDomain[]> {
    if (this.domains.length === 0) await this.refresh();
    return this.domains;
  }

  getTreeItem(element: DomainItem): vscode.TreeItem { return element; }

  getChildren(): DomainItem[] {
    return this.domains.map((domain) => new DomainItem(domain));
  }
}

class DomainItem extends vscode.TreeItem {
  constructor(readonly domain: LocalDomain) {
    super(domain.host, vscode.TreeItemCollapsibleState.None);
    this.description = domain.source;
    this.tooltip = domain.origin;
    this.contextValue = 'localflareDomain';
    this.command = { command: 'localflare.startQuickTunnel', title: 'Start Quick Tunnel' };
  }
}
