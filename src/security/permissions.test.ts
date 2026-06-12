import { PermissionManager } from '../security/permissions.js';
import { DEFAULT_CONFIG } from '../model/types.js';
import type { PersistenceManager } from '../engine/persistence.js';

function createMockPersistence(): PersistenceManager {
  return {
    saveAuditLog: () => {},
  } as unknown as PersistenceManager;
}

describe('PermissionManager', () => {
  let pm: PermissionManager;

  beforeEach(() => {
    pm = new PermissionManager(DEFAULT_CONFIG, createMockPersistence());
  });

  test('file read auto-allowed', () => {
    const result = pm.check({ type: 'file_read', target: 'src/main.ts' });
    expect(result.allowed).toBe(true);
  });

  test('denylisted command rejected', () => {
    const result = pm.check({ type: 'command', target: 'rm -rf /' });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('黑名单');
  });

  test('git push --force rejected', () => {
    const result = pm.check({ type: 'command', target: 'git push --force origin main' });
    expect(result.allowed).toBe(false);
  });

  test('file write in ask mode requires confirmation', () => {
    const result = pm.check({ type: 'file_write', target: 'src/new-file.ts' });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('确认');
  });

  test('grant always auto-allows', () => {
    pm.grantAlways('write:src/auto.ts');
    const result = pm.check({ type: 'file_write', target: 'src/auto.ts' });
    expect(result.allowed).toBe(true);
  });
});
