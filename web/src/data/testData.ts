// Synthetic fixtures only, shared by frontend software tests.
import candidates from '../../../data/fixtures/earth_candidates.json';
import targets from '../../../data/fixtures/targets.json';
import templates from '../../../data/fixtures/mission_templates.json';
import sun from '../../../data/fixtures/sun_windows.json';
import results from '../../../data/fixtures/results.json';
import validation from '../../../data/fixtures/validation.json';
import type { AppData } from '../types/contracts';
export const testData = { candidates, targets, templates, sun, results, validation } as unknown as AppData;

// Real measured pilot snapshots, used to verify mode separation and missingness.
import pilotCandidates from '../../../data/pilot/earth_candidates.json';
import pilotTargets from '../../../data/pilot/targets.json';
import pilotTemplates from '../../../data/pilot/mission_templates.json';
import pilotSun from '../../../data/pilot/sun_windows.json';
import pilotResults from '../../../data/pilot/results.json';
import pilotValidation from '../../../data/pilot/validation.json';
export const pilotTestData = { candidates: pilotCandidates, targets: pilotTargets, templates: pilotTemplates,
  sun: pilotSun, results: pilotResults, validation: pilotValidation } as unknown as AppData;
