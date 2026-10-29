/* Original line-art ghosts for the launch film, drawn to match the GhostLoop mascot's hand-drawn stroke style. */
function lineGhost(kind = 'plain', mood = 'happy') {
  const ink = '#17201d', coral = '#ee7375';
  const body = 'M24 66 C22 34 40 16 60 15 C82 14 100 34 98 68 L99 110 C94 118 86 118 80 110 C74 103 66 103 60 111 C54 118 46 118 40 110 C34 104 28 106 24 112 Z';
  const eyes = mood === 'worried'
    ? `<ellipse cx="47" cy="58" rx="4" ry="6" fill="${ink}"/><ellipse cx="73" cy="56" rx="4" ry="6" fill="${ink}"/><path d="M40 46 L52 50 M80 46 L68 50" stroke="${ink}" stroke-width="3.5" stroke-linecap="round"/><path d="M53 78 Q60 72 67 78" fill="none" stroke="${ink}" stroke-width="3.5" stroke-linecap="round"/>`
    : mood === 'happy'
    ? `<ellipse cx="47" cy="58" rx="4.5" ry="6.5" fill="${ink}"/><ellipse cx="73" cy="58" rx="4.5" ry="6.5" fill="${ink}"/><path d="M52 76 Q60 84 68 76" fill="none" stroke="${ink}" stroke-width="3.5" stroke-linecap="round"/>`
    : `<ellipse cx="47" cy="58" rx="4.5" ry="6.5" fill="${ink}"/><ellipse cx="73" cy="58" rx="4.5" ry="6.5" fill="${ink}"/>`;
  const cheeks = `<circle cx="36" cy="70" r="5" fill="${coral}" opacity=".85"/><circle cx="84" cy="70" r="5" fill="${coral}" opacity=".85"/>`;
  let props = '';
  if (kind === 'speedy') props = `<path d="M6 60 H18 M2 74 H16 M8 88 H18" stroke="${ink}" stroke-width="3.5" stroke-linecap="round" opacity=".7"/>`;
  if (kind === 'careful') props = `<g fill="none" stroke="${ink}" stroke-width="3"><circle cx="47" cy="58" r="12"/><circle cx="73" cy="58" r="12"/><path d="M59 58 h2 M35 56 l-8 -3 M85 56 l8 -3"/></g>`;
  if (kind === 'curious') props = `<path d="M60 8 C66 -2 80 2 76 12" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>`;
  return `<svg viewBox="0 0 120 130" xmlns="http://www.w3.org/2000/svg"><path d="${body}" fill="#fff" stroke="${ink}" stroke-width="5" stroke-linejoin="round"/><path d="M30 46 C32 34 40 26 50 24" fill="none" stroke="#17201d22" stroke-width="5" stroke-linecap="round"/>${eyes}${cheeks}${props}</svg>`;
}
function pointer(color = '#17201d') {
  return `<svg viewBox="0 0 40 48"><path d="M4 3v36l10-10 8 15 8-5-8-14 14-2Z" fill="${color}" stroke="#fff" stroke-width="2.8" stroke-linejoin="round"/></svg>`;
}
