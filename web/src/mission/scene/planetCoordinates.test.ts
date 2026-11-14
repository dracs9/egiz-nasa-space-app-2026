import { expect, it } from "vitest";
import { SphereGeometry, Vector3 } from "three";
import { planetPoint, planetUV, enuToPlanet } from "./planetCoordinates";
import { cinematicAngle } from "./camera";
it("places east-positive longitudes on the equirectangular sphere without mirroring", () => {
  const geometry = new SphereGeometry(1, 32, 16),
    uv = geometry.getAttribute("uv"),
    position = geometry.getAttribute("position");
  for (let i = 33; i < position.count - 33; i++) {
    const lat = uv.getY(i) * 180 - 90,
      lon = uv.getX(i) * 360 - 180;
    expect(
      planetPoint(lat, lon).distanceTo(
        new Vector3().fromBufferAttribute(position, i),
      ),
    ).toBeLessThan(0.000001);
  }
  geometry.dispose();
});
it("keeps poles and dateline continuous, with radius explicitly separate from DEM metres", () => {
  expect(planetPoint(90, 72, 3).toArray()[1]).toBeCloseTo(3);
  expect(planetPoint(0, 180).distanceTo(planetPoint(0, -180))).toBeLessThan(
    1e-10,
  );
  expect(planetPoint(18.4446, 77.4509).length()).toBeCloseTo(1);
  expect(planetUV(0, 0)).toEqual({ u: 0.5, v: 0.5 });
  expect(planetUV(0, 180).u).toBe(0);
});
it("reproduces cinematic camera framing when seeking backward and forward", () => {
  const first = cinematicAngle(27.4, false);
  cinematicAngle(99, false);
  expect(cinematicAngle(27.4, false)).toBe(first);
  expect(cinematicAngle(-1, true)).toBe(cinematicAngle(0, true));
});
it("transforms SPICE local solar ENU to the globe without mirroring north or east",()=>{
  for(const [lat,lon] of [[0,0],[18.4446,77.4509],[-85.4,31.7]]) {
    const up=planetPoint(lat,lon);
    expect(enuToPlanet(lat,lon,[0,0,1]).distanceTo(up)).toBeLessThan(1e-12);
    expect(enuToPlanet(lat,lon,[1,0,0]).dot(up)).toBeCloseTo(0,12);
    expect(enuToPlanet(lat,lon,[0,1,0]).dot(up)).toBeCloseTo(0,12);
  }
  expect(enuToPlanet(0,0,[1,0,0]).distanceTo(new Vector3(0,0,-1))).toBeLessThan(1e-12);
});
