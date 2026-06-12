import type { PersistenceManager } from '../engine/persistence.js';
import type { Config, PermissionAction } from '../model/types.js';
import * as readline from 'readline';

export interface PermissionRequest {
  type: 'file_read' | 'file_write' | 'command';
  target: string;
  description?: string;
}

export interface PermissionResult {
  allowed: boolean;
  reason?: string;
  remember?: boolean;
}

export class PermissionManager {
  private config: Config;
  private persistence: PersistenceManager;
  private allowList: Set<string> = new Set();
  private denyList: Set<string> = new Set();

  constructor(config: Config, persistence: PersistenceManager) {
    this.config = config;
    this.persistence = persistence;
  }

  check(request: PermissionRequest): PermissionResult {
    switch (request.type) {
      case 'file_read':
        return { allowed: true };

      case 'file_write': {
        if (this.allowList.has(`write:${request.target}`)) {
          return { allowed: true };
        }
        if (this.denyList.has(`write:${request.target}`)) {
          return { allowed: false, reason: '已拒绝' };
        }
        const action = this.config.permissions.allow_write;
        return this.evaluateAction(action, request);
      }

      case 'command': {
        for (const denied of this.config.permissions.deny_commands) {
          if (request.target.includes(denied)) {
            return {
              allowed: false,
              reason: `命令匹配黑名单规则: "${denied}"`,
            };
          }
        }
        if (this.allowList.has(`command:${request.target}`)) {
          return { allowed: true };
        }
        const action = this.config.permissions.allow_command;
        return this.evaluateAction(action, request);
      }
    }
  }

  async checkAsync(request: PermissionRequest): Promise<PermissionResult> {
    const syncResult = this.check(request);
    if (syncResult.allowed || syncResult.reason !== '需要用户确认') {
      return syncResult;
    }

    return this.promptUser(request);
  }

  private async promptUser(request: PermissionRequest): Promise<PermissionResult> {
    const typeLabel = request.type === 'file_write' ? '写入文件' : '执行命令';
    console.log(`\n  ⚠ 权限请求: ${typeLabel} ${request.target}`);
    console.log('  [A] 允许  [S] 始终允许  [D] 拒绝');

    const answer = await this.readlinePrompt('  选择 [A]: ');

    switch (answer.toLowerCase()) {
      case 's':
        this.grantAlways(`${request.type === 'file_write' ? 'write' : 'command'}:${request.target}`);
        this.audit(request, 'allowed-always');
        return { allowed: true, remember: true };
      case 'd':
      case 'n':
        this.audit(request, 'denied');
        return { allowed: false, reason: '用户拒绝' };
      default:
        this.audit(request, 'allowed');
        return { allowed: true };
    }
  }

  private readlinePrompt(prompt: string): Promise<string> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question(prompt, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  grantAlways(key: string): void {
    this.allowList.add(key);
  }

  denyAlways(key: string): void {
    this.denyList.add(key);
  }

  private evaluateAction(
    action: PermissionAction,
    request: PermissionRequest
  ): PermissionResult {
    switch (action) {
      case 'auto':
        this.audit(request, 'allowed');
        return { allowed: true };
      case 'deny':
        this.audit(request, 'denied');
        return { allowed: false, reason: '权限配置为拒绝' };
      case 'ask':
        this.audit(request, 'pending');
        return { allowed: false, reason: '需要用户确认' };
    }
  }

  private audit(request: PermissionRequest, result: string): void {
    this.persistence.saveAuditLog({
      timestamp: new Date().toISOString(),
      type: request.type,
      target: request.target,
      result,
    });
  }
}
