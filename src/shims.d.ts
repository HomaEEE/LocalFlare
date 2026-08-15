declare module 'node:fs/promises' {
  export function access(path: string): Promise<void>;

  export function readdir(path: string, options?: { withFileTypes?: boolean }): Promise<import('node:fs').Dirent[]>;
  export function readFile(path: string, encoding: string): Promise<string>;
}

declare module 'node:fs' {
  export interface Dirent { name: string; isFile(): boolean; isDirectory(): boolean; }
}

declare module 'node:os' { export function homedir(): string; }
declare module 'node:path' { export function join(...parts: string[]): string;
  export function basename(path: string): string; }

declare module 'node:child_process' {
  interface Stream { on(event: 'data', listener: (data: Buffer) => void): void; }
  export interface ChildProcessWithoutNullStreams {
    stdout: Stream;
    stderr: Stream;
    kill(): void;
    on(event: 'error', listener: (error: Error) => void): void;
    on(event: 'exit', listener: (code: number | null) => void): void;
  }
  export function spawn(command: string, args?: string[]): ChildProcessWithoutNullStreams;
}

declare class Buffer { toString(): string; }

declare module 'vscode' {
  export interface ExtensionContext { subscriptions: { push(...items: unknown[]): void }; }
  export interface WorkspaceFolder { uri: { fsPath: string }; }
  export const workspace: {
    workspaceFolders?: WorkspaceFolder[];
    getConfiguration(section?: string): { get<T>(key: string, defaultValue: T): T; update(key: string, value: unknown, target?: ConfigurationTarget): Thenable<void> };
  };
  export enum ConfigurationTarget { Global = 1 }
main
  export const window: {
    createOutputChannel(name: string): OutputChannel;
    registerTreeDataProvider<T>(viewId: string, provider: TreeDataProvider<T>): unknown;
    showInformationMessage(message: string, ...items: string[]): Thenable<string | undefined>;
    showWarningMessage(message: string): Thenable<string | undefined>;
    showErrorMessage(message: string, ...items: string[]): Thenable<string | undefined>;
    showQuickPick<T extends QuickPickItem>(items: T[], options?: { placeHolder?: string }): Thenable<T | undefined>;
    showInputBox(options?: { prompt?: string; value?: string }): Thenable<string | undefined>;
    showOpenDialog(options?: { canSelectFiles?: boolean; canSelectFolders?: boolean; canSelectMany?: boolean; openLabel?: string; title?: string }): Thenable<Uri[] | undefined>;
  };
  export const commands: { registerCommand(command: string, callback: (...args: unknown[]) => unknown): unknown };
  export const env: { clipboard: { writeText(value: string): Thenable<void> }; openExternal(uri: Uri): Thenable<boolean> };
  export class Uri { fsPath: string; static parse(value: string): Uri; }
main
  export interface OutputChannel { append(value: string): void; appendLine(value: string): void; show(preserveFocus?: boolean): void; }
  export interface QuickPickItem { label: string; description?: string; detail?: string; }
  export interface TreeDataProvider<T> { onDidChangeTreeData?: Event<T | undefined | null | void>; getTreeItem(element: T): TreeItem; getChildren(element?: T): ProviderResult<T[]>; }
  export type ProviderResult<T> = T | undefined | null | Thenable<T | undefined | null>;
  export interface Event<T> { (listener: (e: T) => unknown): unknown; }
  export class EventEmitter<T> { event: Event<T>; fire(data?: T): void; }
  export enum TreeItemCollapsibleState { None = 0, Expanded = 1, Collapsed = 2 }
  export class ThemeIcon { constructor(id: string); }

  export class TreeItem {
    constructor(label: string, collapsibleState?: TreeItemCollapsibleState);
    description?: string;
    tooltip?: string;
    contextValue?: string;
    command?: { command: string; title: string; arguments?: unknown[] };
    iconPath?: ThemeIcon;
  }
}

declare const process: { platform: string };

