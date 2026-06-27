// assets/figure3d.js

var SEGS3D = [
  ['shoulderL','shoulderR'],
  ['hipL','hipR'],
  ['shoulderL','hipL'],
  ['shoulderR','hipR'],
  ['shoulderL','elbowL','handL'],
  ['shoulderR','elbowR','handR'],
  ['hipL','kneeL','footL'],
  ['hipR','kneeR','footR'],
];

function mirror3d(pose, axis) {
  var a = (axis == null) ? 60 : axis;
  var swap = { shoulderL:'shoulderR', shoulderR:'shoulderL', elbowL:'elbowR', elbowR:'elbowL',
    handL:'handR', handR:'handL', hipL:'hipR', hipR:'hipL', kneeL:'kneeR', kneeR:'kneeL',
    footL:'footR', footR:'footL' };
  var out = {};
  for (var k in pose) {
    if (k === 'headR') { out[k] = pose[k]; continue; }
    var dst = swap[k] || k, v = pose[k];
    out[dst] = [2 * a - v[0], v[1], -v[2]];
  }
  return out;
}

function createFigure3D(canvas, source, opts) {
  opts = opts || {};
  var ctx = canvas.getContext('2d');
  var W = canvas.width, H = canvas.height;
  var theta = 0.3, phi = 0.1;  // initial rotation (slight angle looks best)
  var drag = false, lastX = 0, lastY = 0;
  var fit = null;              // {lo,hi,c,span} over the whole clip — stable framing
  var userZoom = 1;           // wheel-adjustable zoom on top of auto-fit
  var FITSPAN = 70;          // world units the figure should fill at zoom 1

  function rotateY(pt, t) {
    var x = pt[0], y = pt[1], z = pt[2] || 0;
    return [x * Math.cos(t) - z * Math.sin(t), y, x * Math.sin(t) + z * Math.cos(t)];
  }
  function rotateX(pt, t) {
    var x = pt[0], y = pt[1], z = pt[2] || 0;
    return [x, y * Math.cos(t) - z * Math.sin(t), y * Math.sin(t) + z * Math.cos(t)];
  }

  function computeFit(frames) {
    // bounding box over the WHOLE clip so framing/floor stay put while it plays.
    var lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    frames.forEach(function(p){
      for (var k in p) {
        if (k === 'headR' || !Array.isArray(p[k])) continue;
        var v = p[k];
        for (var a = 0; a < 3; a++) { if (v[a] < lo[a]) lo[a] = v[a]; if (v[a] > hi[a]) hi[a] = v[a]; }
      }
    });
    if (lo[0] > hi[0]) { lo = [0, 0, 0]; hi = [1, 1, 1]; }
    return { lo: lo, hi: hi,
      c: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2],
      span: Math.max(hi[0] - lo[0], hi[1] - lo[1], 1) };
  }

  function modelScale() { return (FITSPAN / fit.span) * userZoom; }

  function project(pt) {
    var fov = Math.min(W, H) * 1.4, dist = 120;
    var z = pt[2] + dist;
    return [W / 2 + (pt[0] * fov) / z, H / 2 - (pt[1] * fov) / z, pt[2]];
  }

  function toView(raw) {        // model coords -> centered, scaled, view-rotated
    var s = modelScale();
    return rotateX(rotateY([(raw[0] - fit.c[0]) * s, (raw[1] - fit.c[1]) * s, ((raw[2] || 0) - fit.c[2]) * s], theta), phi);
  }

  function drawFloor() {
    var s = modelScale();
    var fy = (fit.lo[1] - fit.c[1]) * s;          // ground = lowest point of the clip
    var G = (fit.hi[0] - fit.lo[0]) * s * 0.8 + FITSPAN * 0.4 * userZoom;
    var step = G / 3;
    function plot(p) { return project(rotateX(rotateY(p, theta), phi)); }
    ctx.strokeStyle = 'rgba(92,74,53,0.28)'; ctx.lineWidth = 1;
    for (var gx = -G; gx <= G + 1e-3; gx += step) {
      var a = plot([gx, fy, -G]), b = plot([gx, fy, G]);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    for (var gz = -G; gz <= G + 1e-3; gz += step) {
      var c = plot([-G, fy, gz]), d = plot([G, fy, gz]);
      ctx.beginPath(); ctx.moveTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.stroke();
    }
    return fy;
  }

  function draw(pose) {
    if (!pose) return;
    if (!fit) fit = computeFit([pose]);
    ctx.clearRect(0, 0, W, H);

    var fy = drawFloor();

    var pts = {};
    for (var k in pose) {
      if (k === 'headR' || !Array.isArray(pose[k])) continue;
      pts[k] = toView(pose[k]);
    }

    // soft contact shadow under the pelvis, on the floor plane
    if (pose['hipL'] && pose['hipR']) {
      var s = modelScale();
      var shx = ((pose['hipL'][0] + pose['hipR'][0]) / 2 - fit.c[0]) * s;
      var shz = ((pose['hipL'][2] + pose['hipR'][2]) / 2 - fit.c[2]) * s;
      var sc = project(rotateX(rotateY([shx, fy, shz], theta), phi));
      ctx.save(); ctx.globalAlpha = 0.22; ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(sc[0], sc[1], 22, 6, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }

    // Collect segments with their avg z (for depth sort)
    var segs = [];
    SEGS3D.forEach(function(chain) {
      if (!chain.every(function(k){ return pts[k]; })) return;
      var avgZ = chain.reduce(function(s, k){ return s + pts[k][2]; }, 0) / chain.length;
      segs.push({ chain: chain, avgZ: avgZ });
    });
    segs.sort(function(a, b){ return a.avgZ - b.avgZ; }); // paint far first

    segs.forEach(function(seg) {
      var projected = seg.chain.map(function(k){ return project(pts[k]); });
      var normZ = (seg.avgZ + 30) / 60;
      var alpha = 0.45 + 0.55 * Math.max(0, Math.min(1, normZ));
      ctx.strokeStyle = 'rgba(235,166,60,' + alpha + ')';
      ctx.lineWidth = (seg.chain[0] === 'hipL' || seg.chain[0] === 'hipR') ? 5 : 4;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(projected[0][0], projected[0][1]);
      for (var i = 1; i < projected.length; i++) ctx.lineTo(projected[i][0], projected[i][1]);
      ctx.stroke();
    });

    if (pts['head']) {
      var hp = project(pts['head']);
      var r = (pose.headR || 9) * modelScale() * (Math.min(W, H) * 1.4) / (hp[2] + 120) * 0.9;
      ctx.beginPath();
      ctx.arc(hp[0], hp[1], Math.max(4, r), 0, Math.PI * 2);
      ctx.fillStyle = '#3a2e22'; ctx.fill();
      ctx.strokeStyle = 'rgba(235,166,60,0.75)'; ctx.lineWidth = 2; ctx.stroke();
    }
  }

  // --- animation + side state ---
  var anim = null;        // { fps, frames, mirrorAxis }
  var staticPose = null;  // single pose dict
  var side = 'right';     // 'right' = as captured; 'left' = mirrored
  var raf = null, startTs = 0;

  function setSource(src) {
    if (src && src.frames && src.frames.length) {
      anim = { fps: src.fps || 24, frames: src.frames, mirrorAxis: src.mirrorAxis || 60 };
      staticPose = null;
      fit = computeFit(src.frames);
    } else {
      staticPose = src || null;
      anim = null;
      fit = staticPose ? computeFit([staticPose]) : null;
    }
  }
  setSource(source);

  function applySide(pose) {
    if (!pose) return pose;
    if (side === 'left') return mirror3d(pose, (anim && anim.mirrorAxis) || 60);
    return pose;
  }

  function poseAtTime(ms) {
    var f = anim.frames, n = f.length;
    var dur = n * (1000 / anim.fps);
    var t = ((ms % dur) + dur) % dur;
    var fpos = t / (1000 / anim.fps);
    var i = Math.floor(fpos), j = (i + 1) % n, u = fpos - i;
    var a = f[i], b = f[j], o = {};
    for (var k in a) {
      if (k === 'headR') { o[k] = a[k]; continue; }
      var A = a[k], B = b[k] || a[k];
      o[k] = [A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u, A[2] + (B[2] - A[2]) * u];
    }
    return o;
  }

  function frame(ts) {
    if (!startTs) startTs = ts;
    draw(applySide(poseAtTime(ts - startTs)));
    raf = requestAnimationFrame(frame);
  }

  function render() {
    if (anim) { return; }           // animation drives its own frames
    draw(applySide(staticPose));
  }

  function play() { if (anim && !raf) { startTs = 0; raf = requestAnimationFrame(frame); } }
  function pause() { if (raf) { cancelAnimationFrame(raf); raf = null; } }

  // Pointer events (mouse + touch) — unchanged orbit, but re-render statics on drag.
  canvas.addEventListener('pointerdown', function(e) {
    drag = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', function(e) {
    if (!drag) return;
    var dx = e.clientX - lastX, dy = e.clientY - lastY;
    theta += dx * 0.012; phi += dy * 0.010;
    phi = Math.max(-1.2, Math.min(1.2, phi));
    lastX = e.clientX; lastY = e.clientY;
    if (!anim) render();           // animated views redraw on their own RAF
  });
  canvas.addEventListener('pointerup',     function() { drag = false; });
  canvas.addEventListener('pointercancel', function() { drag = false; });
  canvas.addEventListener('wheel', function(e) {
    e.preventDefault();
    userZoom = Math.max(0.4, Math.min(3, userZoom * Math.exp(-e.deltaY * 0.0015)));
    if (!anim) render();         // animated views redraw on their own RAF
  }, { passive: false });

  if (anim) { play(); } else { render(); }

  return {
    update: function(src) { pause(); setSource(src); startTs = 0; if (anim) { play(); } else render(); },
    setAnimation: function(a) { setSource(a); pause(); play(); },
    setVariant: function(name) {
      if (anim && opts.variants && opts.variants[name]) { setSource({ fps: anim.fps, frames: opts.variants[name], mirrorAxis: anim.mirrorAxis }); pause(); play(); }
    },
    setSide: function(s) { side = (s === 'left') ? 'left' : 'right'; if (!anim) render(); },
    getSide: function() { return side; },
    play: play, pause: pause,
    destroy: function() { pause(); }
  };
}
