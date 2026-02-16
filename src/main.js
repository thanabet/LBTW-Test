import { SceneEngine } from "./scene/sceneEngine.js";
import { HudEngine } from "./hud/hudEngine.js";
import { StoryEngine } from "./story/storyEngine.js";

const TEMPLATE_W = 1595;
const TEMPLATE_H = 3457;
const RATIO = TEMPLATE_H / TEMPLATE_W; // ~2.167

async function loadJSON(url){
  const res = await fetch(url, { cache: "no-store" });
  if(!res.ok) throw new Error(`Failed to load ${url}`);
  return await res.json();
}

/** ✅ แก้ iOS/LINE bar: ใช้ visualViewport */
function setVisualViewportHeight(){
  const vv = window.visualViewport;
  const h = vv ? vv.height : window.innerHeight;
  document.documentElement.style.setProperty("--vvh", `${h * 0.01}px`);
}

/**
 * ✅ คำนวณ stage ตาม ratio จริง
 * - stage width = 100vw
 * - stage height = vw * ratio
 * - stage-y = จัดให้ “เห็นด้านล่าง (IN THE ROOM)” มากที่สุด = align bottom
 */
function setStageByRatio(){
  const vw = window.innerWidth;
  const vh = (window.visualViewport ? window.visualViewport.height : window.innerHeight);

  const stageH = vw * RATIO;
  document.documentElement.style.setProperty("--stage-h", `${stageH}px`);

  // align bottom (โชว์ IN THE ROOM ให้มากที่สุด)
  const y = Math.min(0, vh - stageH);
  document.documentElement.style.setProperty("--stage-y", `${y}px`);
}

async function boot(){
  setVisualViewportHeight();
  setStageByRatio();

  if(window.visualViewport){
    window.visualViewport.addEventListener("resize", () => {
      setVisualViewportHeight();
      setStageByRatio();
      reflow();
    });
    window.visualViewport.addEventListener("scroll", () => {
      setVisualViewportHeight();
      setStageByRatio();
      reflow();
    });
  }
  window.addEventListener("resize", () => {
    setVisualViewportHeight();
    setStageByRatio();
    reflow();
  });

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

  function reflow(){
    scene.resize();
    hud.resize();
  }

  reflow();
}

boot().catch(err => {
  console.error(err);
  document.body.style.background = "#111";
});
