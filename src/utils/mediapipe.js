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
  const oShapeOk = jawOpen > 0.08 && (mouthFunnel > 0.06 || mouthPucker > 0.08) && smileAvg < 0.5
  const oShape = Math.round(Math.min(100, Math.max(0, oRaw * 220)))

  // ── 2. SUCTION detection ──
  const suctionRaw = suckAvg * 0.7 + (cheekPuff < 0.20 ? 0.15 : 0) + (mouthFunnel > 0.10 && suckAvg > 0.03 ? 0.15 : 0)
  const isSucking = suckAvg > 0.04 && cheekPuff < 0.4
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

/**
 * Draw a black hose connected to the mouth.
 * The hose follows the mouth as the head turns.
 * Air particles flow through it during suction.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array} landmarks - mirrored face landmarks (478 points)
 * @param {number} time - Date.now()
 * @param {number} suctionStrength - 0..100 suction intensity
 */
export function drawHose(ctx, landmarks, time, suctionStrength) {
  if (!landmarks || landmarks.length < 478) return

  const W = ctx.canvas.width
  const H = ctx.canvas.height

  // ── Mouth attachment point ──
  const upperLip = landmarks[13]
  const lowerLip = landmarks[14]
  const mouthLeft = landmarks[61]
  const mouthRight = landmarks[291]
  const chin = landmarks[152]
  const noseTip = landmarks[1]
  if (!upperLip || !lowerLip || !chin) return

  const mouthCx = ((upperLip.x + lowerLip.x) / 2) * W
  const mouthCy = ((upperLip.y + lowerLip.y) / 2) * H

  // Mouth width for hose diameter
  const mouthW = mouthLeft && mouthRight
    ? Math.abs(mouthRight.x - mouthLeft.x) * W * 0.6
    : 20
  const hoseRadius = Math.max(8, Math.min(18, mouthW * 0.35))

  // ── Head rotation → hose direction ──
  // Use nose-to-chin vector to determine head tilt
  const noseX = noseTip.x * W
  const noseY = noseTip.y * H
  const chinX = chin.x * W
  const chinY = chin.y * H

  // Head tilt angle (nose-to-chin direction)
  const headAngle = Math.atan2(chinY - noseY, chinX - noseX)

  // Hose goes from mouth, curves down following gravity + head tilt
  // Offset the end point based on head rotation
  const hoseLen = H * 0.35 // hose length relative to canvas
  const tiltInfluence = Math.sin(headAngle) * hoseLen * 0.3

  // ── Bezier control points ──
  // P0: mouth center (attachment)
  const p0x = mouthCx
  const p0y = mouthCy

  // P1: slight curve out from mouth (in direction of chin)
  const p1x = mouthCx + tiltInfluence * 0.3
  const p1y = mouthCy + hoseLen * 0.25

  // P2: mid-hose curve
  const p2x = mouthCx + tiltInfluence * 0.8 + Math.sin(time * 0.0008) * 8
  const p2y = mouthCy + hoseLen * 0.6

  // P3: hose end (off-screen bottom)
  const p3x = mouthCx + tiltInfluence + Math.sin(time * 0.0006) * 5
  const p3y = mouthCy + hoseLen

  // ── Draw hose body (thick black tube with shading) ──
  // Draw multiple strokes for 3D tube effect
  const segments = 40

  // Outer shadow
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // Layer 1: dark outer edge
  ctx.beginPath()
  ctx.moveTo(p0x, p0y)
  ctx.bezierCurveTo(p1x, p1y, p2x, p2y, p3x, p3y)
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)'
  ctx.lineWidth = hoseRadius * 2 + 4
  ctx.stroke()

  // Layer 2: main black body
  ctx.beginPath()
  ctx.moveTo(p0x, p0y)
  ctx.bezierCurveTo(p1x, p1y, p2x, p2y, p3x, p3y)
  ctx.strokeStyle = '#1a1a1a'
  ctx.lineWidth = hoseRadius * 2
  ctx.stroke()

  // Layer 3: highlight stripe (3D shading)
  ctx.beginPath()
  ctx.moveTo(p0x, p0y)
  ctx.bezierCurveTo(p1x, p1y, p2x, p2y, p3x, p3y)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)'
  ctx.lineWidth = hoseRadius * 0.8
  ctx.stroke()

  // ── Hose connector ring at mouth ──
  const connR = hoseRadius + 3
  ctx.beginPath()
  ctx.arc(p0x, p0y, connR, 0, Math.PI * 2)
  ctx.fillStyle = '#2a2a2a'
  ctx.fill()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'
  ctx.lineWidth = 1.5
  ctx.stroke()

  // Inner hole
  ctx.beginPath()
  ctx.arc(p0x, p0y, hoseRadius - 2, 0, Math.PI * 2)
  ctx.fillStyle = '#0a0a0a'
  ctx.fill()

  ctx.restore()

  // ── Air particles flowing through hose during suction ──
  if (suctionStrength > 5) {
    const strength = suctionStrength / 100
    const numAir = Math.floor(strength * 12) + 4

    for (let i = 0; i < numAir; i++) {
      // Each particle has a position along the bezier (0..1)
      const speed = 0.0006 + strength * 0.001
      const t = ((time * speed + i / numAir) % 1)

      // Cubic bezier interpolation
      const t2 = t * t
      const t3 = t2 * t
      const mt = 1 - t
      const mt2 = mt * mt
      const mt3 = mt2 * mt

      const px = mt3 * p0x + 3 * mt2 * t * p1x + 3 * mt * t2 * p2x + t3 * p3x
      const py = mt3 * p0y + 3 * mt2 * t * p1y + 3 * mt * t2 * p2y + t3 * p3y

      // Particle size — bigger near mouth, smaller at end
      const size = (2 + (1 - t) * 3) * strength
      // Alpha — fade near ends
      const alpha = Math.sin(t * Math.PI) * strength * 0.7

      // Slight random offset for organic feel
      const offX = Math.sin(time * 0.005 + i * 2.1) * hoseRadius * 0.4
      const offY = Math.cos(time * 0.004 + i * 1.7) * hoseRadius * 0.3

      ctx.beginPath()
      ctx.arc(px + offX, py + offY, size, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(140, 200, 255, ${alpha})`
      ctx.fill()
    }

    // Glow at mouth opening during strong suction
    if (suctionStrength > 30) {
      const glowR = hoseRadius * 2 + strength * 10
      const grad = ctx.createRadialGradient(p0x, p0y, 0, p0x, p0y, glowR)
      grad.addColorStop(0, `rgba(100, 200, 255, ${strength * 0.2})`)
      grad.addColorStop(1, 'transparent')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(p0x, p0y, glowR, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}
