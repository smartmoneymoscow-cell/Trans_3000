import React, { useState, useRef, useEffect, useCallback } from 'react'
import { getFaceLandmarker, resetFaceLandmarker, drawFaceMesh, drawSuctionEffect, detectOMouth } from './utils/mediapipe'
import {
  preloadImages, drawCar, drawCanister, drawAnimatedHose,
  playSuckSound, playDisconnectSound, playTransferSound,
  playConnectSound, playScoreSound, playCanisterFullSound,
} from './utils/graphics'

const tg = window.Telegram?.WebApp

// ── Game config ──
const ROUND_DURATION = 60
const HOLD_THRESHOLD = 300
const CYCLE_CAPACITY = 10 // fill points per transfer cycle (5 strong or 10 weak)
const STRONG_SUCTION_THRESHOLD = 50 // suction > 50 = strong inhale
const STRONG_INHALE_VALUE = 2 // strong inhale = 2 fill points
const WEAK_INHALE_VALUE = 1 // weak inhale = 1 fill point
const CANISTER_CYCLES = 4 // transfers needed to fill the big canister
const TRANSFER_DURATION = 3000 // ms for fluid transfer animation
const DISCONNECT_DURATION = 1500 // ms for hose disconnect animation
const RECONNECT_DURATION = 1500 // ms for hose reconnect animation

function ConfettiParticle({ style }) {
  return <div className="confetti" style={style} />
}

export default function App() {
  const [phase, setPhase] = useState('menu')
  const [score, setScore] = useState(0)
  const [timer, setTimer] = useState(ROUND_DURATION)
  const [streak, setStreak] = useState(0)
  const [maxStreak, setMaxStreak] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [isO, setIsO] = useState(false)
  const [isSucking, setIsSucking] = useState(false)
  const [isActive, setIsActive] = useState(false)
  const [oShape, setOShape] = useState(0)
  const [suction, setSuction] = useState(0)
  const [cycleFill, setCycleFill] = useState(0) // 0-100 current transfer cycle
  const [canisterCycles, setCanisterCycles] = useState(0) // 0-4 completed transfers
  const [hoseState, setHoseState] = useState('mouth') // mouth | disconnecting | transferring | reconnecting
  const [bonusText, setBonusText] = useState(null)
  const [confetti, setConfetti] = useState([])
  const [highScore, setHighScore] = useState(() => {
    try { return parseInt(localStorage.getItem('o-face-highscore') || '0', 10) } catch { return 0 }
  })

  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const landmarkerRef = useRef(null)
  const animRef = useRef(null)
  const floatingPointsRef = useRef([])
  const targetsRef = useRef({ car: null, canister: null })

  const gs = useRef({
    cycleState: 'sucking', // sucking | full | disconnecting | transferring | reconnecting
    cycleLevel: 0, // 0..CYCLE_CAPACITY
    canisterCycles: 0, // 0..CANISTER_CYCLES completed transfers
    cycleStartTime: 0,
    oStartTime: 0,
    lastScoreTime: 0,
    holding: false,
    streak: 0,
    score: 0,
    totalInhales: 0,
    faceCenter: { x: 0.5, y: 0.35 },
    lastSuckSoundTime: 0,
    suctionSmoothed: 0,
  })

  useEffect(() => {
    if (tg) {
      tg.ready()
      tg.expand()
      tg.setHeaderColor('#0a0a0f')
      tg.setBackgroundColor('#0a0a0f')
    }
  }, [])

  const cleanup = useCallback(() => {
    if (animRef.current) cancelAnimationFrame(animRef.current)
    animRef.current = null
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  useEffect(() => () => cleanup(), [cleanup])

  const spawnConfetti = useCallback(() => {
    const particles = Array.from({ length: 20 }, (_, i) => ({
      id: Date.now() + i,
      left: Math.random() * 100,
      delay: Math.random() * 0.3,
      color: ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#ff6b9d'][Math.floor(Math.random() * 5)],
    }))
    setConfetti(prev => [...prev, ...particles])
    setTimeout(() => {
      setConfetti(prev => prev.filter(p => !particles.find(np => np.id === p.id)))
    }, 1500)
  }, [])

  const showBonus = useCallback((text) => {
    setBonusText(text)
    setTimeout(() => setBonusText(null), 1200)
  }, [])

  const startGame = useCallback(async () => {
    try {
      // Preload SVG assets
      await preloadImages()

      const landmarker = await getFaceLandmarker()
      landmarkerRef.current = landmarker

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      })
      streamRef.current = stream

      // Set phase first so <video> mounts in DOM
      setPhase('camera')
      await new Promise(r => setTimeout(r, 200))

      const video = videoRef.current
      if (!video) return
      video.srcObject = stream
      video.setAttribute('playsinline', '')
      video.muted = true
      video.playsInline = true
      await video.play()

      await new Promise(r => setTimeout(r, 800))

      setScore(0); setTimer(ROUND_DURATION); setStreak(0); setMaxStreak(0)
      setTotalCount(0); setIsO(false); setIsSucking(false); setIsActive(false)
      setOShape(0); setSuction(0); setCycleFill(0); setCanisterCycles(0); setHoseState('mouth')

      gs.current = {
        cycleState: 'sucking',
        cycleLevel: 0,
        canisterCycles: 0,
        cycleStartTime: 0,
        oStartTime: 0,
        lastScoreTime: 0,
        holding: false,
        streak: 0,
        score: 0,
        totalInhales: 0,
        faceCenter: { x: 0.5, y: 0.35 },
        lastSuckSoundTime: 0,
        suctionSmoothed: 0,
      }

      setPhase('playing')

      // Wait for React to flush DOM and mount <canvas>
      await new Promise(r => setTimeout(r, 200))

      const timerStart = Date.now()
      const timerInterval = setInterval(() => {
        const remaining = ROUND_DURATION - Math.floor((Date.now() - timerStart) / 1000)
        setTimer(remaining)
        if (remaining <= 0) {
          clearInterval(timerInterval)
          setPhase('result')
          cleanup()
          const finalScore = gs.current.score
          if (finalScore > highScore) {
            setHighScore(finalScore)
            try { localStorage.setItem('o-face-highscore', String(finalScore)) } catch {}
          }
          if (tg) {
            tg.HapticFeedback.notificationOccurred('success')
            tg.MainButton.setParams({ text: `Сыграть ещё (${finalScore} очков)`, is_visible: true })
          }
        }
      }, 500)

      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')

      const loop = () => {
        const time = Date.now()

        if (video.readyState >= 2) {
          const vw = video.videoWidth || 640
          const vh = video.videoHeight || 480
          if (canvas.width !== vw) canvas.width = vw
          if (canvas.height !== vh) canvas.height = vh

          const W = canvas.width, H = canvas.height

          // Mirror video
          ctx.save()
          ctx.translate(W, 0)
          ctx.scale(-1, 1)
          ctx.drawImage(video, 0, 0, W, H)
          ctx.restore()

          // ── Draw static scene elements ──
          // Car (right side)
          const carCap = drawCar(ctx, W, H, time)
          targetsRef.current.car = carCap

          // Canister (left side) — fill level = cycles completed / total
          const canisterPct = (gs.current.canisterCycles / CANISTER_CYCLES) * 100
          const canisterPort = drawCanister(ctx, W, H, canisterPct, time)
          targetsRef.current.canister = canisterPort

          try {
            const result = landmarker.detectForVideo(video, time)
            const landmarks = result?.faceLandmarks?.[0]
            const blendshapes = result?.faceBlendshapes?.[0]?.categories

            if (landmarks) {
              const nose = landmarks[1]
              const forehead = landmarks[10]
              if (nose && forehead) {
                gs.current.faceCenter = {
                  x: 1 - (nose.x + forehead.x) / 2,
                  y: (nose.y + forehead.y) / 2 - 0.08,
                }
              }
            }

            let detection = { isO: false, isSucking: false, active: false, oShape: 0, suction: 0 }
            if (blendshapes) {
              detection = detectOMouth(blendshapes)
              setIsO(detection.isO)
              setIsSucking(detection.isSucking)
              setIsActive(detection.active)
              setOShape(detection.oShape)
              setSuction(detection.suction)
            }

            // Smoothed suction for sound
            gs.current.suctionSmoothed = gs.current.suctionSmoothed * 0.7 + detection.suction * 0.3

            // ── Cycle state machine ──
            const g = gs.current

            if (g.cycleState === 'sucking') {
              // Draw animated hose connected to mouth
              if (landmarks) {
                const mirrored = landmarks.map(l => ({ x: 1 - l.x, y: l.y, z: l.z }))
                drawAnimatedHose(ctx, mirrored, time, 'mouth', detection.suction, targetsRef.current)
                drawFaceMesh(ctx, mirrored, time)
                drawSuctionEffect(ctx, mirrored, time, detection.suction)
              }

              if (detection.active) {
                // Suck sound (throttled)
                if (time - g.lastSuckSoundTime > 150) {
                  playSuckSound(g.suctionSmoothed)
                  g.lastSuckSoundTime = time
                }

                // Score points
                if (!g.holding) { g.holding = true; g.oStartTime = time }
                const holdTime = time - g.oStartTime
                if (holdTime >= HOLD_THRESHOLD && time - g.lastScoreTime > HOLD_THRESHOLD) {
                  g.lastScoreTime = time
                  g.totalInhales++
                  g.streak++
                  const pts = g.streak >= 5 ? 20 : 10
                  g.score += pts
                  setScore(g.score); setStreak(g.streak); setTotalCount(g.totalInhales)
                  if (g.streak > g.maxStreak) { g.maxStreak = g.streak; setMaxStreak(g.streak) }
                  playScoreSound()
                  if (tg) tg.HapticFeedback.impactOccurred('light')
                  g.oStartTime = time
                  spawnConfetti()
                  if (g.streak >= 5) showBonus('🔥 x2 БОНУС!')

                  floatingPointsRef.current.push({
                    x: g.faceCenter.x + (Math.random() - 0.5) * 0.08,
                    y: g.faceCenter.y,
                    text: `+${pts}`, born: time, duration: 1200,
                    color: g.streak >= 5 ? '#f97316' : '#4ade80',
                  })

                  // Fill cycle: strong inhale = 2 pts, weak = 1 pt
                  const isStrong = g.suctionSmoothed >= STRONG_SUCTION_THRESHOLD
                  const fillValue = isStrong ? STRONG_INHALE_VALUE : WEAK_INHALE_VALUE
                  g.cycleLevel = Math.min(CYCLE_CAPACITY, g.cycleLevel + fillValue)
                  setCycleFill(Math.round((g.cycleLevel / CYCLE_CAPACITY) * 100))
                  if (isStrong) showBonus('💪 СИЛЬНЫЙ ВДОХ!')
                }
              } else {
                if (g.holding) { g.holding = false; g.streak = 0; setStreak(0) }
              }

              // Cycle full → transfer
              if (g.cycleLevel >= CYCLE_CAPACITY) {
                g.cycleState = 'disconnecting'
                g.cycleStartTime = time
                setHoseState('disconnecting')
                playDisconnectSound()
                if (tg) tg.HapticFeedback.impactOccurred('heavy')
                showBonus('⛽ ПЕРЕЛИВ!')
              }

            } else if (g.cycleState === 'disconnecting') {
              // Hose swinging from mouth to canister
              if (landmarks) {
                const mirrored = landmarks.map(l => ({ x: 1 - l.x, y: l.y, z: l.z }))
                drawAnimatedHose(ctx, mirrored, time, 'disconnecting', 0, targetsRef.current)
                drawFaceMesh(ctx, mirrored, time)
              }

              if (time - g.cycleStartTime > DISCONNECT_DURATION) {
                g.cycleState = 'transferring'
                g.cycleStartTime = time
                setHoseState('transferring')
                playTransferSound()
              }

            } else if (g.cycleState === 'transferring') {
              // Hose connected to canister, liquid flowing
              drawAnimatedHose(ctx, landmarks ? landmarks.map(l => ({ x: 1 - l.x, y: l.y, z: l.z })) : [], time, 'transferring', 80, targetsRef.current)

              if (landmarks) {
                const mirrored = landmarks.map(l => ({ x: 1 - l.x, y: l.y, z: l.z }))
                drawFaceMesh(ctx, mirrored, time)
              }

              const transferProgress = (time - g.cycleStartTime) / TRANSFER_DURATION
              if (transferProgress >= 1) {
                // Transfer complete → increment canister cycles
                g.canisterCycles++
                g.cycleLevel = 0
                setCanisterCycles(g.canisterCycles)
                setCycleFill(0)

                if (g.canisterCycles >= CANISTER_CYCLES) {
                  // WIN! Big canister full
                  showBonus('🏆 КАНИСТРА ПОЛНА! ПОБЕДА!')
                  playCanisterFullSound()
                  if (tg) tg.HapticFeedback.notificationOccurred('success')
                  g.score += 100 // bonus for completing
                  setScore(g.score)
                  // End game
                  setTimeout(() => {
                    setPhase('result')
                    cleanup()
                    const finalScore = g.score
                    if (finalScore > highScore) {
                      setHighScore(finalScore)
                      try { localStorage.setItem('o-face-highscore', String(finalScore)) } catch {}
                    }
                    if (tg) tg.MainButton.setParams({ text: `Сыграть ещё (${finalScore} очков)`, is_visible: true })
                  }, 2000)
                  return
                }

                g.cycleState = 'reconnecting'
                g.cycleStartTime = time
                setHoseState('reconnecting')
                playConnectSound()
                showBonus(`🛢️ ${g.canisterCycles}/${CANISTER_CYCLES}`)
              }

            } else if (g.cycleState === 'reconnecting') {
              // Hose swinging back to mouth
              if (landmarks) {
                const mirrored = landmarks.map(l => ({ x: 1 - l.x, y: l.y, z: l.z }))
                drawAnimatedHose(ctx, mirrored, time, 'reconnecting', 0, targetsRef.current)
                drawFaceMesh(ctx, mirrored, time)
              }

              if (time - g.cycleStartTime > RECONNECT_DURATION) {
                g.cycleState = 'sucking'
                setHoseState('mouth')
              }
            }

          } catch (e) { /* skip frame */ }

          // Floating +points
          const fps = floatingPointsRef.current
          for (let i = fps.length - 1; i >= 0; i--) {
            const fp = fps[i]
            const age = time - fp.born
            if (age > fp.duration) { fps.splice(i, 1); continue }
            const p = age / fp.duration
            const x = fp.x * W
            const y = fp.y * H - p * 80
            ctx.save()
            ctx.globalAlpha = 1 - p * p
            ctx.font = `bold ${Math.round(28 * (1 + p * 0.4))}px -apple-system, sans-serif`
            ctx.textAlign = 'center'
            ctx.fillStyle = fp.color
            ctx.shadowColor = fp.color
            ctx.shadowBlur = 12
            ctx.fillText(fp.text, x, y)
            ctx.shadowBlur = 0
            ctx.restore()
          }

          // Cycle state label on canvas
          if (gs.current.cycleState !== 'sucking') {
            const labels = {
              disconnecting: '⬆️ Отсоединение шланга...',
              transferring: '⛽ Перелив в канистру...',
              reconnecting: '↩️ Подключение обратно...',
            }
            const label = labels[gs.current.cycleState]
            if (label) {
              ctx.save()
              ctx.font = 'bold 18px -apple-system, sans-serif'
              ctx.textAlign = 'center'
              ctx.fillStyle = 'rgba(255, 200, 50, 0.9)'
              ctx.shadowColor = 'rgba(0,0,0,0.5)'
              ctx.shadowBlur = 6
              ctx.fillText(label, W / 2, H * 0.18)
              ctx.shadowBlur = 0
              ctx.restore()
            }
          }
        }

        animRef.current = requestAnimationFrame(loop)
      }

      animRef.current = requestAnimationFrame(loop)

    } catch (e) {
      console.error('Camera error:', e)
      setPhase('menu')
      alert(e.name === 'NotAllowedError' ? 'Нужен доступ к камере' : `Ошибка: ${e.message}`)
    }
  }, [cleanup, highScore, spawnConfetti, showBonus])

  useEffect(() => {
    if (tg && phase === 'result') {
      const handler = () => { tg.MainButton.hide(); setPhase('menu') }
      tg.MainButton.onClick(handler)
      return () => tg.MainButton.offClick(handler)
    }
  }, [phase])

  return (
    <div className="app">
      {/* Video element — always mounted, always hidden */}
      <video
        ref={videoRef}
        playsInline
        muted
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
      />

      <div className="bg-particles">
        {Array.from({ length: 20 }, (_, i) => (
          <div key={i} className="particle" style={{
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            animationDelay: `${Math.random() * 5}s`,
            animationDuration: `${3 + Math.random() * 4}s`,
          }} />
        ))}
      </div>

      {confetti.map(p => (
        <ConfettiParticle key={p.id} style={{
          left: `${p.left}%`,
          backgroundColor: p.color,
          animationDelay: `${p.delay}s`,
        }} />
      ))}

      {bonusText && <div className="bonus-popup">{bonusText}</div>}

      {/* MENU */}
      {phase === 'menu' && (
        <div className="screen menu-screen">
          <div className="menu-content">
            <div className="logo-container">
              <div className="logo-circle">
                <span className="logo-o">О</span>
              </div>
            </div>
            <h1 className="title">O-face Tycoon</h1>
            <p className="subtitle">Втягивай бензин через букву <strong>О</strong>!</p>

            <div className="rules-card">
              <div className="rule"><span className="rule-icon">📸</span><span>Включи камеру</span></div>
              <div className="rule"><span className="rule-icon">😮</span><span>Сделай букву О ртом</span></div>
              <div className="rule"><span className="rule-icon">💨</span><span>Втяни воздух — щёки вжимаются</span></div>
              <div className="rule"><span className="rule-icon">💪</span><span>Сильный вдох = 2 очка, слабый = 1</span></div>
              <div className="rule"><span className="rule-icon">⛽</span><span>10 очков → перелив в канистру</span></div>
              <div className="rule"><span className="rule-icon">🛢️</span><span>4 перелива → канистра полна!</span></div>
            </div>

            {highScore > 0 && (
              <div className="high-score">🏆 Рекорд: <strong>{highScore}</strong></div>
            )}

            <button className="btn-play" onClick={startGame}>Играть</button>
            <p className="hint">Нужен доступ к камере</p>
          </div>
        </div>
      )}

      {/* CAMERA */}
      {phase === 'camera' && (
        <div className="screen camera-screen">
          <div className="camera-loader">
            <div className="spinner" />
            <p>Подключаю камеру...</p>
          </div>
        </div>
      )}

      {/* PLAYING */}
      {phase === 'playing' && (
        <div className="screen play-screen">
          <div className="hud">
            <div className="hud-left">
              <div className="hud-score">
                <span className="hud-label">МОНЕТЫ</span>
                <span className="hud-value">💰 {score}</span>
              </div>
              {streak >= 3 && <div className="hud-streak">🔥 {streak}</div>}
            </div>
            <div className="hud-center">
              <div className={`hud-timer ${timer <= 5 ? 'urgent' : ''}`}>{timer}</div>
            </div>
            <div className="hud-right">
              <div className="hud-count">
                <span className="hud-label">ВДОХ</span>
                <span className="hud-value">{totalCount}</span>
              </div>
            </div>
          </div>

          {/* Top hint bar */}
          <div className="hint-bar">
            {hoseState === 'mouth'
              ? '😮 ВТЯГИВАЙ БЕНЗИН РТОМ, ЧТОБЫ ЗАПОЛНИТЬ КАНИСТРУ!'
              : hoseState === 'transferring'
                ? '⛽ ПЕРЕЛИВ БЕНЗИНА В КАНИСТРУ...'
                : '↩️ ПОДКЛЮЧЕНИЕ ШЛАНГА...'
            }
          </div>

          <div className="video-container">
            <canvas ref={canvasRef} className="game-canvas" />

            {/* O indicator */}
            <div className={`o-indicator ${isActive ? 'active' : ''}`}>
              <div className="o-ring">
                <svg viewBox="0 0 80 80">
                  <circle cx="40" cy="40" r="36" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="4" />
                  <circle cx="40" cy="40" r="36" fill="none"
                    stroke={isActive ? '#4ade80' : isO ? '#fbbf24' : '#666'}
                    strokeWidth="4"
                    strokeDasharray={`${(cycleFill / 100) * 2 * Math.PI * 36} ${2 * Math.PI * 36}`}
                    strokeLinecap="round"
                    transform="rotate(-90 40 40)"
                    style={{ transition: 'stroke-dasharray 0.15s ease, stroke 0.2s ease' }}
                  />
                </svg>
                <span className="o-letter">О</span>
              </div>
              {isActive && suction >= STRONG_SUCTION_THRESHOLD && <span className="o-label strong">💪 СИЛЬНЫЙ!</span>}
              {isActive && suction < STRONG_SUCTION_THRESHOLD && <span className="o-label">ВДОХ!</span>}
              {isO && !isSucking && <span className="o-label warn">ВТЯНИ ВОЗДУХ!</span>}
            </div>

            {/* Cycle fill bar (per transfer) */}
            <div className="canister-bar">
              <div className="canister-bar-label">⛽ ПЕРЕЛИВ</div>
              <div className="canister-bar-track">
                <div className="canister-bar-fill" style={{ width: `${cycleFill}%` }} />
              </div>
              <div className="canister-bar-pct">{cycleFill}%</div>
            </div>

            {/* Big canister progress (4 cycles) */}
            <div className="big-canister-bar">
              <div className="big-canister-label">🛢️ КАНИСТРА</div>
              <div className="big-canister-dots">
                {Array.from({ length: CANISTER_CYCLES }, (_, i) => (
                  <div key={i} className={`big-canister-dot ${i < canisterCycles ? 'filled' : ''}`} />
                ))}
              </div>
              <div className="big-canister-count">{canisterCycles}/{CANISTER_CYCLES}</div>
            </div>

            {/* Dual meters */}
            <div className="dual-meter">
              <div className="meter">
                <span className="meter-label">О</span>
                <div className="meter-bar">
                  <div className="meter-fill o-fill" style={{ width: `${oShape}%` }} />
                </div>
              </div>
              <div className="meter">
                <span className="meter-label">💨</span>
                <div className="meter-bar">
                  <div className="meter-fill s-fill" style={{ width: `${suction}%` }} />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* RESULT */}
      {phase === 'result' && (
        <div className="screen result-screen">
          <div className="result-content">
            <div className="result-icon">{score >= 100 ? '🏆' : score >= 50 ? '⭐' : '👍'}</div>
            <h2 className="result-title">
              {score >= 100 ? 'Невероятно!' : score >= 50 ? 'Отлично!' : 'Хороший старт!'}
            </h2>
            <div className="result-score">
              <span className="result-score-value">💰 {score}</span>
              <span className="result-score-label">монет</span>
            </div>
            {score > highScore && score > 0 && <div className="new-record">🎉 Новый рекорд!</div>}
            <div className="result-stats">
              <div className="stat"><span className="stat-value">{totalCount}</span><span className="stat-label">вдохов</span></div>
              <div className="stat"><span className="stat-value">{canisterCycles}/{CANISTER_CYCLES}</span><span className="stat-label">переливов</span></div>
              <div className="stat"><span className="stat-value">🏆 {Math.max(score, highScore)}</span><span className="stat-label">рекорд</span></div>
            </div>
            <button className="btn-play" onClick={() => { if (tg) tg.MainButton.hide(); setPhase('menu') }}>
              Играть ещё
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
