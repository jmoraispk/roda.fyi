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

function createFigure3D(canvas, p3d) {
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

  var currentPose = p3d;

  function render() { draw(currentPose); }

  // Pointer events (mouse + touch)
  canvas.addEventListener('pointerdown', function(e) {
    drag = true; lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', function(e) {
    if (!drag) return;
    var dx = e.clientX - lastX, dy = e.clientY - lastY;
    theta += dx * 0.012; phi += dy * 0.010;
    phi = Math.max(-1.2, Math.min(1.2, phi));
    lastX = e.clientX; lastY = e.clientY;
    render();
  });
  canvas.addEventListener('pointerup',     function() { drag = false; });
  canvas.addEventListener('pointercancel', function() { drag = false; });

  render();

  return {
    update: function(newPose) { currentPose = newPose; render(); },
    destroy: function() {}
  };
}
