# Pose Estimation State of the Art (Mid-2026): Is MediaPipe Still the Standard, and What Should You Use?

## TL;DR
- **No — MediaPipe (BlazePose) is no longer the accuracy standard.** For your use case (offline batch, GPU laptop, 3D with feet+hands joints, eventual real-time), the **RTMPose/RTMW family in MMPose**, fed into **Pose2Sim** for multi-view triangulation, is the best convenient pick in 2026. MediaPipe remains the easiest single-line setup and is genuinely fast, but top-down models (RTMPose, ViTPose, Sapiens) beat it on in-the-wild accuracy, and its 33-landmark skeleton lacks the hand/foot-joint granularity you want.
- **Best convenient single-person 3D pipeline with feet+hands:** record from your multiple camera angles → run **Pose2Sim** (RTMPose "Whole_body_wrist"/HALPE_26 backend, COCO-WholeBody-133 option) → calibrated triangulation → OpenSim. For a quick start with minimal setup, **FreeMoCap** (BlazePose/RTM backends + Anipose triangulation) is even easier but less accurate. For monocular-only or rough 3D, **RTMW3D** or **MotionBERT** (lifting) work well.
- **Real-time capable today** (on a GPU laptop): RTMPose, RTMO, YOLO11-pose, MediaPipe, BlazePose — all run well above 30 FPS. Heavy whole-body/mesh models (Sapiens-1B/2B, SMPLer-X, 4D-Humans) and multi-view triangulation pipelines are **offline-only** in practice.

## Key Findings

**1. MediaPipe's position has shifted from "standard" to "convenient baseline."** MediaPipe Pose / the newer MediaPipe Tasks **Pose Landmarker** (model updates released January 2025) outputs 33 body landmarks with pseudo-3D (z) and is still extremely easy to deploy (one pip install, runs on CPU/GPU/web/mobile). But it has documented weaknesses: (a) its 3D z-coordinate is derived from a 2D→3D uplift that introduces most of its error rather than the 2D tracking; (b) it is single-person by design (tracks "the most prominent person"); (c) 33 landmarks include only coarse head points and ankles — **no foot keypoints (toes/heels) and no hand-joint keypoints** unless you add MediaPipe Hands/Holistic; and (d) in head-to-head clinical benchmarking it ranks high but **below the RTMPose family** for 2D accuracy.

**2. The 2025 clinical benchmark is the clearest recent apples-to-apples comparison.** Rode D, Dunkel A, Willi R, Wolf P, Xiloyannis M, Riener R, "Assessment of monocular human pose estimation models for clinical movement analysis," *Scientific Reports* 15:38767 (published 5 Nov 2025; DOI 10.1038/s41598-025-22626-7) "assessed the accuracy, precision, and inference speed of 11 different open source monocular markerless human pose estimators." Across 2.2M frames (the "Physio2.2M" dataset) vs. marker-based optical mocap on an AMD Ryzen 9 7900X + Nvidia RTX 4080 machine: "The mean per joint position error... was found to be in the range of 72 to 122 mm in 2D within the image plane and 146 to 249 mm in 3D when considering depth." **RTMPose "Performance" was the best direct 2D estimator (72 mm MPJPE2D, 30 FPS)**, and the paper states verbatim: "RTMPose and its variants RTMW and RTMO show the highest accuracy among the 2D pose estimators investigated." BlazePose is described as "high accuracy" and was the **fastest** direct estimator, but ranks explicitly below RTMPose for 2D. Notably, **BlazePose "World" Heavy was the best *direct 3D* estimator (146 mm MPJPE3D, 147 FPS)** — its monocular depth estimate beat the transformer lifters' depth ("their depth estimation underperformed BlazePose, which is a direct pose estimator"). Direct 2D estimators ran 25–200 FPS; 2D→3D lifting ran 117–9341 FPS (MotionAGFormer at 4580 FPS, MotionBERT faster still, PoseFormerV2 slowest).

**3. Whole-body (body+feet+hands) is now a solved feature set in the open-source top-down world.** The **COCO-WholeBody 133-keypoint** format (17 body + 6 feet + 68 face + 42 hands) and **Halpe** (26 or 136) are the standards. Per the RTMW paper (arXiv:2407.08634), "RTMW-l achieving a 70.2 mAP on the COCO-Wholebody benchmark, making it the first open-source model to exceed 70 mAP on this benchmark" (note: MMPose release notes list RTMW-l val at 70.1 mAP and attribute the 70.2 figure to RTMW-x — either way, the RTMW family was first open past 70). Critically for you, these formats **include 6 dedicated foot keypoints** (heel + big/small toe per foot) and hand keypoints — and you can pick a config that gives feet + wrist/hand without face.

**4. For multi-view triangulation, Pose2Sim is the standout convenient pick for a personal/non-commercial user.** It's a pip-installable Python package, end-to-end from videos → calibration → person association → triangulation → OpenSim joint angles, supports any cameras, has automatic calibration/synchronization, multi-person mode, and natively embeds RTMPose. AniPose, FreeMoCap, EasyMocap, and OpenCap are the main alternatives.

## Details

### MediaPipe today (BlazePose / Pose Landmarker / Holistic)
- **What it gives:** 33 body landmarks (x, y, z, visibility), optional segmentation mask. Models: Lite/Full/Heavy. "Full" is the recommended balance. Holistic adds 21 per hand (with full finger articulation) + 468 face — more than you need, and the hand crop has known downstream errors (a 2024 arXiv paper specifically optimized MediaPipe Holistic's hand-region detection to fix this).
- **Maintenance:** Google moved to the MediaPipe Tasks API; the classic `mediapipe.solutions` Pose is legacy-maintained while Tasks Pose Landmarker is current (model updates January 2025).
- **Strengths:** Easiest setup, runs real-time on almost anything, good for fitness/yoga (its training bias), strong direct-3D depth relative to lifters.
- **Limits for your use case:** single-person; no foot keypoints; pseudo-3D from monocular uplift; below RTMPose in 2D in-the-wild accuracy; license is Apache-2.0 (commercial-OK, irrelevant to you but a plus).

### Leading 2D / whole-body methods (2025–2026)
- **RTMPose (MMPose, Apache-2.0):** Real-time top-down. Per the RTMPose paper (arXiv:2303.07399): "Our RTMPose-m achieves 75.8% AP on COCO with 90+ FPS on an Intel i7-11700 CPU and 430+ FPS on an NVIDIA GTX 1660 Ti GPU, and RTMPose-l achieves 67.0% AP on COCO-WholeBody with 130+ FPS." Body-with-feet (Halpe-26) and whole-body (133) variants. **The practical sweet spot for accuracy + speed + ease (via the `rtmlib` pip package, no mmcv needed).**
- **RTMW / RTMW-l/x (Apache-2.0):** Whole-body specialist; RTMW-l ≈70.1–70.2 mAP COCO-WholeBody (first open family >70). RTMW-l ≈130+ FPS reported. Best open whole-body accuracy at real-time-ish speeds.
- **RTMO (Apache-2.0, CVPR 2024):** One-stage (YOLO-style) multi-person; RTMO-l = 74.8 AP COCO at 141 FPS on a V100. Faster than top-down when ≥2–4 people. Body-only (17 kpts) by default.
- **DWPose (research):** Distilled whole-body; per the DWPose paper (arXiv:2307.15880), "DWPose-l achieves 63.1 and 66.5 whole AP under two different input resolutions, which both beat the teacher" (DWPose-l at 384×288 = 66.5 whole-body AP, up from RTMPose-l's 64.8). Popular as a ControlNet preprocessor; body+feet+face+hands.
- **ViTPose / ViTPose++ (Apache-2.0 code; some training data academic-only):** ViT backbone, scales to 1B params (ViTPose-G), SOTA on COCO and strong on COCO-WholeBody. Higher accuracy ceiling than RTMPose but heavier; good for offline batch.
- **Sapiens (Meta, CC-BY-NC 4.0 — non-commercial, fine for you):** Foundation human models pretrained on the "Humans-300M" dataset of 300 million in-the-wild human images, native 1K-resolution. **308-keypoint** pose ("308 keypoints encompassing the body, hands, feet, surface, and face") plus 17/133 variants. Sapiens-2B is the SOTA human pose model and outperforms DWPose-L by roughly +7 AP on its human test set, with excellent in-the-wild generalization. Sizes: 0.3B/0.6B/1B/2B. **Best raw accuracy / robustness for offline batch**, but large (1B+ needs serious GPU; bfloat16 weights are A100-oriented).
- **YOLO11-pose / YOLO26-pose (Ultralytics, AGPL-3.0 — fine for non-commercial):** Single-stage, very easy (`pip install ultralytics`), 17 COCO keypoints only (no feet/hands joints). Real-time (200+ FPS on a T4 for some sizes; 30+ FPS high-res). Great convenience but wrong keypoint set for your feet+hands need unless you train custom.
- **OpenPose (legacy, non-commercial license):** BODY_25 (includes 6 feet) + hand/face. Historically the Pose2Sim backend; now superseded by RTMPose on speed/accuracy. Slow without a strong GPU.
- **AlphaPose (non-commercial license):** Whole-body Halpe-136 (body+feet+hands+face), real-time, accurate; still maintained, supported by Pose2Sim.

### 3D: monocular and mesh-recovery
- **RTMW3D / RTMPose3D (MMPose, Apache-2.0, released 2024 in MMPose v1.3.2):** Real-time monocular **3D whole-body 133-keypoint**. Official MMPose figures: RTMW3D-L = 0.678 AP on COCO-WholeBody, 0.056 MPJPE on H3WB; community model card reports ~30 FPS on an RTX 3090. Direct image→3D-keypoints including feet+hands. Strong convenient monocular-3D pick.
- **MotionBERT (research):** 2D→3D lifting transformer; SOTA on Human3.6M; extremely fast at the lifting stage (thousands of FPS) since it consumes 2D sequences. But cross-dataset/in-the-wild degrades (≈40–50 mm on H36M → 100+ mm on 3DPW with detected keypoints). Body-only (no hands/feet joints).
- **SMPL-X mesh methods (SMPLer-X, OSX, Multi-HMR; research/non-commercial):** Produce a full **SMPL-X** parametric body+hands+face mesh → you can read off body+hand+foot joints. SMPLer-X (NeurIPS 2023) is a generalist foundation model. Offline-oriented, heavier setup.
- **4D-Humans / HMR2.0 (research):** Transformer SMPL mesh recovery + multi-person 3D tracking through occlusion from monocular video. Robust tracking; SMPL (body) not SMPL-X, so no detailed hands. Offline.

### Multi-view triangulation pipelines (your eventual multi-camera path)
- **Pose2Sim (BSD-licensed, pip):** "OpenPose to OpenSim," now defaults to **RTMPose** via `rtmlib`. Pose modes: **Body_with_feet (HALPE_26, default)**, **Whole_body_wrist (COCO-133 + 2 hand kpts — exactly body+feet+hands-joint, no fingers/face)**, Whole_body (COCO-133), Body (COCO-17), plus Hand/Face/Animal. End-to-end: calibration (checkerboard or scene measurements), sync (auto), person association, robust triangulation (keeps the triangulation with lowest reprojection error), filtering, marker augmentation, OpenSim IK. Multi-person supported (v0.7+). Validated accuracy: mean absolute error 0.35–1.6° on joint angles vs. a marker-based reference. **Best convenience+accuracy for personal multi-view 3D.** Can import calibration from Caliscope, AniPose, FreeMoCap, Qualisys, OptiTrack, Vicon, OpenCap, EasyMocap.
- **Sports2D (companion, JOSS 2024):** Single-camera 2D angles (or 2D→OpenSim), real-time-capable with RTMlib; sagittal/frontal-plane only. Good for the single-camera real-time future.
- **FreeMoCap (AGPL, free):** Easiest GUI; webcams; CharuCo calibration; Anipose triangulation backend; MediaPipe/other 2D. Research-grade with ≥4 cameras; designed to run even on CPU. Less biomechanically rigorous than Pose2Sim.
- **AniPose (research, built on DeepLabCut):** Robust multi-camera calibration + triangulation with spatial/temporal regularization (bundle adjustment). Originally animal-focused; provides the calibration/triangulation core that FreeMoCap and others reuse.
- **EasyMocap (Zhejiang U., non-commercial research):** RGB→SMPL/SMPL-X multi-view; strong for mesh + novel-view; heavier setup.
- **OpenCap (free, cloud):** Two+ smartphones, web app, HRNet/OpenPose + LSTM marker augmentation → OpenSim. Very easy but cloud-dependent and validated mainly for lower-limb gait; ankle accuracy is weak (limits of agreement ±12°).

### Pose2Sim: OpenSim model behavior, overlay/visualization, and inverted poses
Three clarifications from the current Pose2Sim / Pose2Sim_Blender docs:
- **"The OpenSim skeleton is not rigged yet" does NOT mean it can't move.** That note is from the **Pose2Sim_Blender** visualizer add-on and refers to *rigging* in the animation sense — a skinned armature / control rig for manual posing or retargeting — not whether it animates. Pose2Sim scales an OpenSim model to the participant and solves inverse kinematics, producing a motion file (`.mot`) plus `.trc`/`.osim`; the skeleton animates fully in OpenSim's own GUI and in Blender (the add-on changelog notes IK is already solved on import, so playback is just pose realization — `model.realizePosition` rather than re-running IK). "Not rigged" means the **OpenSim model import** (and c3d import) in the Blender add-on isn't bound to a control armature, so you can't grab-and-pose it by hand or retarget it onto another character like a game-ready rig. The `.trc` keypoint import *is* rigged to the chosen skeleton — it's specifically the OpenSim/c3d import that isn't yet.
- **Overlaying the OpenSim skeleton on your video already works.** The Pose2Sim_Blender add-on imports calibrated cameras, source videos, triangulated keypoints, and the OpenSim skeleton, and can overlay results back onto the footage (and author custom renders/animations). OpenSim's GUI also plays back the scaled model + motion directly (File → Preview experimental data for the `.trc`). Playback/overlay: available now; manual re-posing/retargeting: not yet (per the rigging note above).
- **Inverted/acrobatic poses are a known weak spot of the default backend.** The docs warn it doesn't work well when the person is upside down and suggest switching the 2D backend to **MediaPipe BlazePose** for those clips — the default RTMPose family is trained mostly on upright people, while BlazePose handles inversions better. Relevant for handstands, flips, gymnastics, breakdance, or capoeira-type movement.

### Whole-body keypoint formats cheat-sheet
- **COCO-WholeBody (133):** 17 body + 6 feet + 68 face + 42 hands. RTMPose/RTMW/DWPose/ViTPose/Sapiens-133.
- **Halpe (26 / 136):** 26 = body+feet (no hands/face) — ideal minimal set for you; 136 = +hands+face. AlphaPose, RTMPose-Halpe26.
- **OpenPose BODY_25:** includes 6 feet keypoints.
- **SMPL-X joints:** body+hands+face from mesh.
- **MediaPipe 33:** body only, ankles but no toes/heels, no hand joints.
- **Sapiens 308:** densest (body+face+hands+feet).

### Real-time vs. offline labeling (typical GPU laptop, e.g. RTX 4070/4080-class)
- **Real-time (>30 FPS), single-person 2D/whole-body:** MediaPipe (100+ FPS), BlazePose World Heavy (147 FPS on RTX 4080), RTMPose-m/s (90–430+ FPS depending on size/backend/GPU), YOLO11-pose (real-time), RTMW (~real-time, lighter sizes).
- **Real-time multi-person 2D:** RTMO (141 FPS on V100; stays fast as people increase), YOLO11-pose.
- **Real-time monocular 3D:** RTMW3D/RTMPose3D (~30 FPS RTX 3090); MotionBERT lifting stage is near-instant (but needs a 2D estimator upstream).
- **Offline-only (in practice):** Sapiens-1B/2B, ViTPose-G, SMPLer-X / OSX / Multi-HMR mesh, 4D-Humans, and all multi-view triangulation pipelines (Pose2Sim, FreeMoCap, AniPose, EasyMocap) — these batch-process recorded video.

## Recommendations

**(a) Best convenient pick — offline batch, single-person 3D, multi-view triangulation, feet+hands joints, GPU laptop:**
**Pose2Sim with the RTMPose `Whole_body_wrist` (COCO-133 + 2 hand keypoints) or `Body_with_feet` (HALPE_26) backend.** It is pip-installable, gives you body + 6 foot keypoints + hand joints (no fingers/face if you pick the right mode), triangulates your multiple calibrated views robustly, and outputs OpenSim 3D joint angles. Start single-person; multi-person is a config flag. If you want the absolute easiest first run, prototype with **FreeMoCap** (GUI, CharuCo calibration) then graduate to Pose2Sim for accuracy. For monocular/rough 3D without calibration, use **RTMW3D/RTMPose3D**.

**(b) Multi-person option:** Pose2Sim multi-person mode (v0.7+) for triangulated 3D of two people; for 2D real-time multi-person use **RTMO** (one-stage, scales with people) or **YOLO11-pose**. For monocular multi-person 3D tracking through occlusion, **4D-Humans** (SMPL meshes) is the research SOTA but offline and body-only.

**(c) Real-time capability table:**

| Method | Keypoints (feet/hands?) | Real-time on GPU laptop? | Approx FPS | License |
|---|---|---|---|---|
| MediaPipe Pose | 33 body (no feet/hands joints) | ✅ | 100+ | Apache-2.0 |
| BlazePose World Heavy (3D) | 33 body + pseudo-3D | ✅ | ~147 (RTX 4080) | Apache-2.0 |
| RTMPose-m (body/Halpe-26) | feet ✅ (Halpe-26) | ✅ | 90–430+ | Apache-2.0 |
| RTMW-l (whole-body 133) | feet+hands ✅ | ✅ (lighter sizes) | ~130+ | Apache-2.0 |
| RTMO-l (multi-person) | body only | ✅ | 141 (V100) | Apache-2.0 |
| YOLO11-pose | body only (17) | ✅ | 200+ (T4, small) | AGPL-3.0 |
| RTMW3D / RTMPose3D (3D 133) | feet+hands ✅ | ✅ (borderline) | ~30 (RTX 3090) | Apache-2.0 |
| MotionBERT (lift) | body only | ✅ (lift stage) | 1000s | research |
| Sapiens-1B/2B (308) | feet+hands ✅ | ❌ offline | <real-time | CC-BY-NC-4.0 |
| ViTPose-G | feet+hands (133) ✅ | ❌ offline (huge) | low | Apache code |
| SMPLer-X / OSX (SMPL-X mesh) | feet+hands ✅ | ❌ offline | low | research/NC |
| 4D-Humans (SMPL mesh+track) | body (SMPL) | ❌ offline | low | research |
| Pose2Sim / FreeMoCap (multi-view) | depends on backend (feet+hands ✅) | ❌ offline batch | n/a | BSD / AGPL |

**(d) Accuracy-in-the-wild & setup notes for top picks:**
- **RTMPose/RTMW (via rtmlib or MMPose):** best open accuracy/speed balance; in-the-wild robust; easy via `pip install rtmlib`. **Top recommendation for the 2D backend.**
- **Pose2Sim:** moderate setup (calibration is the main effort), excellent documentation, research-grade accuracy from consumer cameras. **Top recommendation for multi-view 3D.**
- **Sapiens:** highest in-the-wild robustness and densest keypoints, but heavy; reserve for offline batch where accuracy matters most and you have GPU headroom. Non-commercial license is fine for you.
- **MediaPipe:** keep as a quick baseline / real-time prototype, not your accuracy workhorse — and as the fallback backend for inverted/acrobatic clips (see the Pose2Sim notes above).

**Staged plan:** (1) Now — offline batch single-person: Pose2Sim + RTMPose whole-body on your multi-view recordings. (2) Add multi-person: flip Pose2Sim to multi-person, or RTMO/YOLO11 for 2D. (3) Real-time future: RTMPose/RTMO/RTMW via rtmlib for live 2D; Sports2D for single-camera live 2D angles; RTMW3D for live monocular 3D.

**Thresholds that would change the recommendation:** if you need finger articulation or facial expression later → switch backend to COCO-133/Sapiens-308 or an SMPL-X method; if you only ever have one camera → use RTMW3D or BlazePose-World/Sapiens monocular 3D rather than triangulation; if accuracy must approach marker-based mocap (<1–2° joint angle) → you'll need ≥4 well-calibrated synchronized cameras with Pose2Sim.

## Caveats
- **FPS figures are hardware- and backend-dependent.** Quoted numbers come from different GPUs (GTX 1660 Ti, V100, RTX 3090/4080, T4) and inference backends (PyTorch vs ONNX vs TensorRT). On your specific laptop GPU, expect TensorRT/ONNX to roughly match published GPU figures and raw PyTorch to be slower. Treat the table as relative ordering, not guarantees.
- **The Physio2.2M benchmark used healthy adults doing exercises**, not arbitrary "in the wild" footage; rankings (RTMPose > BlazePose for 2D; BlazePose best direct-3D) are robust signals but absolute mm errors are task-specific. Some exact per-model-size FPS figures live in that paper's supplementary tables/figures and are not in the main text.
- **Licenses:** You said non-commercial is fine, so Sapiens (CC-BY-NC), ViTPose data (academic), OpenPose/AlphaPose (non-commercial), EasyMocap (research), MotionBERT/4D-Humans (research) are all usable. Note YOLO11 is AGPL-3.0 (copyleft) — fine for personal/research, but it virally affects redistributed code.
- **Some 2025–2026 items are fast-moving:** RTMPose3D community ports, "SAM 3D Body," and newer multi-view pipelines (e.g. RapidPoseTriangulation, MAMMA) appeared in 2025–2026 preprints; they're promising but less battle-tested than Pose2Sim/RTMPose. RTMPose3D's exact FPS/MPJPE come from a community model card, not a peer-reviewed paper.
- **Pose2Sim notes a current bug:** the maintainer recommends leaving `undistort_points` and `handle_LR_swap` off for now, as they can introduce inaccuracies.
- **Inverted poses:** Pose2Sim's default RTMPose backend degrades on upside-down/acrobatic movement; the docs recommend switching the 2D backend to MediaPipe BlazePose for those clips. The Blender add-on's OpenSim/c3d imports are also "not rigged yet" — playback and video overlay work, but manual re-posing/retargeting in Blender does not.
