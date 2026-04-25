import * as vscode from 'vscode';
import { MemorySnapshot } from '../types';
import { getWebviewContent } from './webviewContent';

export class MemoryVisualizerPanel {
    public static currentPanel: MemoryVisualizerPanel | undefined;
    private static readonly viewType = 'memviewer.visualizer';
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri, snapshot?: MemorySnapshot) {
        const column = vscode.ViewColumn.One;
        if (MemoryVisualizerPanel.currentPanel) {
            MemoryVisualizerPanel.currentPanel._panel.reveal(column);
            if (snapshot) {
                MemoryVisualizerPanel.currentPanel._update(snapshot);
            }
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            MemoryVisualizerPanel.viewType,
            '.NET MemViewer',
            column,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        MemoryVisualizerPanel.currentPanel = new MemoryVisualizerPanel(panel, extensionUri, snapshot);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, snapshot?: MemorySnapshot) {
        this._panel = panel;
        this._panel.webview.html = getWebviewContent(this._panel.webview, extensionUri);
        if (snapshot) {
            setTimeout(() => this._update(snapshot), 500);
        }
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            msg => {
                switch (msg.command) {
                    case 'alert':
                        vscode.window.showInformationMessage(msg.text);
                        break;
                    case 'clearSnapshots':
                        vscode.commands.executeCommand('memviewer.clearSnapshots');
                        break;
                    case 'clearLive':
                        vscode.commands.executeCommand('memviewer.clearLiveMemory');
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    private _update(snapshot: MemorySnapshot) {
        this._panel.webview.postMessage({ command: 'loadSnapshot', data: snapshot });
    }

    public clear() {
        this._panel.webview.postMessage({ command: 'clear' });
    }

    public dispose() {
        MemoryVisualizerPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const d = this._disposables.pop();
            if (d) { d.dispose(); }
        }
    }
}
