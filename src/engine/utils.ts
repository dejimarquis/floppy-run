// Browser compatibility helpers
export function getAudioContext(): AudioContext {
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  return new AudioCtx();
}

export function requestFullscreen(el: HTMLElement): void {
  if (el.requestFullscreen) el.requestFullscreen();
  else if ((el as any).webkitRequestFullscreen) (el as any).webkitRequestFullscreen();
  else if ((el as any).msRequestFullscreen) (el as any).msRequestFullscreen();
}

export function supportsCanvas(): boolean {
  const canvas = document.createElement('canvas');
  return !!(canvas.getContext && canvas.getContext('2d'));
}
