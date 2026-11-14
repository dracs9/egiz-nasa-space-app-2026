import { Vector3 } from "three";
/** Planet-fixed, east-positive longitude; matches the equirectangular texture UVs.
 * This normalized context frame is deliberately separate from local DEM metres. */
export function planetPoint(lat: number, lon: number, radius = 1): Vector3 {
  const phi = (lat * Math.PI) / 180,
    lambda = (lon * Math.PI) / 180;
  return new Vector3(
    Math.cos(phi) * Math.cos(lambda),
    Math.sin(phi),
    -Math.cos(phi) * Math.sin(lambda),
  ).multiplyScalar(radius);
}
export function planetUV(lat: number, lon: number) {
  return { u: ((((lon + 180) / 360) % 1) + 1) % 1, v: (lat + 90) / 180 };
}
/** Local ENU → the existing globe's east-positive planet-fixed rendering axes. */
export function enuToPlanet(lat:number,lon:number,enu:number[]):Vector3 {
  const phi=lat*Math.PI/180,lambda=lon*Math.PI/180;
  const east=new Vector3(-Math.sin(lambda),0,-Math.cos(lambda));
  const north=new Vector3(-Math.sin(phi)*Math.cos(lambda),Math.cos(phi),Math.sin(phi)*Math.sin(lambda));
  return east.multiplyScalar(enu[0]).addScaledVector(north,enu[1]).addScaledVector(planetPoint(lat,lon),enu[2]).normalize();
}
