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
  // top limit: ไม่ให้ขอบบนลงมาจนเห็นพื้นหลัง
  y = Math.min(0, y);
  // bottom limit: ไม่ให้ขอบล่างยกขึ้นจนเห็นพื้นหลัง
  y = Math.max(vh - stageH, y);

  document.documentElement.style.setProperty("--stage-y", `${y}px`);
}

async function boot(){
  setVisualViewportHeight();
  setStageByRatio();

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

  await scene.initSky([
    "./assets/sky/sky_01.png",
    "./assets/sky/sky_02.png",
    "./assets/sky/sky_03.png",
    "./assets/sky/sky_04.png",
    "./assets/sky/sky_05.png"
  ]);

  function tick(){
    const now = new Date();

    scene.updateSkyByTime(now);

    const nextState = story.computeStateAt(now);
    hud.setState(nextState);

    hud.setCalendar(now);
    hud.setClockHands(now);

    requestAnimationFrame(tick);
  }
  tick();

  // first layout
  scene.resize();
  hud.resize();
}

boot().catch(err => {
  console.error(err);
  document.body.style.background = "#111";
});




