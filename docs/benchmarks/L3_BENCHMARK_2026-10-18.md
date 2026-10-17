# L3 reviewer benchmark — October 18, 2026

Master plan Phase 4 asks to "compare model accuracy and cost" before relying on AI verification. This run used a **small synthetic labeled set** with known answers ([make-fixtures.py](../../scripts/benchmark/make-fixtures.py)); it is not customer data, and results on real datasets can differ. Re-run with `npx tsx scripts/l3-benchmark.ts .data/benchmark --only image --image-model <id>` after generating the fixtures.

Fixtures: 24 images (16 correctly labeled circles/squares, 4 mislabeled, 4 irrelevant: noise, text page, gradient, landscape bands), 8 synthesized speech clips (weather reports in `rain/` and `sun/` folders, 1 mislabeled, 2 off-topic), 6 short videos (4 moving ball, 2 off-topic), 6 image pairs (3 near-duplicates, 3 distinct).

All calls ran on the NVIDIA API catalog free tier: $0 per call; token counts are recorded for future pricing.

## Image relevance and label checks

| Model | Relevance accuracy | Mislabels caught | False mislabel flags | Mean latency | Mean input tokens | Unanswered |
|---|---|---|---|---|---|---|
| meta/llama-3.2-11b-vision-instruct (previous default) | 83.3% (missed all 4 irrelevant) | 1 of 4 | 0 | 7.0–8.8 s | 1,719 | 0 |
| nvidia/nemotron-3-nano-omni-30b-a3b-reasoning, reasoning on | 100% | 4 of 4 | 3 | 4.5 s | 390 | 0 |
| **nvidia/nemotron-3-nano-omni-30b-a3b-reasoning, reasoning off (new default)** | **100%** | **4 of 4** | **0** | **1.7 s** | **390** | **0** |
| nvidia/nemotron-3.5-super-vl-120b-a12b | 100% of answered | 2 of 4 | 0 | 17.2 s | 389 | 8 of 24 |
| meta/llama-3.2-90b-vision-instruct | did not finish two images within 200 s on the free tier | — | — | — | — | — |

Decision: `L3_VISION_MODEL` now defaults to the omni model with reasoning disabled. The spec hash includes the model, so earlier cached results stay attached to their own model and are not silently relabeled.

## Audio and video (omni model, `audio_url` / `video_url` data URLs)

| Modality | Relevance accuracy | Mislabels caught | Mean latency | Mean input tokens |
|---|---|---|---|---|
| Speech audio (8 clips) | 87.5% (one off-topic clip judged relevant although its stated reason said otherwise) | 1 of 1 | 2.7 s | 180 |
| Video (6 clips) | 100% | n/a | 1.5 s | 423 |

The OpenAI-style `input_audio` part is ignored by this model (it answered without hearing the clip); only `audio_url` works. Clips are uploaded as-is without local decoding; long PCM WAV is cut to a prefix, other oversized clips are skipped and reported.

## Image near-duplicates (nvidia/llama-nemotron-embed-vl-1b-v2)

| Pair type | Cosine similarity |
|---|---|
| Near-duplicates (brightness +12, 2 px shift, JPEG re-encode) | 0.9958, 0.9938, 0.9918 |
| Distinct images of the same class | 0.9348, 0.9397, 0.9276 |

The 0.97 threshold separated all 6 pairs correctly. `nvidia/nvclip` and `nvidia/cosmos-reason2-8b` returned 404 for this account and are not used.

Raw outputs: the `*.json` files in this folder.
