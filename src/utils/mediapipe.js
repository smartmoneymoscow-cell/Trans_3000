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
 * Detect "O" mouth shape from blendshapes.
 * Returns { isO: boolean, confidence: number (0-100) }
 *
 * "O" shape = jawOpen high + mouthFunnel high + mouthSmile low
 */
export function detectOMouth(blendshapes) {
  if (!blendshapes || blendshapes.length === 0) return { isO: false, confidence: 0 }

  const bs = (name) => {
    const found = blendshapes.find(b => b.categoryName === name)
    return found ? found.score : 0
  }

  const jawOpen = bs('jawOpen')
  const mouthFunnel = bs('mouthFunnel')
  const mouthPucker = bs('mouthPucker')
  const smileL = bs('mouthSmileLeft')
  const smileR = bs('mouthSmileRight')
  const smileAvg = (smileL + smileR) / 2

  // "O" = open jaw + funnel shape + not smiling
  // mouthFunnel captures the rounded lip shape
  // mouthPucker also helps — a pucker with open jaw looks like O
  const oScore = (jawOpen * 0.3) + (mouthFunnel * 0.4) + (mouthPucker * 0.2) - (smileAvg * 0.3)

  // Jaw needs to be noticeably open
  const jawThreshold = 0.15
  // Either funnel or pucker should be present
  const shapePresent = mouthFunnel > 0.12 || mouthPucker > 0.15
  // Not a wide smile
  const notSmiling = smileAvg < 0.4

  const isO = jawOpen > jawThreshold && shapePresent && notSmiling && oScore > 0.12

  // Confidence: scale oScore to 0-100
  const confidence = Math.round(Math.min(100, Math.max(0, oScore * 200)))

  return { isO, confidence }
}
