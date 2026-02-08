let canvas: HTMLCanvasElement | null = null
let gameContainer: HTMLDivElement | null = null
let exitHint: HTMLDivElement | null = null
let pauseOverlay: HTMLDivElement | null = null
let resizeHandler: (() => void) | null = null
let keyHandler: ((e: KeyboardEvent) => void) | null = null
let visibilityHandler: (() => void) | null = null
let pauseClickHandler: (() => void) | null = null
let pauseKeyHandler: ((e: KeyboardEvent) => void) | null = null
let isPaused = false
let onExitCallback: (() => void) | null = null
let currentGameUnmount: (() => void) | null = null

export function getCanvas(): HTMLCanvasElement | null {
  return canvas
}

export function setOnExit(cb: () => void): void {
  onExitCallback = cb
}

export function mountGame(slug: string): void {
  const app = document.getElementById('app')
  if (!app) return

  app.innerHTML = ''

  // Game container
  gameContainer = document.createElement('div')
  gameContainer.className = 'game-container'

  // Canvas
  canvas = document.createElement('canvas')
  canvas.className = 'game-canvas'
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
  gameContainer.appendChild(canvas)

  // Exit hint
  exitHint = document.createElement('div')
  exitHint.className = 'exit-hint'
  exitHint.textContent = 'ESC to exit'
  gameContainer.appendChild(exitHint)

  // Pause overlay
  pauseOverlay = document.createElement('div')
  pauseOverlay.className = 'pause-overlay'
  pauseOverlay.innerHTML = '<span>PAUSED</span><p>Click or press any key to resume</p>'
  pauseOverlay.style.display = 'none'
  gameContainer.appendChild(pauseOverlay)

  app.appendChild(gameContainer)

  // Fade out exit hint after 3 seconds
  setTimeout(() => {
    if (exitHint) exitHint.classList.add('fade-out')
  }, 3000)

  // Draw placeholder while loading
  drawPlaceholder(slug)

  // Dynamically load the game module
  loadGameModule(slug)

  // ESC key handler
  keyHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && onExitCallback) {
      onExitCallback()
    }
  }
  document.addEventListener('keydown', keyHandler)

  // Resize handler
  resizeHandler = () => {
    if (canvas) {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
      if (!currentGameUnmount) drawPlaceholder(slug)
    }
  }
  window.addEventListener('resize', resizeHandler)

  // Pause on visibility change (tab switch)
  visibilityHandler = () => {
    if (document.hidden) {
      showPause()
    }
  }
  document.addEventListener('visibilitychange', visibilityHandler)

  // Resume on click
  pauseClickHandler = () => {
    if (isPaused) hidePause()
  }
  pauseOverlay.addEventListener('click', pauseClickHandler)

  // Resume on keypress
  pauseKeyHandler = (e: KeyboardEvent) => {
    if (isPaused && e.key !== 'Escape') {
      hidePause()
    }
  }
  document.addEventListener('keydown', pauseKeyHandler)
}

function showPause(): void {
  isPaused = true
  if (pauseOverlay) pauseOverlay.style.display = 'flex'
}

function hidePause(): void {
  isPaused = false
  if (pauseOverlay) pauseOverlay.style.display = 'none'
}

async function loadGameModule(slug: string): Promise<void> {
  try {
    const modules: Record<string, () => Promise<{ mount: (c: HTMLCanvasElement) => void; unmount: () => void }>> = {
      'space-pinball': () => import('../games/space-pinball/index'),
      'road-rage': () => import('../games/road-rage/index'),
    }
    const loader = modules[slug]
    if (loader && canvas) {
      const mod = await loader()
      if (canvas) {
        mod.mount(canvas)
        currentGameUnmount = mod.unmount
      }
    }
  } catch (err) {
    console.error(`Failed to load game "${slug}":`, err)
    // Show error on canvas so user can see it
    if (canvas) {
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#0a0a0a'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.fillStyle = '#ff0000'
        ctx.font = '20px "Press Start 2P", monospace'
        ctx.textAlign = 'center'
        ctx.fillText('ERROR LOADING GAME', canvas.width / 2, canvas.height / 2 - 40)
        ctx.fillStyle = '#ff6666'
        ctx.font = '12px monospace'
        const msg = err instanceof Error ? err.message : String(err)
        // Word wrap the error message
        const words = msg.split(' ')
        let line = ''
        let y = canvas.height / 2
        for (const word of words) {
          if ((line + word).length > 60) {
            ctx.fillText(line, canvas.width / 2, y)
            y += 18
            line = word + ' '
          } else {
            line += word + ' '
          }
        }
        ctx.fillText(line, canvas.width / 2, y)
      }
    }
  }
}

function drawPlaceholder(slug: string): void {
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.fillStyle = '#0a0a0a'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.fillStyle = '#00ff00'
  ctx.font = '24px "Press Start 2P", monospace'
  ctx.textAlign = 'center'
  ctx.fillText('COMING SOON', canvas.width / 2, canvas.height / 2 - 20)

  ctx.fillStyle = '#00ffff'
  ctx.font = '14px "Press Start 2P", monospace'
  ctx.fillText(slug, canvas.width / 2, canvas.height / 2 + 20)
}

export function unmountGame(): void {
  if (currentGameUnmount) {
    currentGameUnmount()
    currentGameUnmount = null
  }
  if (keyHandler) {
    document.removeEventListener('keydown', keyHandler)
    keyHandler = null
  }
  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler)
    resizeHandler = null
  }
  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler)
    visibilityHandler = null
  }
  if (pauseKeyHandler) {
    document.removeEventListener('keydown', pauseKeyHandler)
    pauseKeyHandler = null
  }
  if (pauseOverlay && pauseClickHandler) {
    pauseOverlay.removeEventListener('click', pauseClickHandler)
    pauseClickHandler = null
  }

  isPaused = false
  canvas = null
  gameContainer = null
  exitHint = null
  pauseOverlay = null

  const app = document.getElementById('app')
  if (app) app.innerHTML = ''
}
