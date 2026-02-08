import { mountGame, unmountGame, setOnExit } from './game-page'
import { renderHomepage } from './homepage'

type Route = '/' | 'game'
let currentRoute: Route | null = null
let currentSlug: string | null = null

const GAME_SLUGS = ['ping-pong', 'road-rage']

function parseRoute(path: string): { route: Route; slug: string | null } {
  const cleaned = path.replace(/\/+$/, '') || '/'
  const match = cleaned.match(/^\/play\/([a-z0-9-]+)$/)
  if (match && GAME_SLUGS.includes(match[1])) {
    return { route: 'game', slug: match[1] }
  }
  return { route: '/', slug: null }
}

function handleRoute(): void {
  const { route, slug } = parseRoute(window.location.pathname)

  // Same route, nothing to do
  if (route === currentRoute && slug === currentSlug) return

  // Cleanup current game if active
  if (currentRoute === 'game') {
    unmountGame()
  }

  // Mount new route
  if (route === 'game' && slug) {
    currentRoute = 'game'
    currentSlug = slug
    mountGame(slug)
  } else {
    currentRoute = '/'
    currentSlug = null
    renderHomepage()
  }
}

export function navigateTo(path: string): void {
  window.history.pushState({}, '', path)
  handleRoute()
}

export function initRouter(): void {
  // Register ESC exit callback
  setOnExit(() => navigateTo('/'))

  // Handle browser back/forward
  window.addEventListener('popstate', handleRoute)

  // Intercept clicks on internal links
  document.addEventListener('click', (e: MouseEvent) => {
    const target = (e.target as HTMLElement).closest('a')
    if (!target) return

    const href = target.getAttribute('href')
    if (!href || href.startsWith('http') || href.startsWith('//')) return

    e.preventDefault()
    navigateTo(href)
  })

  // Handle initial route
  handleRoute()
}
