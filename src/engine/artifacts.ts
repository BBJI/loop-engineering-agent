import * as fs from 'fs';
import * as path from 'path';
import type { Phase } from '../utils/constants.js';

export interface ArtifactVersion {
  version: number;
  path: string;
  createdAt: string;
  reason: string;
}

export class ArtifactManager {
  private versionsDir: string;

  constructor(projectDir: string, stateDir: string) {
    this.versionsDir = path.join(projectDir, stateDir, 'artifacts');
  }

  init(): void {
    if (!fs.existsSync(this.versionsDir)) {
      fs.mkdirSync(this.versionsDir, { recursive: true });
    }
  }

  saveArtifact(phase: Phase, artifactPath: string, content: string, reason: string): number {
    this.init();

    const phaseDir = path.join(this.versionsDir, phase);
    if (!fs.existsSync(phaseDir)) {
      fs.mkdirSync(phaseDir, { recursive: true });
    }

    const versions = this.listVersions(phase, artifactPath);
    const nextVersion = versions.length + 1;

    const entry: ArtifactVersion = {
      version: nextVersion,
      path: artifactPath,
      createdAt: new Date().toISOString(),
      reason,
    };

    const versionFile = path.join(phaseDir, this.sanitizePath(artifactPath) + '.jsonl');
    fs.appendFileSync(versionFile, JSON.stringify(entry) + '\n', 'utf-8');

    const contentFile = path.join(phaseDir, `${this.sanitizePath(artifactPath)}-v${nextVersion}`);
    const contentDir = path.dirname(contentFile);
    if (!fs.existsSync(contentDir)) {
      fs.mkdirSync(contentDir, { recursive: true });
    }
    fs.writeFileSync(contentFile, content, 'utf-8');

    return nextVersion;
  }

  listVersions(phase: Phase, artifactPath: string): ArtifactVersion[] {
    this.init();

    const versionFile = path.join(this.versionsDir, phase, this.sanitizePath(artifactPath) + '.jsonl');
    if (!fs.existsSync(versionFile)) return [];

    const lines = fs.readFileSync(versionFile, 'utf-8').trim().split('\n').filter(Boolean);
    return lines.map((line) => JSON.parse(line) as ArtifactVersion);
  }

  getVersion(phase: Phase, artifactPath: string, version: number): string | null {
    this.init();

    const contentFile = path.join(
      this.versionsDir, phase,
      `${this.sanitizePath(artifactPath)}-v${version}`
    );

    if (!fs.existsSync(contentFile)) return null;
    return fs.readFileSync(contentFile, 'utf-8');
  }

  diff(phase: Phase, artifactPath: string, v1: number, v2: number): { old: string | null; new: string | null } {
    return {
      old: this.getVersion(phase, artifactPath, v1),
      new: this.getVersion(phase, artifactPath, v2),
    };
  }

  private sanitizePath(p: string): string {
    return p.replace(/[/\\:]/g, '_').replace(/[^a-zA-Z0-9_.-]/g, '');
  }
}
