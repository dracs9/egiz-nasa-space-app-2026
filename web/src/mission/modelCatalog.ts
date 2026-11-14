/** Human-authored explanations mapped to real mesh names; never inferred physical results. */
export const MODEL_PARTS = [
  {id:'chassis',label:'Chassis & thermal protection',description:'The structural body carries the instruments and electronics. Thermal blankets and radiator surfaces help control temperature.',connection:'EGIZ mass is an input to mobility and power calculations. The outer skin is a visual assembly.'},
  {id:'mobility',label:'Wheels & drive hubs',description:'Open metal wheels use raised grousers for grip. Hubs and spokes transmit drive torque to the wheel barrel.',connection:'Wheel radius, motor torque and power change calculated speed and energy. In native replay each wheel follows its recorded body pose.'},
  {id:'suspension',label:'Suspension & joints',description:'The suspension connects wheel assemblies to the chassis. Perseverance uses rocker-bogie suspension; EGIZ native experiments use six independent trailing arms.',connection:'Native spring stiffness and damping change solver motion. The fast regional model only uses terrain-following kinematics.'},
  {id:'mast',label:'Mast & remote cameras',description:'The raised mast provides a clear view of the surrounding terrain. The NASA model includes Mastcam-Z and navigation cameras.',connection:'The EGIZ mast camera is a viewpoint. Image perception and autonomous visual navigation are not simulated.'},
  {id:'science',label:'Robotic arm & instruments',description:'The arm positions close-up instruments and the sampling turret near rocks. The NASA mesh includes the coring drill, PIXL and WATSON.',connection:'These instruments are available for visual inspection. This application does not calculate sampling or instrument measurements.'},
  {id:'power',label:'Power & heat rejection',description:'Perseverance carries a radioisotope power source at the rear. The configurable EGIZ demonstrator instead includes solar panels and a battery.',connection:'EGIZ battery capacity, solar aperture and efficiency enter its energy model. The NASA reference does not change the configured power system.'},
  {id:'communications',label:'Antennas & communications',description:'Antennas provide links to orbiters and Earth. Different antenna geometries support different directions and communication roles.',connection:'The model shows antenna placement. Antenna gain, packet links and communication traffic are not calculated here.'},
  {id:'sensors',label:'Hazard cameras & sensors',description:'Low-mounted cameras look near the wheels. Their housings, optical windows and cable connections are separate visible components.',connection:'The cameras explain vehicle layout. The regional elevation grid does not contain camera imagery or wheel-scale obstacles.'},
  {id:'avionics',label:'Avionics & equipment deck',description:'The equipment deck supports control electronics, instrument mounts, cable harnesses and calibration targets.',connection:'EGIZ accounts for configured auxiliary electrical demand. Internal circuit operation is outside the model.'},
] as const;
export type ModelPart = typeof MODEL_PARTS[number]['id'];
export function nasaPart(name:string):ModelPart {
  if(/^(Wheels_objs)/i.test(name))return 'mobility';
  if(/^suspension/i.test(name))return 'suspension';
  if(/^(Cylinder|bottom|top|head|lens|Mastcam|NavCams|probe|microphones\.001)/.test(name))return 'mast';
  if(/^(arm|turret|corring|cover_|PIXL|hinge|WATSON)/i.test(name))return 'science';
  if(/^rtg/i.test(name))return 'power';
  if(/^antenna/i.test(name))return 'communications';
  if(/hazcams|Look_Camera|RIMFAX/i.test(name))return 'sensors';
  if(/lab|calibration|Name_Chips|base|box/i.test(name))return 'avionics';
  return 'chassis';
}
export const NASA_MODEL_SOURCE='https://science.nasa.gov/3d-resources/mars-2020-perseverance-rover/';

export type EquipmentId='perseverance'|'saturn-v'|'apollo-lm'|'emu'|'lro'|'mro';
export type EquipmentFamily='rover'|'launcher'|'lander'|'suit'|'orbiter';
export type EquipmentPartId=ModelPart|'engines'|'lower-stage'|'middle-stage'|'upper-stage'|'capsule'|'escape'|'cabin'|'descent-stage'|'landing-gear'|'solar'|'bus'|'antenna'|'instruments'|'helmet'|'life-support'|'suit-body'|'arms'|'legs'|'tanks'|'fairing';
export interface EquipmentPart {id:EquipmentPartId;label:string;description:string;connection:string}
export interface EquipmentAsset {id:EquipmentId;title:string;family:EquipmentFamily;file:string;source:string;credit:string;parts:readonly EquipmentPart[];inspectionRegions:boolean}
const component=(id:EquipmentPartId,label:string,description:string,connection='Reference geometry only. No new physical model is selected by inspecting this part.'):EquipmentPart=>({id,label,description,connection});
export const ROCKET_PARTS=[
  component('engines','Engine cluster','The lower region contains engine bells, thrust structure and nearby external hardware.'),
  component('lower-stage','Lower stage region','The lower tank and structure region carries the launch vehicle through the first portion of ascent.'),
  component('middle-stage','Middle stage region','This inspection band shows the middle rocket structure and interstage hardware.'),
  component('upper-stage','Upper stage region','The upper region contains later-stage structure and the payload adapter.'),
  component('capsule','Spacecraft & adapter','The spacecraft and adapter sit above the launch stages. Inspection does not simulate separation.'),
  component('escape','Escape tower region','The uppermost hardware represents the launch escape system. No abort dynamics are calculated here.'),
];
export const LANDER_PARTS=[
  component('cabin','Crew cabin & upper structure','The upper module contains the cabin, windows, access hardware and ascent-stage structure.'),
  component('descent-stage','Descent stage & thermal protection','The lower platform carries landing systems and thermal blankets. The historical reference and EGIZ demonstrator have separate physical assumptions.'),
  component('landing-gear','Landing gear & footpads','Struts and footpads spread touchdown loads across the surface. These are inspection regions, not a structural stress calculation.'),
  component('engines','Descent propulsion region','The underside contains the main descent-engine region and nearby supporting hardware.'),
  component('antenna','Upper antennas & instruments','Upper external hardware supports communications and navigation. Radio links and instrument outputs are not simulated.'),
];
export const SUIT_PARTS=[
  component('helmet','Helmet & visor','The helmet region includes protective shell and visor. The model is a spacesuit reference, not a physiological simulation.'),
  component('suit-body','Torso & suit shell','The torso contains the pressure garment and external controls. Visual regions follow the source mesh surface.'),
  component('life-support','Life-support backpack','The rear equipment region carries life-support hardware. Oxygen, cooling and consumables are not numerically simulated.'),
  component('arms','Arms & gloves','The lateral garment regions provide arm and hand protection. This static source has no recorded limb dynamics.'),
  component('legs','Legs & boots','The lower garment and boots support mobility. EGIZ EVA routes use the declared surface travel model.'),
];
export const ORBITER_PARTS=[
  component('bus','Spacecraft bus','The central bus supports the scientific payload, avionics and propulsion equipment.'),
  component('solar','Solar array region','Extended array surfaces collect sunlight. The orbital propagator currently evolves position and velocity, not electrical power.'),
  component('antenna','Antenna & upper hardware','The antenna region contains communication and supporting external hardware. The displayed orientation is a viewing frame.'),
  component('instruments','Instrument & lower-deck region','Science instruments survey the planet. Rendering these instruments does not produce simulated observations.'),
];
export const FAST_LAUNCH_PARTS=[
  component('engines','Engine assembly','The detailed engine follows the recorded thrust state. Plumes visualize calculated engine activity.','Thrust, specific impulse, propellant and throttle schedule feed the flight calculation.'),
  component('tanks','Tank & primary structure','The tank shell and external structure show the configured demonstration vehicle.','Dry mass and propellant determine mass evolution. This model has no calculated staging.'),
  component('fairing','Payload fairing','The fairing encloses a conceptual payload.','Fairing opening and payload separation are not part of this flight model.'),
];
const CONFIGURED_LANDER_PARTS:readonly EquipmentPart[]=[
  component('cabin','Vehicle body & guidance','The body carries the payload and guidance hardware of the EGIZ demonstrator.','Dry mass, propellant, gravity and drag enter the descent calculation. The shell is illustrative.'),
  component('descent-stage','Lower structure & thermal protection','The lower structure surrounds the propulsion system and supports the landing gear.','Propellant limits the available powered descent. Structural stress and thermal balance are not solved.'),
  component('landing-gear','Landing gear & footpads','The supports indicate the touchdown footprint of the configured vehicle.','Touchdown speed and sampled terrain slope determine the supported landing checks. Individual leg loads are not solved.'),
  component('engines','Descent propulsion region','The engine and plume follow the recorded powered-descent state.','Thrust, specific impulse, ignition altitude and remaining propellant affect the calculated descent.'),
  component('antenna','Upper antennas & instruments','External hardware indicates navigation and communication equipment.','Radio links and sensor measurements are visual references only.'),
];
const CONFIGURED_EVA_PARTS:readonly EquipmentPart[]=SUIT_PARTS.map(part=>({...part,connection:part.id==='legs'||part.id==='arms'?'Route, speed and slope constraints control regional travel. Limb motion is distance-driven kinematics, not biomechanics.':'EVA energy is a declared travel proxy. Oxygen, cooling and physiological safety are not calculated.'}));
export const EQUIPMENT_ASSETS:readonly EquipmentAsset[]=[
  {id:'perseverance',title:'Perseverance',family:'rover',file:'perseverance.glb',source:NASA_MODEL_SOURCE,credit:'NASA/JPL',parts:MODEL_PARTS,inspectionRegions:false},
  {id:'saturn-v',title:'Saturn V',family:'launcher',file:'saturn-v.glb',source:'https://science.nasa.gov/3d-resources/saturn-v/',credit:'NASA / Michael D. Carbajal',parts:ROCKET_PARTS,inspectionRegions:true},
  {id:'apollo-lm',title:'Apollo Lunar Module',family:'lander',file:'apollo-lm.glb',source:'https://science.nasa.gov/3d-resources/apollo-lunar-module/',credit:'NASA / Michael D. Carbajal',parts:LANDER_PARTS,inspectionRegions:true},
  {id:'emu',title:'EMU spacesuit',family:'suit',file:'emu.glb',source:'https://science.nasa.gov/3d-resources/extravehicular-mobility-unit/',credit:'NASA / Michael D. Carbajal',parts:SUIT_PARTS,inspectionRegions:true},
  {id:'lro',title:'Lunar Reconnaissance Orbiter',family:'orbiter',file:'lro.glb',source:'https://science.nasa.gov/3d-resources/lunar-reconnaissance-orbiter-a/',credit:'NASA / Christopher R. Meaney',parts:ORBITER_PARTS,inspectionRegions:true},
  {id:'mro',title:'Mars Reconnaissance Orbiter',family:'orbiter',file:'mro.glb',source:'https://science.nasa.gov/3d-resources/mars-reconnaissance-orbiter-mro-a/',credit:'NASA 3D Resources',parts:ORBITER_PARTS,inspectionRegions:true},
];
export function equipmentAsset(id:EquipmentId):EquipmentAsset{return EQUIPMENT_ASSETS.find(a=>a.id===id)!;}
export function referenceForMode(mode:import('./types').Mode):EquipmentId{return mode==='launch'?'saturn-v':mode==='descent'?'apollo-lm':mode==='eva'?'emu':'perseverance';}
export function orbitalReference(body:import('./types').Planet):EquipmentId{return body==='mars'?'mro':'lro';}
export function configuredParts(mode:import('./types').Mode):readonly EquipmentPart[]{return mode==='launch'?FAST_LAUNCH_PARTS:mode==='descent'?CONFIGURED_LANDER_PARTS:mode==='eva'?CONFIGURED_EVA_PARTS:MODEL_PARTS;}
/** Approximate geometric inspection bands. They preserve every source triangle, not flight CAD boundaries. */
export function inspectionRegion(family:EquipmentFamily,x:number,y:number,z:number,configured=false):EquipmentPartId {
  if(family==='launcher')return configured?(y<.16?'engines':y>.74?'fairing':'tanks'):(y<.10?'engines':y<.45?'lower-stage':y<.68?'middle-stage':y<.85?'upper-stage':y<.95?'capsule':'escape');
  if(family==='lander'){const radius=Math.hypot(x-.5,z-.5);return y<.18&&radius<.13?'engines':y<.48&&radius>.28?'landing-gear':y>.86?'antenna':y>.47?'cabin':'descent-stage';}
  if(family==='suit')return y>.83?'helmet':y<.43?'legs':Math.abs(x-.5)>.25?'arms':z>.66?'life-support':'suit-body';
  if(family==='orbiter')return x<.44?'solar':y>.72?'antenna':y<.36?'instruments':'bus';
  return 'chassis';
}

/** Prefer explicit names in the NASA source for orbiter arrays, dishes and payload surfaces. */
export function namedReferencePart(asset:EquipmentId|undefined,material:string,node:string):EquipmentPartId|undefined {
  if(asset==='mro'){
    if(/^solar/i.test(material))return 'solar';
    if(/^(cover|tower)$/i.test(material))return 'antenna';
    if(/^(lens|parts|rocket)$/i.test(material))return 'instruments';
    return 'bus';
  }
  if(asset==='lro'){
    if(/solar/i.test(material))return 'solar';
    if(/dish/i.test(material)||/Layer_[13](?:\b|_)/.test(node))return 'antenna';
    if(/^Crater/i.test(material))return 'instruments';
    return 'bus';
  }
  return undefined;
}
