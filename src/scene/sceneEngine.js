import { SkyManager } from "./skyManager.js";
import { CloudManager } from "./cloudManager.js";
import { RainManager } from "./rainManager.js";
import { RoomManager } from "./roomManager.js";

export class SceneEngine {
  constructor({ hostEl, sceneLayout }){
    this.hostEl = hostEl;
    this.layout = sceneLayout;

    this.app = null;

    // layer containers
    this.skyContainer = null;
    this.cloudContainer = null;
    this.roomContainer = null;
    this.rainContainer = null;

    // managers
    this.sky = null;
    this.clouds = null;
    this.room = null;
    this.rain = null;

    this.sceneRectPx = null;

    // reuse mask graphic (กันสะสม)
    this._maskG = null;
  }

  _percentRectToPx(rectPct, w, h){
    return {
      x: (rectPct.x/100) * w,
      y: (rectPct.y/100) * h,
      w: (rectPct.w/100) * w,
      h: (rectPct.h/100) * h
    };
  }

  async _ensureApp(){
    if(this.app) return;

    this.app = new PIXI.Application();
    await this.app.init({
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.max(1, window.devicePixelRatio || 1),
      autoDensity: true
    });

    this.hostEl.appendChild(this.app.canvas);

    // Create layer containers in the correct order:
    // Sky -> Clouds -> Room -> Rain/Lightning (TOP)
    this.skyContainer = new PIXI.Container();
    this.cloudContainer = new PIXI.Container();
    this.roomContainer = new PIXI.Container();
    this.rainContainer = new PIXI.Container();

    this.app.stage.addChild(
      this.skyContainer,
      this.cloudContainer,
      this.roomContainer,
      this.rainContainer
    );
  }

  // ✅ รองรับ 2 แบบ:
  // 1) initSky([urls]) แบบเดิม
  // 2) initSky({ urls, keyframes }) แบบใหม่
  async initSky(arg){
    await this._ensureApp();

    this.sky = new SkyManager(this.skyContainer);

    if(Array.isArray(arg)){
      await this.sky.load({ urls: arg });
    }else{
      await this.sky.load(arg);
    }
  }

  async initClouds(cloudCfg){
    await this._ensureApp();
    this.clouds = new CloudManager(this.cloudContainer);
    await this.clouds.loadConfig(cloudCfg);
  }

  async initRoom(roomCfg){
    await this._ensureApp();
    this.room = new RoomManager(this.roomContainer);
    await this.room.load(roomCfg);
  }

  async initRain(rainCfg){
    await this._ensureApp();
    this.rain = new RainManager(this.rainContainer);
    await this.rain.load(rainCfg);
  }

  resize(){
    if(!this.app) return;

    const rect = this.hostEl.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    this.app.renderer.resize(w, h);

    this.sceneRectPx = this._percentRectToPx(this.layout.sceneRect, w, h);

    // mask เฉพาะพื้นที่ scene (reuse)
    if(!this._maskG){
      this._maskG = new PIXI.Graphics();
      this.app.stage.addChild(this._maskG);
      this.app.stage.mask = this._maskG;
    }

    this._maskG.clear();
    this._maskG.rect(this.sceneRectPx.x, this.sceneRectPx.y, this.sceneRectPx.w, this.sceneRectPx.h);
    this._maskG.fill({ color: 0xffffff, alpha: 1 });

    if(this.sky) this.sky.resizeToRect(this.sceneRectPx);
    if(this.clouds) this.clouds.resizeToRect(this.sceneRectPx);
    if(this.room) this.room.resizeToRect(this.sceneRectPx);
    if(this.rain) this.rain.resizeToRect(this.sceneRectPx);
  }

  // For backwards compat
  updateSkyByTime(now){
    if(!this.sky) return;
    this.sky.updateByTime(now);
  }

  // Avoid fade-in on refresh (clouds)
  setInitialCloudProfile(profileName){
    if(!this.clouds) return;
    this.clouds.setProfile(profileName);
  }

  // Avoid fade-in on refresh (room)
  setInitialRoomState(now, storyState){
    if(!this.room) return;
    this.room.setInitial(now, storyState);
  }

  update(now, dtSec, storyState){
    // --- Sky ---
    if(this.sky) this.sky.updateByTime(now);

    // --- Clouds ---
    if(this.clouds){
      const profile =
        storyState?.cloudProfile ??
        storyState?.state?.cloudProfile ??
        "none";
      this.clouds.setProfile(profile);
      this.clouds.update(now, dtSec);
    }

    // --- Room (time + story light) ---
    if(this.room){
      this.room.update(now, dtSec, storyState);
    }

    // --- Rain + Lightning (TOP) ---
    if(this.rain){
      const profile =
        storyState?.cloudProfile ??
        storyState?.state?.cloudProfile ??
        "none";
      const raining = (profile === "overcast");

      this.rain.setEnabled(raining);
      this.rain.update(now, dtSec);
    }
  }
}