// Runner de stress : node lab/stress/run-stress.js [variant] [--seeds 1,42,1337]
//                    [--case name] [--dump]
// Exécute tous les cas limites sur la règle <variant> (défaut v1), JSON sur stdout,
// dumps ASCII des échecs sur stderr avec --dump.

const path = require('path');
const { cases } = require('./cases');
const { runCase, ascii } = require('./harness');

const args = process.argv.slice(2);
const variant = (args[0] && !args[0].startsWith('--')) ? args[0] : 'v1';
const seedArg = args.indexOf('--seeds');
const seeds = seedArg >= 0 ? args[seedArg + 1].split(',').map(Number) : [1, 42, 1337];
const caseArg = args.indexOf('--case');
const only = caseArg >= 0 ? args[caseArg + 1] : null;
const dump = args.includes('--dump');

const rule = require(path.join(__dirname, '..', 'rules', variant + '.js'));

const results = { variant, seeds, cases: {}, allPass: true, failures: [] };

for (const c of cases) {
  if (only && c.name !== only) continue;
  const perSeed = {};
  let casePass = true;
  for (const seed of seeds) {
    const r = runCase(c, rule, seed);
    perSeed[seed] = {
      pass: r.pass,
      error: r.error ? r.error.split('\n')[0] : null,
      conservationOK: r.conservationOK,
      firstBreakFrame: r.firstBreakFrame,
      meanLateActivity: r.meanLateActivity,
      metrics: r.metrics,
    };
    if (!r.pass) {
      casePass = false;
      results.failures.push(`${c.name} (seed ${seed})`);
      if (dump) {
        console.error(`=== ECHEC ${c.name} seed=${seed} (état final ${c.w}x${c.h}) ===`);
        if (r.error) console.error(r.error);
        console.error(ascii(r.sim));
      }
    }
  }
  results.cases[c.name] = { pass: casePass, seeds: perSeed };
  if (!casePass) results.allPass = false;
}

console.log(JSON.stringify(results, null, 2));
process.exitCode = results.allPass ? 0 : 1;
