# EGIZ — feature guide

EGIZ helps you explore planetary terrain, simulate a mission, and find Earth locations where parts of that mission could be tested. This guide describes the current local prototype.

## What is included

| Screen | What you can do |
| --- | --- |
| **Engineering lab** | Explore Earth, the Moon and Mars in 3D. Configure a mission, run simulations, evaluate acceptance criteria and compare recorded experiments. |
| **Mission brief** | Choose a Moon or Mars target, select test objectives, adjust their priorities and set a budget of one to three Earth sites. |
| **Campaign** | Compare Earth candidates on a map or in a table. See which combination covers your objectives and which conditions need laboratory testing. |
| **Fidelity matrix** | Compare how well sites match individual attributes. Select a cell to inspect its values, calculation and missing evidence. |
| **Same Sun** | Compare terrain under matching Sun angles. The packaged images currently use synthetic demo terrain; measured pilot images are unavailable. |
| **Evidence** | Read the methods, data sources, validation status and limitations. |

An **Earth analog** is a place on Earth used to test some conditions relevant to a Moon or Mars mission. A similarity score describes the model's comparison; it is not a probability of mission success.

## Try your first mission

1. Open **Engineering lab** with **Real terrain** selected, then choose **World** in its workspace rail.
2. Choose **Mars**, **Moon** or **Earth**. Select **Explore measured terrain** to enter the local landscape.
3. Choose a mission type and press **Start simulation**. The preset settings are ready to try; expand **Mission configuration** to change them.
4. Use the timeline to pause, replay, change speed or jump to an event. Readings and charts follow the selected moment.
5. Open **Scientific analysis** for the outcome, or **Compare & sensitivity** to test other conditions.

The optional **Quick guide** walks through these steps. It can be closed and reopened at any time.

## Workspaces and acceptance tests

The desktop laboratory fits the window. **Design**, **Telemetry**, **Analysis** and **Tests** appear beside the 3D scene. **Dynamics**, **Earth tests**, **Compare**, **Control** and **Archive** use the complete work area. Return with **World** or the panel's close icon. On smaller screens, panels stack and the navigation becomes horizontal.

To evaluate a design, calculate it and choose the pin icon to retain its baseline. In **Tests**, expand **Acceptance criteria** to set time, energy or landing thresholds. Change the design in **Design**, calculate again, then return to **Tests** for checks, deltas and changed inputs. **Open synchronized comparison** opens both recorded designs on one comparison clock. A failed or incomplete traverse is never presented as an equal-task energy saving.

The baseline remains for this workspace session. Export the test report to retain both full runs and requirements; its code icon opens the complete JSON. Reproduce it with `node tools/reproduce_acceptance.mjs path/to/test-report.json`. Passing criteria screens model outputs; it is not flight qualification.

`Ctrl/⌘ + Enter` calculates the current fast scenario. `Space` plays or pauses its recording when focus is outside a form control. **Cancel calculation** terminates a running fast worker. The native dynamics page retains its selected record and replay position across workspace changes, pausing when left. Its replay clock belongs to its own native record.

## Mission types

| Mission | What it calculates |
| --- | --- |
| **Rover traverse** | A route across the terrain, travel time and estimated mechanical energy use, subject to slope, traction and battery limits. |
| **Launch & flight** | A simplified rocket trajectory using thrust, propellant, gravity and drag. You can edit the throttle schedule. |
| **Descent & landing** | A controlled descent, propellant use and touchdown outcome against speed and regional slope limits. |
| **Habitat & EVA** | A surface route from a habitat, with a line-of-sight check and mechanical energy estimate. It does not calculate astronaut metabolism or life support. |

Camera views include planetary overview, regional terrain, vehicle inspection, mission tracking and scientific views. You can inspect points, place start/destination markers and add observation locations.

The simulation calculates a recorded run before playback begins. Changing replay speed changes how quickly you watch it, not its calculated outcome.

## Compare missions and Earth sites

In **Compare & sensitivity**, **Run analog experiment** calculates the planetary case and two Earth candidates. Each Earth candidate is tested with Earth conditions and with substituted planetary conditions. You can compare outcomes, charts and synchronized 3D replays.

Sensitivity runs vary one parameter to show how the result changes. They are scenario comparisons, not confidence estimates.

For site planning, use **Mission brief → Campaign**. Changing objectives, priorities or site budget recalculates the campaign. Open a site dossier for terrain evidence, available lighting information and a field verification checklist. The priority explorer shows when changing an objective's importance changes the leading site.

## Save and export

- **Save** stores a complete mission experiment in this browser on this device.
- **JSON** exports a portable experiment archive. **Report** exports a Markdown summary.
- **Import & reproduce** checks an archive and recalculates it against matching terrain data.
- Campaigns and site dossiers export as JSON. Field verification plans and surface plans can also be exported.
- Campaign URLs preserve the selected dataset, target, objectives and priorities. Mission archives carry the simulation settings and results.

## Data and current limits

The measured pilot contains nine Earth windows and two planetary windows: the lunar Site20/Mons Mouton region and Jezero on Mars. A water-dominated Earth window is excluded from mission selection. Mission terrain is reconstructed at **200 m spacing**.

The separate **Synthetic demo** uses invented inputs to demonstrate site-planning and rendering behavior. Mission Explorer requires measured terrain.

This is an exploratory prototype. Regional terrain does not resolve individual rocks, wheel clearance or small landing hazards. Planet imagery, lighting and vehicle detailing provide visual context. Climate, seasonal snow and target temperatures are incomplete, and field suitability, access, permits and safety are not assessed.

For technical details, see the [simulation model](MISSION_LAB.md), [scientific methodology](SCIENTIFIC_METHODOLOGY.md) and [data guide](engineering/REAL_DATA_GUIDE.md).

## Run locally

With the project dependencies installed:

```bash
npm --prefix web run dev
```

Open the address printed by Vite. The browser app runs without a backend, account or API key.

### Focused interface and data menu

The database button in the top navigation selects **Real terrain** (the default measured NASA/Copernicus pilot) or **Example data** (invented software fixtures). Both are EGIZ product modes, not a NASA requirement. The example remains available for learning and regression checks; source flags, exports and source-loading errors retain their original behavior.

Campaign opens on the map and selected sites; objectives, physical constraints and preference research expand on request. Mission Explorer has a visual Explore → Design → Simulate → Validate workflow, a visible launch action and one replay clock. Environment, rover systems, model explanations and event details remain accessible without occupying the initial view. The Sources workspace groups method, validation, limitations and provenance into expandable sections. Coverage rings display the existing weighted coverage score, never a probability of success.

### Equipment studio and Guide

Click the equipment icon beside Quick guide, or click the vehicle preview, to open **Equipment studio**. The NASA reference tab opens a contextual model: Perseverance for rover missions, Saturn V for launch, Apollo Lunar Module for descent, and EMU for EVA. Its equipment picker also includes LRO and MRO. Models load locally on demand. **Your configured vehicle** opens the shared EGIZ geometry. Select a part in 3D or in the component list, focus the camera, isolate the part, or separate assemblies with the inspection slider. The component guide explains each subsystem and its relationship to the supported calculations. The full mesh tree is searchable.

The **Guide** button at the bottom right works in every workspace. It explains the section under the pointer or keyboard focus, highlights it and offers previous/next explanations. Rover, launch, landing, environment and native suspension fields include explanations of their numerical role. Close the guide to return to the uncluttered view. No guide action changes mission parameters or recorded results.

The NASA model is a reference for construction and inspection. EGIZ's configurable simulation rig retains its own declared physics, dimensions and recorded replay. See [equipment sources and technical scope](design/EQUIPMENT_STUDIO.md).


Orbital flight now uses the NASA MRO reference around Mars and LRO around the Moon (also a generic visual reference for Earth experiments). **Track spacecraft** follows its recorded inertial position, **Inspect spacecraft** opens the same reference in the equipment studio, and the expand icon opens a full-screen scene. Its play/pause button and elapsed time use the same native replay clock as charts and comparison views. The spacecraft marker is enlarged; orientation is visual, and these configured experiments are not historical LRO/MRO ephemerides.
