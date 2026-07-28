import React, { useState, useRef, useEffect, useCallback } from 'react'
import { getFaceLandmarker, resetFaceLandmarker, drawFaceMesh, detectOMouth } from './utils/mediapipe'

// Telegram WebApp SDK
const tg = window.Telegram?.WebApp

// Game config
const ROUND_DURATION = 15 // seconds per round
const HOLD_THRESHOLD = 800 // ms to hold O to score a point
const COOLDOWN = 600 // ms between scoring
const POINTS_PER_O = 10
const BONUS_THRESHOLD = 5 // consecutive O's for bonus
const BONUS_MULTIPLIER = 2

// Sound effects (Web Audio API)
function playSound(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)

    if (type === 'score') {
      osc.frequency.setValueAtTime(880, ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.1)
      gain.gain.setValueAtTime(0.15, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2)
      osc.start()
      osc.stop(ctx.currentTime + 0.2)
    } else if (type === 'bonus') {
      osc.frequency.setValueAtTime(660, ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.3)
      gain.gain.setValueAtTime(0.2, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4)
      osc.start()
      osc.stop(ctx.currentTime + 0.4)
    } else if (type === 'end') {
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(440, ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.5)
      gain.gain.setValueAtTime(0.15, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5)
      osc.start()
      osc.stop(ctx.currentTime + 0.5)
    }
  } catch (e) { /* silent */ }
}

// Confetti particle
function ConfettiParticle({ style }) {
  return <div className="confetti" style={style} />
}

export default function App() {
  const [phase, setPhase] = useState('menu') // menu | camera | playing | result
  const [score, setScore] = useState(0)
  const [timer, setTimer] = useState(ROUND_DURATION)
  const [streak, setStreak] = useState(0)
  const [maxStreak, setMaxStreak] = useState(0)
  const [totalOCount, setTotalOCount] = useState(0)
  const [isO, setIsO] = useState(false)
  const [confidence, setConfidence] = useState(0)
  const [holdProgress, setHoldProgress] = useState(0)
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
  const stateRef = useRef({
    oStartTime: 0,
    lastScoreTime: 0,
    holding: false,
    streak: 0,
    score: 0,
    totalO: 0,
  })

  // Init Telegram
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
      const landmarker = await getFaceLandmarker()
      landmarkerRef.current = landmarker

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      })
      streamRef.current = stream

      const video = videoRef.current
      if (!video) return
      video.srcObject = stream
      video.setAttribute('playsinline', '')
      video.style.display = 'none'
      await video.play()

      setPhase('camera')
      await new Promise(r => setTimeout(r, 800))

      // Reset state
      setScore(0)
      setTimer(ROUND_DURATION)
      setStreak(0)
      setMaxStreak(0)
      setTotalOCount(0)
      setIsO(false)
      setConfidence(0)
      setHoldProgress(0)
      stateRef.current = {
        oStartTime: 0,
        lastScoreTime: 0,
        holding: false,
        streak: 0,
        score: 0,
        totalO: 0,
      }

      setPhase('playing')

      // Timer countdown
      const timerStart = Date.now()
      const timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - timerStart) / 1000)
        const remaining = ROUND_DURATION - elapsed
        setTimer(remaining)
        if (remaining <= 0) {
          clearInterval(timerInterval)
          setPhase('result')
          playSound('end')
          cleanup()
          // Save high score
          const finalScore = stateRef.current.score
          if (finalScore > highScore) {
            setHighScore(finalScore)
            try { localStorage.setItem('o-face-highscore', String(finalScore)) } catch {}
          }
          // Send to Telegram
          if (tg) {
            tg.HapticFeedback.notificationOccurred('success')
            tg.MainButton.setParams({ text: `Сыграть ещё (${finalScore} очков)`, is_visible: true })
          }
        }
      }, 500)

      // Detection loop
      const canvas = canvasRef.current
      const ctx = canvas.getContext('2d')

      const loop = () => {
        const time = Date.now()

        if (video.readyState >= 2) {
          const vw = video.videoWidth || 640
          const vh = video.videoHeight || 480
          if (canvas.width !== vw) canvas.width = vw
          if (canvas.height !== vh) canvas.height = vh

          // Mirror video
          ctx.save()
          ctx.translate(canvas.width, 0)
          ctx.scale(-1, 1)
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          ctx.restore()

          try {
            const result = landmarker.detectForVideo(video, time)
            const landmarks = result?.faceLandmarks?.[0]
            const blendshapes = result?.faceBlendshapes?.[0]?.categories

            if (landmarks) {
              // Mirror landmarks for display
              const mirrored = landmarks.map(l => ({ x: 1 - l.x, y: l.y, z: l.z }))
              drawFaceMesh(ctx, mirrored, time)
            }

            if (blendshapes) {
              const detection = detectOMouth(blendshapes)
              setIsO(detection.isO)
              setConfidence(detection.confidence)

              if (detection.isO) {
                if (!stateRef.current.holding) {
                  stateRef.current.holding = true
                  stateRef.current.oStartTime = time
                }

                const holdTime = time - stateRef.current.oStartTime
                const progress = Math.min(100, (holdTime / HOLD_THRESHOLD) * 100)
                setHoldProgress(progress)

                if (holdTime >= HOLD_THRESHOLD && time - stateRef.current.lastScoreTime > COOLDOWN) {
                  // Score!
                  stateRef.current.lastScoreTime = time
                  stateRef.current.totalO++
                  stateRef.current.streak++
                  const streak = stateRef.current.streak
                  let points = POINTS_PER_O

                  if (streak >= BONUS_THRESHOLD) {
                    points *= BONUS_MULTIPLIER
                    showBonus(`🔥 x${BONUS_MULTIPLIER} БОНУС!`)
                    playSound('bonus')
                    if (tg) tg.HapticFeedback.impactOccurred('heavy')
                  } else {
                    playSound('score')
                    if (tg) tg.HapticFeedback.impactOccurred('light')
                  }

                  stateRef.current.score += points
                  setScore(stateRef.current.score)
                  setStreak(streak)
                  setTotalOCount(stateRef.current.totalO)
                  if (streak > stateRef.current.maxStreak) {
                    stateRef.current.maxStreak = streak
                    setMaxStreak(streak)
                  }

                  // Reset hold for next detection
                  stateRef.current.oStartTime = time + COOLDOWN
                  spawnConfetti()
                }
              } else {
                if (stateRef.current.holding) {
                  stateRef.current.holding = false
                  stateRef.current.streak = 0
                  setStreak(0)
                }
                setHoldProgress(0)
              }
            }
          } catch (e) { /* skip frame */ }
        }

        animRef.current = requestAnimationFrame(loop)
      }

      animRef.current = requestAnimationFrame(loop)

    } catch (e) {
      console.error('Camera error:', e)
      setPhase('menu')
      alert(e.name === 'NotAllowedError'
        ? 'Нужен доступ к камере для игры'
        : `Ошибка: ${e.message}`)
    }
  }, [cleanup, highScore, spawnConfetti, showBonus])

  // Telegram MainButton handler
  useEffect(() => {
    if (tg && phase === 'result') {
      const handler = () => {
        tg.MainButton.hide()
        setPhase('menu')
      }
      tg.MainButton.onClick(handler)
      return () => tg.MainButton.offClick(handler)
    }
  }, [phase])

  return (
    <div className="app">
      {/* Background particles */}
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

      {/* Confetti */}
      {confetti.map(p => (
        <ConfettiParticle key={p.id} style={{
          left: `${p.left}%`,
          backgroundColor: p.color,
          animationDelay: `${p.delay}s`,
        }} />
      ))}

      {/* Bonus text */}
      {bonusText && (
        <div className="bonus-popup">{bonusText}</div>
      )}

      {/* MENU */}
      {phase === 'menu' && (
        <div className="screen menu-screen">
          <div className="menu-content">
            <div className="logo-container">
              <div className="logo-circle">
                <span className="logo-o">О</span>
              </div>
            </div>
            <h1 className="title">О-face</h1>
            <p className="subtitle">Сделай букву <strong>О</strong> ртом и получи очки!</p>

            <div className="rules-card">
              <div className="rule">
                <span className="rule-icon">📸</span>
                <span>Включи камеру</span>
              </div>
              <div className="rule">
                <span className="rule-icon">😮</span>
                <span>Сделай букву О губами</span>
              </div>
              <div className="rule">
                <span className="rule-icon">⏱</span>
                <span>15 секунд на раунд</span>
              </div>
              <div className="rule">
                <span className="rule-icon">🔥</span>
                <span>5+ подряд = двойные очки!</span>
              </div>
            </div>

            {highScore > 0 && (
              <div className="high-score">
                🏆 Рекорд: <strong>{highScore}</strong>
              </div>
            )}

            <button className="btn-play" onClick={startGame}>
              Играть
            </button>

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

      {/* PLAYING */}
      {phase === 'playing' && (
        <div className="screen play-screen">
          {/* HUD */}
          <div className="hud">
            <div className="hud-left">
              <div className="hud-score">
                <span className="hud-label">ОЧКИ</span>
                <span className="hud-value">{score}</span>
              </div>
              {streak >= 3 && (
                <div className="hud-streak">
                  🔥 {streak}
                </div>
              )}
            </div>
            <div className="hud-center">
              <div className={`hud-timer ${timer <= 5 ? 'urgent' : ''}`}>
                {timer}
              </div>
            </div>
            <div className="hud-right">
              <div className="hud-count">
                <span className="hud-label">О</span>
                <span className="hud-value">{totalOCount}</span>
              </div>
            </div>
          </div>

          {/* Video */}
          <div className="video-container">
            <video ref={videoRef} playsInline muted style={{ display: 'none' }} />
            <canvas ref={canvasRef} className="game-canvas" />

            {/* O indicator */}
            <div className={`o-indicator ${isO ? 'active' : ''}`}>
              <div className="o-ring">
                <svg viewBox="0 0 80 80">
                  <circle cx="40" cy="40" r="36" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="4" />
                  <circle cx="40" cy="40" r="36" fill="none"
                    stroke={isO ? '#4ade80' : '#666'}
                    strokeWidth="4"
                    strokeDasharray={`${(holdProgress / 100) * 2 * Math.PI * 36} ${2 * Math.PI * 36}`}
                    strokeLinecap="round"
                    transform="rotate(-90 40 40)"
                    style={{ transition: 'stroke-dasharray 0.1s ease, stroke 0.2s ease' }}
                  />
                </svg>
                <span className="o-letter">О</span>
              </div>
              {isO && <span className="o-label">ДЕРЖИ!</span>}
            </div>

            {/* Confidence bar */}
            <div className="confidence-bar">
              <div className="confidence-fill" style={{
                width: `${confidence}%`,
                backgroundColor: confidence > 60 ? '#4ade80' : confidence > 30 ? '#fbbf24' : '#666',
              }} />
            </div>
          </div>
        </div>
      )}

      {/* RESULT */}
      {phase === 'result' && (
        <div className="screen result-screen">
          <div className="result-content">
            <div className="result-icon">
              {score >= 100 ? '🏆' : score >= 50 ? '⭐' : '👍'}
            </div>
            <h2 className="result-title">
              {score >= 100 ? 'Невероятно!' : score >= 50 ? 'Отлично!' : 'Хороший старт!'}
            </h2>

            <div className="result-score">
              <span className="result-score-value">{score}</span>
              <span className="result-score-label">очков</span>
            </div>

            {score > highScore && score > 0 && (
              <div className="new-record">🎉 Новый рекорд!</div>
            )}

            <div className="result-stats">
              <div className="stat">
                <span className="stat-value">{totalOCount}</span>
                <span className="stat-label">букв О</span>
              </div>
              <div className="stat">
                <span className="stat-value">{maxStreak}</span>
                <span className="stat-label">макс. серия</span>
              </div>
              <div className="stat">
                <span className="stat-value">🏆 {Math.max(score, highScore)}</span>
                <span className="stat-label">рекорд</span>
              </div>
            </div>

            <button className="btn-play" onClick={() => {
              if (tg) tg.MainButton.hide()
              setPhase('menu')
            }}>
              Играть ещё
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
