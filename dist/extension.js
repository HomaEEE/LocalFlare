"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const domainScanner_1 = require("./domainScanner");
const tunnelManager_1 = require("./tunnelManager");
function activate(context) {
    const tunnelManager = new tunnelManager_1.TunnelManager();
    const provider = new LocalFlareProvider(tunnelManager);
    context.subscriptions.push(vscode.window.registerTreeDataProvider('localflare.domains', provider));
    context.subscriptions.push(vscode.commands.registerCommand('localflare.scanDomains', async () => provider.refresh()), vscode.commands.registerCommand('localflare.startQuickTunnel', async () => {
        const domain = await pickDomain(provider);
        if (domain)
            await tunnelManager.startQuickTunnel(domain);
    }), vscode.commands.registerCommand('localflare.startQuickTunnelFromItem', async (item) => {
        const domain = item instanceof LocalFlareItem ? item.domain : await pickDomain(provider);
        if (domain)
            await tunnelManager.startQuickTunnel(domain);
    }), vscode.commands.registerCommand('localflare.loginCloudflare', async () => tunnelManager.login()), vscode.commands.registerCommand('localflare.configureCloudflared', async () => tunnelManager.configureCloudflaredPath()), vscode.commands.registerCommand('localflare.startNamedTunnel', async () => startNamedTunnel(provider, tunnelManager)), vscode.commands.registerCommand('localflare.startNamedTunnelFromItem', async (item) => startNamedTunnel(provider, tunnelManager, item instanceof LocalFlareItem ? item.domain : undefined)), vscode.commands.registerCommand('localflare.stopTunnel', () => tunnelManager.stop()));
    provider.refresh();
}
function deactivate() { }
async function startNamedTunnel(provider, tunnelManager, selectedDomain) {
    const domain = selectedDomain ?? await pickDomain(provider);
    if (!domain)
        return;
    const hostname = await vscode.window.showInputBox({ prompt: 'Custom hostname in your Cloudflare zone, e.g. demo.example.com' });
    if (!hostname)
        return;
    const tunnelName = await vscode.window.showInputBox({ prompt: 'Cloudflare tunnel name', value: `localflare-${domain.host.replace(/[^a-z0-9-]/gi, '-')}` });
    if (!tunnelName)
        return;
    await tunnelManager.startNamedTunnel(domain, hostname, tunnelName);
}
async function pickDomain(provider) {
    const domains = await provider.getDomains();
    if (domains.length === 0) {
        vscode.window.showWarningMessage('No local domains found. Add localflare.projectRoots, localflare.extraDomains, or create a Herd/Valet/MAMP site.');
        return undefined;
    }
    const picked = await vscode.window.showQuickPick(domains.map((domain) => ({ label: domain.host, description: domain.source, detail: domain.projectPath ?? domain.origin, domain })), { placeHolder: 'Select local domain to expose through Cloudflare Tunnel' });
    return picked?.domain;
}
class LocalFlareProvider {
    tunnelManager;
    domains = [];
    changeEmitter = new vscode.EventEmitter();
    onDidChangeTreeData = this.changeEmitter.event;
    constructor(tunnelManager) {
        this.tunnelManager = tunnelManager;
        this.tunnelManager.onDidChangeTunnels(() => this.changeEmitter.fire());
    }
    async refresh() {
        this.domains = await (0, domainScanner_1.scanLocalDomains)();
        this.changeEmitter.fire();
        vscode.window.showInformationMessage(`LocalFlare found ${this.domains.length} local project/domain item(s).`);
    }
    async getDomains() {
        if (this.domains.length === 0)
            await this.refresh();
        return this.domains;
    }
    getTreeItem(element) { return element; }
    getChildren(element) {
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
class LocalFlareItem extends vscode.TreeItem {
    section;
    domain;
    tunnel;
}
class SectionItem extends LocalFlareItem {
    constructor(label, description, section) {
        super(label, vscode.TreeItemCollapsibleState.Expanded);
        this.section = section;
        this.description = description;
        this.contextValue = section;
    }
}
class DomainItem extends LocalFlareItem {
    constructor(domain) {
        super(domain.host, vscode.TreeItemCollapsibleState.None);
        this.domain = domain;
        this.description = domain.source;
        this.tooltip = domain.projectPath ? `${domain.origin}\n${domain.projectPath}` : domain.origin;
        this.contextValue = 'localflareDomain';
        this.iconPath = new vscode.ThemeIcon('play');
        this.command = { command: 'localflare.startQuickTunnelFromItem', title: 'Start', arguments: [this] };
    }
}
class TunnelItem extends LocalFlareItem {
    constructor(tunnel) {
        super(tunnel.publicUrl ?? tunnel.label, vscode.TreeItemCollapsibleState.None);
        this.tunnel = tunnel;
        this.description = tunnel.status;
        this.iconPath = new vscode.ThemeIcon(tunnel.status === 'online' ? 'radio-tower' : tunnel.status === 'failed' ? 'error' : 'debug-stop');
        this.tooltip = `${tunnel.origin}${tunnel.publicUrl ? `\n${tunnel.publicUrl}` : ''}`;
        this.contextValue = 'localflareTunnel';
    }
}
class EmptyItem extends LocalFlareItem {
    constructor(label) {
        super(label, vscode.TreeItemCollapsibleState.None);
    }
}
//# sourceMappingURL=extension.js.map