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
const HOLD_THRESHOLD = 600
const CYCLE_CAPACITY = 10
const STRONG_SUCTION_THRESHOLD = 50
const STRONG_INHALE_VALUE = 2
const WEAK_INHALE_VALUE = 1
const CANISTER_CYCLES = 4
const TRANSFER_DURATION = 3000
const DISCONNECT_DURATION = 1500
const RECONNECT_DURATION = 1500

// ── Camera diagnostics ──
function getCameraDiagnostics() {
  const ua = navigator.userAgent || ''
  const isIOS = /iPhone|iPad|iPod/.test(ua)
  const isAndroid = /Android/.test(ua)
  const isTelegram = /Telegram/i.test(ua) || !!window.Telegram?.WebApp
  const isSecure = location.protocol === 'https:' || location.hostname === 'localhost'
  const hasMediaDevices = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
  const isWKWebView = isIOS && !/Safari/.test(ua) && /AppleWebKit/.test(ua)

  return { isIOS, isAndroid, isTelegram, isSecure, hasMediaDevices, isWKWebView }
}

// ── Robust camera acquisition ──
async function acquireCamera() {
  const diag = getCameraDiagnostics()

  // 1. Check secure context
  if (!diag.isSecure) {
    throw new Error('CAMERA_REQUIRES_HTTPS')
  }

  // 2. Check API availability
  if (!diag.hasMediaDevices) {
    if (diag.isIOS) {
      throw new Error('CAMERA_IOS_NOT_SUPPORTED')
    }
    throw new Error('CAMERA_API_UNAVAILABLE')
  }

  // 3. Try constraints in order of preference
  const constraintSets = [
    // Best: front camera, ideal resolution
    {
      video: {
        facingMode: 'user',
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
      audio: false,
    },
    // Fallback 1: front camera, no resolution preference
    {
      video: { facingMode: 'user' },
      audio: false,
    },
    // Fallback 2: any camera
    {
      video: true,
      audio: false,
    },
    // Fallback 3: minimal constraints (some old WebViews need this)
    {
      video: {},
      audio: false,
    },
  ]

  let lastError = null

  for (const constraints of constraintSets) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      // Verify we got a video track
      const videoTracks = stream.getVideoTracks()
      if (videoTracks.length === 0) {
        stream.getTracks().forEach(t => t.stop())
        throw new Error('NO_VIDEO_TRACK')
      }
      return stream
    } catch (err) {
      lastError = err
      // If user denied, don't try other constraints
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        throw new Error('CAMERA_DENIED')
      }
      // If NotFound, no camera at all
      if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        throw new Error('CAMERA_NOT_FOUND')
      }
      // Otherwise try next constraint set
      continue
    }
  }

  // All constraint sets failed
  if (lastError) {
    if (lastError.name === 'NotReadableError' || lastError.name === 'TrackStartError') {
      throw new Error('CAMERA_IN_USE')
    }
    throw new Error(`CAMERA_FAILED: ${lastError.message || lastError.name}`)
  }
  throw new Error('CAMERA_FAILED')
}

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
  const [cycleFill, setCycleFill] = useState(0)
  const [canisterCycles, setCanisterCycles] = useState(0)
  const [hoseState, setHoseState] = useState('mouth')
  const [bonusText, setBonusText] = useState(null)
  const [confetti, setConfetti] = useState([])
  const [cameraError, setCameraError] = useState(null)
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

  // ── Human-readable error messages ──
  const getErrorUI = useCallback((errorType) => {
    const diag = getCameraDiagnostics()

    const errors = {
      CAMERA_REQUIRES_HTTPS: {
        icon: '🔒',
        title: 'Нужен HTTPS',
        text: 'Камера работает только по защищённому соединению. Откройте приложение по https:// ссылке.',
        canRetry: false,
      },
      CAMERA_API_UNAVAILABLE: {
        icon: '📱',
        title: 'Камера не поддерживается',
        text: diag.isIOS
          ? 'На iPhone камера не работает внутри Telegram. Откройте игру в Safari.'
          : 'Обновите Telegram или попробуйте открыть в браузере Chrome/Safari.',
        canRetry: false,
        openExternal: diag.isIOS,
      },
      CAMERA_IOS_NOT_SUPPORTED: {
        icon: '📱',
        title: 'Камера не поддерживается',
        text: 'На iPhone камера не работает внутри Telegram. Откройте игру в Safari.',
        canRetry: false,
        openExternal: true,
      },
      CAMERA_DENIED: {
        icon: '🚫',
        title: 'Доступ к камере запрещён',
        text: 'Разрешите доступ к камере в настройках браузера или Telegram и попробуйте снова.',
        canRetry: true,
      },
      CAMERA_NOT_FOUND: {
        icon: '📷',
        title: 'Камера не найдена',
        text: 'На этом устройстве нет камеры, или она занята другим приложением.',
        canRetry: true,
      },
      CAMERA_IN_USE: {
        icon: '📷',
        title: 'Камера занята',
        text: 'Камера используется другим приложением. Закройте его и попробуйте снова.',
        canRetry: true,
      },
    }

    // Match known errors or use generic
    for (const [key, val] of Object.entries(errors)) {
      if (errorType === key) return val
    }

    return {
      icon: '⚠️',
      title: 'Ошибка камеры',
      text: `Не удалось подключить камеру. Попробуйте обновить Telegram или открыть в браузере.\n\n${errorType}`,
      canRetry: true,
      openExternal: diag.isIOS,
    }
  }, [])

  const startGame = useCallback(async () => {
    setCameraError(null)

    try {
      // Preload SVG assets
      await preloadImages()

      // Load MediaPipe model
      const landmarker = await getFaceLandmarker()
      landmarkerRef.current = landmarker

      // Acquire camera with fallback chain
      const stream = await acquireCamera()
      streamRef.current = stream

      // Set phase FIRST so <video> mounts in DOM
      setPhase('camera')

      // Wait for React to flush and mount the <video> element
      await new Promise(r => setTimeout(r, 150))

      const video = videoRef.current
      if (!video) {
        throw new Error('VIDEO_ELEMENT_NOT_MOUNTED')
      }

      // Attach stream to video element
      video.srcObject = stream
      video.muted = true
      video.playsInline = true
      video.setAttribute('playsinline', '')
      video.setAttribute('webkit-playsinline', '')

      // Wait for video to be ready
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('VIDEO_PLAY_TIMEOUT')), 10000)
        video.onloadedmetadata = () => {
          video.play()
            .then(() => { clearTimeout(timeout); resolve() })
            .catch(reject)
        }
        // If metadata already loaded (cached)
        if (video.readyState >= 1) {
          video.play()
            .then(() => { clearTimeout(timeout); resolve() })
            .catch(reject)
        }
      })

      // Small delay for camera warm-up
      await new Promise(r => setTimeout(r, 600))

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
      if (!canvas) {
        console.error('Canvas not mounted after phase change')
        cleanup()
        setCameraError('CANVAS_NOT_MOUNTED')
        setPhase('camera_error')
        return
      }
      const ctx = canvas.getContext('2d')

      const loop = () => {
        if (!canvasRef.current) {
          animRef.current = requestAnimationFrame(loop)
          return
        }
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

          // Draw static scene elements
          const carCap = drawCar(ctx, W, H, time)
          targetsRef.current.car = carCap

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

            gs.current.suctionSmoothed = gs.current.suctionSmoothed * 0.7 + detection.suction * 0.3

            const g = gs.current

            if (g.cycleState === 'sucking') {
              if (landmarks) {
                const mirrored = landmarks.map(l => ({ x: 1 - l.x, y: l.y, z: l.z }))
                drawAnimatedHose(ctx, mirrored, time, 'mouth', detection.suction, targetsRef.current)
                drawFaceMesh(ctx, mirrored, time)
                drawSuctionEffect(ctx, mirrored, time, detection.suction)
              }

              if (detection.active) {
                if (time - g.lastSuckSoundTime > 150) {
                  playSuckSound(g.suctionSmoothed)
                  g.lastSuckSoundTime = time
                }

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

                  const isStrong = g.suctionSmoothed >= STRONG_SUCTION_THRESHOLD
                  const fillValue = isStrong ? STRONG_INHALE_VALUE : WEAK_INHALE_VALUE
                  g.cycleLevel = Math.min(CYCLE_CAPACITY, g.cycleLevel + fillValue)
                  setCycleFill(Math.round((g.cycleLevel / CYCLE_CAPACITY) * 100))
                  if (isStrong) showBonus('💪 СИЛЬНЫЙ ВДОХ!')
                }
              } else {
                if (g.holding) { g.holding = false; g.streak = 0; setStreak(0) }
              }

              if (g.cycleLevel >= CYCLE_CAPACITY) {
                g.cycleState = 'disconnecting'
                g.cycleStartTime = time
                setHoseState('disconnecting')
                playDisconnectSound()
                if (tg) tg.HapticFeedback.impactOccurred('heavy')
                showBonus('⛽ ПЕРЕЛИВ!')
              }

            } else if (g.cycleState === 'disconnecting') {
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
              drawAnimatedHose(ctx, landmarks ? landmarks.map(l => ({ x: 1 - l.x, y: l.y, z: l.z })) : [], time, 'transferring', 80, targetsRef.current)
              if (landmarks) {
                const mirrored = landmarks.map(l => ({ x: 1 - l.x, y: l.y, z: l.z }))
                drawFaceMesh(ctx, mirrored, time)
              }
              const transferProgress = (time - g.cycleStartTime) / TRANSFER_DURATION
              if (transferProgress >= 1) {
                g.canisterCycles++
                g.cycleLevel = 0
                setCanisterCycles(g.canisterCycles)
                setCycleFill(0)

                if (g.canisterCycles >= CANISTER_CYCLES) {
                  showBonus('🏆 КАНИСТРА ПОЛНА! ПОБЕДА!')
                  playCanisterFullSound()
                  if (tg) tg.HapticFeedback.notificationOccurred('success')
                  g.score += 100
                  setScore(g.score)
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

          // Cycle state label
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
      console.error('Camera/startup error:', e)
      cleanup()
      const errorType = e.message || e.name || 'UNKNOWN'
      setCameraError(errorType)
      setPhase('camera_error')
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

      {/* CAMERA LOADING */}
      {phase === 'camera' && (
        <div className="screen camera-screen">
          <div className="camera-loader">
            <div className="spinner" />
            <p>Подключаю камеру...</p>
          </div>
        </div>
      )}

      {/* CAMERA ERROR */}
      {phase === 'camera_error' && (
        <div className="screen camera-error-screen">
          <div className="camera-error-content">
            {(() => {
              const err = getErrorUI(cameraError)
              return (
                <>
                  <div className="error-icon">{err.icon}</div>
                  <h2 className="error-title">{err.title}</h2>
                  <p className="error-text">{err.text}</p>
                  <div className="error-actions">
                    {err.canRetry && (
                      <button className="btn-play" onClick={startGame}>Попробовать снова</button>
                    )}
                    {err.openExternal && (
                      <button className="btn-play" onClick={() => {
                        if (tg) tg.openLink(window.location.href)
                        else window.open(window.location.href, '_blank')
                      }}>
                        Открыть в Safari
                      </button>
                    )}
                    <button className="btn-secondary" onClick={() => { setCameraError(null); setPhase('menu') }}>
                      Назад
                    </button>
                  </div>
                </>
              )
            })()}
          </div>
        </div>
      )}

      {/* PLAYING */}
      {phase === 'playing' && (
        <div className="screen playing-screen">
          <div className="hud-top">
            <div className="hud-left">
              <div className="score-display">💰 {score}</div>
              <div className="streak-display">🔥 {streak > 0 ? `x${streak}` : '—'}</div>
            </div>
            <div className="hud-timer">{timer}</div>
          </div>

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

            {/* Cycle fill bar */}
            <div className="canister-bar">
              <div className="canister-bar-label">⛽ ПЕРЕЛИВ</div>
              <div className="canister-bar-track">
                <div className="canister-bar-fill" style={{ width: `${cycleFill}%` }} />
              </div>
              <div className="canister-bar-pct">{cycleFill}%</div>
            </div>

            {/* Big canister progress */}
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
