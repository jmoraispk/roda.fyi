"""Vendored MotionBERT DSTformer (Walter0807/MotionBERT, Apache-2.0).

Trimmed to the inference path used for 2D->3D lifting (the `FT_MB_release_MB_ft_h36m`
checkpoint): dim_feat=512, depth=5, mlp_ratio=2, num_heads=8, att_fuse=True,
maxlen=243, num_joints=17. drop_path_rate=0 so DropPath is a no-op here.
"""
import math
from collections import OrderedDict

import torch
import torch.nn as nn


def _trunc_normal_(tensor, mean=0.0, std=0.02, a=-2.0, b=2.0):
    def norm_cdf(x):
        return (1.0 + math.erf(x / math.sqrt(2.0))) / 2.0

    with torch.no_grad():
        l = norm_cdf((a - mean) / std)
        u = norm_cdf((b - mean) / std)
        tensor.uniform_(2 * l - 1, 2 * u - 1)
        tensor.erfinv_()
        tensor.mul_(std * math.sqrt(2.0))
        tensor.add_(mean)
        tensor.clamp_(min=a, max=b)
        return tensor


class DropPath(nn.Module):
    def __init__(self, drop_prob=0.0):
        super().__init__()
        self.drop_prob = drop_prob

    def forward(self, x):
        if self.drop_prob == 0.0 or not self.training:
            return x
        keep = 1 - self.drop_prob
        shape = (x.shape[0],) + (1,) * (x.ndim - 1)
        mask = keep + torch.rand(shape, dtype=x.dtype, device=x.device)
        return x.div(keep) * mask.floor_()


class MLP(nn.Module):
    def __init__(self, in_features, hidden_features=None, out_features=None, act_layer=nn.GELU, drop=0.0):
        super().__init__()
        out_features = out_features or in_features
        hidden_features = hidden_features or in_features
        self.fc1 = nn.Linear(in_features, hidden_features)
        self.act = act_layer()
        self.fc2 = nn.Linear(hidden_features, out_features)
        self.drop = nn.Dropout(drop)

    def forward(self, x):
        x = self.drop(self.act(self.fc1(x)))
        return self.drop(self.fc2(x))


class Attention(nn.Module):
    def __init__(self, dim, num_heads=8, qkv_bias=False, qk_scale=None,
                 attn_drop=0.0, proj_drop=0.0, st_mode="vanilla"):
        super().__init__()
        self.num_heads = num_heads
        head_dim = dim // num_heads
        self.scale = qk_scale or head_dim ** -0.5
        self.attn_drop = nn.Dropout(attn_drop)
        self.proj = nn.Linear(dim, dim)
        self.mode = st_mode
        self.qkv = nn.Linear(dim, dim * 3, bias=qkv_bias)
        self.proj_drop = nn.Dropout(proj_drop)

    def forward(self, x, seqlen=1):
        B, N, C = x.shape
        qkv = self.qkv(x).reshape(B, N, 3, self.num_heads, C // self.num_heads).permute(2, 0, 3, 1, 4)
        q, k, v = qkv[0], qkv[1], qkv[2]
        if self.mode == "temporal":
            x = self.forward_temporal(q, k, v, seqlen=seqlen)
        else:  # spatial / vanilla
            x = self.forward_spatial(q, k, v)
        return self.proj_drop(self.proj(x))

    def forward_spatial(self, q, k, v):
        B, _, N, C = q.shape
        attn = (q @ k.transpose(-2, -1)) * self.scale
        attn = self.attn_drop(attn.softmax(dim=-1))
        x = attn @ v
        return x.transpose(1, 2).reshape(B, N, C * self.num_heads)

    def forward_temporal(self, q, k, v, seqlen=8):
        B, _, N, C = q.shape
        qt = q.reshape(-1, seqlen, self.num_heads, N, C).permute(0, 2, 3, 1, 4)
        kt = k.reshape(-1, seqlen, self.num_heads, N, C).permute(0, 2, 3, 1, 4)
        vt = v.reshape(-1, seqlen, self.num_heads, N, C).permute(0, 2, 3, 1, 4)
        attn = (qt @ kt.transpose(-2, -1)) * self.scale
        attn = self.attn_drop(attn.softmax(dim=-1))
        x = attn @ vt
        return x.permute(0, 3, 2, 1, 4).reshape(B, N, C * self.num_heads)


class Block(nn.Module):
    def __init__(self, dim, num_heads, mlp_ratio=4.0, mlp_out_ratio=1.0, qkv_bias=True,
                 qk_scale=None, drop=0.0, attn_drop=0.0, drop_path=0.0,
                 act_layer=nn.GELU, norm_layer=nn.LayerNorm, st_mode="stage_st", att_fuse=False):
        super().__init__()
        self.st_mode = st_mode
        self.norm1_s = norm_layer(dim)
        self.norm1_t = norm_layer(dim)
        self.attn_s = Attention(dim, num_heads, qkv_bias, qk_scale, attn_drop, drop, st_mode="spatial")
        self.attn_t = Attention(dim, num_heads, qkv_bias, qk_scale, attn_drop, drop, st_mode="temporal")
        self.drop_path = DropPath(drop_path) if drop_path > 0.0 else nn.Identity()
        self.norm2_s = norm_layer(dim)
        self.norm2_t = norm_layer(dim)
        mlp_hidden_dim = int(dim * mlp_ratio)
        mlp_out_dim = int(dim * mlp_out_ratio)
        self.mlp_s = MLP(dim, mlp_hidden_dim, mlp_out_dim, act_layer, drop)
        self.mlp_t = MLP(dim, mlp_hidden_dim, mlp_out_dim, act_layer, drop)
        self.att_fuse = att_fuse
        if att_fuse:
            self.ts_attn = nn.Linear(dim * 2, dim * 2)

    def forward(self, x, seqlen=1):
        if self.st_mode == "stage_st":
            x = x + self.drop_path(self.attn_s(self.norm1_s(x), seqlen))
            x = x + self.drop_path(self.mlp_s(self.norm2_s(x)))
            x = x + self.drop_path(self.attn_t(self.norm1_t(x), seqlen))
            x = x + self.drop_path(self.mlp_t(self.norm2_t(x)))
        elif self.st_mode == "stage_ts":
            x = x + self.drop_path(self.attn_t(self.norm1_t(x), seqlen))
            x = x + self.drop_path(self.mlp_t(self.norm2_t(x)))
            x = x + self.drop_path(self.attn_s(self.norm1_s(x), seqlen))
            x = x + self.drop_path(self.mlp_s(self.norm2_s(x)))
        else:
            raise NotImplementedError(self.st_mode)
        return x


class DSTformer(nn.Module):
    def __init__(self, dim_in=3, dim_out=3, dim_feat=512, dim_rep=512, depth=5,
                 num_heads=8, mlp_ratio=2, num_joints=17, maxlen=243, qkv_bias=True,
                 qk_scale=None, drop_rate=0.0, attn_drop_rate=0.0, drop_path_rate=0.0,
                 norm_layer=nn.LayerNorm, att_fuse=True):
        super().__init__()
        self.dim_out = dim_out
        self.dim_feat = dim_feat
        self.joints_embed = nn.Linear(dim_in, dim_feat)
        self.pos_drop = nn.Dropout(p=drop_rate)
        dpr = [x.item() for x in torch.linspace(0, drop_path_rate, depth)]
        self.blocks_st = nn.ModuleList([
            Block(dim_feat, num_heads, mlp_ratio, 1.0, qkv_bias, qk_scale, drop_rate,
                  attn_drop_rate, dpr[i], norm_layer=norm_layer, st_mode="stage_st")
            for i in range(depth)])
        self.blocks_ts = nn.ModuleList([
            Block(dim_feat, num_heads, mlp_ratio, 1.0, qkv_bias, qk_scale, drop_rate,
                  attn_drop_rate, dpr[i], norm_layer=norm_layer, st_mode="stage_ts")
            for i in range(depth)])
        self.norm = norm_layer(dim_feat)
        if dim_rep:
            self.pre_logits = nn.Sequential(OrderedDict([
                ("fc", nn.Linear(dim_feat, dim_rep)),
                ("act", nn.Tanh())]))
        else:
            self.pre_logits = nn.Identity()
        self.head = nn.Linear(dim_rep, dim_out) if dim_out > 0 else nn.Identity()
        self.temp_embed = nn.Parameter(torch.zeros(1, maxlen, 1, dim_feat))
        self.pos_embed = nn.Parameter(torch.zeros(1, num_joints, dim_feat))
        _trunc_normal_(self.temp_embed, std=0.02)
        _trunc_normal_(self.pos_embed, std=0.02)
        self.att_fuse = att_fuse
        if att_fuse:
            self.ts_attn = nn.ModuleList([nn.Linear(dim_feat * 2, 2) for _ in range(depth)])

    def forward(self, x, return_rep=False):
        B, F, J, C = x.shape
        x = x.reshape(-1, J, C)
        BF = x.shape[0]
        x = self.joints_embed(x)
        x = x + self.pos_embed
        _, J, C = x.shape
        x = x.reshape(-1, F, J, C) + self.temp_embed[:, :F, :, :]
        x = x.reshape(BF, J, C)
        x = self.pos_drop(x)
        for idx, (blk_st, blk_ts) in enumerate(zip(self.blocks_st, self.blocks_ts)):
            x_st = blk_st(x, F)
            x_ts = blk_ts(x, F)
            if self.att_fuse:
                alpha = torch.cat([x_st, x_ts], dim=-1)
                alpha = self.ts_attn[idx](alpha).softmax(dim=-1)
                x = x_st * alpha[:, :, 0:1] + x_ts * alpha[:, :, 1:2]
            else:
                x = (x_st + x_ts) * 0.5
        x = self.norm(x)
        x = x.reshape(B, F, J, -1)
        x = self.pre_logits(x)
        if return_rep:
            return x
        return self.head(x)


def load_dstformer(ckpt_path, device="cuda"):
    """Build the FT_MB_release_MB_ft_h36m DSTformer and load weights."""
    model = DSTformer(dim_in=3, dim_out=3, dim_feat=512, dim_rep=512, depth=5,
                      num_heads=8, mlp_ratio=2, num_joints=17, maxlen=243, att_fuse=True)
    ckpt = torch.load(ckpt_path, map_location="cpu")
    sd = ckpt["model_pos"]
    sd = {k.replace("module.", "", 1): v for k, v in sd.items()}
    missing, unexpected = model.load_state_dict(sd, strict=True)
    return model.eval().to(device)
