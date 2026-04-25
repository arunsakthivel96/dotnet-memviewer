import * as vscode from 'vscode';
import { getCssContent } from './styles';
import { getJsContent } from './scripts';

export function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const nonce = getNonce();
    const css = getCssContent();
    const js = getJsContent();
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>.NET MemViewer</title>
<style nonce="${nonce}">${css}</style>
</head>
<body>
<div id="app">
  <header id="topbar">
    <div class="logo">&#9889; .NET MemViewer - Developed by Arun Sakthivel</div>
    <div id="debug-badge" class="debug-badge" style="display:none">&#128308; LIVE DEBUG</div>
    <div id="status" class="status">No snapshot loaded</div>
  </header>
  <div id="toolbar">
    <div id="tabs">
      <button class="tab active" data-tab="stack">Stack &amp; Heap</button>
      <button class="tab" data-tab="heap">Heap Graph</button>
      <button class="tab" data-tab="stats">Statistics</button>
    </div>
    <div id="actions">
      <button id="clear-snapshot" class="action-btn" title="Clear Current Visualization">
        &#128465; Clear Snapshot
      </button>
      <button id="clear-live" class="action-btn secondary" title="Reset Live Tracking">
        &#8634; Reset Live
      </button>
    </div>
    <div id="filter-bar">
      <input type="text" id="filter-input" placeholder="&#128269; Filter threads, methods, types..." spellcheck="false" />
      <div id="filter-chips">
        <button class="chip active" data-filter="all">All</button>
        <button class="chip" data-filter="running">Running</button>
        <button class="chip" data-filter="waiting">Waiting</button>
        <button class="chip" data-filter="stopped">Stopped</button>
        <button class="chip" data-filter="user">User Code</button>
      </div>
    </div>
  </div>
  <div id="content">
    <div id="tab-stack" class="tab-panel active">
      <div id="split">
        <div id="stack-panel" class="panel">
          <div class="panel-header">
            <h2>Threads &amp; Stack Frames</h2>
            <span id="thread-count" class="count-badge"></span>
          </div>
          <div id="thread-list"></div>
        </div>
        <div id="heap-panel" class="panel">
          <div class="panel-header">
            <h2>Heap Objects</h2>
            <span id="heap-count" class="count-badge"></span>
          </div>
          <div id="heap-detail"></div>
        </div>
      </div>
    </div>
    <div id="tab-heap" class="tab-panel">
      <canvas id="heapCanvas"></canvas>
    </div>
    <div id="tab-stats" class="tab-panel">
      <div id="stats-grid"></div>
    </div>
  </div>
</div>
<script nonce="${nonce}">${js}</script>
</body>
</html>`;
}

function getNonce(): string {
    let t = '';
    const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) { t += c.charAt(Math.floor(Math.random() * c.length)); }
    return t;
}
