// Sprite sheet and animation system for pixel-art rendering

export interface SpriteFrameData {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DrawOptions {
  scale?: number;
  flipX?: boolean;
  flipY?: boolean;
  alpha?: number;
  rotation?: number;
}

const imageCache = new Map<string, HTMLImageElement>();

function loadImage(url: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(url);
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      imageCache.set(url, img);
      resolve(img);
    };
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

/** Draw an image with nearest-neighbor scaling for crisp pixel art. */
export function drawPixelImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, x, y, width, height);
  ctx.imageSmoothingEnabled = prev;
}

export class SpriteSheet {
  readonly image: HTMLImageElement;
  readonly frames: SpriteFrameData[];

  private constructor(image: HTMLImageElement, frames: SpriteFrameData[]) {
    this.image = image;
    this.frames = frames;
  }

  /** Load an image and divide it into a uniform grid of frames. */
  static async load(
    imageUrl: string,
    frameWidth: number,
    frameHeight: number,
  ): Promise<SpriteSheet> {
    const image = await loadImage(imageUrl);
    const cols = Math.floor(image.naturalWidth / frameWidth);
    const rows = Math.floor(image.naturalHeight / frameHeight);
    const frames: SpriteFrameData[] = [];

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        frames.push({
          x: col * frameWidth,
          y: row * frameHeight,
          width: frameWidth,
          height: frameHeight,
        });
      }
    }

    return new SpriteSheet(image, frames);
  }

  /** Load with explicit frame definitions for non-uniform sprite sheets. */
  static async loadWithData(
    imageUrl: string,
    data: SpriteFrameData[],
  ): Promise<SpriteSheet> {
    const image = await loadImage(imageUrl);
    return new SpriteSheet(image, data);
  }

  /** Draw a single frame at the given position. */
  drawFrame(
    ctx: CanvasRenderingContext2D,
    frameIndex: number,
    x: number,
    y: number,
    options: DrawOptions = {},
  ): void {
    const frame = this.frames[frameIndex];
    if (!frame) return;

    const {
      scale = 1,
      flipX = false,
      flipY = false,
      alpha,
      rotation = 0,
    } = options;

    const w = frame.width * scale;
    const h = frame.height * scale;

    ctx.save();
    ctx.imageSmoothingEnabled = false;

    if (alpha !== undefined) {
      ctx.globalAlpha = alpha;
    }

    ctx.translate(x + w / 2, y + h / 2);

    if (rotation) {
      ctx.rotate(rotation);
    }

    ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);

    ctx.drawImage(
      this.image,
      frame.x,
      frame.y,
      frame.width,
      frame.height,
      -w / 2,
      -h / 2,
      w,
      h,
    );

    ctx.restore();
  }
}

export class SpriteAnimation {
  private readonly spriteSheet: SpriteSheet;
  private readonly frames: number[];
  private readonly frameDuration: number;
  private elapsed = 0;
  private _currentFrame = 0;

  loop = true;

  constructor(
    spriteSheet: SpriteSheet,
    frames: number[],
    frameDuration: number,
  ) {
    this.spriteSheet = spriteSheet;
    this.frames = frames;
    this.frameDuration = frameDuration;
  }

  get currentFrame(): number {
    return this.frames[this._currentFrame];
  }

  /** Advance the animation timer by dt seconds. */
  update(dt: number): void {
    if (this.frames.length === 0) return;
    if (!this.loop && this._currentFrame >= this.frames.length - 1) return;

    this.elapsed += dt;

    while (this.elapsed >= this.frameDuration) {
      this.elapsed -= this.frameDuration;
      this._currentFrame++;

      if (this._currentFrame >= this.frames.length) {
        if (this.loop) {
          this._currentFrame = 0;
        } else {
          this._currentFrame = this.frames.length - 1;
          this.elapsed = 0;
          break;
        }
      }
    }
  }

  /** Draw the current animation frame. */
  draw(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    options?: DrawOptions,
  ): void {
    this.spriteSheet.drawFrame(ctx, this.currentFrame, x, y, options);
  }

  /** Restart animation from frame 0. */
  reset(): void {
    this._currentFrame = 0;
    this.elapsed = 0;
  }

  /** True if a non-looping animation has reached its last frame. */
  isComplete(): boolean {
    return !this.loop && this._currentFrame >= this.frames.length - 1;
  }
}
