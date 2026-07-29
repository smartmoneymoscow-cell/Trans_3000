/**
 * Canvas graphics for O-Face Tycoon.
 * Uses realistic SVG sprites for car and canister.
 */

// ── Image preloading ──
const images = {}
let imagesLoaded = false

const IMAGE_SOURCES = {
  car: `${import.meta.env.BASE_URL}assets/car.svg`,
  canister: `${import.meta.env.BASE_URL}assets/canister.svg`,
}

export function preloadImages() {
  if (imagesLoaded) return Promise.resolve()
  return Promise.all(
    Object.entries(IMAGE_SOURCES).map(([key, src]) =>
      new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => { images[key] = img; resolve() }
        img.onerror = () => { console.warn(`Failed to load ${src}`); resolve() }
        img.src = src
      })
    )
  ).then(() => { imagesLoaded = true })
}

// ── Draw car (right side) ──
export function drawCar(ctx, canvasW, canvasH, time) {
  const img = images.car
  if (!img) return { x: canvasW * 0.82, y: canvasH * 0.45 }

  // Scale: car height = 75% of canvas
  const targetH = canvasH * 0.75
  const scale = targetH / img.height
  const w = img.width * scale
  const h = img.height * scale
  // Position: right portion of car visible, fuel cap area accessible
  const x = canvasW - w * 0.5
  const y = canvasH * 0.12

  ctx.save()
  ctx.drawImage(img, x, y, w, h)

  // Animated headlight glow
  const glowAlpha = 0.2 + Math.sin(time * 0.002) * 0.1
  const hlX = x + w * 0.97
  const hlY1 = y + h * 0.53
  const grad = ctx.createRadialGradient(hlX, hlY1, 0, hlX, hlY1, 40)
  grad.addColorStop(0, `rgba(255, 245, 220, ${glowAlpha})`)
  grad.addColorStop(1, 'transparent')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(hlX, hlY1, 40, 0, Math.PI * 2)
  ctx.fill()

  // Taillight glow (red)
  const tlX = x + w * 0.04
  const tlY = y + h * 0.52
  const tailGrad = ctx.createRadialGradient(tlX, tlY, 0, tlX, tlY, 25)
  tailGrad.addColorStop(0, `rgba(255, 40, 40, ${0.15 + Math.sin(time * 0.003) * 0.05})`)
  tailGrad.addColorStop(1, 'transparent')
  ctx.fillStyle = tailGrad
  ctx.beginPath()
  ctx.arc(tlX, tlY, 25, 0, Math.PI * 2)
  ctx.fill()

  ctx.restore()

  // Return fuel cap position (right rear fender area)
  const capX = x + w * 0.68
  const capY = y + h * 0.55
  return { x: capX, y: capY }
}

// ── Draw canister (left side) ──
export function drawCanister(ctx, canvasW, canvasH, fillPct, time) {
  const img = images.canister
  if (!img) return { x: canvasW * 0.15, y: canvasH * 0.5 }

  // Scale canister to fit left side
  const targetH = canvasH * 0.38
  const scale = targetH / img.height
  const w = img.width * scale
  const h = img.height * scale
  const x = canvasW * 0.01
  const y = canvasH * 0.42

  ctx.save()
  ctx.drawImage(img, x, y, w, h)

  // ── Animated fluid level overlay ──
  if (fillPct > 0) {
    const fluidTop = y + h * 0.82 - (fillPct / 100) * h * 0.62
    const fluidBottom = y + h * 0.9
    const fluidLeft = x + w * 0.26
    const fluidWidth = w * 0.48

    ctx.save()
    // Clip to canister body area
    ctx.beginPath()
    ctx.rect(x + w * 0.22, y + h * 0.2, fluidWidth + w * 0.04, h * 0.74)
    ctx.clip()

    // Fluid fill
    const fluidGrad = ctx.createLinearGradient(0, fluidTop, 0, fluidBottom)
    fluidGrad.addColorStop(0, 'rgba(255, 210, 60, 0.65)')
    fluidGrad.addColorStop(0.5, 'rgba(240, 180, 40, 0.75)')
    fluidGrad.addColorStop(1, 'rgba(200, 140, 25, 0.85)')
    ctx.fillStyle = fluidGrad
    ctx.fillRect(fluidLeft, fluidTop, fluidWidth, fluidBottom - fluidTop)

    // Wave on fluid surface
    ctx.fillStyle = 'rgba(255, 225, 80, 0.45)'
    ctx.beginPath()
    ctx.moveTo(fluidLeft, fluidTop)
    for (let px = 0; px < fluidWidth; px += 2) {
      const wave = Math.sin(px * 0.08 + time * 0.004) * 3
      ctx.lineTo(fluidLeft + px, fluidTop + wave)
    }
    ctx.lineTo(fluidLeft + fluidWidth, fluidTop + 8)
    ctx.lineTo(fluidLeft, fluidTop + 8)
    ctx.closePath()
    ctx.fill()

    // Bubbles
    for (let i = 0; i < 4; i++) {
      const bx = fluidLeft + fluidWidth * 0.2 + (i * fluidWidth * 0.2)
      const by = fluidBottom - ((time * 0.03 + i * 50) % (fluidBottom - fluidTop))
      const br = 1.5 + Math.sin(time * 0.005 + i) * 0.5
      ctx.beginPath()
      ctx.arc(bx, by, br, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255, 240, 150, 0.4)'
      ctx.fill()
    }

    ctx.restore()
  }

  // Fluid level indicator strip (left side of canister)
  const stripX = x + w * 0.2
  const stripTop = y + h * 0.22
  const stripH = h * 0.62
  const stripW = w * 0.05

  // Fill indicator on strip
  if (fillPct > 0) {
    const fillH = (fillPct / 100) * stripH
    ctx.fillStyle = 'rgba(255, 210, 60, 0.7)'
    ctx.fillRect(stripX, stripTop + stripH - fillH, stripW, fillH)
  }

  ctx.restore()

  // Return nozzle port position (right side of canister)
  const nozzleX = x + w * 0.95
  const nozzleY = y + h * 0.4
  return { x: nozzleX, y: nozzleY }
}

// ── Animated hose with state machine ──
export function drawAnimatedHose(ctx, landmarks, time, state, suctionStrength, targets) {
  if (!landmarks || landmarks.length < 478) return

  const W = ctx.canvas.width
  const H = ctx.canvas.height

  const upperLip = landmarks[13]
  const lowerLip = landmarks[14]
  const noseTip = landmarks[1]
  const chin = landmarks[152]
  if (!upperLip || !lowerLip || !chin) return

  const mouthCx = ((upperLip.x + lowerLip.x) / 2) * W
  const mouthCy = ((upperLip.y + lowerLip.y) / 2) * H
  const noseX = noseTip.x * W
  const noseY = noseTip.y * H
  const chinX = chin.x * W
  const chinY = chin.y * H

  const headAngle = Math.atan2(chinY - noseY, chinX - noseX)
  const tiltInfluence = Math.sin(headAngle) * H * 0.12
  const hoseRadius = 12

  const mouthPos = { x: mouthCx, y: mouthCy }
  const carPos = targets.car || { x: W * 0.82, y: H * 0.45 }
  const canisterPos = targets.canister || { x: W * 0.15, y: H * 0.48 }

  let hoseEnd, hoseStart

  if (state === 'mouth') {
    // Hose goes from mouth to car fuel cap (right side)
    hoseStart = mouthPos
    hoseEnd = carPos
  } else if (state === 'disconnecting') {
    // Hose swings from car fuel cap to canister
    const t = (Math.sin(time * 0.003) + 1) / 2
    hoseStart = {
      x: carPos.x + (canisterPos.x - carPos.x) * t,
      y: carPos.y + (canisterPos.y - carPos.y) * t,
    }
    hoseEnd = {
      x: carPos.x + (canisterPos.x - carPos.x) * (t * 0.7),
      y: carPos.y + (canisterPos.y - carPos.y) * (t * 0.7),
    }
  } else if (state === 'transferring') {
    hoseStart = { x: canisterPos.x - 20, y: canisterPos.y - 10 }
    hoseEnd = { x: canisterPos.x + 15, y: canisterPos.y }
  } else if (state === 'reconnecting') {
    // Hose swings back from canister to car fuel cap
    const t = (Math.sin(time * 0.003 + Math.PI) + 1) / 2
    hoseStart = {
      x: canisterPos.x + (carPos.x - canisterPos.x) * t,
      y: canisterPos.y + (carPos.y - canisterPos.y) * t,
    }
    hoseEnd = {
      x: canisterPos.x + (carPos.x - canisterPos.x) * (t * 0.7),
      y: canisterPos.y + (carPos.y - canisterPos.y) * (t * 0.7),
    }
  }

  const midX = (hoseStart.x + hoseEnd.x) / 2
  const midY = (hoseStart.y + hoseEnd.y) / 2
  const sag = 30 + Math.sin(time * 0.001) * 5

  // Dynamic control points based on hose direction
  const dx = hoseEnd.x - hoseStart.x
  const dy = hoseEnd.y - hoseStart.y
  const hoseLen = Math.sqrt(dx * dx + dy * dy)
  // Perpendicular offset for natural curve
  const perpX = -dy / hoseLen * sag
  const perpY = dx / hoseLen * sag

  const p0x = hoseStart.x, p0y = hoseStart.y
  const p1x = midX + perpX * 0.6, p1y = midY + perpY * 0.6 + sag * 0.5
  const p2x = midX + perpX * 0.3, p2y = midY + perpY * 0.3 + sag * 0.4
  const p3x = hoseEnd.x, p3y = hoseEnd.y

  ctx.save()
  ctx.lineCap = 'round'

  // Outer shadow
  ctx.beginPath()
  ctx.moveTo(p0x, p0y)
  ctx.bezierCurveTo(p1x, p1y, p2x, p2y, p3x, p3y)
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'
  ctx.lineWidth = hoseRadius * 2 + 6
  ctx.stroke()

  // Main body
  ctx.beginPath()
  ctx.moveTo(p0x, p0y)
  ctx.bezierCurveTo(p1x, p1y, p2x, p2y, p3x, p3y)
  ctx.strokeStyle = '#1a1a1a'
  ctx.lineWidth = hoseRadius * 2
  ctx.stroke()

  // Highlight
  ctx.beginPath()
  ctx.moveTo(p0x, p0y)
  ctx.bezierCurveTo(p1x, p1y, p2x, p2y, p3x, p3y)
  ctx.strokeStyle = 'rgba(255,255,255,0.07)'
  ctx.lineWidth = hoseRadius * 0.7
  ctx.stroke()

  // Connectors
  for (const [cx, cy] of [[p0x, p0y], [p3x, p3y]]) {
    ctx.beginPath()
    ctx.arc(cx, cy, hoseRadius + 4, 0, Math.PI * 2)
    ctx.fillStyle = '#2a2a2a'
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'
    ctx.lineWidth = 1.5
    ctx.stroke()
  }
  ctx.beginPath()
  ctx.arc(p0x, p0y, hoseRadius - 3, 0, Math.PI * 2)
  ctx.fillStyle = '#0a0a0a'
  ctx.fill()

  // Particles
  if (suctionStrength > 5 || state === 'transferring') {
    const numP = state === 'transferring' ? 15 : Math.floor(suctionStrength / 8) + 3
    const speed = state === 'transferring' ? 0.0008 : 0.0005 + (suctionStrength / 100) * 0.001

    for (let i = 0; i < numP; i++) {
      const t = ((time * speed + i / numP) % 1)
      const t2 = t * t, t3 = t2 * t, mt = 1 - t, mt2 = mt * mt, mt3 = mt2 * mt
      const px = mt3 * p0x + 3 * mt2 * t * p1x + 3 * mt * t2 * p2x + t3 * p3x
      const py = mt3 * p0y + 3 * mt2 * t * p1y + 3 * mt * t2 * p2y + t3 * p3y
      const offX = Math.sin(time * 0.005 + i * 2) * hoseRadius * 0.3
      const offY = Math.cos(time * 0.004 + i * 1.5) * hoseRadius * 0.25
      const alpha = Math.sin(t * Math.PI) * 0.7
      const size = state === 'transferring' ? 2.5 + (1 - t) * 2 : 1.5 + (1 - t) * 2.5
      const color = state === 'transferring'
        ? `rgba(255, 200, 50, ${alpha})`
        : `rgba(140, 200, 255, ${alpha})`

      ctx.beginPath()
      ctx.arc(px + offX, py + offY, size, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
    }
  }

  ctx.restore()
  return { p0x, p0y, p3x, p3y }
}

// ── Sound effects ──
let audioCtx = null
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  return audioCtx
}

export function playSuckSound(strength) {
  try {
    const ctx = getAudioCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 200 + strength * 5
    osc.type = 'sawtooth'
    osc.frequency.value = 60 + strength * 0.5
    osc.connect(filter)
    filter.connect(gain)
    gain.connect(ctx.destination)
    gain.gain.setValueAtTime(0.04 + strength * 0.001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15)
    osc.start()
    osc.stop(ctx.currentTime + 0.15)
  } catch (e) {}
}

export function playDisconnectSound() {
  try {
    const ctx = getAudioCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(400, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + 0.3)
    gain.gain.setValueAtTime(0.12, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.3)
  } catch (e) {}
}

export function playTransferSound() {
  try {
    const ctx = getAudioCtx()
    for (let i = 0; i < 5; i++) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      const t = ctx.currentTime + i * 0.12
      osc.frequency.setValueAtTime(200 + Math.random() * 200, t)
      osc.frequency.exponentialRampToValueAtTime(100, t + 0.1)
      gain.gain.setValueAtTime(0.06, t)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.1)
    }
  } catch (e) {}
}

export function playConnectSound() {
  try {
    const ctx = getAudioCtx()
    const click = ctx.createOscillator()
    const cg = ctx.createGain()
    click.type = 'square'
    click.frequency.value = 800
    cg.gain.setValueAtTime(0.08, ctx.currentTime)
    cg.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05)
    click.connect(cg)
    cg.connect(ctx.destination)
    click.start()
    click.stop(ctx.currentTime + 0.05)

    const tone = ctx.createOscillator()
    const tg2 = ctx.createGain()
    tone.type = 'sine'
    tone.frequency.setValueAtTime(600, ctx.currentTime + 0.06)
    tone.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.15)
    tg2.gain.setValueAtTime(0.08, ctx.currentTime + 0.06)
    tg2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2)
    tone.connect(tg2)
    tg2.connect(ctx.destination)
    tone.start(ctx.currentTime + 0.06)
    tone.stop(ctx.currentTime + 0.2)
  } catch (e) {}
}

export function playScoreSound() {
  try {
    const ctx = getAudioCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(523, ctx.currentTime)
    osc.frequency.setValueAtTime(659, ctx.currentTime + 0.08)
    osc.frequency.setValueAtTime(784, ctx.currentTime + 0.16)
    gain.gain.setValueAtTime(0.12, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.3)
  } catch (e) {}
}

export function playCanisterFullSound() {
  try {
    const ctx = getAudioCtx()
    const notes = [523, 659, 784, 1047]
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'triangle'
      const t = ctx.currentTime + i * 0.12
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.15, t)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.25)
    })
  } catch (e) {}
}
