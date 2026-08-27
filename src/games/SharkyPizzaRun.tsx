import { useCallback, useEffect, useRef, useState } from "react";
import {
  Clock,
  Pause,
  Pizza,
  Play,
  RotateCcw,
  Trophy,
  Volume2,
  VolumeX,
} from "lucide-react";
import scooterImg from "@/assets/sharky-scooter.png";
import pizzaImg from "@/assets/pizza-box.png";

type Kind =
  | "pizza"
  | "customer"
  | "cone"
  | "puddle"
  | "trash"
  | "car"
  | "barrier"
  | "rival"
  | "roadblock"
  | "turbo"
  | "shield";

type Entity = {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: Kind;
  alive: boolean;
  phase: number;
  color?: string;
  vx?: number;
};

type Pedestrian = {
  x: number;
  phase: number;
  speed: number;
  shirt: string;
  skin: string;
  scale: number;
  wave: number;
};

type TrafficCar = {
  x: number;
  lane: 0 | 1;
  dir: 1 | -1;
  speed: number;
  color: string;
  type: "sedan" | "van" | "mini";
};

type FloatText = {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
};

type Runtime = {
  sharkX: number;
  sharkY: number;
  vy: number;
  onGround: boolean;
  jumpHeld: boolean;
  jumpHold: number;
  speed: number;
  distance: number;
  score: number;
  pizzas: number;
  delivered: number;
  combo: number;
  timeLeft: number;
  level: number;
  lives: number;
  invuln: number;
  shield: number;
  turbo: number;
  started: boolean;
  paused: boolean;
  over: boolean;
  win: boolean;
  spawnTimer: number;
  customerTimer: number;
  rivalTimer: number;
  roadblockTimer: number;
  entities: Entity[];
  pedestrians: Pedestrian[];
  traffic: TrafficCar[];
  floatTexts: FloatText[];
  lastVitoLevel: number;
  shake: number;
};

const GROUND = 0.79;
const GRAVITY = 2200;
const JUMP_VY = -790;
const MAX_PIZZAS = 5;
const ROUND_DURATION = 100;
const LEVEL_THRESHOLD = 3;
const WIN_LEVEL = 10;
const HIGH_SCORE_KEY = "sharky-pizza-run-high-score";
const LEVEL_NAMES = [
  "Apprenti",
  "Coursier",
  "Vétéran",
  "Pro",
  "Champion",
  "Légende",
  "Mythique",
  "Élite",
  "Maître",
  "Champion ultime",
];
const SPEED_STEPS = [515, 560, 620, 690, 760, 835, 905, 975, 1035, 1100];
const SPAWN_FLOORS = [0.97, 0.84, 0.7, 0.6, 0.51, 0.44, 0.37, 0.32, 0.27, 0.23];
const COLORS = ["#ef4444", "#3b82f6", "#f59e0b", "#10b981", "#8b5cf6", "#ec4899"];

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const levelFromDeliveries = (delivered: number) => Math.min(WIN_LEVEL, 1 + Math.floor(delivered / LEVEL_THRESHOLD));
const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function createRuntime(): Runtime {
  return {
    sharkX: 120,
    sharkY: 0,
    vy: 0,
    onGround: true,
    jumpHeld: false,
    jumpHold: 0,
    speed: SPEED_STEPS[0],
    distance: 0,
    score: 0,
    pizzas: 0,
    delivered: 0,
    combo: 0,
    timeLeft: ROUND_DURATION,
    level: 1,
    lives: 3,
    invuln: 0,
    shield: 0,
    turbo: 0,
    started: false,
    paused: false,
    over: false,
    win: false,
    spawnTimer: 0.7,
    customerTimer: 3.4,
    rivalTimer: 7,
    roadblockTimer: 8,
    entities: [],
    pedestrians: [],
    traffic: [],
    floatTexts: [],
    lastVitoLevel: 0,
    shake: 0,
  };
}

function useArcadeAudio() {
  const ctxRef = useRef<AudioContext | null>(null);
  const mutedRef = useRef(false);

  const ctx = useCallback(() => {
    if (mutedRef.current) return null;
    if (!ctxRef.current) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return null;
      ctxRef.current = new AudioCtx();
    }
    if (ctxRef.current.state === "suspended") ctxRef.current.resume().catch(() => {});
    return ctxRef.current;
  }, []);

  const tone = useCallback((from: number, to: number, duration: number, volume = 0.12, type: OscillatorType = "triangle") => {
    const c = ctx();
    if (!c) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(from, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, to), c.currentTime + duration);
    g.gain.setValueAtTime(volume, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
    o.connect(g).connect(c.destination);
    o.start();
    o.stop(c.currentTime + duration + 0.02);
  }, [ctx]);

  const jump = useCallback(() => tone(350, 760, 0.13, 0.13), [tone]);
  const pickup = useCallback(() => {
    tone(650, 920, 0.11, 0.12);
    window.setTimeout(() => tone(920, 1240, 0.1, 0.09), 55);
  }, [tone]);
  const deliver = useCallback(() => {
    tone(520, 820, 0.16, 0.14);
    window.setTimeout(() => tone(780, 1180, 0.18, 0.12), 80);
  }, [tone]);
  const crash = useCallback(() => tone(180, 55, 0.35, 0.18, "sawtooth"), [tone]);
  const siren = useCallback(() => {
    tone(620, 850, 0.18, 0.07, "square");
    window.setTimeout(() => tone(850, 620, 0.18, 0.06, "square"), 180);
  }, [tone]);
  const power = useCallback(() => tone(420, 1250, 0.28, 0.13), [tone]);

  return {
    jump,
    pickup,
    deliver,
    crash,
    siren,
    power,
    setMuted(v: boolean) { mutedRef.current = v; },
  };
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawCar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, police = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "rgba(0,0,0,.18)";
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h * 0.92, w * 0.48, h * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = police ? "#172554" : color;
  roundedRect(ctx, 0, h * 0.28, w, h * 0.52, 12);
  ctx.fill();
  ctx.fillStyle = police ? "#f8fafc" : "rgba(255,255,255,.24)";
  roundedRect(ctx, w * 0.13, h * 0.05, w * 0.57, h * 0.4, 9);
  ctx.fill();
  ctx.fillStyle = "#bae6fd";
  roundedRect(ctx, w * 0.2, h * 0.1, w * 0.2, h * 0.24, 5);
  ctx.fill();
  roundedRect(ctx, w * 0.44, h * 0.1, w * 0.2, h * 0.24, 5);
  ctx.fill();
  if (police) {
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(w * 0.06, h * 0.5, w * 0.88, h * 0.12);
    ctx.fillStyle = "#1d4ed8";
    ctx.font = `700 ${Math.max(7, w * 0.085)}px system-ui`;
    ctx.fillText("POLICE", w * 0.33, h * 0.6);
    ctx.fillStyle = "#2563eb";
    ctx.fillRect(w * 0.43, 0, w * 0.1, h * 0.08);
    ctx.fillStyle = "#ef4444";
    ctx.fillRect(w * 0.53, 0, w * 0.1, h * 0.08);
  }
  ctx.fillStyle = "#111827";
  for (const wx of [w * 0.22, w * 0.77]) {
    ctx.beginPath(); ctx.arc(wx, h * 0.78, h * 0.17, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#94a3b8";
    ctx.beginPath(); ctx.arc(wx, h * 0.78, h * 0.075, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#111827";
  }
  ctx.restore();
}

function drawPed(ctx: CanvasRenderingContext2D, p: Pedestrian, groundY: number) {
  const s = p.scale;
  const y = groundY - 78 * s;
  const leg = Math.sin(p.phase) * 7 * s;
  ctx.save();
  ctx.translate(p.x, y);
  ctx.lineCap = "round";
  ctx.strokeStyle = "#334155";
  ctx.lineWidth = 5 * s;
  ctx.beginPath();
  ctx.moveTo(0, 50 * s); ctx.lineTo(-7 * s + leg, 72 * s);
  ctx.moveTo(0, 50 * s); ctx.lineTo(7 * s - leg, 72 * s);
  ctx.stroke();
  ctx.fillStyle = p.shirt;
  roundedRect(ctx, -13 * s, 24 * s, 26 * s, 34 * s, 7 * s);
  ctx.fill();
  ctx.strokeStyle = p.skin;
  ctx.lineWidth = 4 * s;
  ctx.beginPath();
  ctx.moveTo(-10 * s, 31 * s); ctx.lineTo((-21 - (p.wave > 0 ? 8 : 0)) * s, (43 - (p.wave > 0 ? 18 : 0)) * s);
  ctx.moveTo(10 * s, 31 * s); ctx.lineTo(20 * s, 43 * s);
  ctx.stroke();
  ctx.fillStyle = p.skin;
  ctx.beginPath(); ctx.arc(0, 14 * s, 11 * s, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#3f3f46";
  ctx.beginPath(); ctx.arc(-1 * s, 9 * s, 11 * s, Math.PI, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawCity(ctx: CanvasRenderingContext2D, W: number, H: number, distance: number, level: number) {
  const groundY = H * GROUND;
  const sky = ctx.createLinearGradient(0, 0, 0, groundY);
  if (level >= 8) {
    sky.addColorStop(0, "#172554");
    sky.addColorStop(0.55, "#7c3aed");
    sky.addColorStop(1, "#fb7185");
  } else {
    sky.addColorStop(0, "#60a5fa");
    sky.addColorStop(0.55, "#f9a8d4");
    sky.addColorStop(1, "#fdba74");
  }
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, groundY);

  const sunX = W * 0.78;
  const sunY = H * 0.16;
  ctx.fillStyle = level >= 8 ? "rgba(255,255,230,.55)" : "rgba(255,244,190,.88)";
  ctx.beginPath(); ctx.arc(sunX, sunY, Math.max(24, H * 0.065), 0, Math.PI * 2); ctx.fill();

  const backOffset = -((distance * 0.12) % 170);
  const buildingColors = ["#f472b6", "#f59e0b", "#38bdf8", "#34d399", "#a78bfa", "#fb7185"];
  for (let i = -1; i < Math.ceil(W / 170) + 2; i++) {
    const x = backOffset + i * 170;
    const seed = Math.abs((i * 37 + Math.floor(distance / 170)) % 7);
    const bw = 118 + (seed % 3) * 18;
    const bh = H * (0.2 + (seed % 4) * 0.035);
    const by = groundY - bh - H * 0.085;
    ctx.fillStyle = buildingColors[seed % buildingColors.length];
    ctx.globalAlpha = 0.75;
    roundedRect(ctx, x, by, bw, bh, 5);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = level >= 8 ? "#fde68a" : "#e0f2fe";
    for (let wy = by + 20; wy < by + bh - 15; wy += 30) {
      for (let wx = x + 15; wx < x + bw - 12; wx += 28) {
        ctx.fillRect(wx, wy, 12, 14);
      }
    }
  }

  ctx.fillStyle = "#e5e7eb";
  ctx.fillRect(0, groundY - H * 0.085, W, H * 0.085);
  ctx.fillStyle = "#9ca3af";
  ctx.fillRect(0, groundY - 6, W, 6);
  ctx.fillStyle = "#374151";
  ctx.fillRect(0, groundY, W, H - groundY);
  ctx.fillStyle = "#facc15";
  const stripeOffset = -((distance * 0.9) % 120);
  for (let x = stripeOffset; x < W + 120; x += 120) ctx.fillRect(x, groundY + (H - groundY) * 0.62, 64, 5);
}

export default function SharkyPizzaRun() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runtimeRef = useRef<Runtime>(createRuntime());
  const audio = useArcadeAudio();
  const [hud, setHud] = useState(() => ({ score: 0, pizzas: 0, delivered: 0, time: ROUND_DURATION, level: 1, lives: 3, combo: 0, shield: 0, turbo: 0 }));
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [ended, setEnded] = useState<"none" | "lose" | "win">("none");
  const [muted, setMuted] = useState(false);
  const [highScore, setHighScore] = useState(() => {
    try { return Number(localStorage.getItem(HIGH_SCORE_KEY) || 0) || 0; } catch { return 0; }
  });
  const [vito, setVito] = useState<string | null>("Sharky ! Les commandes arrivent. Récupère les pizzas et livre-les sans traîner !");
  const images = useRef<{ scooter: HTMLImageElement | null; pizza: HTMLImageElement | null }>({ scooter: null, pizza: null });
  const lastHud = useRef(0);

  useEffect(() => {
    const s = new Image(); s.src = scooterImg;
    const p = new Image(); p.src = pizzaImg;
    images.current = { scooter: s, pizza: p };
  }, []);

  useEffect(() => { audio.setMuted(muted); }, [audio, muted]);

  const speakVito = useCallback((text: string) => {
    setVito(text);
    if (muted) return;
    try {
      if (!("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "fr-FR";
      utterance.rate = 1.03;
      utterance.pitch = 0.88;
      const voices = window.speechSynthesis.getVoices();
      const fr = voices.find(v => v.lang.toLowerCase().startsWith("fr"));
      if (fr) utterance.voice = fr;
      window.speechSynthesis.speak(utterance);
    } catch {}
  }, [muted]);

  const updateHud = useCallback((s: Runtime) => {
    setHud({
      score: Math.floor(s.score),
      pizzas: s.pizzas,
      delivered: s.delivered,
      time: Math.max(0, Math.ceil(s.timeLeft)),
      level: s.level,
      lives: s.lives,
      combo: s.combo,
      shield: s.shield,
      turbo: s.turbo,
    });
  }, []);

  const resetGame = useCallback(() => {
    runtimeRef.current = createRuntime();
    setHud({ score: 0, pizzas: 0, delivered: 0, time: ROUND_DURATION, level: 1, lives: 3, combo: 0, shield: 0, turbo: 0 });
    setStarted(false);
    setPaused(false);
    setEnded("none");
    setVito("Sharky ! Les commandes arrivent. Récupère les pizzas et livre-les sans traîner !");
  }, []);

  const finish = useCallback((s: Runtime, won: boolean) => {
    s.over = true;
    s.win = won;
    const final = Math.floor(s.score);
    setEnded(won ? "win" : "lose");
    setPaused(false);
    if (final > highScore) {
      setHighScore(final);
      try { localStorage.setItem(HIGH_SCORE_KEY, String(final)); } catch {}
    }
    if (won) speakVito("Bravo Sharky ! Niveau 10 atteint. La ville entière connaît maintenant le meilleur livreur de pizzas !");
    else speakVito("Pas grave Sharky. Recharge le scooter et repars : la prochaine tournée sera la bonne !");
  }, [highScore, speakVito]);

  const startJump = useCallback(() => {
    const s = runtimeRef.current;
    if (s.over || s.paused) return;
    if (!s.started) {
      s.started = true;
      setStarted(true);
      speakVito("C'est parti ! Garde jusqu'à cinq pizzas et livre les clients colorés.");
    }
    if (s.onGround) {
      s.vy = JUMP_VY;
      s.onGround = false;
      s.jumpHeld = true;
      s.jumpHold = 0;
      audio.jump();
    }
  }, [audio, speakVito]);

  const stopJump = useCallback(() => { runtimeRef.current.jumpHeld = false; }, []);

  const togglePause = useCallback(() => {
    const s = runtimeRef.current;
    if (!s.started || s.over) return;
    s.paused = !s.paused;
    setPaused(s.paused);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const down = (e: PointerEvent) => { e.preventDefault(); startJump(); };
    const up = (e: PointerEvent) => { e.preventDefault(); stopJump(); };
    canvas.addEventListener("pointerdown", down, { passive: false });
    canvas.addEventListener("pointerup", up, { passive: false });
    canvas.addEventListener("pointercancel", up, { passive: false });
    const keydown = (e: KeyboardEvent) => {
      if (["Space", "ArrowUp", "KeyW"].includes(e.code)) { e.preventDefault(); startJump(); }
      if (e.code === "KeyP" || e.code === "Escape") togglePause();
    };
    const keyup = (e: KeyboardEvent) => {
      if (["Space", "ArrowUp", "KeyW"].includes(e.code)) stopJump();
    };
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
    };
  }, [startJump, stopJump, togglePause]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let previous = performance.now();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const s = runtimeRef.current;
      s.sharkX = Math.max(90, rect.width * 0.2);
      if (s.onGround || s.sharkY === 0) s.sharkY = rect.height * GROUND;
      if (s.pedestrians.length === 0) {
        for (let i = 0; i < 9; i++) {
          s.pedestrians.push({
            x: Math.random() * rect.width * 1.4,
            phase: Math.random() * Math.PI * 2,
            speed: 0.22 + Math.random() * 0.14,
            shirt: COLORS[i % COLORS.length],
            skin: ["#f5d0a9", "#d6a77a", "#8d5d42"][i % 3],
            scale: 0.72 + Math.random() * 0.2,
            wave: 0,
          });
        }
      }
      if (s.traffic.length === 0) {
        for (let i = 0; i < 6; i++) {
          s.traffic.push({
            x: Math.random() * rect.width * 1.5,
            lane: (i % 2) as 0 | 1,
            dir: i % 3 === 0 ? -1 : 1,
            speed: 0.38 + Math.random() * 0.35,
            color: COLORS[(i + 2) % COLORS.length],
            type: (["sedan", "van", "mini"] as const)[i % 3],
          });
        }
      }
    };
    resize();
    window.addEventListener("resize", resize);

    const spawn = (s: Runtime, W: number, H: number) => {
      const gy = H * GROUND;
      const r = Math.random();
      let kind: Kind;
      if (r < 0.31) kind = "pizza";
      else if (r < 0.47) kind = "cone";
      else if (r < 0.59) kind = "puddle";
      else if (r < 0.7) kind = "trash";
      else if (r < 0.84) kind = "car";
      else if (r < 0.91) kind = "barrier";
      else if (r < 0.96 && s.level >= 4) kind = "turbo";
      else if (s.level >= 5) kind = "shield";
      else kind = "pizza";
      const dims: Record<Kind, [number, number]> = {
        pizza: [36, 36], customer: [72, 86], cone: [28, 36], puddle: [76, 15], trash: [38, 48], car: [112, 54], barrier: [72, 44], rival: [98, 58], roadblock: [135, 58], turbo: [38, 38], shield: [40, 40],
      };
      const [w, h] = dims[kind];
      let y = gy - h;
      if (kind === "pizza" && Math.random() < 0.52) y -= 55 + Math.random() * 55;
      if (kind === "turbo" || kind === "shield") y -= 52;
      s.entities.push({ x: W + 60, y, w, h, kind, alive: true, phase: 0, color: COLORS[Math.floor(Math.random() * COLORS.length)] });
    };

    const spawnCustomer = (s: Runtime, W: number, H: number) => {
      s.entities.push({ x: W + 70, y: H * GROUND - 86, w: 72, h: 86, kind: "customer", alive: true, phase: 0, color: COLORS[Math.floor(Math.random() * COLORS.length)] });
    };

    const spawnRival = (s: Runtime, W: number, H: number) => {
      s.entities.push({ x: W + 100, y: H * GROUND - 58, w: 98, h: 58, kind: "rival", alive: true, phase: 0, color: COLORS[Math.floor(Math.random() * COLORS.length)], vx: 40 + s.level * 8 });
    };

    const spawnRoadblock = (s: Runtime, W: number, H: number) => {
      s.entities.push({ x: W + 100, y: H * GROUND - 58, w: 135, h: 58, kind: "roadblock", alive: true, phase: 0, color: "#1d4ed8" });
      audio.siren();
    };

    const damage = (s: Runtime, e: Entity) => {
      if (s.invuln > 0) return;
      e.alive = false;
      if (s.shield > 0) {
        s.shield = 0;
        s.invuln = 1;
        s.floatTexts.push({ x: s.sharkX, y: s.sharkY - 90, text: "BOUCLIER !", color: "#67e8f9", life: 1 });
        audio.power();
        return;
      }
      s.lives -= 1;
      s.combo = 0;
      s.invuln = 1.25;
      s.shake = 0.4;
      s.floatTexts.push({ x: s.sharkX, y: s.sharkY - 90, text: "AÏE !", color: "#fecaca", life: 0.9 });
      audio.crash();
      if (s.lives <= 0) finish(s, false);
    };

    const vitoForLevel = (level: number) => {
      if (level === 3) speakVito("Niveau 3 ! Des concurrents arrivent. Reste concentré sur tes livraisons !");
      if (level === 5) speakVito("Niveau 5 ! La circulation se resserre et les patrouilles apparaissent. Garde ton rythme !");
      if (level === 8) speakVito("Niveau 8 ! Attention aux barrages sur la route. Saute au bon moment !");
      if (level === 10) speakVito("Niveau 10 ! Dernière ligne droite, Sharky !");
    };

    const frame = (now: number) => {
      const dt = Math.min(0.033, Math.max(0, (now - previous) / 1000));
      previous = now;
      const rect = canvas.getBoundingClientRect();
      const W = rect.width;
      const H = rect.height;
      const gy = H * GROUND;
      const s = runtimeRef.current;

      if (s.sharkY === 0) s.sharkY = gy;

      if (s.started && !s.paused && !s.over) {
        s.timeLeft -= dt;
        if (s.timeLeft <= 0) finish(s, false);
        s.level = levelFromDeliveries(s.delivered);
        const levelIndex = clamp(s.level - 1, 0, SPEED_STEPS.length - 1);
        const baseSpeed = SPEED_STEPS[levelIndex];
        if (s.turbo > 0) s.turbo = Math.max(0, s.turbo - dt);
        if (s.shield > 0) s.shield = Math.max(0, s.shield - dt);
        s.speed += (baseSpeed * (s.turbo > 0 ? 1.18 : 1) - s.speed) * Math.min(1, dt * 2.5);
        s.distance += s.speed * dt;
        s.score += dt * (8 + s.level * 2) * (1 + s.combo * 0.04);
        s.invuln = Math.max(0, s.invuln - dt);
        s.shake = Math.max(0, s.shake - dt);

        if (!s.onGround) {
          if (s.jumpHeld && s.jumpHold < 0.18) {
            s.vy -= 72 * dt * 60;
            s.jumpHold += dt;
          }
          s.vy += GRAVITY * dt;
          s.sharkY += s.vy * dt;
          if (s.sharkY >= gy) {
            s.sharkY = gy;
            s.vy = 0;
            s.onGround = true;
          }
        }

        if (s.lastVitoLevel !== s.level) {
          s.lastVitoLevel = s.level;
          vitoForLevel(s.level);
        }

        s.spawnTimer -= dt;
        if (s.spawnTimer <= 0) {
          spawn(s, W, H);
          const floor = SPAWN_FLOORS[levelIndex];
          s.spawnTimer = floor + Math.random() * (0.45 + floor * 0.35);
        }
        s.customerTimer -= dt;
        if (s.customerTimer <= 0) {
          spawnCustomer(s, W, H);
          s.customerTimer = Math.max(2.15, 3.2 - s.level * 0.08) + Math.random() * 0.65;
        }
        if (s.level >= 3) {
          s.rivalTimer -= dt;
          if (s.rivalTimer <= 0) {
            spawnRival(s, W, H);
            s.rivalTimer = Math.max(4.4, 8 - s.level * 0.32) + Math.random() * 2;
          }
        }
        if (s.level >= 8) {
          s.roadblockTimer -= dt;
          if (s.roadblockTimer <= 0) {
            spawnRoadblock(s, W, H);
            s.roadblockTimer = 7 + Math.random() * 3;
          }
        }

        const player = { x: s.sharkX - 35, y: s.sharkY - 70, w: 88, h: 68 };
        for (const e of s.entities) {
          if (!e.alive) continue;
          e.phase += dt;
          const factor = e.kind === "rival" ? 0.72 : 1;
          e.x -= Math.max(120, s.speed * factor - (e.vx || 0)) * dt;
          if (e.x < -220) { e.alive = false; continue; }
          if (!overlap(player, e)) continue;

          if (e.kind === "pizza") {
            e.alive = false;
            if (s.pizzas < MAX_PIZZAS) {
              s.pizzas += 1;
              s.score += 90 * (1 + s.level * 0.1);
              s.floatTexts.push({ x: e.x, y: e.y, text: "+ PIZZA", color: "#fde047", life: 0.9 });
              audio.pickup();
            } else {
              s.score += 25;
              s.floatTexts.push({ x: e.x, y: e.y, text: "STOCK PLEIN", color: "#fef3c7", life: 0.8 });
            }
          } else if (e.kind === "customer") {
            e.alive = false;
            if (s.pizzas > 0) {
              s.pizzas -= 1;
              s.delivered += 1;
              s.combo += 1;
              s.score += 450 * (1 + (s.level - 1) * 0.5) * (1 + Math.min(8, s.combo) * 0.05);
              s.floatTexts.push({ x: e.x, y: e.y, text: `LIVRÉ x${s.combo}`, color: "#86efac", life: 1.1 });
              audio.deliver();
              const newLevel = levelFromDeliveries(s.delivered);
              if (newLevel >= WIN_LEVEL) finish(s, true);
            } else {
              s.combo = 0;
              s.floatTexts.push({ x: e.x, y: e.y, text: "PAS DE PIZZA", color: "#fca5a5", life: 0.9 });
            }
          } else if (e.kind === "turbo") {
            e.alive = false;
            s.turbo = 5;
            s.score += 150;
            s.floatTexts.push({ x: e.x, y: e.y, text: "TURBO 5s", color: "#fbbf24", life: 1 });
            audio.power();
          } else if (e.kind === "shield") {
            e.alive = false;
            s.shield = 8;
            s.score += 150;
            s.floatTexts.push({ x: e.x, y: e.y, text: "BOUCLIER 8s", color: "#67e8f9", life: 1 });
            audio.power();
          } else if (e.kind === "rival") {
            e.alive = false;
            s.score += 120;
            s.floatTexts.push({ x: e.x, y: e.y, text: "DÉPASSÉ !", color: "#c4b5fd", life: 0.9 });
          } else {
            damage(s, e);
          }
        }
        s.entities = s.entities.filter(e => e.alive);

        for (const p of s.pedestrians) {
          p.x -= s.speed * p.speed * dt;
          p.phase += dt * 7;
          p.wave = Math.max(0, p.wave - dt);
          if (Math.abs(p.x - s.sharkX) < 130 && p.wave <= 0) p.wave = 0.8;
          if (p.x < -60) p.x = W + 80 + Math.random() * W;
        }
        for (const c of s.traffic) {
          const motion = c.dir === 1 ? -s.speed * c.speed : -s.speed * (1.05 + c.speed);
          c.x += motion * dt;
          if (c.x < -180) c.x = W + 100 + Math.random() * W;
        }
        for (const f of s.floatTexts) {
          f.y -= 35 * dt;
          f.life -= dt;
        }
        s.floatTexts = s.floatTexts.filter(f => f.life > 0);
      }

      const shakeX = s.shake > 0 ? (Math.random() - 0.5) * 10 : 0;
      const shakeY = s.shake > 0 ? (Math.random() - 0.5) * 7 : 0;
      ctx.save();
      ctx.translate(shakeX, shakeY);
      drawCity(ctx, W, H, s.distance, s.level);

      for (const p of s.pedestrians) drawPed(ctx, p, gy - 7);
      for (const c of s.traffic) {
        const y = gy + (c.lane === 0 ? 18 : 62);
        const scale = c.lane === 0 ? 0.62 : 0.78;
        drawCar(ctx, c.x, y, 105 * scale, 55 * scale, c.color);
      }

      if (s.level >= 5 && s.started && !s.over) {
        const policeCount = s.level >= 8 ? 2 : 1;
        for (let i = 0; i < policeCount; i++) {
          const px = 12 + i * 118 + Math.sin(now / 650 + i) * 7;
          const py = gy + 43 + i * 8;
          drawCar(ctx, px, py, 105, 52, "#1e3a8a", true);
          if (Math.floor(now / 180) % 2 === 0) {
            ctx.fillStyle = i % 2 ? "rgba(239,68,68,.28)" : "rgba(37,99,235,.28)";
            ctx.beginPath(); ctx.arc(px + 57, py - 3, 34, 0, Math.PI * 2); ctx.fill();
          }
        }
      }

      for (const e of s.entities) {
        ctx.save();
        if (e.kind === "pizza") {
          const img = images.current.pizza;
          if (img?.complete && img.naturalWidth) ctx.drawImage(img, e.x, e.y, e.w, e.h);
          else { ctx.font = `${e.w}px sans-serif`; ctx.fillText("🍕", e.x, e.y + e.h); }
        } else if (e.kind === "customer") {
          const pulse = 1 + Math.sin(now / 180 + e.phase) * 0.05;
          ctx.translate(e.x + e.w / 2, e.y + e.h / 2);
          ctx.scale(pulse, pulse);
          ctx.translate(-e.w / 2, -e.h / 2);
          ctx.strokeStyle = e.color || "#22c55e";
          ctx.lineWidth = 4;
          ctx.setLineDash([8, 6]);
          roundedRect(ctx, 0, 0, e.w, e.h, 14); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = "rgba(255,255,255,.92)";
          roundedRect(ctx, 9, 10, e.w - 18, e.h - 18, 12); ctx.fill();
          ctx.font = "34px sans-serif"; ctx.fillText("🙋", 18, 49);
          ctx.font = "bold 14px system-ui"; ctx.fillStyle = "#111827"; ctx.fillText("PIZZA", 13, 72);
        } else if (e.kind === "cone") {
          ctx.fillStyle = "#f97316";
          ctx.beginPath(); ctx.moveTo(e.x + e.w / 2, e.y); ctx.lineTo(e.x + e.w, e.y + e.h); ctx.lineTo(e.x, e.y + e.h); ctx.closePath(); ctx.fill();
          ctx.fillStyle = "#fff7ed"; ctx.fillRect(e.x + 5, e.y + e.h * 0.55, e.w - 10, 6);
        } else if (e.kind === "puddle") {
          ctx.fillStyle = "rgba(56,189,248,.65)";
          ctx.beginPath(); ctx.ellipse(e.x + e.w / 2, e.y + e.h / 2, e.w / 2, e.h / 2, 0, 0, Math.PI * 2); ctx.fill();
        } else if (e.kind === "trash") {
          ctx.fillStyle = "#475569"; roundedRect(ctx, e.x, e.y + 6, e.w, e.h - 6, 5); ctx.fill();
          ctx.fillStyle = "#64748b"; ctx.fillRect(e.x - 3, e.y + 4, e.w + 6, 7);
        } else if (e.kind === "car") {
          drawCar(ctx, e.x, e.y, e.w, e.h, e.color || "#ef4444");
        } else if (e.kind === "barrier") {
          ctx.fillStyle = "#f8fafc"; roundedRect(ctx, e.x, e.y + 14, e.w, 18, 4); ctx.fill();
          ctx.fillStyle = "#ef4444";
          for (let x = 4; x < e.w - 4; x += 22) ctx.fillRect(e.x + x, e.y + 14, 11, 18);
          ctx.fillStyle = "#475569"; ctx.fillRect(e.x + 9, e.y + 31, 7, 13); ctx.fillRect(e.x + e.w - 16, e.y + 31, 7, 13);
        } else if (e.kind === "rival") {
          ctx.fillStyle = e.color || "#8b5cf6";
          roundedRect(ctx, e.x + 20, e.y + 15, e.w - 20, e.h - 22, 13); ctx.fill();
          ctx.fillStyle = "#111827";
          ctx.beginPath(); ctx.arc(e.x + 35, e.y + e.h - 5, 11, 0, Math.PI * 2); ctx.arc(e.x + e.w - 18, e.y + e.h - 5, 11, 0, Math.PI * 2); ctx.fill();
          ctx.font = "28px sans-serif"; ctx.fillText("😼", e.x + 2, e.y + 29);
          ctx.font = "18px sans-serif"; ctx.fillText("🍕", e.x + 54, e.y + 23);
        } else if (e.kind === "roadblock") {
          ctx.fillStyle = "#1e3a8a"; roundedRect(ctx, e.x, e.y + 12, e.w, 26, 6); ctx.fill();
          ctx.fillStyle = "#f8fafc"; ctx.font = "bold 13px system-ui"; ctx.fillText("POLICE", e.x + 43, e.y + 30);
          ctx.fillStyle = "#fde047";
          for (let x = 6; x < e.w - 6; x += 30) ctx.fillRect(e.x + x, e.y + 38, 18, 7);
          ctx.fillStyle = "#334155"; ctx.fillRect(e.x + 15, e.y + 44, 8, 14); ctx.fillRect(e.x + e.w - 23, e.y + 44, 8, 14);
        } else if (e.kind === "turbo") {
          ctx.fillStyle = "rgba(251,191,36,.25)"; ctx.beginPath(); ctx.arc(e.x + 19, e.y + 19, 26, 0, Math.PI * 2); ctx.fill();
          ctx.font = "34px sans-serif"; ctx.fillText("⚡", e.x + 2, e.y + 33);
        } else if (e.kind === "shield") {
          ctx.fillStyle = "rgba(34,211,238,.25)"; ctx.beginPath(); ctx.arc(e.x + 20, e.y + 20, 27, 0, Math.PI * 2); ctx.fill();
          ctx.font = "33px sans-serif"; ctx.fillText("🛡️", e.x + 1, e.y + 34);
        }
        ctx.restore();
      }

      ctx.save();
      const flash = s.invuln > 0 && Math.floor(now / 90) % 2 === 0;
      ctx.globalAlpha = flash ? 0.35 : 1;
      if (s.shield > 0) {
        ctx.strokeStyle = "#67e8f9";
        ctx.lineWidth = 4;
        ctx.fillStyle = "rgba(34,211,238,.12)";
        ctx.beginPath(); ctx.arc(s.sharkX + 10, s.sharkY - 36, 57, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      if (s.turbo > 0) {
        ctx.strokeStyle = "#fbbf24";
        ctx.lineWidth = 5;
        for (let i = 0; i < 4; i++) {
          ctx.beginPath(); ctx.moveTo(s.sharkX - 65 - i * 14, s.sharkY - 25 + i * 8); ctx.lineTo(s.sharkX - 20, s.sharkY - 25 + i * 8); ctx.stroke();
        }
      }
      const img = images.current.scooter;
      if (img?.complete && img.naturalWidth) {
        const ratio = img.naturalWidth / Math.max(1, img.naturalHeight);
        const h = 105;
        const w = clamp(h * ratio, 118, 175);
        ctx.drawImage(img, s.sharkX - w * 0.35, s.sharkY - h + 9, w, h);
      } else {
        ctx.font = "62px sans-serif"; ctx.fillText("🛵", s.sharkX - 30, s.sharkY);
      }
      ctx.restore();

      for (const f of s.floatTexts) {
        ctx.globalAlpha = clamp(f.life, 0, 1);
        ctx.fillStyle = f.color;
        ctx.font = "900 17px system-ui";
        ctx.textAlign = "center";
        ctx.fillText(f.text, f.x, f.y);
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = "start";
      ctx.restore();

      if (s.started && !s.paused && !s.over && now - lastHud.current > 90) {
        lastHud.current = now;
        updateHud(s);
      }
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [audio, finish, speakVito, updateHud]);

  return (
    <main style={{ minHeight: "100dvh", background: "#07111f", color: "white", fontFamily: "system-ui, sans-serif", overflow: "hidden" }}>
      <div style={{ width: "100%", maxWidth: 1180, margin: "0 auto", padding: "10px 10px 14px" }}>
        <header style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: "clamp(18px,4vw,30px)", fontWeight: 950, lineHeight: 1 }}>🍕 Sharky Pizza Run</div>
            <div style={{ color: "#93c5fd", fontSize: 12, marginTop: 3 }}>Ville • scooter • livraisons • poursuite arcade</div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button aria-label="Son" onClick={() => setMuted(v => !v)} style={buttonStyle}>{muted ? <VolumeX size={19}/> : <Volume2 size={19}/>}</button>
            <button aria-label="Pause" onClick={togglePause} style={buttonStyle}>{paused ? <Play size={19}/> : <Pause size={19}/>}</button>
            <button aria-label="Recommencer" onClick={resetGame} style={buttonStyle}><RotateCcw size={19}/></button>
          </div>
        </header>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(6,minmax(0,1fr))", gap: 6, marginBottom: 7 }}>
          <Hud icon={<Trophy size={15}/>} label="Score" value={hud.score.toLocaleString("fr-FR")} />
          <Hud icon={<Pizza size={15}/>} label="Stock" value={`${hud.pizzas}/${MAX_PIZZAS}`} />
          <Hud icon={<Pizza size={15}/>} label="Livrées" value={String(hud.delivered)} />
          <Hud icon={<Clock size={15}/>} label="Temps" value={`${hud.time}s`} />
          <Hud icon={<span>🏁</span>} label="Niveau" value={`${hud.level}/10`} />
          <Hud icon={<span>❤️</span>} label="Vies" value={String(hud.lives)} />
        </section>

        <div style={{ position: "relative", height: "min(70dvh,680px)", minHeight: 430, borderRadius: 22, overflow: "hidden", border: "1px solid rgba(255,255,255,.16)", boxShadow: "0 22px 60px rgba(0,0,0,.38)", background: "#0f172a" }}>
          <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block", touchAction: "none", cursor: "pointer" }} />

          {!started && ended === "none" && (
            <div style={overlayStyle}>
              <div style={cardStyle}>
                <div style={{ fontSize: 54 }}>🛵🍕</div>
                <h1 style={{ margin: "4px 0 8px", fontSize: 28 }}>Prêt pour la tournée ?</h1>
                <p style={{ margin: "0 0 12px", color: "#dbeafe", lineHeight: 1.45 }}>Tape ou maintiens l’écran pour sauter. Ramasse jusqu’à 5 pizzas et livre les clients. À partir des niveaux 5 et 8, la circulation et les barrages se corsent.</p>
                <button onClick={startJump} style={primaryStyle}><Play size={20}/> DÉMARRER</button>
              </div>
            </div>
          )}

          {paused && ended === "none" && (
            <div style={overlayStyle}>
              <div style={cardStyle}>
                <div style={{ fontSize: 48 }}>⏸️</div>
                <h2>Pause</h2>
                <button onClick={togglePause} style={primaryStyle}><Play size={20}/> REPRENDRE</button>
              </div>
            </div>
          )}

          {ended !== "none" && (
            <div style={overlayStyle}>
              <div style={cardStyle}>
                <div style={{ fontSize: 58 }}>{ended === "win" ? "🏆🍕" : "🛵💨"}</div>
                <h2 style={{ margin: "4px 0" }}>{ended === "win" ? "Champion ultime !" : "Fin de tournée"}</h2>
                <p style={{ color: "#dbeafe" }}>Score : <b>{hud.score.toLocaleString("fr-FR")}</b> • Record : <b>{highScore.toLocaleString("fr-FR")}</b></p>
                <button onClick={resetGame} style={primaryStyle}><RotateCcw size={20}/> REJOUER</button>
              </div>
            </div>
          )}

          {vito && ended === "none" && (
            <button onClick={() => setVito(null)} style={{ position: "absolute", left: 12, bottom: 12, maxWidth: 440, textAlign: "left", border: "1px solid rgba(255,255,255,.25)", background: "rgba(12,18,30,.9)", color: "white", borderRadius: 16, padding: "10px 13px", boxShadow: "0 10px 30px rgba(0,0,0,.35)", backdropFilter: "blur(8px)" }}>
              <div style={{ fontSize: 11, fontWeight: 900, color: "#fbbf24", letterSpacing: 1 }}>VITO</div>
              <div style={{ fontSize: 13, lineHeight: 1.35 }}>{vito}</div>
            </button>
          )}

          <div style={{ position: "absolute", top: 12, right: 12, display: "flex", gap: 5, pointerEvents: "none" }}>
            {hud.combo >= 2 && <Badge text={`COMBO x${hud.combo}`} color="#a78bfa" />}
            {hud.turbo > 0 && <Badge text={`⚡ ${Math.ceil(hud.turbo)}s`} color="#fbbf24" />}
            {hud.shield > 0 && <Badge text={`🛡️ ${Math.ceil(hud.shield)}s`} color="#67e8f9" />}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 8, color: "#94a3b8", fontSize: 12 }}>
          <span>N{hud.level} — {LEVEL_NAMES[hud.level - 1]}</span>
          <span>Record {highScore.toLocaleString("fr-FR")}</span>
        </div>
      </div>
    </main>
  );
}

function Hud({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div style={{ minWidth: 0, background: "rgba(15,23,42,.92)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 11, padding: "6px 7px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, color: "#93c5fd", fontSize: 10, whiteSpace: "nowrap", overflow: "hidden" }}>{icon}<span>{label}</span></div>
      <div style={{ fontWeight: 900, fontSize: "clamp(13px,2.6vw,18px)", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
    </div>
  );
}

function Badge({ text, color }: { text: string; color: string }) {
  return <span style={{ background: "rgba(15,23,42,.9)", border: `1px solid ${color}`, color, borderRadius: 999, padding: "5px 8px", fontSize: 11, fontWeight: 900 }}>{text}</span>;
}

const buttonStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,.15)",
  background: "rgba(30,41,59,.9)",
  color: "white",
  width: 39,
  height: 39,
  borderRadius: 11,
  display: "grid",
  placeItems: "center",
};

const primaryStyle: React.CSSProperties = {
  border: 0,
  background: "linear-gradient(135deg,#f59e0b,#ef4444)",
  color: "white",
  borderRadius: 14,
  padding: "12px 18px",
  fontWeight: 950,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  boxShadow: "0 10px 26px rgba(239,68,68,.28)",
};

const overlayStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "grid",
  placeItems: "center",
  background: "rgba(2,6,23,.56)",
  backdropFilter: "blur(5px)",
  padding: 18,
};

const cardStyle: React.CSSProperties = {
  width: "min(92%,460px)",
  textAlign: "center",
  background: "rgba(15,23,42,.94)",
  border: "1px solid rgba(255,255,255,.16)",
  borderRadius: 22,
  padding: 20,
  boxShadow: "0 24px 70px rgba(0,0,0,.45)",
};
