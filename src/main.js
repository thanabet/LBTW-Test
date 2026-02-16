import { SceneEngine } from "./scene/sceneEngine.js";
import { HudEngine } from "./hud/hudEngine.js";
import { StoryEngine } from "./story/storyEngine.js";

async function loadJSON(url){
  const res = await fetch(url, { cache: "no-store" });
  if(!res.ok) throw new Error(`Failed to load ${url}`);
  return await res.json();
}

async function boot(){
  // Load layouts
  const sceneLayout = await loadJSON("./data/scene_layout.json");
  const hudLayout = await loadJSON("./data/hud_layout.json");

  // Engines
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

  // Wire: story -> hud
  await story.init();
  hud.setState(story.getCurrentState());
  hud.enableDialogueToggle(() => {
    hud.toggleDialogueLang();
  });

  // Sky manager in scene (5 images)
  await scene.initSky([
    "./assets/sky/sky_01.png",
    "./assets/sky/sky_02.png",
    "./assets/sky/sky_03.png",
    "./assets/sky/sky_04.png",
    "./assets/sky/sky_05.png"
  ]);

  // Tick loop
  function tick(){
    const now = new Date();

    // update sky by real time
    scene.updateSkyByTime(now);

    // story state by time (today only for now)
    const nextState = story.computeStateAt(now);
    hud.setState(nextState);

    // realtime clock + calendar
    hud.setCalendar(now);
    hud.setClockHands(now);

    requestAnimationFrame(tick);
  }
  tick();

  // Reflow on resize/orientation
  window.addEventListener("resize", () => {
    scene.resize();
    hud.resize();
  });

  // initial layout
  scene.resize();
  hud.resize();
}

boot().catch(err => {
  console.error(err);
  // Fallback: ถ้า scene พัง อย่างน้อย HUD ต้องไม่จอดำ
  document.body.style.background = "#111";
});
