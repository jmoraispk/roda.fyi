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

  function rotateY(pt, t) {
    var x = pt[0], y = pt[1], z = pt[2] || 0;
    return [x * Math.cos(t) - z * Math.sin(t), y, x * Math.sin(t) + z * Math.cos(t)];
  }
  function rotateX(pt, t) {
    var x = pt[0], y = pt[1], z = pt[2] || 0;
    return [x, y * Math.cos(t) - z * Math.sin(t), y * Math.sin(t) + z * Math.cos(t)];
  }

  function centroid(pts) {
    var cx = 0, cy = 0, cz = 0, n = pts.length;
    pts.forEach(function(p){ cx += p[0]; cy += p[1]; cz += (p[2]||0); });
    return [cx/n, cy/n, cz/n];
  }

  function project(pt) {
    var fov = Math.min(W, H) * 1.4;
    var dist = 120;
    var x = pt[0], y = pt[1], z = pt[2] + dist;
    return [W/2 + (x * fov) / z, H/2 - (y * fov) / z, pt[2]];
  }

  function draw(pose) {
    if (!pose) return;
    ctx.clearRect(0, 0, W, H);

    // Build joint map, normalise to centre of figure
    var keys = Object.keys(pose).filter(function(k){ return k !== 'headR' && Array.isArray(pose[k]); });
    var c = centroid(keys.map(function(k){ return pose[k]; }));
    // Shift origin to figure centroid at y=0 (mid-height)
    var centY = c[1];
    var pts = {};
    keys.forEach(function(k){
      var raw = pose[k];
      pts[k] = rotateX(rotateY([raw[0]-c[0], raw[1]-centY, raw[2]||0], theta), phi);
    });

    // Collect segments with their avg z (for depth sort)
    var segs = [];
    SEGS3D.forEach(function(chain) {
      // verify all joints in pose
      var valid = chain.every(function(k){ return pts[k]; });
      if (!valid) return;
      var avgZ = chain.reduce(function(s,k){ return s + pts[k][2]; }, 0) / chain.length;
      segs.push({ chain: chain, avgZ: avgZ });
    });
    segs.sort(function(a,b){ return a.avgZ - b.avgZ; }); // paint far first

    segs.forEach(function(seg) {
      var projected = seg.chain.map(function(k){ return project(pts[k]); });
      // Depth tint: near joints are brighter
      var normZ = (seg.avgZ + 30) / 60; // roughly -30 to +30 range → 0..1
      var alpha = 0.45 + 0.55 * Math.max(0, Math.min(1, normZ));
      ctx.strokeStyle = 'rgba(235,166,60,' + alpha + ')';
      ctx.lineWidth = seg.chain[0].startsWith('leg') || seg.chain[0] === 'hipL' || seg.chain[0] === 'hipR' ? 5 : 4;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(projected[0][0], projected[0][1]);
      for (var i = 1; i < projected.length; i++) ctx.lineTo(projected[i][0], projected[i][1]);
      ctx.stroke();
    });

    // Head
    if (pts['head']) {
      var hp = project(pts['head']);
      var r = (pose.headR || 9) * (Math.min(W, H) * 1.4) / (hp[2] + 120) * 0.9;
      ctx.beginPath();
      ctx.arc(hp[0], hp[1], Math.max(4, r), 0, Math.PI * 2);
      ctx.fillStyle = '#3a2e22';
      ctx.fill();
      ctx.strokeStyle = 'rgba(235,166,60,0.75)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Axis ring (faint ground-plane circle to help with spatial orientation)
    ctx.beginPath();
    ctx.ellipse(W/2, H * 0.78, 60, 60 * Math.abs(Math.sin(phi + 0.35)), 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(92,74,53,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
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
    } else {
      staticPose = src || null;
      anim = null;
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

  if (anim) { play(); } else { render(); }

  return {
    update: function(src) { setSource(src); startTs = 0; if (anim) { pause(); play(); } else render(); },
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
