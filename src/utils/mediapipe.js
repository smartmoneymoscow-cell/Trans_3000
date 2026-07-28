/**
 * MediaPipe Face Landmarker — adapted from Face project.
 * https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js
 */
import { FaceLandmarker, DrawingUtils, FilesetResolver } from '@mediapipe/tasks-vision'

let faceLandmarker = null
let loadPromise = null

const WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

export async function getFaceLandmarker() {
  if (faceLandmarker) return faceLandmarker
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    const vision = await FilesetResolver.forVisionTasks(WASM_CDN)
    const baseOpts = { modelAssetPath: MODEL_URL, delegate: 'GPU' }

    try {
      faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: baseOpts,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
        runningMode: 'VIDEO',
        numFaces: 1,
      })
    } catch (gpuErr) {
      console.warn('GPU failed, falling back to CPU:', gpuErr)
      faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { ...baseOpts, delegate: 'CPU' },
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
        runningMode: 'VIDEO',
        numFaces: 1,
      })
    }
    return faceLandmarker
  })()

  return loadPromise
}

export function resetFaceLandmarker() {
  if (faceLandmarker) {
    faceLandmarker.close()
    faceLandmarker = null
  }
  loadPromise = null
}

/**
 * Draw face mesh overlay on canvas (mirrored landmarks).
 */
export function drawFaceMesh(ctx, landmarks, time) {
  if (!landmarks || landmarks.length < 478) return

  const du = new DrawingUtils(ctx)

  // Tessellation mesh — subtle
  du.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_TESSELATION, {
    color: 'rgba(100, 200, 255, 0.08)',
    lineWidth: 0.4,
  })

  // Face oval
  du.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, {
    color: 'rgba(100, 200, 255, 0.3)',
    lineWidth: 1.5,
  })

  // Lips — highlight when making O
  du.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LIPS, {
    color: 'rgba(255, 120, 120, 0.6)',
    lineWidth: 2,
  })

  // Eyes
  du.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, {
    color: 'rgba(100, 200, 255, 0.4)',
    lineWidth: 1,
  })
  du.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, {
    color: 'rgba(100, 200, 255, 0.4)',
    lineWidth: 1,
  })

  // Key landmark dots
  const keyPoints = [1, 33, 263, 61, 291, 10, 152, 13, 14]
  for (const i of keyPoints) {
    const l = landmarks[i]
    if (!l) continue
    const pulse = 2 + Math.sin(time * 0.004 + i * 0.1) * 1
    ctx.beginPath()
    ctx.arc(l.x * ctx.canvas.width, l.y * ctx.canvas.height, pulse, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(100, 200, 255, 0.5)'
    ctx.fill()
  }
}

/**
 * Detect inhale-through-O from blendshapes.
 *
 * Two conditions must BOTH be true:
 *  1. O-SHAPE: jawOpen + mouthFunnel/mouthPucker + not smiling
 *  2. SUCTION: mouthSuckLeft/Right (cheeks pulled inward)
 *
 * Returns {
 *   isO: boolean,          // O-shape detected
 *   isSucking: boolean,    // suction force detected
 *   active: boolean,       // BOTH conditions met → scoreable
 *   oShape: number (0-100), // how well lips form O
 *   suction: number (0-100) // how strong the suction is
 * }
 */
export function detectOMouth(blendshapes) {
  if (!blendshapes || blendshapes.length === 0) {
    return { isO: false, isSucking: false, active: false, oShape: 0, suction: 0 }
  }

  const bs = (name) => {
    const found = blendshapes.find(b => b.categoryName === name)
    return found ? found.score : 0
  }

  // ── Raw blendshape values ──
  const jawOpen = bs('jawOpen')
  const mouthFunnel = bs('mouthFunnel')
  const mouthPucker = bs('mouthPucker')
  const smileL = bs('mouthSmileLeft')
  const smileR = bs('mouthSmileRight')
  const smileAvg = (smileL + smileR) / 2
  const suckL = bs('mouthSuckLeft')
  const suckR = bs('mouthSuckRight')
  const suckAvg = (suckL + suckR) / 2
  const cheekPuff = bs('cheekPuff')  // should be LOW when sucking

  // ── 1. O-SHAPE detection ──
  const oRaw = (jawOpen * 0.35) + (mouthFunnel * 0.35) + (mouthPucker * 0.15) - (smileAvg * 0.25)
  const oShapeOk = jawOpen > 0.12 && (mouthFunnel > 0.10 || mouthPucker > 0.12) && smileAvg < 0.4
  const oShape = Math.round(Math.min(100, Math.max(0, oRaw * 220)))

  // ── 2. SUCTION detection ──
  const suctionRaw = suckAvg * 0.7 + (cheekPuff < 0.15 ? 0.15 : 0) + (mouthFunnel > 0.15 && suckAvg > 0.05 ? 0.15 : 0)
  const isSucking = suckAvg > 0.08 && cheekPuff < 0.3
  const suction = Math.round(Math.min(100, Math.max(0, suctionRaw * 250)))

  // ── Combined: both O-shape AND suction → active/scorable ──
  const active = oShapeOk && isSucking

  return { isO: oShapeOk, isSucking, active, oShape, suction }
}

/**
 * Draw suction visual effect on canvas — particles flowing into mouth.
 */
export function drawSuctionEffect(ctx, landmarks, time, suctionStrength) {
  if (!landmarks || landmarks.length < 478 || suctionStrength < 5) return

  // Mouth center (inner lips)
  const upperLip = landmarks[13]
  const lowerLip = landmarks[14]
  if (!upperLip || !lowerLip) return

  const cx = ((upperLip.x + lowerLip.x) / 2) * ctx.canvas.width
  const cy = ((upperLip.y + lowerLip.y) / 2) * ctx.canvas.height

  const numParticles = Math.floor(suctionStrength / 10) + 3
  const strength = suctionStrength / 100

  for (let i = 0; i < numParticles; i++) {
    const angle = (time * 0.002 + i * (Math.PI * 2 / numParticles)) % (Math.PI * 2)
    const radius = 40 + (1 - strength) * 60 + Math.sin(time * 0.003 + i) * 15
    const px = cx + Math.cos(angle) * radius
    const py = cy + Math.sin(angle) * radius

    // Particle moves toward center
    const progress = ((time * 0.003 + i * 0.5) % 1)
    const dx = cx - px
    const dy = cy - py
    const x = px + dx * progress
    const y = py + dy * progress
    const alpha = (1 - progress) * strength * 0.6
    const size = 2 + (1 - progress) * 3

    ctx.beginPath()
    ctx.arc(x, y, size, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(100, 200, 255, ${alpha})`
    ctx.fill()
  }

  // Glow around mouth when strong suction
  if (suctionStrength > 30) {
    const glowR = 25 + strength * 20
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR)
    grad.addColorStop(0, `rgba(100, 200, 255, ${strength * 0.15})`)
    grad.addColorStop(1, 'transparent')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(cx, cy, glowR, 0, Math.PI * 2)
    ctx.fill()
  }
}
