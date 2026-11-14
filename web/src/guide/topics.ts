import type { Route } from '../state/store';
export interface GuideTopic {id:string;selector:string;title:string;body:string;action:string}
const topic=(id:string,selector:string,title:string,body:string,action:string):GuideTopic=>({id,selector,title,body,action});
const shared=[
  topic('navigation','.app-header nav','Workspaces','Mission brief sets your objectives. Campaign selects Earth sites. The laboratory runs experiments; the matrix and evidence explain the recommendations.','Choose a workspace without changing your mission target.'),
];
export function topicsFor(route:Route):GuideTopic[] {
  const specific:Record<Route,GuideTopic[]>={
    home:[],
    planet:[],
    studio:[],
    astral:[],
    discover:[],
    brief:[
      topic('target','.target-choices','Mission destination','Choose the Moon or Mars and its measured research region. The destination determines the terrain and reference environment.','Select a destination card.'),
      topic('objectives','.brief-objectives','Mission objectives','Enable the experiments you want to rehearse on Earth. Priority weights determine how much each objective contributes to campaign coverage.','Enable an objective, then adjust its priority.'),
      topic('size','.size-choices','Campaign size','This limits how many Earth sites the optimizer may select. Several complementary sites can cover different mission requirements.','Compare the one-, two- and three-site options.'),
      topic('summary','.brief-summary','Mission summary','This is the current destination, active objectives and campaign size. The next action computes a campaign from these inputs.','Review the choices and open the campaign.'),
    ],
    campaign:[
      topic('budget','.frontier-options','Site budget comparison','The bars compare calculated campaign coverage for each allowed site count. Coverage is a weighted similarity score, not a probability of mission success.','Choose a budget and compare its result.'),
      topic('map','.map-panel','Earth campaign map','Numbered markers correspond to the selected campaign sites. Basemap imagery provides geographic context; the recommendations use the packaged evidence.','Select a marker to inspect a site.'),
      topic('coverage','.campaign-card','Campaign coverage','The ring shows the weighted best attribute fidelity across the selected sites. Missing eligible evidence earns no credited coverage.','Inspect a site or export the complete campaign record.'),
      topic('priorities','.campaign-objective-fold','Mission priorities','The same objectives selected in Mission brief remain editable here. Changes recompute the site selection.','Expand the section to adjust priorities.'),
      topic('preferences','.campaign-research','Research & alternatives','Preference analysis compares weight choices and simpler baselines. It helps identify whether a recommendation depends strongly on your priorities.','Expand the research section to inspect alternatives.'),
    ],
    lab:[
      topic('workflow','.sim-rail .sim-world-button','Engineering workflow','Explore the environment, design the vehicle, simulate its behavior and plan Earth validation. Workspaces open around the same mission configuration.','Choose World for mission setup, Design for vehicle parameters, or Dynamics for native solvers.'),
      topic('setup','.ml-setup','Mission configuration','Select the body, vehicle and route. Configuration changes become inputs to the next calculation; saved results keep their original inputs.','Set the parameters, then start a simulation.'),
      topic('studio','.ex-equipment-toggle,.ex-schematic','Detailed equipment','Open the equipment studio for six NASA reference models or your configured vehicle. Select a component to inspect its role and source geometry.','Click the vehicle preview or the equipment icon.'),
      topic('world','.ml-viewport, .ml-viewer, .ex-planet','3D research world','The orbital globe provides context. Regional views use the elevation grid; vehicle views show the configured geometry and recorded motion.','Drag to orbit, scroll to zoom and use the view bookmarks.'),
      topic('readings','.ml-charts,.ml-telemetry:not([hidden])','Recorded engineering readings','Distance, speed, energy and terrain slope come from the selected run at the current replay time. Dashes mean no run is available.','Open Telemetry and move along the mission timeline.'),
      topic('tests','.test-bench','Experiment test bench','Set acceptance limits, pin a calculated baseline, change the design and run again. Checks and differences use the actual recorded results. Baselines remain in this workspace session; export the report to retain both runs.','Open Tests, then pin a baseline or change acceptance criteria.'),
      topic('clock','.ex-timeline','Authoritative replay clock','The timeline drives the 3D scene, readings and events from the same recorded run. Playback speed changes viewing time, not the simulation physics.','Play, pause, scrub or jump to an event.'),
      topic('results','.sim-rail','Engineering tools & results','Dynamics contains native solver experiments. Rover configures the analytical design. Earth tests connects run results to a validation campaign.','Choose a workspace in the rail; use its information icon for model details.'),
    ],
    twin:[
      topic('sun','.twin-page','Lighting comparison','This workspace compares terrain under matching solar geometry when the required lighting pair is packaged. An unavailable state identifies missing data.','Select a supported pair or open the measured terrain explorer.'),
      topic('sun-controls','.twin-controls','Solar controls','Solar elevation and azimuth change the lighting direction in the comparison. They are geometry inputs, not site weather measurements.','Adjust the direction and compare the two views.'),
    ],
    matrix:[
      topic('cells','.matrix-scroll','Attribute fidelity matrix','Each row is an Earth site and each column is a mission attribute. Color and numbers show fidelity from zero to one; hatched cells have missing evidence.','Select a cell for evidence or a column heading to sort.'),
      topic('matrix-evidence','.matrix-evidence','Cell evidence','A selected cell exposes the underlying value, source, mismatch and comparison method. It explains why that attribute received its score.','Compare the source values and their units.'),
    ],
    atlas:[
      topic('atlas-modes','.atlas-tabs','Transferability workspace','Each mode answers one research question: which operations transfer, which sites complement each other, what physics changes, and what to measure next.','Choose a mode; the mission selector applies to all of them.'),
      topic('atlas-tensor','.atlas-matrix','Operational Transferability Tensor','Rows are Earth sites, columns are mission tasks. The status comes from documented rules; similarity, evidence and physics remain separate numbers in the cell detail.','Select a cell to open its certificate and evidence trace.'),
    ],
    evidence:[
      topic('coverage','.research-overview','Packaged evidence','These counts describe the currently loaded dataset: Earth windows, planetary targets and distinct source records.','Expand the dataset coverage section below.'),
      topic('method','#method','How the recommendation works','The method explains attribute similarity, objective coverage and complementary site selection. It also states the limits of these calculations.','Open the method section to inspect the equations.'),
      topic('validation','#experiments','Scientific checks','The validation section reports executed experiments and their recorded status. It separates confirmed behavior from inconclusive results.','Inspect a verification record before relying on a claim.'),
      topic('sources','#sources','Data & credits','Sources provide the origin of terrain, environmental observations and third-party technology. Their links and provenance remain accessible here.','Open a source link or inspect its provenance.'),
    ],
  };
  return [...specific[route],...shared];
}
export const FIELD_HELP:Record<string,string>={
  mass:'Mass increases gravity load and the forces needed to drive or accelerate. Changing it affects the next calculation.',
  wheelRadius:'Wheel radius converts shaft rotation to ground travel and torque to drive force. It also changes the visible wheel geometry.',
  wheelWidth:'Wheel width changes the visual assembly. The fast analytical model does not solve pressure distribution or deformable-soil contact.',
  trackWidth:'Track width is the side-to-side wheel spacing. It changes the visual rig and the conservative static stability screen.',
  wheelbase:'Wheelbase is the front-to-rear wheel spacing. It affects the visual footprint and conservative stability calculation.',
  cgHeight:'Centre-of-mass height enters the static tip-angle screen. The illustration is not a measured internal mass distribution.',
  suspensionTravel:'Travel controls the visual articulation envelope in the regional model. Native experiments have their own explicit suspension constraints.',
  stallTorque:'Per-wheel stall torque is the zero-speed end of the configured DC motor curve. Limited torque may prevent a route segment from being traversed.',
  noLoadRpm:'No-load RPM is the zero-load wheel-shaft speed. The torque-speed curve reduces available torque as rotational speed increases.',
  motorPower:'This caps mechanical power at each wheel. The drivetrain and electrical model determine the corresponding energy demand.',
  solarArea:'Solar aperture is an assumed horizontal collection area used by the power model. It is not measured from the visible CAD panels.',
  solarEfficiency:'Panel efficiency converts incident modeled sunlight to electrical power. It is an assumption, not a field measurement.',
  transmission:'Transmission scales sunlight reaching the panels. It does not calculate local clouds or measured dust weather.',
};
Object.assign(FIELD_HELP,{
  speed:'Commanded speed is a target. Motor capability, slope and traction may reduce the actual calculated speed.',
  batteryWh:'Battery capacity is the available electrical energy in watt-hours. A run can stop when the modeled energy budget is depleted.',
  maxSlope:'Segments steeper than this regional slope threshold are rejected by the route planner.',
  dryMass:'Dry mass excludes propellant. The flight integrator reduces total vehicle mass as fuel is consumed.',
  fuel:'Propellant is the initial usable fuel mass. Burn time depends on thrust and specific impulse.',
  thrust:'Rated thrust is the maximum configured engine force. The controller or thrust program determines when it is applied.',
  isp:'Specific impulse links thrust to propellant mass flow using standard Earth gravity as the reference.',
  initialAltitude:'Initial altitude is the starting height above the terrain in the supported descent model.',
  initialVelocity:'Initial vertical speed is signed: negative values represent descent.',
  ignitionAltitude:'Ignition altitude is the terrain-relative height that triggers the configured landing guidance.',
  safeSpeed:'Touchdown speed above this limit is classified as a hard landing in the supported model.',
  angle:'Tilt sets the thrust direction away from vertical in the supported launch plane. It is not a full attitude controller.',
  duration:'Duration limits the integration interval. Earlier terrain, fuel or mission events may terminate a run.',
  dt:'The timestep controls numerical integration resolution. Smaller steps cost more computation and should be checked for convergence.',
  gravity:'Gravity sets acceleration and surface weight. Changing it while retaining a terrain creates a counterfactual experiment.',
  density:'Reference atmospheric density contributes to aerodynamic drag. Vacuum has zero density.',
  scaleHeight:'Scale height controls how quickly the exponential reference atmosphere thins with altitude.',
  traction:'The traction coefficient limits available drive force in the analytical model. It is an uncalibrated surface assumption.',
  rollingResistance:'Rolling resistance contributes to the force and energy required to traverse a route.',
  efficiency:'Drivetrain efficiency converts mechanical work to electrical demand. Lower efficiency increases energy use.',
  idlePower:'Idle power is auxiliary electrical demand while time advances, in addition to the drive load.',
  area:'Reference area scales aerodynamic drag with density, speed squared and the drag coefficient.',
  cd:'The drag coefficient is an assumed aerodynamic parameter. It does not solve flow around the displayed mesh.',
  safeSlope:'A touchdown on terrain above this regional slope threshold fails the supported landing-slope check.',
  coordinates:'Local coordinates are metres east and north within the terrain window. They select route start and destination.',
  'native-stiffness':'Native torsional spring stiffness relates joint displacement to suspension torque. The solver integrates the resulting constrained motion.',
  'native-damping':'Native damping resists suspension angular velocity. It affects oscillation, contact loading and energy dissipation.',
  'native-friction':'This is the native rigid-contact friction assumption. It is not a calibrated regolith or deformable-soil model.',
  'native-steer':'The native controller targets front and rear steering angles. Wheel and knuckle orientation comes from the solver.',
  'native-speed':'Native wheel-speed command is converted to a target axle angular speed using the configured wheel radius.',
  'native-duration':'This bounds the actual native solver execution time simulated. Returned states are stored in the experiment archive.',
  'native-mass':'The requested chassis mass enters the native multibody model and its contact loading.',
  'native-wheelRadius':'The radius sets the native collision cylinder and target axle speed. Rendered wheel details remain attached to that body.',
  'native-travel':'The travel envelope sets explicit native joint limits. It is separate from the fast model’s visual articulation setting.',
  'native-stallTorque':'The native actuator is limited by this per-wheel torque bound.',
});
