const PREVENT_DEFAULT_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space',
]);

export class InputManager {
  private keysDown = new Set<string>();
  private keysJustPressed = new Set<string>();
  private keysJustReleased = new Set<string>();
  private actionMap = new Map<string, string[]>();

  private handleKeyDown: (e: KeyboardEvent) => void;
  private handleKeyUp: (e: KeyboardEvent) => void;

  constructor() {
    this.handleKeyDown = (e: KeyboardEvent) => {
      if (PREVENT_DEFAULT_KEYS.has(e.code)) e.preventDefault();
      if (!this.keysDown.has(e.code)) {
        this.keysJustPressed.add(e.code);
      }
      this.keysDown.add(e.code);
    };

    this.handleKeyUp = (e: KeyboardEvent) => {
      if (PREVENT_DEFAULT_KEYS.has(e.code)) e.preventDefault();
      this.keysDown.delete(e.code);
      this.keysJustReleased.add(e.code);
    };

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
  }

  /** True while the key is held down. */
  isDown(key: string): boolean {
    return this.keysDown.has(key);
  }

  /** True only on the first frame after the key was pressed. */
  justPressed(key: string): boolean {
    return this.keysJustPressed.has(key);
  }

  /** True only on the first frame after the key was released. */
  justReleased(key: string): boolean {
    return this.keysJustReleased.has(key);
  }

  /** Call once per game-loop tick to advance frame state. */
  update(): void {
    this.keysJustPressed.clear();
    this.keysJustReleased.clear();
  }

  /** Map a named action to one or more key codes. */
  mapAction(action: string, ...keys: string[]): void {
    this.actionMap.set(action, keys);
  }

  /** True if any key mapped to the action is currently held. */
  isActionDown(action: string): boolean {
    const keys = this.actionMap.get(action);
    return keys !== undefined && keys.some((k) => this.isDown(k));
  }

  /** True if any key mapped to the action was just pressed this frame. */
  isActionJustPressed(action: string): boolean {
    const keys = this.actionMap.get(action);
    return keys !== undefined && keys.some((k) => this.justPressed(k));
  }

  /** Remove all event listeners. */
  destroy(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
  }
}

const input = new InputManager();
export default input;
