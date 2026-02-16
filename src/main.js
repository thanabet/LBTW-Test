import { SceneEngine } from "./scene/sceneEngine.js";
import { HudEngine } from "./hud/hudEngine.js";
import { StoryEngine } from "./story/storyEngine.js";

async function loadJSON(url){
  const res = await fetch(url, { cache: "no-store" });
  if(!res.ok) throw new Error(`Failed to load ${url}`);
  return await res.json();
}

/**
 * ✅ Fix: iOS/LINE in-app browser bar
 * ใช้ visualViewport.height เพื่อให้เต็ม "พื้นที่ที่มองเห็นได้จริง"
 */
function setVisualViewportHeight(){
  const vv = window.visualViewport;
  const h = vv ? vv.height : window.innerHeight;
  document.documentElement.style.setProperty("--vvh", `${h * 0.01}px`);
}

async function boot(){
  // set vv height now + listen changes (bar show/hide)
  setVisualViewportHeight();
  if(window.visualViewport){
    window.visualViewport.addEventListener("resize", setVisualViewportHeight);
    window.visualViewport.addEventListener("scroll", setVisualViewportHeight);
  }
  window.addEventListener("resize", setVisualViewportHeight);

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

  // ✅ รีคำนวณตำแหน่งทุกครั้งที่ viewport เปลี่ยน (รวมตอนแถบล่างโชว์/หาย)
  const reflow = () => {
    setVisualViewportHeight();
    scene.resize();
    hud.resize();
  };

  window.addEventListener("resize", reflow);
  if(window.visualViewport){
    window.visualViewport.addEventListener("resize", reflow);
    window.visualViewport.addEventListener("scroll", reflow);
  }

  scene.resize();
  hud.resize();
}

boot().catch(err => {
  console.error(err);
  document.body.style.background = "#111";
});
