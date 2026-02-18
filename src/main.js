import { SceneEngine } from "./scene/sceneEngine.js";
import { HudEngine } from "./hud/hudEngine.js";
import { StoryEngine } from "./story/storyEngine.js";

const TEMPLATE_W = 1595;
const TEMPLATE_H = 3457;
const RATIO = TEMPLATE_H / TEMPLATE_W; // ~2.167

// ✅ ปรับค่าเดียวนี้เพื่อ “เลื่อน template ลง/ขึ้น”
// + = เลื่อนลง (เพิ่มพื้นที่ท้องฟ้า/ครึ่งบนยาวขึ้น)
// - = เลื่อนขึ้น (โชว์ in-room มากขึ้น)
const STAGE_Y_OFFSET_PX = 20;

async function loadJSON(url){
  const res = await fetch(url, { cache: "no-store" });
  if(!res.ok) throw new Error(`Failed to load ${url}`);
  return await res.json();
}

function setVisualViewportHeight(){
  const vv = window.visualViewport;
  const h = vv ? vv.height : window.innerHeight;
  document.documentElement.style.setProperty("--vvh", `${h * 0.01}px`);
}

/**
 * ✅ จัด stage แบบ “กึ่งกลาง” แล้วค่อย offset ตามใจพี่มี่
 * - base: center (ทำให้รู้สึกใกล้ 50/50)
 * - offset: ปรับ framing ตามต้องการ
 */
function setStageByRatio(){
  const vw = window.innerWidth;
  const vh = (window.visualViewport ? window.visualViewport.height : window.innerHeight);

  const stageH = vw * RATIO;
  document.documentElement.style.setProperty("--stage-h", `${stageH}px`);

  // base = center
  let y = (vh - stageH) / 2;

  // apply offset
  y += STAGE_Y_OFFSET_PX;

  // clamp ไม่ให้เลื่อนจนเห็นขอบว่าง
  y = Math.min(0, y);
  y = Math.max(vh - stageH, y);

  document.documentElement.style.setProperty("--stage-y", `${y}px`);
}

async function boot(){
  setVisualViewportHeight();
  setStageByRatio();

  const sceneLayout = await loadJSON("./data/scene_layout.json");
  const hudLayout = await loadJSON("./data/hud_layout.json");

  const scene = new SceneEngine({
    hostEl: document.getElementById("scene-host"),
    sceneLayout
  });

  const hud = new HudEngine({
    overlayEl: document.getElementById("overlay"),
    hudLayout
  });

  const story = new StoryEngine({
    storyUrl: "./data/story/2026-02-14.json"
  });

  await story.init();

  hud.setState(story.getCurrentState());
  hud.enableDialogueToggle(() => hud.toggleDialogueLang());

  const reflow = () => {
    setVisualViewportHeight();
    setStageByRatio();
    scene.resize();
    hud.resize();
  };

  if(window.visualViewport){
    window.visualViewport.addEventListener("resize", reflow);
    window.visualViewport.addEventListener("scroll", reflow);
  }
  window.addEventListener("resize", reflow);

  // --- SKY (keyframes) ---
  const skyCfg = await loadJSON("./data/sky_config.json");
  const urls = [...new Set(skyCfg.keyframes.map(k => k.src))];

  await scene.initSky({
    urls,
    keyframes: skyCfg.keyframes,
    mode: "keyframes"
  });

  // --- CLOUDS (profiles + 2 layers) ---
  const cloudCfg = await loadJSON("./data/cloud_config.json");
  await scene.initClouds(cloudCfg);

  // first layout
  scene.resize();
  hud.resize();

  let lastTs = performance.now();

  function tick(){
    const now = new Date();
    const ts = performance.now();
    const dtSec = Math.min(0.05, (ts - lastTs) / 1000); // clamp กันกระตุก
    lastTs = ts;

    const nextState = story.computeStateAt(now);

    // ✅ scene update (sky + clouds)
    scene.update(now, dtSec, nextState);

    // HUD (ของเดิม)
    hud.setState(nextState);
    hud.setCalendar(now);
    hud.setClockHands(now);

    requestAnimationFrame(tick);
  }
  tick();
}

boot().catch(err => {
  console.error(err);
  document.body.style.background = "#111";
});
