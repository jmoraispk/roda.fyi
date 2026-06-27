"""Roda video motion-capture pipeline (pure numpy/scipy modules).

Modules:
  geom      - 3D skeleton defs + rotations + mirror
  segment   - energy/rest/active span detection + stance/facing classifiers
  align     - phase-align (time-normalize) + average reps
  fuse      - rotate views to a common frame + inverse-variance fusion
  retarget  - MediaPipe-33 -> Roda joints + normalize into the viewBox
  io_formats- json/js load+save helpers
"""
