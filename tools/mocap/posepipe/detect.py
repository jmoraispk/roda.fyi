"""Single-person bbox per frame via Ultralytics YOLO (class 0 = person).

The capture footage is one performer, so we keep the dominant detection
(score x area, with light continuity to the previous box) and return None when
nothing confident is found.
"""
import numpy as np
from ultralytics import YOLO


class PersonDetector:
    def __init__(self, weights="yolo11x.pt", device="cuda:0", conf=0.35, imgsz=1280):
        self.model = YOLO(weights)
        self.device = device
        self.conf = conf
        self.imgsz = imgsz
        self._prev = None

    def detect_batch(self, frames_rgb):
        """frames_rgb: list of HxWx3 uint8 RGB. Returns list of (x0,y0,x1,y1) or None."""
        res = self.model.predict(frames_rgb, classes=[0], conf=self.conf, imgsz=self.imgsz,
                                 device=self.device, verbose=False)
        out = []
        for r in res:
            b = r.boxes
            if b is None or len(b) == 0:
                out.append(None)
                continue
            xyxy = b.xyxy.cpu().numpy()
            scores = b.conf.cpu().numpy()
            areas = (xyxy[:, 2] - xyxy[:, 0]) * (xyxy[:, 3] - xyxy[:, 1])
            rank = scores * np.sqrt(areas)
            if self._prev is not None:
                pcx = (self._prev[0] + self._prev[2]) / 2
                pcy = (self._prev[1] + self._prev[3]) / 2
                cx = (xyxy[:, 0] + xyxy[:, 2]) / 2
                cy = (xyxy[:, 1] + xyxy[:, 3]) / 2
                diag = np.sqrt(areas) + 1e-6
                dist = np.sqrt((cx - pcx) ** 2 + (cy - pcy) ** 2) / diag
                rank = rank * np.exp(-0.5 * dist)
            best = xyxy[int(np.argmax(rank))]
            self._prev = best
            out.append(tuple(float(v) for v in best))
        return out
