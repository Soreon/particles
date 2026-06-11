// Runner : node lab/run.js <variant> [--seed N] [--scenario name] [--dump]
// Charge lab/rules/<variant>.js, exécute la suite de scénarios, imprime un JSON.

const path = require('path');
const { scenarios, runScenario } = require('./scenarios');
const { Sim, makeRng } = require('./automaton');
const { ascii } = require('./metrics');

const args = process.argv.slice(2);
const variant = args[0] || 'v0';
const seedArg = args.indexOf('--seed');
const seed = seedArg >= 0 ? parseInt(args[seedArg + 1], 10) : 1;
const scenArg = args.indexOf('--scenario');
const only = scenArg >= 0 ? args[scenArg + 1] : null;
const dump = args.includes('--dump');

const flowRule = require(path.join(__dirname, 'rules', variant + '.js'));

const results = { variant, seed, scenarios: {}, allPass: true };

for (const scenario of scenarios) {
  if (only && scenario.name !== only) continue;
  const r = runScenario(scenario, flowRule, seed);
  results.scenarios[scenario.name] = r;
  if (!r.pass) results.allPass = false;

  if (dump) {
    // Re-simule pour afficher l'état final en ASCII.
    const sim = new Sim(64, 64, flowRule, seed);
    const rng = makeRng(seed * 7 + 13);
    scenario.build(sim, rng);
    for (let f = 0; f < scenario.frames; f++) sim.frame();
    console.error('=== ' + scenario.name + ' (final) ===');
    console.error(ascii(sim));
  }
}

console.log(JSON.stringify(results, null, 2));
