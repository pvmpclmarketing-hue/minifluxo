const appUrl = () => process.env.APP_URL || 'https://minifluxo.vercel.app';

export const LYRIC_VIDEO_THEMES = {
  romantic_rose: {
    name: 'Romântico Rosé',
    accent: '#D89AA8',
    overlayColor: '#1A0F14',
    // Versioned filename prevents render-provider asset cache from serving the prior theme.
    backgroundPath: '/lyric-backgrounds/romantic-rose-template-v2.png',
  },
  night_love: {
    name: 'Noturno Elegante',
    accent: '#C47B5F',
    overlayColor: '#120A0D',
    backgroundPath: '/lyric-backgrounds/night-love.svg',
  },
  soft_gold: {
    name: 'Delicado Premium',
    accent: '#D7B58A',
    overlayColor: '#171312',
    backgroundPath: '/lyric-backgrounds/soft-gold.svg',
  },
};

export function resolveLyricTheme(name) {
  return LYRIC_VIDEO_THEMES[name] ? name : 'romantic_rose';
}

export function lyricThemeAsset(name) {
  const theme = LYRIC_VIDEO_THEMES[resolveLyricTheme(name)];
  return `${appUrl()}${theme.backgroundPath}`;
}
