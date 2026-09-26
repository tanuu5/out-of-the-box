import './style.css';
import { Game } from './Game';
import { setLang, t } from './i18n';
import { loadSettings } from './systems/Save';

async function boot(): Promise<void> {
  setLang(loadSettings().lang);
  const stage = document.getElementById('stage')!;
  const ui = document.getElementById('ui')!;
  const loading = document.createElement('div');
  loading.className = 'loading';
  loading.textContent = 'BOOTING SANDBOX …';
  document.getElementById('app')!.appendChild(loading);

  const probe = document.createElement('canvas');
  if (!probe.getContext('webgl2')) {
    loading.remove();
    const f = document.createElement('div');
    f.className = 'fatal';
    f.innerText = t('fatal.webgl');
    document.getElementById('app')!.appendChild(f);
    return;
  }

  // 掲示板の文字を描く前にフォントを読み込む（失敗しても続行）
  try {
    await Promise.race([
      Promise.all([document.fonts.load('400 24px "M PLUS 1 Code"'), document.fonts.load('700 24px "M PLUS 1 Code"')]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch {
    /* noop */
  }

  const game = new Game(stage, ui);
  if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game;
  await game.start();
  loading.style.opacity = '0';
  setTimeout(() => loading.remove(), 700);
}

void boot();
