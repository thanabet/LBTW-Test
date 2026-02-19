import { SkyManager } from "./skyManager.js";
import { CloudManager } from "./cloudManager.js";

// ✅ ปรับความยาว fade ตรงนี้ (วินาที)
const CLOUD_PROFILE_FADE_SEC = 60.0;

export class SceneEngine {
  constructor({ hostEl, sceneLayout }){
    this.hostEl = hostEl;
    this.layout = sceneLayout;

    this.app = null;

    this.sky = null;

    // cloud containers
    this.cloudContainer = null;
    this.cloudLayerA = null;
    this.cloudLayerB = null;

    // two cloud managers (for crossfade)
    this.cloudsA = null;
    this.cloudsB = null;

    this._activeCloud = "A"; // "A" or "B"

    // ✅ IMPORTANT: track current vs target to prevent restarting fade every frame
    this._currentCloudProfile = "none"; // currently visible profile
    this._targetCloudProfile = "none";  // target profile during fade

    this._xfading = false;
    this._fadeT = 0;
    this._fadeDur = CLOUD_PROFILE_FADE_SEC;

    this.skyContainer = null;
    this.sceneRectPx = null;

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

  async _ensurePixi(){
    if(this.app) return;

    this.app = new PIXI.Application();
    await this.app.init({
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.max(1, window.devicePixelRatio || 1),
      autoDensity: true
    });

    this.hostEl.appendChild(this.app.canvas);

    // stage layers
    this.skyContainer = new PIXI.Container();
    this.cloudContainer = new PIXI.Container();

    this.app.stage.addChild(this.skyContainer);
    this.app.stage.addChild(this.cloudContainer);

    // ✅ 2 alpha layers for clouds
    this.cloudLayerA = new PIXI.Container();
    this.cloudLayerB = new PIXI.Container();
    this.cloudContainer.addChild(this.cloudLayerA);
    this.cloudContainer.addChild(this.cloudLayerB);

    // initial visibility
    this.cloudLayerA.alpha = 1;
    this.cloudLayerB.alpha = 0;
  }

  async initSky(arg){
    await this._ensurePixi();

    this.sky = new SkyManager(this.skyContainer);

    // support: initSky([urls]) or initSky({urls,keyframes,mode})
    if(Array.isArray(arg)){
      await this.sky.load({ urls: arg });
    } else {
      await this.sky.load(arg);
    }
  }

  async initClouds(cloudConfig){
    await this._ensurePixi();

    // create two managers so we can crossfade between profiles
    this.cloudsA = new CloudManager(this.cloudLayerA);
    this.cloudsB = new CloudManager(this.cloudLayerB);

    await this.cloudsA.loadConfig(cloudConfig);
    await this.cloudsB.loadConfig(cloudConfig);

    // start safe
    this.cloudsA.setProfile("none");
    this.cloudsB.setProfile("none");

    this._activeCloud = "A";
    this._currentCloudProfile = "none";
    this._targetCloudProfile = "none";
    this._xfading = false;
    this._fadeT = 0;
    this._fadeDur = CLOUD_PROFILE_FADE_SEC;

    // if already resized, apply rect
    if(this.sceneRectPx){
      this.cloudsA.resizeToRect(this.sceneRectPx);
      this.cloudsB.resizeToRect(this.sceneRectPx);
    }
  }

  _normalizeProfile(p){
    const s = (p && String(p).trim()) ? String(p).trim() : "none";
    return s;
  }

  _easeInOut(t){
    // smoothstep
    return t*t*(3 - 2*t);
  }

  // ✅ Start a smooth transition only when target actually changes
  _transitionCloudProfile(nextProfile){
    if(!this.cloudsA || !this.cloudsB) return;

    const next = this._normalizeProfile(nextProfile);

    // If we're already aiming for this target, do nothing.
    // (This is the key fix that makes 60 sec fade actually work.)
    if(next === this._targetCloudProfile) return;

    this._targetCloudProfile = next;

    const front = (this._activeCloud === "A")
      ? { layer: this.cloudLayerA, mgr: this.cloudsA }
      : { layer: this.cloudLayerB, mgr: this.cloudsB };

    const back = (this._activeCloud === "A")
      ? { layer: this.cloudLayerB, mgr: this.cloudsB }
      : { layer: this.cloudLayerA, mgr: this.cloudsA };

    // load new profile into the back layer
    back.mgr.setProfile(next);
    if(this.sceneRectPx) back.mgr.resizeToRect(this.sceneRectPx);

    // start fade from current visual state
    back.layer.alpha = 0;
    front.layer.alpha = 1;

    this._xfading = true;
    this._fadeT = 0;
    this._fadeDur = CLOUD_PROFILE_FADE_SEC;
  }

  resize(){
    if(!this.app) return;

    const rect = this.hostEl.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    this.app.renderer.resize(w, h);

    this.sceneRectPx = this._percentRectToPx(this.layout.sceneRect, w, h);

    // mask only scene rect
    if(!this._maskG){
      this._maskG = new PIXI.Graphics();
      this.app.stage.addChild(this._maskG);
      this.app.stage.mask = this._maskG;
    }

    this._maskG.clear();
    this._maskG.rect(this.sceneRectPx.x, this.sceneRectPx.y, this.sceneRectPx.w, this.sceneRectPx.h);
    this._maskG.fill({ color: 0xffffff, alpha: 1 });

    if(this.sky) this.sky.resizeToRect(this.sceneRectPx);

    if(this.cloudsA) this.cloudsA.resizeToRect(this.sceneRectPx);
    if(this.cloudsB) this.cloudsB.resizeToRect(this.sceneRectPx);
  }

  update(now, dtSec, storyState){
    // sky always updates by time
    if(this.sky) this.sky.updateByTime(now);

    // read cloudProfile from either flat or nested shape
    const profile =
      storyState?.cloudProfile ??
      storyState?.state?.cloudProfile ??
      "none";

    // start transition if needed
    this._transitionCloudProfile(profile);

    // update both managers so motion continues during fade
    if(this.cloudsA) this.cloudsA.update(now, dtSec);
    if(this.cloudsB) this.cloudsB.update(now, dtSec);

    // handle crossfade alpha
    if(this._xfading){
      this._fadeT += dtSec;

      const dur = Math.max(0.001, this._fadeDur);
      const t = Math.max(0, Math.min(1, this._fadeT / dur));
      const s = this._easeInOut(t);

      // fade from active -> inactive
      if(this._activeCloud === "A"){
        this.cloudLayerA.alpha = 1 - s;
        this.cloudLayerB.alpha = s;
      } else {
        this.cloudLayerB.alpha = 1 - s;
        this.cloudLayerA.alpha = s;
      }

      if(t >= 1){
        // finalize
        this._xfading = false;

        // swap active layer
        this._activeCloud = (this._activeCloud === "A") ? "B" : "A";

        // now the target becomes current
        this._currentCloudProfile = this._targetCloudProfile;

        // snap alphas
        if(this._activeCloud === "A"){
          this.cloudLayerA.alpha = 1;
          this.cloudLayerB.alpha = 0;
        } else {
          this.cloudLayerB.alpha = 1;
          this.cloudLayerA.alpha = 0;
        }
      }
    }
  }
}