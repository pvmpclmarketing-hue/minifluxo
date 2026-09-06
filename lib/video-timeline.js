const round = value => Number(value.toFixed(2));

/**
 * Builds a 60 second visual timeline. Image changes overlap by the crossfade
 * duration, but the last image still ends exactly at `duration`.
 */
export function buildPhotoTimeline(photos, { duration = 60, transition = 0.5 } = {}) {
  if (!Array.isArray(photos) || photos.length < 3 || photos.length > 8) {
    throw new Error('O clipe precisa receber entre 3 e 8 fotos.');
  }

  const count = photos.length;
  const safeTransition = Math.min(Math.max(transition, 0.4), 0.7);
  const weights = photos.map((_, index) => {
    if (index === 0) return 1.15;
    if (index === count - 1) return 1.2;
    return 1;
  });
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const available = duration + safeTransition * (count - 1);
  const base = available / totalWeight;
  const motionStrength = count <= 3 ? 0.12 : count <= 5 ? 0.08 : 0.05;
  const motions = ['zoom_in', 'pan_left', 'zoom_out', 'pan_right'];
  let cursor = 0;

  return photos.map((src, index) => {
    const length = index === count - 1
      ? duration - cursor
      : base * weights[index];
    const item = {
      src,
      start: round(cursor),
      end: round(cursor + length),
      length: round(length),
      transition: index === count - 1 ? 0 : safeTransition,
      motion: motions[index % motions.length],
      motionStrength,
    };
    cursor += length - safeTransition;
    return item;
  });
}
