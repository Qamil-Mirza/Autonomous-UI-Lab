/* GhostLoop v5 characters: line-art ghosts in the brand mascot's style (white body, thick ink line, coral cheeks).
   Each ghost is a small rig redrawn every frame from timeline-owned state, so scrubbing and rendering agree. */
const INK = '#17201d', CORAL = '#ee7375', CORAL_DARK = '#c84f57';

// Body outline with a hem that waves over time. t = timeline seconds, phase = per-ghost offset, amp = wave size.
function ghostBody(t, phase, amp) {
  const lobes = 5, left = 26, right = 134, base = 150;
  let d = `M${left} 94 C${left} 46 50 18 80 18 C110 18 ${right} 46 ${right} 94 L${right} ${base}`;
  const w = (right - left) / lobes;
  for (let i = 0; i < lobes; i++) {
    const x0 = right - i * w, x1 = x0 - w, xm = (x0 + x1) / 2;
    const wave = Math.sin(t * 5.2 + phase + i * 1.3);
    const yb = base + 15 + amp * wave;
    const ye = base + amp * .45 * Math.sin(t * 5.2 + phase + (i + 1) * 1.3);
    d += ` Q${xm.toFixed(1)} ${yb.toFixed(1)} ${x1.toFixed(1)} ${(i === lobes - 1 ? base : ye).toFixed(1)}`;
  }
  return d + ' Z';
}

const MOUTHS = {
  happy: 'M70 100 Q80 110 90 100',
  calm: 'M73 102 Q80 106 87 102',
  worried: 'M71 106 Q80 98 89 106',
  angry: 'M70 108 Q80 97 90 108',
  wow: 'M76 101 Q80 96 84 101 Q80 109 76 101',
};
const BROWS = {
  happy: '', calm: '',
  worried: 'M58 62 L70 58 M102 62 L90 58',
  angry: 'M57 58 L71 65 M103 58 L89 65',
  wow: 'M60 56 Q66 52 72 56 M88 56 Q94 52 100 56',
};

function ghostSVG(kind) {
  let prop = '';
  // Curious: a little magnifying glass held at the side.
  if (kind === 'curious') prop = `<g class="prop"><circle cx="146" cy="104" r="15" fill="#ffffffcc" stroke="${INK}" stroke-width="6"/><path d="M135 116 L122 130" stroke="${INK}" stroke-width="7" stroke-linecap="round"/></g>`;
  // In a hurry: coral sweatband.
  if (kind === 'hurry') prop = `<g class="prop"><path d="M30 60 Q80 44 130 60" fill="none" stroke="${CORAL}" stroke-width="11" stroke-linecap="round"/><path d="M128 58 l14 -10 M128 60 l16 4" stroke="${CORAL}" stroke-width="7" stroke-linecap="round"/></g>`;
  // Careful: round glasses.
  if (kind === 'careful') prop = `<g class="prop face-prop"><g fill="none" stroke="${INK}" stroke-width="5"><circle cx="66" cy="80" r="15"/><circle cx="94" cy="80" r="15"/><path d="M78 79 h4 M51 77 l-12 -5 M109 77 l12 -5"/></g></g>`;
  return `<svg viewBox="-10 -10 180 200" xmlns="http://www.w3.org/2000/svg">
<path class="body" d="${ghostBody(0, 0, 0)}" fill="#fff" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>
<path d="M40 70 C42 52 52 38 64 32" fill="none" stroke="#17201d1c" stroke-width="7" stroke-linecap="round"/>
<g class="face"><g class="eyes"><ellipse cx="66" cy="80" rx="5.5" ry="8" fill="${INK}"/><ellipse cx="94" cy="80" rx="5.5" ry="8" fill="${INK}"/><circle class="glint" cx="68" cy="76" r="2" fill="#fff"/><circle class="glint" cx="96" cy="76" r="2" fill="#fff"/></g>
<path class="brows" d="" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
<path class="mouth" d="${MOUTHS.happy}" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="50" cy="96" r="7.5" fill="${CORAL}" opacity=".9"/><circle cx="110" cy="96" r="7.5" fill="${CORAL}" opacity=".9"/>${kind === 'careful' ? prop : ''}</g>
${kind !== 'careful' ? prop : ''}
<path class="arm-l" d="M28 112 Q10 118 12 132" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>
<path class="arm-r" d="M132 112 Q150 118 148 132" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>
</svg>`;
}

function pointer() {
  return `<svg viewBox="0 0 40 48"><path d="M4 3v36l10-10 8 15 8-5-8-14 14-2Z" fill="${INK}" stroke="#fff" stroke-width="3" stroke-linejoin="round"/></svg>`;
}
