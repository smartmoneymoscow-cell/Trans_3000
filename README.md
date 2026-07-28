# О-face Game 🎮

Telegram Mini App — игра, в которой нужно делать букву **О** ртом и зарабатывать очки.

## Как работает

1. Камера отслеживает лицо через **MediaPipe Face Landmarker** (468 точек)
2. AI детектит форму рта через blendshapes: `jawOpen` + `mouthFunnel` + `mouthPucker`
3. Когда рот принимает форму буквы **О** — начисляются очки
4. 15 секунд на раунд, 5+ подряд = двойные очки

## Стек

| Технология | Зачем |
|---|---|
| React 19 + Vite | Фронтенд |
| MediaPipe Tasks Vision | Face mesh + blendshapes |
| Telegram WebApp SDK | Интеграция с Telegram |

## Запуск

```bash
npm install
npm run dev
```

Для теста в Telegram нужен HTTPS. Используй `ngrok` или задеплой на хостинг.

## Деплой как Telegram Mini App

1. Задеплой на любой хостинг (Vercel, Netlify, Cloudflare Pages)
2. Открой [@BotFather](https://t.me/BotFather) → `/newapp`
3. Укажи URL деплоя
4. Готово!

## Структура

```
o-shape-game/
├── index.html
├── package.json
├── vite.config.js
├── public/
└── src/
    ├── main.jsx
    ├── App.jsx          # Игровая логика + UI
    ├── index.css         # Стили
    └── utils/
        └── mediapipe.js  # Face Landmarker + детекция О
```

## Механика детекции

Нужно **одновременно** выполнить два условия:

### 1. Форма О (O-shape)
- `jawOpen` > 0.12 — рот открыт
- `mouthFunnel` > 0.10 или `mouthPucker` > 0.12 — губы округлены
- `mouthSmile` < 0.4 — не улыбка

### 2. Вдох через О (Suction)
- `mouthSuckLeft` / `mouthSuckRight` > 0.08 — щёки втягиваются
- `cheekPuff` < 0.3 — не надувание

### Начисление
- Удержание обоих условий ≥ 800мс = **+10 очков**
- Серия 5+ подряд = **x2 множитель**

## Лицензия

MIT
