import { ArtifactManager } from '../engine/artifacts.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ArtifactManager', () => {
  let am: ArtifactManager;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `lea-artifact-test-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    am = new ArtifactManager(tmpDir, '.lea/state');
    am.init();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('保存并读取制品版本', () => {
    const v = am.saveArtifact('req', 'docs/requirements.md', 'v1 content', '初始版本');
    expect(v).toBe(1);

    const versions = am.listVersions('req', 'docs/requirements.md');
    expect(versions).toHaveLength(1);
    expect(versions[0].version).toBe(1);
    expect(versions[0].reason).toBe('初始版本');
  });

  test('多个版本递增', () => {
    am.saveArtifact('req', 'docs/requirements.md', 'v1', '初始');
    const v2 = am.saveArtifact('req', 'docs/requirements.md', 'v2 updated', '回退修改');
    expect(v2).toBe(2);

    const versions = am.listVersions('req', 'docs/requirements.md');
    expect(versions).toHaveLength(2);
  });

  test('读取特定版本内容', () => {
    am.saveArtifact('req', 'docs/requirements.md', 'content v1', 'v1');
    am.saveArtifact('req', 'docs/requirements.md', 'content v2', 'v2');

    const v1Content = am.getVersion('req', 'docs/requirements.md', 1);
    expect(v1Content).toBe('content v1');

    const v2Content = am.getVersion('req', 'docs/requirements.md', 2);
    expect(v2Content).toBe('content v2');
  });

  test('版本对比', () => {
    am.saveArtifact('req', 'docs/req.md', 'old content', 'v1');
    am.saveArtifact('req', 'docs/req.md', 'new content', 'v2');

    const diff = am.diff('req', 'docs/req.md', 1, 2);
    expect(diff.old).toBe('old content');
    expect(diff.new).toBe('new content');
  });

  test('不存在的版本返回 null', () => {
    const content = am.getVersion('req', 'nonexistent.md', 1);
    expect(content).toBeNull();
  });

  test('不存在的制品版本列表为空', () => {
    const versions = am.listVersions('design', 'nonexistent.md');
    expect(versions).toHaveLength(0);
  });
});
