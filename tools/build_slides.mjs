/** Local editable demo deck. Written with AI assistance (Codex); human review pending. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const workspaceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeRoot = process.env.EGIZ_ARTIFACT_RUNTIME ?? path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies');
process.env.RUNTIME_NODE_MODULES ??= path.join(runtimeRoot, 'node/node_modules');
process.env.RUNTIME_PYTHON ??= path.join(runtimeRoot, 'python/bin/python3');
process.env.RUNTIME_NODE ??= path.join(runtimeRoot, 'node/bin/node');
const skillDir = process.env.EGIZ_PRESENTATIONS_SKILL ?? path.join(os.homedir(), '.codex/plugins/cache/openai-primary-runtime/presentations/26.1013.11914/skills/presentations');
const buildDir = path.join(workspaceDir, 'artifacts/slides-build');
const outputDir = path.join(workspaceDir, 'submission');
await fs.mkdir(buildDir, { recursive: true });
await fs.mkdir(outputDir, { recursive: true });
try { await fs.symlink(path.join(runtimeRoot, 'node/node_modules'), path.join(buildDir, 'node_modules'), 'dir'); }
catch (error) { if (error.code !== 'EEXIST') throw error; }
const requireRuntime = createRequire(path.join(buildDir, 'package.json'));
const { Presentation, PresentationFile } = await import(pathToFileURL(requireRuntime.resolve('@oai/artifact-tool')).href);
const { resolvePresentationFont, finalizePresentation } = await import(pathToFileURL(path.join(skillDir, 'container_tools/artifact_tool_utils.mjs')).href);
// Arial is present in the host font inventory and also has a standard office
// fallback. Helvetica Neue renders in canvas but not in this office exporter.
const font = resolvePresentationFont({ fontFamily: process.env.EGIZ_SLIDES_FONT ?? 'Arial' });
const C = { bg: '#0B1017', panel: '#121A24', text: '#E8EEF4', muted: '#9AA8B6',
            line: '#334250', earth: '#4CC3D9', moon: '#E9C46A', mars: '#E07A5F', warn: '#F4A261' };
const presentation = Presentation.create({ slideSize: { width: 1280, height: 720 } });

function text(slide, value, left, top, width, height, size=28, color=C.text, bold=false) {
  const box = slide.shapes.add({ geometry: 'textbox', position: { left, top, width, height },
    fill: 'none', line: { fill: 'none', width: 0 } });
  box.text = value;
  box.text.style = { typeface: font, fontSize: size, color, bold, wrap: 'square', autoFit: 'none', insets: 0 };
  return box;
}
function slide(title, index, sourceNotes) {
  const s = presentation.slides.add();
  s.background.fill = C.bg;
  text(s, title, 72, 54, 1120, 100, 44, C.text, true);
  text(s, 'EGIZ', 72, 668, 300, 24, 17, C.earth, true);
  text(s, `${index} / 7`, 1110, 668, 90, 24, 17, C.muted);
  s.speakerNotes.text = sourceNotes;
  return s;
}
function table(s, values, left, top, width, height, widths, size=25) {
  const t = s.tables.add({ rows: values.length, columns: values[0].length, left, top, width, height,
    columnWidths: widths, values });
  t.borders.assign({ style: 'solid', width: 0.5, fill: C.line });
  t.styleOptions = { headerRow: false, bandedRows: false };
  t.cells.block({ row: 0, column: 0, rowCount: values.length, columnCount: values[0].length }).assign({
    fill: C.bg, textStyle: { typeface: font, fontSize: size, color: C.text },
    margins: { left: 14, right: 14, top: 12, bottom: 12 }, anchor: 'center' });
  for (let i=0; i<values.length; i++) {
    t.rows[i].height = height / values.length;
    for (let j=0; j<values[i].length; j++) {
      const cell = t.getCell(i,j);
      cell.text.style = { typeface: font, fontSize: size, color: i === 0 ? C.earth : C.text,
        bold: i === 0, wrap: 'square' };
      if (i === 0) cell.fill = C.panel;
    }
  }
  return t;
}

const resultsPath = path.join(workspaceDir, 'data/fixtures/results.json');
const resultBytes = await fs.readFile(resultsPath);
const result = JSON.parse(resultBytes.toString());
if (!result.synthetic) throw new Error('This deck template expects explicitly synthetic demo results');
const run = result.runs.find(r => r.target.includes('MOON'));
const campaigns = run.campaigns;
const pct = x => `${(100*x).toFixed(1)}%`;
const sourceHash = createHash('sha256').update(resultBytes).digest('hex');
const sourceCore = 'Project method: docs/science/MATHEMATICAL_SPECIFICATION.md and docs/science/ALGORITHMS_AND_PSEUDOCODE.md. Source plan: docs/product/SIGNATURE_DEMO.md §4. This is an independent Egiz prototype, with no NASA affiliation or endorsement.';
const s1 = slide('Egiz', 1, sourceCore);
// Keep the cover title intentionally much larger than content slide titles.
s1.shapes.items[0].position = { left: 72, top: 106, width: 1120, height: 136 };
s1.shapes.items[0].text.style = { typeface: font, fontSize: 104, color: C.earth, bold: true, insets: 0 };
text(s1, 'Earth test campaigns\nfor Moon and Mars missions', 72, 274, 1060, 156, 48, C.text, true);
text(s1, 'Choose the conditions your mission needs to rehearse.', 72, 468, 1090, 64, 29, C.muted);
text(s1, 'Independent software prototype', 72, 578, 1100, 40, 24, C.warn);
text(s1, 'Challenge: Earth analogs for permanent Moon bases and Mars', 72, 624, 1100, 32, 22, C.muted);

const s2 = slide('Conditions that shape a test campaign', 2,
  `${sourceCore}\nNASA criterion reference identified in project sources: https://ntrs.nasa.gov/citations/20250009323 . Values here reproduce the documented project method, not a site-specific safety approval.`);
table(s2, [
  ['Condition', 'Physical basis', 'Test objective'],
  ['Low Sun', 'About 2–7° above the horizon\nnear the lunar south pole', 'Lighting and visibility'],
  ['Local slopes', 'Less than 10° on a 100 m baseline', 'Landing hazard rehearsal'],
  ['Regional slopes', 'Less than 20° on a 2 km baseline', 'Field traverses and mobility'],
], 72, 180, 1136, 350, [220, 540, 376], 25);
text(s2, 'Each task needs a different set of conditions.', 72, 575, 1130, 52, 30, C.moon);

const s3 = slide('A campaign of complementary sites', 3, sourceCore);
table(s3, [
  ['Step', 'Calculation', 'Decision'],
  ['1   Attributes', 'Measure Earth and the target\non matching physical baselines', 'Comparable terrain and conditions'],
  ['2   Objectives', 'Combine attribute fidelity\nwith a weighted geometric mean', 'Task scores with missingness flags'],
  ['3   Campaign', 'Search combinations of 1–3 sites\non a shortlist, checked against global greedy', 'Sites with specific task roles'],
], 72, 180, 1136, 350, [235, 550, 351], 24);
text(s3, 'Coverage combines the best available site for each enabled task.', 72, 576, 1130, 64, 28, C.muted);

const s4 = slide('Data and physical baselines', 4,
  `${sourceCore}\nDataset inventory: docs/science/DATASET_SPECIFICATION.md. Source links: data/curated/sources.csv. Copernicus DEM: ESA. LOLA: NASA LRO/PGDA. MOLA/HRSC blend: NASA/ESA/USGS. MODIS LST and GPM IMERG: NASA. WorldCover: ESA. Solar geometry: NOAA algorithm. Default fixtures are invented software-test data, not these observations.`);
table(s4, [
  ['Source', 'Measurement', 'Use'],
  ['Copernicus DEM', '100 m / 400 m and 2 km terrain baselines', 'Earth terrain'],
  ['LOLA / PGDA', '100 m and 2 km terrain baselines', 'Moon target'],
  ['MOLA / HRSC', '400 m and 2 km terrain baselines', 'Mars target'],
  ['MODIS, IMERG, WorldCover', 'Surface temperature, rain and bare ground', 'Earth environment'],
  ['NOAA solar model', 'Monthly hours and azimuth span of low Sun', 'Lighting opportunities'],
], 72, 172, 1136, 386, [330, 540, 266], 23);
text(s4, 'The default demo uses invented fixture values. Source adapters support observed data.', 72, 594, 1130, 58, 25, C.warn);

const s5 = slide('Mons Mouton campaign demonstration', 5,
  `${sourceCore}\nAll displayed values and site identities on this slide are synthetic. Source: data/fixtures/results.json. SHA-256: ${sourceHash}. Target: ${run.target}. Template: ${run.template}. Monthly values demonstrate the interface and do not recommend a field season.`);
text(s5, 'SYNTHETIC DEMONSTRATION', 72, 151, 1130, 40, 23, C.warn, true);
campaigns.forEach((campaign,i) => {
  text(s5, `${campaign.k} ${campaign.k === 1 ? 'site' : 'sites'}`, 72, 225+i*104, 200, 42, 28, C.muted);
  text(s5, pct(campaign.coverage), 272, 214+i*104, 240, 60, 46, i === 2 ? C.moon : C.text, true);
});
const roles = { O1: 'Landing', O2: 'Field geology', O3: 'LTV mobility', O4: 'Low Sun', O5: 'Cold and dryness' };
const selected = campaigns.at(-1).sites.map(site => [
  site.id, site.roles.map(role => roles[role] ?? role).join('\n'), site.best_month === 3 ? 'March' : site.best_month ? String(site.best_month) : 'Not assessed',
]);
table(s5, [['Fictional site', 'Task role', 'Month'], ...selected], 552, 214, 656, 312, [220, 255, 181], 22);
text(s5, 'Earth cannot reproduce lunar gravity, vacuum or radiation.', 72, 564, 1130, 40, 29, C.moon);
text(s5, 'All scores and month choices above are invented software output.', 72, 613, 1130, 36, 23, C.warn);

const s6 = slide('Verification and scientific status', 6,
  `${sourceCore}\nMeasured software evidence: .venv/bin/python -m pytest tests/test_terrain.py tests/test_fidelity.py tests/test_campaign.py tests/test_engine*.py -q gave 45 passed in 2.92s during implementation. The test_campaign.py independent oracle covers 100 random tasks with n=10–25. test_engine_run.py verifies identical result bytes on repeated inputs. These are software tests, not observed-data validation of site quality. Scientific experiment state remains not_run in data/fixtures/validation.json.`);
table(s6, [
  ['Check', 'Current evidence', 'Meaning'],
  ['E1   Solar geometry', 'Reference-check module implemented', 'Reference evidence needs independent review'],
  ['E3   Practice recovery', 'Not run on observed candidate data', 'No claim that the model recovers NASA practice'],
  ['E4   Campaign search', '100 random cases match an independent oracle', 'Software verifies exact search on its shortlist'],
  ['E7   Negative controls', 'Synthetic test harness implemented', 'Observed control experiment remains pending'],
], 72, 174, 1136, 360, [265, 450, 421], 24);
text(s6, '45 core tests passed', 72, 572, 600, 48, 34, C.earth, true);
text(s6, 'Formulas, admission, search and identical output bytes', 72, 622, 1120, 34, 23, C.muted);

const s7 = slide('What remains before field use', 7, `${sourceCore}\nOutstanding scientific and external work: observed global data acquisition, preregistration of practice pairs and parameters, independent expert review, operational permissions and field validation. Deployment and competition submission have not been performed. No public links are invented.`);
const next = [
  ['01', 'Complete the observed candidate dataset', 'Terrain, environment and documented data quality for every site'],
  ['02', 'Preregister the scientific comparison', 'Freeze practice pairs and parameters before the first experiment'],
  ['03', 'Review the science and test in the field', 'Check measurement assumptions, access and operational safety'],
  ['04', 'Expand the conditions and target set', 'Validate terrain shadows, seasonal snow and curated geology'],
];
next.forEach((row,i) => {
  text(s7, row[0], 72, 174+i*104, 78, 44, 29, C.earth, true);
  text(s7, row[1], 168, 172+i*104, 1030, 42, 29, C.text, true);
  text(s7, row[2], 168, 219+i*104, 1030, 38, 23, C.muted);
});
text(s7, 'Local prototype. Public deployment and competition submission are pending.', 72, 615, 1130, 34, 23, C.warn);

await fs.writeFile(path.join(buildDir, 'font-policy.json'), JSON.stringify({ basis: 'design', families: [font] }, null, 2));
const candidatePath = path.join(buildDir, 'candidate.pptx');
await (await PresentationFile.exportPptx(presentation)).save(candidatePath);
for (let index=0; index<presentation.slides.items.length; index++) {
  const s = presentation.slides.items[index];
  const blob = await presentation.export({ slide: s, format: 'png', scale: 1 });
  await fs.writeFile(path.join(buildDir, `slide-${String(index+1).padStart(2,'0')}.png`), new Uint8Array(await blob.arrayBuffer()));
  const layout = await s.export({ format: 'layout' });
  await fs.writeFile(path.join(buildDir, `slide-${String(index+1).padStart(2,'0')}.layout.json`), await layout.text());
}
await fs.mkdir(path.join(buildDir, 'validated'), { recursive: true });
const revision = Date.now();
const finalStagedPath = path.join(buildDir, 'validated', `slides-${revision}.pptx`);
const final = await finalizePresentation({ workspaceDir, candidatePath, finalPath: finalStagedPath,
  explicitTotalSlideCount: 7, requiredNativeTableOwnerSlides: [2,3,4,5,6], requiredNativeChartOwnerSlides: [],
  fontPolicy: { basis: 'design', families: [font] },
  pythonExecutable: path.join(runtimeRoot, 'python/bin/python3'),
  integrityValidatorPath: path.join(skillDir, 'container_tools/inspect_presentation_package_integrity.py'),
  layoutValidatorPath: path.join(skillDir, 'container_tools/inspect_presentation_layout_geometry.py'),
  layoutArgs: ['--expected-slide-size-emu', '12192000,6858000', '--validate-bullet-geometry', '--validate-heading-fit',
    ...[2,3,4,5,6].flatMap(n => ['--require-native-table-slide', String(n)])],
  verifyArtifactToolImport: true, receiptPath: path.join(buildDir, `validation-${revision}.json`) });
await fs.copyFile(finalStagedPath, path.join(outputDir, 'slides.pptx'));
let pdfEngine = 'artifact-tool';
try {
  const pdf = await presentation.export({ format: 'pdf' });
  await fs.writeFile(path.join(outputDir, 'slides.pdf'), new Uint8Array(await pdf.arrayBuffer()));
} catch (error) {
  // The bundled exporter can lack its standard-font package. Use the bundled
  // office converter without altering dependencies or flattening the PPTX.
  pdfEngine = 'LibreOffice';
  const pdfDir = path.join(buildDir, 'pdf');
  await fs.mkdir(pdfDir, { recursive: true });
  const conversion = spawnSync(path.join(runtimeRoot, 'bin/override/soffice'), [
    `-env:UserInstallation=${pathToFileURL(path.join(buildDir, 'libreoffice-profile')).href}`,
    '--headless', '--convert-to', 'pdf:impress_pdf_Export', '--outdir', pdfDir, finalStagedPath,
  ], { encoding: 'utf8', timeout: 60000 });
  if (conversion.status !== 0) throw new Error(`PDF export failed: ${conversion.stderr || error.message}`);
  await fs.copyFile(path.join(pdfDir, path.basename(finalStagedPath, '.pptx') + '.pdf'), path.join(outputDir, 'slides.pdf'));
}
await fs.writeFile(path.join(buildDir, 'source-evidence.json'), JSON.stringify({ resultsSha256: sourceHash,
  synthetic: true, slideCount: 7, font, candidatePath, final, pdfEngine,
  exportedFiles: ['submission/slides.pptx','submission/slides.pdf'] }, null, 2));
console.log(`Created 7-slide deck and PDF with ${font}: ${outputDir}`);
