import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class ToolChecker {
    private readonly requiredTools = [
        { name: 'dotnet-stack', installCmd: 'dotnet tool install -g dotnet-stack' },
        { name: 'dotnet-gcdump', installCmd: 'dotnet tool install -g dotnet-gcdump' },
        { name: 'dotnet-dump', installCmd: 'dotnet tool install -g dotnet-dump' },
    ];

    async checkAndPromptInstall(): Promise<void> {
        const missing: typeof this.requiredTools = [];

        for (const tool of this.requiredTools) {
            try {
                await execAsync(`${tool.name} --help`);
            } catch {
                missing.push(tool);
            }
        }

        if (missing.length > 0) {
            const names = missing.map(t => t.name).join(', ');
            const action = await vscode.window.showWarningMessage(
                `MemViewer requires these .NET tools: ${names}. Install them now?`,
                'Install All',
                'Skip'
            );

            if (action === 'Install All') {
                const terminal = vscode.window.createTerminal('MemViewer Setup');
                terminal.show();
                for (const tool of missing) {
                    terminal.sendText(tool.installCmd);
                }
                vscode.window.showInformationMessage(
                    'Installing .NET diagnostic tools. Please wait for completion then reload.'
                );
            }
        }
    }
}
