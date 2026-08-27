import { useEffect, useRef, useState, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Trophy, Pizza, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import scooterImg from "@/assets/sharky-scooter.png";
import pizzaImg from "@/assets/pizza-box.png";

/* ───────────────────────── Sharky Pizza Run ─────────────────────────
   Side-scroller : Sharky en scooter livre des pizzas dans une rue qui
   défile. 1 doigt = tap/maintien pour sauter. Esquive les obstacles
   (plots, voitures, flaques), collecte les pizzas (max 3 en stock),
   livre aux clients (zone arc-en-ciel) avant la fin du timer.
─────────────────────────────────────────────────────────────────────── */

type ObstacleKind = "cone" | "puddle" | "trash" | "car";
type EntityKind = "pizza" | "customer" | ObstacleKind;

interface Entity {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: EntityKind;
  alive: boolean;
  phase: number;
  customerColor?: string; // pour les clients
  lane?: 0 | 1; // 0 = sol, 1 = en l'air (pour les pizzas)
}

interface Cloud {
  x: number; y: number; scale: number; speed: number;
}
interface Building {
  x: number; w: number; h: number; color: string; windowsCol: string;
}

const GROUND_RATIO = 0.78; // y du sol (ratio de la hauteur)
const GRAVITY = 2200;       // px/s²
const JUMP_VY = -780;
const JUMP_HOLD_BOOST = -60; // tant qu'on tient, petite poussée
const JUMP_HOLD_MAX = 0.18;  // secondes
const MAX_PIZZAS = 3;
const ROUND_DURATION = 75;   // secondes

/* Sons procéduraux */
function useSounds() {
  const ctxRef = useRef<AudioContext | null>(null);
  const ensure = () => {
    if (!ctxRef.current) ctxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctxRef.current.state === "suspended") ctxRef.current.resume().catch(() => {});
    return ctxRef.current;
  };
  const jump = () => {
    const ctx = ensure();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(360, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(720, ctx.currentTime + 0.12);
    g.gain.setValueAtTime(0.18, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    o.connect(g).connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.16);
  };
  const pickup = () => {
    const ctx = ensure();
    [660, 990].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = "triangle"; o.frequency.value = f;
      const t = ctx.currentTime + i * 0.05;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.18, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + 0.16);
    });
  };
  const deliver = () => {
    const ctx = ensure();
    [523, 659, 784, 1047].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = "triangle"; o.frequency.value = f;
      const t = ctx.currentTime + i * 0.07;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.22, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + 0.3);
    });
  };
  const crash = () => {
    const ctx = ensure();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(220, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.4);
    g.gain.setValueAtTime(0.3, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
    o.connect(g).connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.5);
  };
  const horn = () => {
    const ctx = ensure();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = "square"; o.frequency.value = 280;
    g.gain.setValueAtTime(0.12, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    o.connect(g).connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.2);
  };
  return { jump, pickup, deliver, crash, horn };
}

const CUSTOMER_COLORS = ["#fbbf24", "#22d3ee", "#a855f7", "#10b981", "#f472b6", "#fb923c"];

export default function SharkyPizzaRun() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sounds = useSounds();

  const [score, setScore] = useState(0);
  const [pizzas, setPizzas] = useState(0);
  const [delivered, setDelivered] = useState(0);
  const [timeLeft, setTimeLeft] = useState(ROUND_DURATION);
  const [combo, setCombo] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [highScore, setHighScore] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  const stateRef = useRef({
    sharkX: 0,
    sharkY: 0,
    sharkVY: 0,
    onGround: true,
    jumpHold: 0,
    jumping: false,
    speed: 280,            // px/s, accélère lentement
    distance: 0,
    score: 0,
    pizzas: 0,
    delivered: 0,
    combo: 0,
    timeLeft: ROUND_DURATION,
    invuln: 0,
    shake: 0,
    started: false,
    gameOver: false,
    flash: 0,
    flashColor: "rgba(255,255,255,0)",

    entities: [] as Entity[],
    clouds: [] as Cloud[],
    buildings: [] as Building[],
    spawnTimer: 0,
    customerTimer: 8,      // premier client après 8s

    floatTexts: [] as { x: number; y: number; text: string; color: string; life: number }[],
  });

  const imgsRef = useRef<{ scooter?: HTMLImageElement; pizza?: HTMLImageElement }>({});
  useEffect(() => {
    const s = new Image(); s.src = scooterImg;
    const p = new Image(); p.src = pizzaImg;
    imgsRef.current.scooter = s;
    imgsRef.current.pizza = p;
  }, []);

  /* High score */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      setUserId(user.id);
      const { data: prog } = await supabase
        .from("deep_sea_quest_progress")
        .select("high_score")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (prog) setHighScore(prog.high_score ?? 0);
      else await supabase.from("deep_sea_quest_progress").insert({ user_id: user.id });
    })();
    return () => { cancelled = true; };
  }, []);

  const persistProgress = useCallback(async (final: number) => {
    if (!userId) return;
    const newHigh = Math.max(highScore, final);
    setHighScore(newHigh);
    await supabase.from("deep_sea_quest_progress").upsert({
      user_id: userId,
      high_score: newHigh,
    } as any, { onConflict: "user_id" });
  }, [userId, highScore]);

  /* Contrôles : tap/hold = saut */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      const s = stateRef.current;
      if (!s.started) { s.started = true; setStarted(true); }
      if (s.gameOver) return;
      if (s.onGround) {
        s.sharkVY = JUMP_VY;
        s.onGround = false;
        s.jumping = true;
        s.jumpHold = 0;
        sounds.jump();
      }
    };
    const onUp = () => { stateRef.current.jumping = false; };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", onUp);
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onUp);
    };
  }, [sounds]);

  /* Boucle */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const s = stateRef.current;
      s.sharkX = rect.width * 0.22;
      const groundY = rect.height * GROUND_RATIO;
      if (s.onGround) s.sharkY = groundY;
      // Init clouds + buildings
      if (s.clouds.length === 0) {
        for (let i = 0; i < 5; i++) {
          s.clouds.push({
            x: Math.random() * rect.width,
            y: 30 + Math.random() * (rect.height * 0.35),
            scale: 0.5 + Math.random() * 1,
            speed: 8 + Math.random() * 12,
          });
        }
      }
      if (s.buildings.length === 0) {
        let x = 0;
        const bgColors = [
          ["#f9a8d4", "#fce7f3"], // rose
          ["#fde047", "#fef9c3"], // jaune
          ["#7dd3fc", "#e0f2fe"], // bleu
          ["#86efac", "#dcfce7"], // vert
          ["#c4b5fd", "#ede9fe"], // violet
          ["#fdba74", "#ffedd5"], // orange
        ];
        while (x < rect.width * 1.5) {
          const w = 60 + Math.random() * 100;
          const h = 100 + Math.random() * 220;
          const c = bgColors[Math.floor(Math.random() * bgColors.length)];
          s.buildings.push({ x, w, h, color: c[0], windowsCol: c[1] });
          x += w + 4;
        }
      }
    };
    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    let last = performance.now();

    const spawnObstacle = (W: number, H: number, _depth: number) => {
      const s = stateRef.current;
      const groundY = H * GROUND_RATIO;
      const r = Math.random();
      let kind: ObstacleKind;
      if (r < 0.4) kind = "cone";
      else if (r < 0.65) kind = "puddle";
      else if (r < 0.85) kind = "trash";
      else kind = "car";
      const dims =
        kind === "cone" ? { w: 28, h: 36 } :
        kind === "puddle" ? { w: 70, h: 14 } :
        kind === "trash" ? { w: 36, h: 46 } :
        { w: 110, h: 50 }; // car
      s.entities.push({
        x: W + 60,
        y: groundY - dims.h,
        w: dims.w, h: dims.h,
        kind, alive: true, phase: 0,
      });
    };

    const spawnPizza = (W: number, H: number) => {
      const s = stateRef.current;
      const groundY = H * GROUND_RATIO;
      const inAir = Math.random() < 0.45;
      const w = 32, h = 32;
      const y = inAir ? groundY - 80 - Math.random() * 50 : groundY - h - 4;
      s.entities.push({
        x: W + 40, y, w, h,
        kind: "pizza", alive: true, phase: 0,
        lane: inAir ? 1 : 0,
      });
    };

    const spawnCustomer = (W: number, H: number) => {
      const s = stateRef.current;
      const groundY = H * GROUND_RATIO;
      const w = 70, h = 80;
      const color = CUSTOMER_COLORS[Math.floor(Math.random() * CUSTOMER_COLORS.length)];
      s.entities.push({
        x: W + 60, y: groundY - h, w, h,
        kind: "customer", alive: true, phase: 0,
        customerColor: color,
      });
    };

    const tick = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;

      const s = stateRef.current;
      const rect = canvas.getBoundingClientRect();
      const W = rect.width, H = rect.height;
      const groundY = H * GROUND_RATIO;

      /* ===== FOND : ciel dégradé ===== */
      const sky = ctx.createLinearGradient(0, 0, 0, groundY);
      sky.addColorStop(0, "#fde68a");
      sky.addColorStop(0.5, "#fdba74");
      sky.addColorStop(1, "#fb923c");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, groundY);

      // Soleil
      ctx.fillStyle = "rgba(255,240,180,0.85)";
      ctx.beginPath(); ctx.arc(W * 0.78, H * 0.18, 42, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,250,220,0.4)";
      ctx.beginPath(); ctx.arc(W * 0.78, H * 0.18, 60, 0, Math.PI * 2); ctx.fill();

      /* ===== Nuages ===== */
      for (const c of s.clouds) {
        if (s.started && !s.gameOver) c.x -= c.speed * dt;
        if (c.x < -80) c.x = W + 60;
        drawCloud(ctx, c.x, c.y, c.scale);
      }

      /* ===== Buildings (parallaxe lente) ===== */
      const bgSpeed = s.started && !s.gameOver ? s.speed * 0.35 : 0;
      for (const b of s.buildings) b.x -= bgSpeed * dt;
      // recycle
      let maxX = 0;
      for (const b of s.buildings) maxX = Math.max(maxX, b.x + b.w);
      while (maxX < W + 200) {
        const bgColors = [
          ["#f9a8d4", "#fce7f3"], ["#fde047", "#fef9c3"],
          ["#7dd3fc", "#e0f2fe"], ["#86efac", "#dcfce7"],
          ["#c4b5fd", "#ede9fe"], ["#fdba74", "#ffedd5"],
        ];
        const w = 60 + Math.random() * 100;
        const h = 100 + Math.random() * 220;
        const c = bgColors[Math.floor(Math.random() * bgColors.length)];
        s.buildings.push({ x: maxX + 4, w, h, color: c[0], windowsCol: c[1] });
        maxX += w + 4;
      }
      s.buildings = s.buildings.filter(b => b.x + b.w > -10);
      for (const b of s.buildings) drawBuilding(ctx, b, groundY);

      /* ===== Trottoir ===== */
      // Bord de trottoir
      ctx.fillStyle = "#94a3b8";
      ctx.fillRect(0, groundY - 6, W, 6);
      ctx.fillStyle = "#cbd5e1";
      ctx.fillRect(0, groundY - 8, W, 2);
      // Route
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(0, groundY, W, H - groundY);
      // Lignes de route défilantes
      ctx.fillStyle = "#fbbf24";
      const dashY = groundY + (H - groundY) * 0.55;
      const dashW = 40, dashGap = 30;
      const offset = (s.distance * 0.6) % (dashW + dashGap);
      for (let x = -offset; x < W; x += dashW + dashGap) {
        ctx.fillRect(x, dashY, dashW, 5);
      }
      // Ombres sol
      ctx.fillStyle = "rgba(0,0,0,0.15)";
      ctx.fillRect(0, groundY, W, 8);

      /* Écran d'attente */
      if (!s.started) {
        drawShark(ctx, s.sharkX, groundY + Math.sin(now / 300) * 2);
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.fillRect(0, H * 0.32, W, 90);
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.font = "bold 22px system-ui, sans-serif";
        ctx.fillText("🍕 Tap pour démarrer", W / 2, H * 0.32 + 35);
        ctx.font = "13px system-ui, sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.fillText("Tap = saut · Maintien = saut + haut", W / 2, H * 0.32 + 60);
        ctx.fillText("Récupère les pizzas, livre aux clients !", W / 2, H * 0.32 + 78);
        ctx.restore();
        raf = requestAnimationFrame(tick);
        return;
      }

      if (s.gameOver) {
        // Continue d'afficher le décor mais figé
        drawShark(ctx, s.sharkX, s.sharkY);
        for (const e of s.entities) drawEntity(ctx, e);
        raf = requestAnimationFrame(tick);
        return;
      }

      /* ===== Update gameplay ===== */
      // Timer
      s.timeLeft = Math.max(0, s.timeLeft - dt);
      if (s.timeLeft <= 0) {
        endGame(s.score);
      }

      // Vitesse qui augmente doucement
      s.speed = Math.min(520, s.speed + dt * 8);
      s.distance += s.speed * dt;

      // Saut
      if (s.jumping && !s.onGround && s.jumpHold < JUMP_HOLD_MAX) {
        s.sharkVY += JUMP_HOLD_BOOST * dt * 60;
        s.jumpHold += dt;
      }
      s.sharkVY += GRAVITY * dt;
      s.sharkY += s.sharkVY * dt;
      if (s.sharkY >= groundY) {
        s.sharkY = groundY;
        s.sharkVY = 0;
        s.onGround = true;
      }

      // Spawn obstacles & pizzas
      s.spawnTimer -= dt;
      if (s.spawnTimer <= 0) {
        // Mix : alterne obstacle / pizza
        const r = Math.random();
        if (r < 0.55) spawnObstacle(W, H, s.distance);
        else spawnPizza(W, H);
        // intervalle plus court avec la vitesse
        const base = 1.4 - Math.min(0.7, s.speed / 1500);
        s.spawnTimer = base + Math.random() * 0.6;
      }
      // Spawn clients périodiques
      s.customerTimer -= dt;
      if (s.customerTimer <= 0) {
        spawnCustomer(W, H);
        s.customerTimer = 9 + Math.random() * 6;
      }

      // Update entities
      for (const e of s.entities) {
        if (!e.alive) continue;
        e.x -= s.speed * dt;
        e.phase += dt * 4;
      }
      s.entities = s.entities.filter(e => e.alive && e.x + e.w > -50);

      // Hitbox du requin (légèrement réduite pour fairness)
      const sharkBox = {
        x: s.sharkX - 38, y: s.sharkY - 56,
        w: 76, h: 56,
      };

      // Collisions
      for (const e of s.entities) {
        if (!e.alive) continue;
        const overlap = sharkBox.x < e.x + e.w &&
                        sharkBox.x + sharkBox.w > e.x &&
                        sharkBox.y < e.y + e.h &&
                        sharkBox.y + sharkBox.h > e.y;
        if (!overlap) continue;

        if (e.kind === "pizza") {
          if (s.pizzas < MAX_PIZZAS) {
            e.alive = false;
            s.pizzas += 1;
            s.score += 10;
            sounds.pickup();
            s.floatTexts.push({ x: e.x, y: e.y, text: "+1 🍕", color: "#fbbf24", life: 1 });
          }
        } else if (e.kind === "customer") {
          if (s.pizzas > 0) {
            e.alive = false;
            const delivered = Math.min(s.pizzas, 1); // une livraison à la fois
            s.pizzas -= delivered;
            s.delivered += delivered;
            s.combo += 1;
            const baseScore = 100 * delivered;
            const comboBonus = Math.min(150, s.combo * 15);
            const total = baseScore + comboBonus;
            s.score += total;
            s.timeLeft = Math.min(ROUND_DURATION, s.timeLeft + 4); // +4s par livraison !
            sounds.deliver();
            s.flash = 0.3;
            s.flashColor = "rgba(34,197,94,0.35)";
            s.floatTexts.push({
              x: e.x, y: e.y - 10,
              text: `+${total} ${s.combo > 1 ? `x${s.combo}` : ""} +4s`,
              color: "#22c55e", life: 1.4,
            });
          } else {
            // pas de pizza : client déçu mais pas de pénalité, on rate juste
          }
        } else {
          // obstacle
          if (s.invuln <= 0) {
            sounds.crash();
            if (e.kind === "car") sounds.horn();
            s.shake = 16;
            s.invuln = 1.2;
            s.combo = 0;
            s.flash = 0.4;
            s.flashColor = "rgba(239,68,68,0.4)";
            // pénalité : -8s + perdre une pizza
            s.timeLeft = Math.max(0, s.timeLeft - 8);
            if (s.pizzas > 0) {
              s.pizzas -= 1;
              s.floatTexts.push({ x: s.sharkX, y: s.sharkY - 60, text: "-1 🍕 -8s", color: "#ef4444", life: 1.4 });
            } else {
              s.floatTexts.push({ x: s.sharkX, y: s.sharkY - 60, text: "-8s", color: "#ef4444", life: 1.4 });
            }
            // léger rebond
            if (s.onGround) { s.sharkVY = -300; s.onGround = false; }
            if (s.timeLeft <= 0) endGame(s.score);
          }
        }
      }

      if (s.invuln > 0) s.invuln -= dt;

      // Float texts
      for (const ft of s.floatTexts) {
        ft.y -= 30 * dt;
        ft.life -= dt;
      }
      s.floatTexts = s.floatTexts.filter(ft => ft.life > 0);

      /* ===== DESSIN ===== */
      // Tremblement
      let sx = 0, sy = 0;
      if (s.shake > 0) {
        sx = (Math.random() - 0.5) * s.shake;
        sy = (Math.random() - 0.5) * s.shake;
        s.shake = Math.max(0, s.shake - dt * 35);
      }
      ctx.save();
      ctx.translate(sx, sy);

      // Entities (clients d'abord pour qu'ils soient derrière les obstacles ?
      // En fait on dessine dans l'ordre du sol)
      for (const e of s.entities) {
        if (!e.alive) continue;
        drawEntity(ctx, e);
      }

      // Ombre du requin au sol
      const heightAbove = groundY - s.sharkY;
      const shadowScale = 1 - Math.min(0.6, heightAbove / 200);
      ctx.fillStyle = `rgba(0,0,0,${0.25 * shadowScale})`;
      ctx.beginPath();
      ctx.ellipse(s.sharkX, groundY - 2, 40 * shadowScale, 6 * shadowScale, 0, 0, Math.PI * 2);
      ctx.fill();

      // Sharky (clignote en invuln)
      const blink = s.invuln > 0 && Math.floor(s.invuln * 12) % 2 === 0;
      if (!blink) drawShark(ctx, s.sharkX, s.sharkY);

      // Indicateur pizzas en stock au-dessus du requin
      drawPizzaStack(ctx, s.sharkX + 32, s.sharkY - 70, s.pizzas);

      // Float texts
      for (const ft of s.floatTexts) {
        ctx.save();
        const a = Math.min(1, ft.life);
        ctx.globalAlpha = a;
        ctx.font = "bold 16px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.lineWidth = 4;
        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        ctx.strokeText(ft.text, ft.x, ft.y);
        ctx.fillStyle = ft.color;
        ctx.fillText(ft.text, ft.x, ft.y);
        ctx.restore();
      }

      ctx.restore();

      // Flash overlay
      if (s.flash > 0) {
        ctx.fillStyle = s.flashColor;
        ctx.fillRect(0, 0, W, H);
        s.flash = Math.max(0, s.flash - dt * 2);
      }

      // Sync UI
      if (Math.floor(now / 100) % 2 === 0) {
        setScore(s.score);
        setPizzas(s.pizzas);
        setDelivered(s.delivered);
        setTimeLeft(Math.ceil(s.timeLeft));
        setCombo(s.combo);
      }

      raf = requestAnimationFrame(tick);
    };

    const endGame = (final: number) => {
      const s = stateRef.current;
      if (s.gameOver) return;
      s.gameOver = true;
      setGameOver(true);
      setScore(final);
      persistProgress(final);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [persistProgress, sounds]);

  /* ===== Helpers de dessin ===== */
  function drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.arc(20, -4, 22, 0, Math.PI * 2);
    ctx.arc(40, 0, 18, 0, Math.PI * 2);
    ctx.arc(20, 8, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawBuilding(ctx: CanvasRenderingContext2D, b: Building, groundY: number) {
    const top = groundY - 10 - b.h;
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, top, b.w, b.h);
    // toit
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(b.x - 2, top - 4, b.w + 4, 4);
    // fenêtres
    const wcols = Math.max(2, Math.floor(b.w / 18));
    const wrows = Math.max(2, Math.floor(b.h / 24));
    const gx = (b.w - wcols * 10) / (wcols + 1);
    const gy = (b.h - wrows * 12) / (wrows + 1);
    for (let i = 0; i < wcols; i++) {
      for (let j = 0; j < wrows; j++) {
        const wx = b.x + gx + i * (10 + gx);
        const wy = top + gy + j * (12 + gy);
        ctx.fillStyle = (i + j) % 3 === 0 ? "#fde68a" : b.windowsCol;
        ctx.fillRect(wx, wy, 10, 12);
        ctx.strokeStyle = "rgba(0,0,0,0.15)";
        ctx.lineWidth = 1;
        ctx.strokeRect(wx, wy, 10, 12);
      }
    }
  }

  function drawShark(ctx: CanvasRenderingContext2D, x: number, y: number) {
    const img = imgsRef.current.scooter;
    const w = 130, h = 100;
    if (img && img.complete && img.naturalWidth > 0) {
      // léger tilt si en l'air
      const s = stateRef.current;
      const tilt = !s.onGround ? Math.max(-0.18, Math.min(0.18, s.sharkVY * 0.0003)) : 0;
      ctx.save();
      ctx.translate(x, y - h / 2 + 8);
      ctx.rotate(tilt);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      ctx.restore();
    } else {
      ctx.fillStyle = "#ef4444";
      ctx.fillRect(x - 30, y - 30, 60, 30);
    }
  }

  function drawEntity(ctx: CanvasRenderingContext2D, e: Entity) {
    if (e.kind === "pizza") {
      const img = imgsRef.current.pizza;
      const bob = Math.sin(e.phase) * 3;
      const sz = 36;
      // halo
      const g = ctx.createRadialGradient(e.x + e.w / 2, e.y + e.h / 2 + bob, 2, e.x + e.w / 2, e.y + e.h / 2 + bob, sz);
      g.addColorStop(0, "rgba(251,191,36,0.5)");
      g.addColorStop(1, "rgba(251,191,36,0)");
      ctx.fillStyle = g;
      ctx.fillRect(e.x - 15, e.y - 15 + bob, e.w + 30, e.h + 30);
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, e.x - 4, e.y + bob - 4, sz, sz);
      } else {
        ctx.fillStyle = "#dc2626";
        ctx.fillRect(e.x, e.y + bob, e.w, e.h);
      }
    } else if (e.kind === "cone") {
      // plot orange
      ctx.fillStyle = "#f97316";
      ctx.beginPath();
      ctx.moveTo(e.x + e.w / 2, e.y);
      ctx.lineTo(e.x + e.w, e.y + e.h);
      ctx.lineTo(e.x, e.y + e.h);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillRect(e.x + 4, e.y + e.h * 0.45, e.w - 8, 5);
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(e.x - 4, e.y + e.h - 4, e.w + 8, 4);
    } else if (e.kind === "puddle") {
      // flaque
      ctx.fillStyle = "rgba(56,189,248,0.85)";
      ctx.beginPath();
      ctx.ellipse(e.x + e.w / 2, e.y + e.h / 2, e.w / 2, e.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(14,165,233,0.9)";
      ctx.lineWidth = 2;
      ctx.stroke();
      // reflet
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.beginPath();
      ctx.ellipse(e.x + e.w * 0.35, e.y + e.h * 0.35, e.w * 0.18, e.h * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (e.kind === "trash") {
      // poubelle
      ctx.fillStyle = "#475569";
      ctx.fillRect(e.x, e.y + 6, e.w, e.h - 6);
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(e.x - 3, e.y, e.w + 6, 8);
      ctx.fillStyle = "#94a3b8";
      ctx.fillRect(e.x + 4, e.y + 12, 3, e.h - 18);
      ctx.fillRect(e.x + e.w - 7, e.y + 12, 3, e.h - 18);
      // détritus
      ctx.fillStyle = "#84cc16";
      ctx.beginPath(); ctx.arc(e.x + e.w * 0.3, e.y + 4, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath(); ctx.arc(e.x + e.w * 0.7, e.y + 5, 2.5, 0, Math.PI * 2); ctx.fill();
    } else if (e.kind === "car") {
      // petite voiture
      // ombre
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath();
      ctx.ellipse(e.x + e.w / 2, e.y + e.h + 2, e.w / 2, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      // carrosserie
      const cy = e.y + e.h * 0.45;
      ctx.fillStyle = "#3b82f6";
      // base
      ctx.fillRect(e.x, cy, e.w, e.h * 0.4);
      // toit
      ctx.beginPath();
      ctx.moveTo(e.x + 18, cy);
      ctx.lineTo(e.x + 30, e.y + e.h * 0.1);
      ctx.lineTo(e.x + e.w - 25, e.y + e.h * 0.1);
      ctx.lineTo(e.x + e.w - 12, cy);
      ctx.closePath();
      ctx.fill();
      // vitres
      ctx.fillStyle = "#bae6fd";
      ctx.beginPath();
      ctx.moveTo(e.x + 22, cy - 2);
      ctx.lineTo(e.x + 32, e.y + e.h * 0.18);
      ctx.lineTo(e.x + e.w - 27, e.y + e.h * 0.18);
      ctx.lineTo(e.x + e.w - 16, cy - 2);
      ctx.closePath();
      ctx.fill();
      // phares
      ctx.fillStyle = "#fef3c7";
      ctx.fillRect(e.x - 2, cy + 4, 4, 8);
      // roues
      ctx.fillStyle = "#0f172a";
      ctx.beginPath(); ctx.arc(e.x + 18, e.y + e.h - 4, 8, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(e.x + e.w - 18, e.y + e.h - 4, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#cbd5e1";
      ctx.beginPath(); ctx.arc(e.x + 18, e.y + e.h - 4, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(e.x + e.w - 18, e.y + e.h - 4, 3, 0, Math.PI * 2); ctx.fill();
    } else if (e.kind === "customer") {
      drawCustomer(ctx, e);
    }
  }

  function drawCustomer(ctx: CanvasRenderingContext2D, e: Entity) {
    const x = e.x + e.w / 2;
    const baseY = e.y + e.h;
    const bounce = Math.abs(Math.sin(e.phase * 1.5)) * 4;
    const color = e.customerColor || "#fbbf24";

    // halo arc-en-ciel pulsé pour bien indiquer "client"
    const pulseR = 50 + Math.sin(e.phase * 2) * 6;
    const halo = ctx.createRadialGradient(x, baseY - 30, 5, x, baseY - 30, pulseR);
    halo.addColorStop(0, "rgba(255,255,255,0)");
    halo.addColorStop(0.7, `${color}55`);
    halo.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(x - pulseR, baseY - 30 - pulseR, pulseR * 2, pulseR * 2);

    // Petit animal stylisé (corps rond)
    const bodyY = baseY - 28 - bounce;
    // ombre
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.beginPath();
    ctx.ellipse(x, baseY - 2, 18, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    // corps
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, bodyY, 22, 26, 0, 0, Math.PI * 2);
    ctx.fill();
    // ventre
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.ellipse(x, bodyY + 6, 12, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    // oreilles
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x - 14, bodyY - 18, 6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 14, bodyY - 18, 6, 0, Math.PI * 2); ctx.fill();
    // yeux
    ctx.fillStyle = "#0f172a";
    ctx.beginPath(); ctx.arc(x - 7, bodyY - 4, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 7, bodyY - 4, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(x - 6, bodyY - 5, 1, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 8, bodyY - 5, 1, 0, Math.PI * 2); ctx.fill();
    // sourire
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, bodyY + 2, 4, 0.2, Math.PI - 0.2);
    ctx.stroke();
    // bras levés (qui demandent une pizza)
    ctx.fillStyle = color;
    const armWave = Math.sin(e.phase * 4) * 3;
    ctx.beginPath();
    ctx.ellipse(x - 22, bodyY - 4 + armWave, 5, 9, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x + 22, bodyY - 4 - armWave, 5, 9, 0.3, 0, Math.PI * 2);
    ctx.fill();

    // Bulle "🍕?" au-dessus
    const bx = x, by = e.y - 10;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.ellipse(bx, by, 18, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // pointe
    ctx.beginPath();
    ctx.moveTo(bx - 4, by + 12);
    ctx.lineTo(bx, by + 20);
    ctx.lineTo(bx + 4, by + 12);
    ctx.closePath();
    ctx.fillStyle = "#fff"; ctx.fill();
    ctx.stroke();
    // emoji
    ctx.font = "16px system-ui";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "#0f172a";
    ctx.fillText("🍕", bx, by + 1);
  }

  function drawPizzaStack(ctx: CanvasRenderingContext2D, x: number, y: number, count: number) {
    if (count <= 0) return;
    // mini pile de pizzas au-dessus du requin
    for (let i = 0; i < count; i++) {
      const py = y - i * 7;
      ctx.fillStyle = "#dc2626";
      ctx.fillRect(x - 12, py, 24, 6);
      ctx.fillStyle = "#fff";
      for (let j = 0; j < 3; j++) {
        ctx.fillRect(x - 10 + j * 8, py + 1, 4, 4);
      }
      ctx.strokeStyle = "rgba(0,0,0,0.4)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 12, py, 24, 6);
    }
  }

  const restart = () => {
    const s = stateRef.current;
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    s.sharkX = rect.width * 0.22;
    s.sharkY = rect.height * GROUND_RATIO;
    s.sharkVY = 0;
    s.onGround = true;
    s.jumpHold = 0;
    s.jumping = false;
    s.speed = 280;
    s.distance = 0;
    s.score = 0;
    s.pizzas = 0;
    s.delivered = 0;
    s.combo = 0;
    s.timeLeft = ROUND_DURATION;
    s.invuln = 0;
    s.shake = 0;
    s.gameOver = false;
    s.started = true;
    s.entities = [];
    s.spawnTimer = 0;
    s.customerTimer = 6;
    s.floatTexts = [];
    s.flash = 0;
    setGameOver(false);
    setScore(0); setPizzas(0); setDelivered(0); setCombo(0);
    setTimeLeft(ROUND_DURATION);
    setStarted(true);
  };

  /* UI */
  const timeColor =
    timeLeft > 30 ? "from-emerald-400 to-emerald-600" :
    timeLeft > 15 ? "from-amber-400 to-orange-500" :
    "from-red-500 to-red-700";

  return (
    <div className="fixed inset-0 bg-orange-200 overflow-hidden select-none">
      {/* Top HUD */}
      <div className="absolute top-3 left-3 right-3 z-20 flex items-center justify-between pointer-events-none">
        <Link
          to="/games"
          className="pointer-events-auto w-9 h-9 flex items-center justify-center rounded-full bg-black/40 backdrop-blur-md text-white hover:bg-black/60"
          aria-label="Retour"
        >
          <ArrowLeft size={18} />
        </Link>
        <div className="flex items-center gap-1.5 text-white text-xs font-bold">
          <span className="px-2.5 py-1 rounded-full bg-black/45 backdrop-blur-md flex items-center gap-1">
            <Trophy size={12} className="text-yellow-300" /> {score}
          </span>
          <span className="px-2.5 py-1 rounded-full bg-emerald-500/80 backdrop-blur-sm flex items-center gap-1">
            🚚 {delivered}
          </span>
          <span className="px-2.5 py-1 rounded-full bg-amber-500/80 backdrop-blur-sm flex items-center gap-1">
            <Pizza size={12} /> {pizzas}/{MAX_PIZZAS}
          </span>
        </div>
        <div className="w-9" />
      </div>

      {/* Timer bar */}
      <div className="absolute top-12 left-4 right-4 z-20 pointer-events-none">
        <div className="flex items-center gap-2">
          <Clock size={12} className="text-white drop-shadow" />
          <div className="flex-1 h-2.5 bg-black/40 rounded-full overflow-hidden backdrop-blur-sm">
            <div
              className={`h-full bg-gradient-to-r ${timeColor} transition-all duration-150`}
              style={{ width: `${(timeLeft / ROUND_DURATION) * 100}%` }}
            />
          </div>
          <span className="text-white text-[11px] font-bold drop-shadow w-7 text-right">{timeLeft}s</span>
        </div>
        {combo > 1 && (
          <div className="text-center text-yellow-300 text-xs font-black mt-1 drop-shadow animate-pulse">
            🔥 Combo x{combo}
          </div>
        )}
      </div>

      {/* High score badge */}
      <div className="absolute bottom-3 left-3 z-20 px-2.5 py-1 rounded-full bg-black/45 text-amber-200 text-[10px] font-semibold backdrop-blur-sm">
        🏆 Record : {highScore}
      </div>

      {/* Help bottom */}
      {started && !gameOver && (
        <div className="absolute bottom-3 right-3 z-20 px-2.5 py-1 rounded-full bg-black/45 text-white/80 text-[10px] font-semibold backdrop-blur-sm">
          Tap = saut
        </div>
      )}

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full touch-none"
      />

      {/* Game over */}
      {gameOver && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-gradient-to-b from-orange-500 to-red-600 border-2 border-yellow-300 rounded-2xl p-6 max-w-sm w-full mx-4 text-center text-white shadow-2xl">
            <div className="text-5xl mb-2">{delivered >= 10 ? "🏆" : delivered >= 5 ? "🍕" : "🛵"}</div>
            <h2 className="text-3xl font-black mb-1">
              {timeLeft <= 0 ? "Temps écoulé !" : "Partie terminée"}
            </h2>
            <p className="text-yellow-100 text-sm mb-4">
              {delivered >= 10 ? "Livreur d'élite !" : delivered >= 5 ? "Bonne tournée !" : "On retente ?"}
            </p>
            <div className="space-y-1 mb-4 bg-black/20 rounded-xl p-3">
              <p className="text-white">Score : <span className="font-bold text-2xl text-yellow-200">{score}</span></p>
              <p className="text-emerald-200">🚚 Livraisons : <span className="font-bold">{delivered}</span></p>
            </div>
            {score >= highScore && score > 0 && (
              <p className="text-yellow-200 font-bold mb-3 animate-pulse">🌟 Nouveau record !</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={restart}
                className="flex-1 py-3 bg-yellow-400 text-orange-900 hover:bg-yellow-300 rounded-lg font-black"
              >
                Rejouer
              </button>
              <Link
                to="/games"
                className="flex-1 py-3 bg-black/30 hover:bg-black/40 rounded-lg font-bold flex items-center justify-center"
              >
                Menu
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
