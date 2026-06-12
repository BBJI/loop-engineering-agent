import ansiEscapes from 'ansi-escapes';

export interface StatusBarState {
  version: string;
  model: string;
  phase: string;
  cost: string;
}

export class StatusBar {
  private state: StatusBarState;
  private enabled = false;
  private supported = false;

  constructor(initial: StatusBarState) {
    this.state = initial;
    this.detectSupport();
  }

  private detectSupport(): void {
    const term = process.env.TERM || '';
    const termProgram = process.env.TERM_PROGRAM || '';
    this.supported =
      termProgram === 'iTerm.app' ||
      termProgram === 'Hyper' ||
      term.includes('xterm') ||
      term.includes('alacritty') ||
      process.env.WT_SESSION !== undefined ||
      process.env.ConEmuPID !== undefined;
  }

  enable(): void {
    if (!this.supported) return;
    this.enabled = true;
    process.stdout.write(ansiEscapes.cursorSavePosition);
    this.render();
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
  }

  update(partial: Partial<StatusBarState>): void {
    Object.assign(this.state, partial);
    if (this.enabled) this.render();
  }

  private render(): void {
    if (!this.supported || !process.stdout.isTTY) return;

    const line = `  LEA v${this.state.version}  │  Model: ${this.state.model}  │  Phase: ${this.state.phase}  │  ${this.state.cost}`;

    process.stdout.write(ansiEscapes.cursorTo(0, 0));
    process.stdout.write(ansiEscapes.eraseLine);
    process.stdout.write(line);
    process.stdout.write(ansiEscapes.cursorRestorePosition);
  }
}
