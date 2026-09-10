"""Sapiens-1B Goliath-308 top-down 2D pose (torchscript), fp16 on GPU.

Top-down: takes a person bbox per frame, warps the crop to the model's native
1024x768 (HxW) input, runs the ViT, and decodes 308 heatmaps (256x192) back to
full-image pixel coordinates with per-keypoint peak scores.
"""
import cv2
import numpy as np
import torch

INPUT_H, INPUT_W = 1024, 768          # Sapiens native input (H x W)
HEAT_H, HEAT_W = 256, 192             # output heatmap grid (input / 4)
ASPECT = INPUT_W / INPUT_H            # 0.75 (w/h)
PAD = 1.25                            # bbox padding factor
_MEAN = np.array([123.675, 116.28, 103.53], np.float32)
_STD = np.array([58.395, 57.12, 57.375], np.float32)


class SapiensPose:
    def __init__(self, ckpt_path, device="cuda:0", dtype=torch.float16):
        self.device = device
        self.dtype = dtype
        self.model = torch.jit.load(ckpt_path).eval().to(device).to(dtype)
        self.mean = torch.tensor(_MEAN, device=device).view(1, 3, 1, 1)
        self.std = torch.tensor(_STD, device=device).view(1, 3, 1, 1)

    @staticmethod
    def _warp_matrix(bbox_xyxy):
        """Affine mapping image -> (INPUT_W, INPUT_H) for a padded, aspect-fixed bbox.
        Returns (M, Minv)."""
        x0, y0, x1, y1 = bbox_xyxy
        cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
        w, h = max(x1 - x0, 1.0), max(y1 - y0, 1.0)
        if w > ASPECT * h:
            h = w / ASPECT
        else:
            w = ASPECT * h
        w *= PAD
        h *= PAD
        src = np.array([[cx, cy], [cx, cy - h / 2.0], [cx + w / 2.0, cy]], np.float32)
        dst = np.array([[INPUT_W / 2.0, INPUT_H / 2.0],
                        [INPUT_W / 2.0, 0.0],
                        [INPUT_W, INPUT_H / 2.0]], np.float32)
        M = cv2.getAffineTransform(src, dst)
        Minv = cv2.getAffineTransform(dst, src)
        return M, Minv

    def _preprocess(self, frames_rgb, bboxes):
        crops, invs = [], []
        for frame, b in zip(frames_rgb, bboxes):
            M, Minv = self._warp_matrix(b)
            crop = cv2.warpAffine(frame, M, (INPUT_W, INPUT_H), flags=cv2.INTER_LINEAR)
            crops.append(crop)
            invs.append(Minv)
        batch = np.stack(crops).astype(np.float32)              # (N,H,W,3) RGB
        t = torch.from_numpy(batch).to(self.device).permute(0, 3, 1, 2)
        t = (t - self.mean) / self.std
        return t.to(self.dtype), invs

    @staticmethod
    def _decode(heatmaps):
        """heatmaps: (N,308,256,192) tensor -> coords (N,308,2) in input px, scores (N,308).
        Vectorised MMPose-style sub-pixel refinement (nudge 0.25 toward higher neighbour)."""
        N, K, Hh, Wh = heatmaps.shape
        flat = heatmaps.reshape(N, K, -1)
        scores, idx = flat.max(dim=2)
        xi = (idx % Wh)
        yi = (idx // Wh)
        xm1 = (xi - 1).clamp(0, Wh - 1)
        xp1 = (xi + 1).clamp(0, Wh - 1)
        ym1 = (yi - 1).clamp(0, Hh - 1)
        yp1 = (yi + 1).clamp(0, Hh - 1)

        def gather(yy, xx):
            return torch.gather(flat, 2, (yy * Wh + xx).unsqueeze(2)).squeeze(2)

        dx = gather(yi, xp1) - gather(yi, xm1)
        dy = gather(yp1, xi) - gather(ym1, xi)
        xs = xi.float() + 0.25 * torch.sign(dx)
        ys = yi.float() + 0.25 * torch.sign(dy)
        coords = torch.stack([xs * (INPUT_W / Wh), ys * (INPUT_H / Hh)], dim=2)
        return coords.cpu().numpy(), scores.cpu().numpy()

    def _heatmaps(self, t):
        """Image tensor -> (N,308,256,192) float heatmaps. Torchscript path."""
        return self.model(t).float()

    def infer(self, frames_rgb, bboxes):
        """One bbox per frame. frames_rgb: list of HxWx3 uint8 RGB; bboxes: list of
        (x0,y0,x1,y1) image px (same length). Returns kpts (N,308,2) image px, scores (N,308)."""
        t, invs = self._preprocess(frames_rgb, bboxes)
        with torch.inference_mode():
            heat = self._heatmaps(t)
        coords, scores = self._decode(heat)
        out = np.empty_like(coords)
        for n, Minv in enumerate(invs):
            pts = coords[n]
            ones = np.ones((pts.shape[0], 1), np.float32)
            hom = np.concatenate([pts, ones], axis=1)            # (308,3)
            out[n] = (Minv @ hom.T).T                            # back to image px
        return out, scores


class Sapiens2Pose(SapiensPose):
    """Sapiens2-5B (safetensors) via the `sapiens` package: same Goliath-308 output,
    same 256x192 heatmaps, same preprocessing as the torchscript path — only the
    weights load + backbone/head forward differ. Built fp32 on CPU, cast to fp16,
    moved to GPU, then the fp32 state dict is loaded directly onto the GPU (keeps
    host RAM ~20 GB rather than ~40)."""

    def __init__(self, config_path, ckpt_path, device="cuda:0", dtype=torch.float16):
        from safetensors.torch import load_file
        from sapiens.engine.config import Config
        from sapiens.registry import MODELS
        import sapiens.pose.src.models  # noqa: F401  (registers Sapiens2/PoseHeatmapHead/...)
        self.device = device
        self.dtype = dtype
        cfg = Config.fromfile(config_path)
        cfg.model["backbone"].pop("init_cfg", None)              # skip pretrained backbone fetch
        model = MODELS.build(cfg.model).half().to(device).eval()
        sd = load_file(ckpt_path, device=device)
        inc = model.load_state_dict(sd, strict=False)
        assert not inc.missing_keys and not inc.unexpected_keys, (
            len(inc.missing_keys), len(inc.unexpected_keys))
        del sd
        torch.cuda.empty_cache()
        self.model = model
        self.mean = torch.tensor(_MEAN, device=device).view(1, 3, 1, 1)
        self.std = torch.tensor(_STD, device=device).view(1, 3, 1, 1)
        self._patch_attention()

    @staticmethod
    def _padded_sdpa(head_dim, pad_to):
        """Turing (sm_75) has no fast SDPA kernel for head_dim=76 (not %8), so it
        falls back to the slow math path. Zero-padding q/k/v to head_dim=80 makes the
        memory-efficient kernel eligible; padding with zeros leaves Q.Kᵀ and the
        softmax-weighted V unchanged, and we keep the original scale=head_dim**-0.5,
        so the result is numerically identical (modulo fp rounding)."""
        import torch.nn.functional as F
        scale = head_dim ** -0.5
        pad = pad_to - head_dim

        def op(q, k, v, attn_mask=None, dropout_p=0.0, is_causal=False, **kw):
            q = F.pad(q, (0, pad)); k = F.pad(k, (0, pad)); v = F.pad(v, (0, pad))
            o = F.scaled_dot_product_attention(
                q, k, v, attn_mask=attn_mask, dropout_p=dropout_p,
                is_causal=is_causal, scale=scale)
            return o[..., :head_dim]
        return op

    def _patch_attention(self):
        """Swap each attention module's SDPA op for the head_dim-padded variant."""
        n = 0
        for m in self.model.modules():
            if hasattr(m, "attn_op") and hasattr(m, "head_dim"):
                hd = m.head_dim
                if hd % 8:
                    m.attn_op = self._padded_sdpa(hd, ((hd + 7) // 8) * 8)
                    n += 1
        self._patched_attn = n

    def _heatmaps(self, t):
        feat = self.model.backbone(t)                            # tuple -> single featmap
        return self.model.decode_head(feat[0]).float()
