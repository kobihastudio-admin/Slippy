# 04 AI Shot Detection Spec

## 1. Objective

สร้าง AI model เพื่อแยกประเภทการตีแบดมินตันจาก motion sensor ของ Apple Watch

## 2. MVP Classes

Start with:

```text
0 = no_shot
1 = shot_unknown
2 = smash
```

Later expand:

```text
clear
smash
drive
drop
net_shot
serve
forehand
backhand
```

## 3. Model Input

Sensor window:

```text
Duration: 1 second
Sampling: 50 Hz
Features per sample: ax, ay, az, gx, gy, gz
Shape: 50 x 6
```

## 4. Model Options

### Option A: Feature-based ML for MVP

- Random Forest
- XGBoost
- LightGBM

Pros:

- Easier to debug
- Works with smaller dataset

### Option B: Deep Learning

- 1D CNN
- LSTM
- CNN + LSTM
- Tiny Transformer

Pros:

- Better pattern learning
- Easier to improve with more data

## 5. Recommended MVP Approach

Use 2-stage model:

```text
Stage 1: Heuristic shot candidate detector
Stage 2: ML classifier for Smash / Non-Smash
```

## 6. Dataset Collection

Collect data from:

- right-handed players
- left-handed players
- beginner/intermediate/advanced
- male/female
- Apple Watch SE/Series/Ultra if possible

Minimum pilot target:

```text
10 users
30 sessions
5,000 labeled shot windows
```

Better target:

```text
50 users
300 sessions
50,000 labeled shot windows
```

## 7. Labeling Workflow

### Manual Label Mode

After session:

- show detected shot candidates
- allow tester to label shot type
- save label

### Coach-assisted Labeling

For high quality dataset:

- record video with timestamp
- sync with sensor time
- label shot type from video

## 8. Output Format

```json
{
  "shotType": "smash",
  "confidence": 0.87,
  "timestamp": 1710000000.123,
  "features": {
    "peakAcceleration": 6.2,
    "peakGyro": 11.4,
    "energy": 44.8
  }
}
```

## 9. On-device Inference

Use Core ML after model is stable:

```text
Python model
→ convert to Core ML
→ bundle in iOS/watchOS app
→ run inference on device
```

## 10. AI Insight Text

Generate simple rule-based summary first:

```text
วันนี้คุณตี Smash 78 ครั้ง คิดเป็น 16% ของจำนวนลูกตีทั้งหมด ความหนักเฉลี่ยอยู่ระดับสูง แนะนำพักให้เพียงพอและฝึก footwork เพิ่มเติม
```

Later connect to Slippy AI Coach.

