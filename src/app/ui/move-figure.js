// src/app/ui/move-figure.js
const SVG = 'http://www.w3.org/2000/svg';
const DEFAULT_POSE = Object.freeze({
  head: [60, 22], shoulder: [58, 40], hip: [60, 84],
  elbowL: [44, 50], handL: [40, 64], elbowR: [72, 50], handR: [78, 62],
  kneeL: [50, 114], footL: [46, 150], kneeR: [72, 114], footR: [76, 150], headR: 9,
});
const LIMBS = Object.freeze({
  torso: ['shoulder', 'hip'],
  legL: ['hip', 'kneeL', 'footL'],
  legR: ['hip', 'kneeR', 'footR'],
  armL: ['shoulder', 'elbowL', 'handL'],
  armR: ['shoulder', 'elbowR', 'handR'],
});

function polyline(document, points, width, className) {
  const line = document.createElementNS(SVG, 'polyline');
  line.setAttribute('points', points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
  line.setAttribute('class', className);
  line.setAttribute('stroke-width', String(width));
  return line;
}

export function figureSvg(document, entry) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 120 160');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'move-figure');
  if (!entry.pose) {
    const text = document.createElementNS(SVG, 'text');
    text.setAttribute('x', '60');
    text.setAttribute('y', '92');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('class', 'move-figure-placeholder');
    text.textContent = entry.name.split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase();
    svg.append(text);
    return svg;
  }
  const joints = { ...DEFAULT_POSE, ...entry.pose };
  for (const [name, keys] of Object.entries(LIMBS)) {
    svg.append(polyline(document, keys.map((key) => joints[key]), name === 'torso' ? 11 : 9, 'move-figure-body'));
  }
  const head = document.createElementNS(SVG, 'circle');
  head.setAttribute('cx', String(joints.head[0]));
  head.setAttribute('cy', String(joints.head[1]));
  head.setAttribute('r', String(joints.headR ?? 9));
  head.setAttribute('class', 'move-figure-head');
  svg.append(head);
  if (entry.highlight && LIMBS[entry.highlight]) {
    svg.append(polyline(document, LIMBS[entry.highlight].map((key) => joints[key]), 9, 'move-figure-highlight'));
  }
  return svg;
}
