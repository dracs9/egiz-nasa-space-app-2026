import { t as localizeText, useLanguage } from '../i18n';
import { useEffect, useRef } from "react";
import * as T from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { makeVehicle } from "./scene/vehicles";
import type { Scenario } from "./types";
/** Orthographic drawing projected directly from the configured scene rig. */
export function VehicleSchematic({ scenario, onInspect }: { scenario: Scenario; onInspect?():void }) {
  useLanguage();
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    const rig = makeVehicle(scenario.mode, scenario.rover.design);
    rig.root.updateMatrixWorld(true);
    const bounds = new T.Box3().setFromObject(rig.root),
      size = bounds.getSize(new T.Vector3()),
      center = bounds.getCenter(new T.Vector3());
    const camera = new T.OrthographicCamera(
      -size.length() * 0.55,
      size.length() * 0.55,
      size.length() * 0.44,
      -size.length() * 0.44,
      0.1,
      100,
    );
    camera.position.copy(center).add(new T.Vector3(8, 5, -10));
    camera.lookAt(center);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    context.clearRect(0, 0, 520, 360);
    const geometries = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>(),
      textures = new Set<T.Texture>();
    const scene = new T.Scene();
    scene.add(rig.root);
    let renderer: T.WebGLRenderer;
    try {
      renderer = new T.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      context.fillStyle = "#a29d91";
      context.font = "16px monospace";
      context.fillText("Technical preview unavailable", 35, 180);
      rig.root.traverse((object) => {
        if (object instanceof T.Mesh) {
          object.geometry.dispose();
          for (const m of Array.isArray(object.material)
            ? object.material
            : [object.material]) {
            for (const value of Object.values(m))
              if (value instanceof T.Texture) value.dispose();
            m.dispose();
          }
        }
      });
      return;
    }
    renderer.setSize(520, 360);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = T.SRGBColorSpace;
    scene.add(new T.AmbientLight("#b2a484", 2));
    const light = new T.DirectionalLight("#fff0d8", 3);
    light.position.set(5, 8, -8);
    scene.add(light);
    const room=new RoomEnvironment(),pmrem=new T.PMREMGenerator(renderer),env=pmrem.fromScene(room,.04);
    scene.environment=env.texture;scene.environmentIntensity=.8;
    room.dispose();pmrem.dispose();
    renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
    rig.root.traverse(object=>{if(object instanceof T.Mesh){geometries.add(object.geometry);for(const m of Array.isArray(object.material)?object.material:[object.material])materials.add(m);}});
    renderer.render(scene, camera);
    context.drawImage(renderer.domElement, 0, 0, 520, 360);
    env.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    for (const m of materials) {
      for (const value of Object.values(m))
        if (value instanceof T.Texture) textures.add(value);
      m.dispose();
    }
    textures.forEach((t) => t.dispose());
    geometries.forEach((g) => g.dispose());
  }, [scenario.mode, scenario.rover.design]);
  const surface = scenario.mode === "rover" || scenario.mode === "eva";
  return (
    <div className="ex-schematic">
      <div className="ex-overline">
        <span>02</span>{localizeText(" ")}
        {localizeText(scenario.mode === "rover"
          ? "SURFACE EXPLORER"
          : scenario.mode === "launch"
            ? "LAUNCH VEHICLE"
            : scenario.mode === "descent"
              ? "DESCENT MODULE"
              : "FIELD SYSTEM")}
      </div>
      <button type="button" className="ex-schematic-image" title={localizeText("Inspect equipment in 3D")} aria-label={localizeText("Inspect equipment in 3D")} onClick={onInspect}>
        <canvas
          ref={canvas}
          width="520"
          height="360"
          aria-label={localizeText(`${scenario.mode} technical drawing derived from the 3D vehicle model`)}
        />
        <span>{localizeText("EGIZ /")}{localizeText(" ")}
          {localizeText(scenario.mode === "rover"
            ? "R–01"
            : scenario.mode === "launch"
              ? "LV–01"
              : scenario.mode === "descent"
                ? "D–01"
                : "EVA–01")}
        </span>
        <i>{localizeText("ENGINEERING DEMONSTRATOR")}</i>
      </button>
      <dl>
        <div>
          <dt>{localizeText(surface ? "Configured mass" : "Dry mass")}</dt>
          <dd>{localizeText(surface ? scenario.rover.mass : scenario.vehicle.dryMass)}{localizeText(" kg")}</dd>
        </div>
        <div>
          <dt>{localizeText(surface ? "Energy budget" : "Propellant")}</dt>
          <dd>
            {localizeText(surface ? scenario.rover.batteryWh : scenario.vehicle.fuel)}{localizeText(" ")}
            {localizeText(surface ? "Wh" : "kg")}
          </dd>
        </div>
        <div>
          <dt>{localizeText(surface ? "Cruise speed" : "Rated thrust")}</dt>
          <dd>
            {localizeText(surface ? scenario.rover.speed : scenario.vehicle.thrust / 1000)}{localizeText(" ")}
            {localizeText(surface ? "m/s" : "kN")}
          </dd>
        </div>
      </dl>
    </div>
  );
}
