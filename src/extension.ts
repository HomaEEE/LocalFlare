import * as vscode from 'vscode';
import { LocalDomain, scanLocalDomains } from './domainScanner';
import { ActiveTunnel, TunnelManager } from './tunnelManager';

export function activate(context: vscode.ExtensionContext): void {
  const tunnelManager = new TunnelManager();
  const provider = new LocalFlareProvider(tunnelManager);
  context.subscriptions.push(vscode.window.registerTreeDataProvider('localflare.domains', provider));

  context.subscriptions.push(
    vscode.commands.registerCommand('localflare.scanDomains', async () => provider.refresh()),
    vscode.commands.registerCommand('localflare.startQuickTunnel', async () => {
      const domain = await pickDomain(provider);
      if (domain) await tunnelManager.startQuickTunnel(domain);
    }),
    vscode.commands.registerCommand('localflare.startQuickTunnelFromItem', async (item?: unknown) => {
      const domain = item instanceof LocalFlareItem ? item.domain : await pickDomain(provider);
      if (domain) await tunnelManager.startQuickTunnel(domain);
    }),
    vscode.commands.registerCommand('localflare.loginCloudflare', async () => tunnelManager.login()),
    vscode.commands.registerCommand('localflare.configureCloudflared', async () => tunnelManager.configureCloudflaredPath()),
main
    vscode.commands.registerCommand('localflare.startNamedTunnel', async () => startNamedTunnel(provider, tunnelManager)),
    vscode.commands.registerCommand('localflare.startNamedTunnelFromItem', async (item?: unknown) => startNamedTunnel(provider, tunnelManager, item instanceof LocalFlareItem ? item.domain : undefined)),
    vscode.commands.registerCommand('localflare.stopTunnel', () => tunnelManager.stop()),
  );

  provider.refresh();
}

export function deactivate(): void {}

async function startNamedTunnel(provider: LocalFlareProvider, tunnelManager: TunnelManager, selectedDomain?: LocalDomain): Promise<void> {
  const domain = selectedDomain ?? await pickDomain(provider);
  if (!domain) return;
  const hostname = await vscode.window.showInputBox({ prompt: 'Custom hostname in your Cloudflare zone, e.g. demo.example.com' });
  if (!hostname) return;
  const tunnelName = await vscode.window.showInputBox({ prompt: 'Cloudflare tunnel name', value: `localflare-${domain.host.replace(/[^a-z0-9-]/gi, '-')}` });
  if (!tunnelName) return;
  await tunnelManager.startNamedTunnel(domain, hostname, tunnelName);
}

async function pickDomain(provider: LocalFlareProvider): Promise<LocalDomain | undefined> {
  const domains = await provider.getDomains();
  if (domains.length === 0) {
    vscode.window.showWarningMessage('No local domains found. Add localflare.projectRoots, localflare.extraDomains, or create a Herd/Valet/MAMP site.');
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(
    domains.map((domain) => ({ label: domain.host, description: domain.source, detail: domain.projectPath ?? domain.origin, domain })),
    { placeHolder: 'Select local domain to expose through Cloudflare Tunnel' },
  );
  return picked?.domain;
}

class LocalFlareProvider implements vscode.TreeDataProvider<LocalFlareItem> {
  private domains: LocalDomain[] = [];
  private readonly changeEmitter = new vscode.EventEmitter<LocalFlareItem | undefined | null | void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(private readonly tunnelManager: TunnelManager) {
    this.tunnelManager.onDidChangeTunnels(() => this.changeEmitter.fire());
  }

  async refresh(): Promise<void> {
    this.domains = await scanLocalDomains();
    this.changeEmitter.fire();
    vscode.window.showInformationMessage(`LocalFlare found ${this.domains.length} local project/domain item(s).`);
  }

  async getDomains(): Promise<LocalDomain[]> {
    if (this.domains.length === 0) await this.refresh();
    return this.domains;
  }

  getTreeItem(element: LocalFlareItem): vscode.TreeItem { return element; }

  getChildren(element?: LocalFlareItem): LocalFlareItem[] {
    if (!element) {
      return [
        new SectionItem('Local projects', `${this.domains.length} discovered`, 'localflareProjects'),
        new SectionItem('Active tunnels', `${this.tunnelManager.getTunnels().length} running`, 'localflareTunnels'),
      ];
    }

    if (element.section === 'localflareProjects') {
      return this.domains.map((domain) => new DomainItem(domain));
    }

    if (element.section === 'localflareTunnels') {
      const tunnels = this.tunnelManager.getTunnels();
      return tunnels.length > 0 ? tunnels.map((tunnel) => new TunnelItem(tunnel)) : [new EmptyItem('No active tunnels')];
    }

    return [];
  }
}

type Section = 'localflareProjects' | 'localflareTunnels';

class LocalFlareItem extends vscode.TreeItem {
  section?: Section;
  domain?: LocalDomain;
  tunnel?: ActiveTunnel;
}

class SectionItem extends LocalFlareItem {
  constructor(label: string, description: string, section: Section) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.section = section;
    this.description = description;
    this.contextValue = section;
  }
}

class DomainItem extends LocalFlareItem {
  constructor(domain: LocalDomain) {
    super(domain.host, vscode.TreeItemCollapsibleState.None);
    this.domain = domain;
    this.description = domain.source;
    this.tooltip = domain.projectPath ? `${domain.origin}\n${domain.projectPath}` : domain.origin;
    this.contextValue = 'localflareDomain';
    this.iconPath = new vscode.ThemeIcon('play');
    this.command = { command: 'localflare.startQuickTunnelFromItem', title: 'Start', arguments: [this] };
main
  }
}

class TunnelItem extends LocalFlareItem {
  constructor(tunnel: ActiveTunnel) {
    super(tunnel.publicUrl ?? tunnel.label, vscode.TreeItemCollapsibleState.None);
    this.tunnel = tunnel;
    this.description = tunnel.status;
    this.iconPath = new vscode.ThemeIcon(tunnel.status === 'online' ? 'radio-tower' : tunnel.status === 'failed' ? 'error' : 'debug-stop');
main
    this.tooltip = `${tunnel.origin}${tunnel.publicUrl ? `\n${tunnel.publicUrl}` : ''}`;
    this.contextValue = 'localflareTunnel';
  }
}

class EmptyItem extends LocalFlareItem {
  constructor(label: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
  }
}
