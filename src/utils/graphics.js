/**
 * Canvas graphics for the O-Face Tycoon game.
 * Realistic car, canister, animated hose, fluid effects.
 */

// ── Car (right side) ──
export function drawCar(ctx, canvasW, canvasH, time) {
  const cx = canvasW * 0.82
  const cy = canvasH * 0.55
  const scale = Math.min(canvasW, canvasH) / 600

  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(scale, scale)

  // Shadow under car
  ctx.fillStyle = 'rgba(0,0,0,0.3)'
  ctx.beginPath()
  ctx.ellipse(0, 80, 130, 15, 0, 0, Math.PI * 2)
  ctx.fill()

  // ── Body ──
  // Main body
  const bodyGrad = ctx.createLinearGradient(-120, -60, -120, 40)
  bodyGrad.addColorStop(0, '#2a2a2a')
  bodyGrad.addColorStop(0.5, '#1a1a1a')
  bodyGrad.addColorStop(1, '#111')
  ctx.fillStyle = bodyGrad
  roundRect(ctx, -120, -50, 240, 80, 8)
  ctx.fill()

  // Roof
  const roofGrad = ctx.createLinearGradient(-80, -100, -80, -50)
  roofGrad.addColorStop(0, '#333')
  roofGrad.addColorStop(1, '#222')
  ctx.fillStyle = roofGrad
  roundRect(ctx, -80, -100, 160, 55, 6)
  ctx.fill()

  // Windshield
  ctx.fillStyle = 'rgba(100, 180, 255, 0.15)'
  ctx.beginPath()
  ctx.moveTo(-75, -95)
  ctx.lineTo(70, -95)
  ctx.lineTo(80, -50)
  ctx.lineTo(-60, -50)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = 'rgba(100, 180, 255, 0.3)'
  ctx.lineWidth = 1.5
  ctx.stroke()

  // Rear window
  ctx.fillStyle = 'rgba(100, 180, 255, 0.1)'
  ctx.beginPath()
  ctx.moveTo(-75, -95)
  ctx.lineTo(-100, -50)
  ctx.lineTo(-60, -50)
  ctx.closePath()
  ctx.fill()

  // Front bumper
  ctx.fillStyle = '#222'
  roundRect(ctx, 100, -20, 25, 50, 4)
  ctx.fill()

  // Headlights
  const hlGlow = 0.3 + Math.sin(time * 0.002) * 0.1
  ctx.fillStyle = `rgba(255, 240, 200, ${hlGlow})`
  roundRect(ctx, 115, -15, 8, 15, 2)
  ctx.fill()
  roundRect(ctx, 115, 5, 8, 15, 2)
  ctx.fill()

  // Taillights
  ctx.fillStyle = 'rgba(255, 30, 30, 0.6)'
  roundRect(ctx, -125, -15, 6, 12, 2)
  ctx.fill()
  roundRect(ctx, -125, 5, 6, 12, 2)
  ctx.fill()

  // ── Wheels ──
  for (const wx of [-85, 85]) {
    // Tire
    ctx.fillStyle = '#1a1a1a'
    ctx.beginPath()
    ctx.arc(wx, 35, 28, 0, Math.PI * 2)
    ctx.fill()
    // Rim
    const rimGrad = ctx.createRadialGradient(wx, 35, 0, wx, 35, 18)
    rimGrad.addColorStop(0, '#888')
    rimGrad.addColorStop(0.5, '#555')
    rimGrad.addColorStop(1, '#333')
    ctx.fillStyle = rimGrad
    ctx.beginPath()
    ctx.arc(wx, 35, 18, 0, Math.PI * 2)
    ctx.fill()
    // Rim spokes
    ctx.strokeStyle = '#666'
    ctx.lineWidth = 2
    for (let a = 0; a < 5; a++) {
      const angle = (a / 5) * Math.PI * 2 + time * 0.0002
      ctx.beginPath()
      ctx.moveTo(wx, 35)
      ctx.lineTo(wx + Math.cos(angle) * 16, 35 + Math.sin(angle) * 16)
      ctx.stroke()
    }
  }

  // ── Fuel cap (right side, where hose connects) ──
  const capX = 60
  const capY = -10
  ctx.fillStyle = '#3a3a3a'
  ctx.beginPath()
  ctx.arc(capX, capY, 10, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#555'
  ctx.lineWidth = 2
  ctx.stroke()
  // Cap hinge
  ctx.fillStyle = '#444'
  ctx.fillRect(capX + 8, capY - 3, 8, 6)

  // Metallic shine on body
  ctx.fillStyle = 'rgba(255,255,255,0.03)'
  ctx.fillRect(-115, -48, 230, 15)

  ctx.restore()

  // Return fuel cap position in canvas coords
  return { x: cx + capX * scale, y: cy + capY * scale }
}

// ── Canister (left side) ──
export function drawCanister(ctx, canvasW, canvasH, fillLevel, time) {
  const cx = canvasW * 0.15
  const cy = canvasH * 0.58
  const scale = Math.min(canvasW, canvasH) / 600

  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(scale, scale)

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)'
  ctx.beginPath()
  ctx.ellipse(0, 75, 50, 10, 0, 0, Math.PI * 2)
  ctx.fill()

  // ── Canister body ──
  const bodyGrad = ctx.createLinearGradient(-40, -70, 40, -70)
  bodyGrad.addColorStop(0, '#b01a1a')
  bodyGrad.addColorStop(0.3, '#d42020')
  bodyGrad.addColorStop(0.7, '#c01818')
  bodyGrad.addColorStop(1, '#8a1212')
  ctx.fillStyle = bodyGrad
  roundRect(ctx, -40, -70, 80, 140, 6)
  ctx.fill()

  // Metallic rim at top
  ctx.fillStyle = '#888'
  roundRect(ctx, -42, -73, 84, 8, 3)
  ctx.fill()

  // Metallic rim at bottom
  ctx.fillStyle = '#777'
  roundRect(ctx, -42, 65, 84, 8, 3)
  ctx.fill()

  // ── Fluid inside (animated level) ──
  const fluidTop = 60 - (fillLevel / 100) * 120
  if (fillLevel > 0) {
    const fluidGrad = ctx.createLinearGradient(0, fluidTop, 0, 62)
    fluidGrad.addColorStop(0, 'rgba(255, 200, 50, 0.7)')
    fluidGrad.addColorStop(0.5, 'rgba(220, 160, 30, 0.8)')
    fluidGrad.addColorStop(1, 'rgba(180, 120, 20, 0.9)')

    ctx.save()
    ctx.beginPath()
    roundRect(ctx, -37, -67, 74, 132, 4)
    ctx.clip()

    ctx.fillStyle = fluidGrad
    ctx.fillRect(-37, fluidTop, 74, 62 - fluidTop + 67)

    // Wave on top of fluid
    ctx.fillStyle = 'rgba(255, 220, 80, 0.4)'
    ctx.beginPath()
    ctx.moveTo(-37, fluidTop)
    for (let x = -37; x <= 37; x += 2) {
      const wave = Math.sin(x * 0.15 + time * 0.004) * 3
      ctx.lineTo(x, fluidTop + wave)
    }
    ctx.lineTo(37, fluidTop + 10)
    ctx.lineTo(-37, fluidTop + 10)
    ctx.closePath()
    ctx.fill()

    ctx.restore()
  }

  // ── Cap / nozzle ──
  ctx.fillStyle = '#555'
  roundRect(ctx, -12, -82, 24, 14, 3)
  ctx.fill()
  ctx.fillStyle = '#444'
  roundRect(ctx, -8, -90, 16, 10, 4)
  ctx.fill()

  // ── Handle ──
  ctx.strokeStyle = '#666'
  ctx.lineWidth = 5
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(-30, -65)
  ctx.quadraticCurveTo(-30, -90, -10, -85)
  ctx.stroke()

  // ── "БЕНЗИН" label ──
  ctx.save()
  ctx.rotate(-0.05)
  // Label background
  ctx.fillStyle = 'rgba(0,0,0,0.4)'
  roundRect(ctx, -32, -15, 64, 30, 4)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.15)'
  ctx.lineWidth = 1
  roundRect(ctx, -32, -15, 64, 30, 4)
  ctx.stroke()
  // Text
  ctx.fillStyle = '#ffd700'
  ctx.font = 'bold 16px -apple-system, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('БЕНЗИН', 0, 0)
  ctx.restore()

  // ── Fill percentage text ──
  ctx.fillStyle = 'rgba(255,255,255,0.8)'
  ctx.font = 'bold 14px -apple-system, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(`${Math.round(fillLevel)}%`, 0, 50)

  // ── Nozzle port (where hose connects) ──
  const nozzleX = 42
  const nozzleY = -20
  ctx.fillStyle = '#444'
  ctx.beginPath()
  ctx.arc(nozzleX, nozzleY, 7, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#666'
  ctx.lineWidth = 2
  ctx.stroke()

  ctx.restore()

  return { x: cx + nozzleX * scale, y: cy + nozzleY * scale }
}

// ── Animated hose with state machine ──
// state: 'mouth' | 'disconnecting' | 'transferring' | 'reconnecting'
export function drawAnimatedHose(ctx, landmarks, time, state, suctionStrength, targets) {
  if (!landmarks || landmarks.length < 478) return

  const W = ctx.canvas.width
  const H = ctx.canvas.height

  // Mouth attachment point
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

  // Target positions
  const mouthPos = { x: mouthCx, y: mouthCy }
  const carPos = targets.car || { x: W * 0.82, y: H * 0.45 }
  const canisterPos = targets.canister || { x: W * 0.15, y: H * 0.48 }

  // Hose end position based on state
  let hoseEnd
  let hoseStart = mouthPos

  if (state === 'mouth') {
    // Hose goes from mouth down and to the right toward car
    hoseEnd = {
      x: mouthCx + tiltInfluence + 80,
      y: mouthCy + H * 0.25,
    }
  } else if (state === 'disconnecting') {
    // Hose swinging from mouth toward canister
    const t = (Math.sin(time * 0.003) + 1) / 2 // 0..1 oscillation
    hoseEnd = {
      x: mouthCx + (canisterPos.x - mouthCx) * t,
      y: mouthCy + (canisterPos.y - mouthCy) * t,
    }
    hoseStart = {
      x: mouthPos.x + (canisterPos.x - mouthPos.x) * (t * 0.3),
      y: mouthPos.y + (canisterPos.y - mouthPos.y) * (t * 0.3),
    }
  } else if (state === 'transferring') {
    // Hose connected to canister
    hoseStart = {
      x: canisterPos.x - 20,
      y: canisterPos.y - 10,
    }
    hoseEnd = {
      x: canisterPos.x + 15,
      y: canisterPos.y,
    }
  } else if (state === 'reconnecting') {
    // Hose swinging back to mouth
    const t = (Math.sin(time * 0.003 + Math.PI) + 1) / 2
    hoseEnd = {
      x: canisterPos.x + (mouthCx - canisterPos.x) * t,
      y: canisterPos.y + (mouthCy - canisterPos.y) * t,
    }
    hoseStart = {
      x: canisterPos.x + (mouthPos.x - canisterPos.x) * (t * 0.3),
      y: canisterPos.y + (mouthPos.y - canisterPos.y) * (t * 0.3),
    }
  }

  // Bezier control points
  const midX = (hoseStart.x + hoseEnd.x) / 2
  const midY = (hoseStart.y + hoseEnd.y) / 2
  const sag = 40 + Math.sin(time * 0.001) * 5

  const p0x = hoseStart.x, p0y = hoseStart.y
  const p1x = midX - 30, p1y = midY + sag
  const p2x = midX + 30, p2y = midY + sag * 0.8
  const p3x = hoseEnd.x, p3y = hoseEnd.y

  // ── Draw hose ──
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

  // ── Connector at start ──
  ctx.beginPath()
  ctx.arc(p0x, p0y, hoseRadius + 4, 0, Math.PI * 2)
  ctx.fillStyle = '#2a2a2a'
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.1)'
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(p0x, p0y, hoseRadius - 3, 0, Math.PI * 2)
  ctx.fillStyle = '#0a0a0a'
  ctx.fill()

  // ── Connector at end ──
  ctx.beginPath()
  ctx.arc(p3x, p3y, hoseRadius + 4, 0, Math.PI * 2)
  ctx.fillStyle = '#2a2a2a'
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.1)'
  ctx.lineWidth = 1.5
  ctx.stroke()

  // ── Air/liquid particles inside hose ──
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
      const size = state === 'transferring'
        ? 2.5 + (1 - t) * 2 // liquid drops
        : 1.5 + (1 - t) * 2.5 // air particles

      const color = state === 'transferring'
        ? `rgba(255, 200, 50, ${alpha})` // golden liquid
        : `rgba(140, 200, 255, ${alpha})` // blue air

      ctx.beginPath()
      ctx.arc(px + offX, py + offY, size, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
    }
  }

  ctx.restore()

  return { p0x, p0y, p3x, p3y }
}

// ── Helper: rounded rectangle ──
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

// ── Sound effects (Web Audio API) ──
let audioCtx = null

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  }
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

    // Bubbling sound
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

    // Click + confirmation tone
    const click = ctx.createOscillator()
    const clickGain = ctx.createGain()
    click.type = 'square'
    click.frequency.value = 800
    clickGain.gain.setValueAtTime(0.08, ctx.currentTime)
    clickGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05)
    click.connect(clickGain)
    clickGain.connect(ctx.destination)
    click.start()
    click.stop(ctx.currentTime + 0.05)

    const tone = ctx.createOscillator()
    const toneGain = ctx.createGain()
    tone.type = 'sine'
    tone.frequency.setValueAtTime(600, ctx.currentTime + 0.06)
    tone.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.15)
    toneGain.gain.setValueAtTime(0.08, ctx.currentTime + 0.06)
    toneGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2)
    tone.connect(toneGain)
    toneGain.connect(ctx.destination)
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
    osc.frequency.setValueAtTime(523, ctx.currentTime) // C5
    osc.frequency.setValueAtTime(659, ctx.currentTime + 0.08) // E5
    osc.frequency.setValueAtTime(784, ctx.currentTime + 0.16) // G5

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

    // Fanfare
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
