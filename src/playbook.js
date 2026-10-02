/**
 * Executable playbook: numbered step-by-step batch instructions.
 * Pure module: no DOM, no dependencies.
 */

import { percent } from './math.js';

export function buildPlaybook({ analysis, labels }) {
  const run = analysis.run;
  const path = [run.steps[0].from, ...run.steps.map((s) => s.to)];

  const header = {
    cycle: path.join(' -> '),
    direction: analysis.direction,
    edge: percent(analysis.roi),
    batch: String(analysis.batch),
  };

  const steps = run.steps.map((step, index) => {
    const leftover = step.leftover > 0n ? `${step.leftover} ${step.from}` : null;
    return {
      n: index + 1,
      buy: `${step.out} ${step.to}`,
      pay: `${step.executed} ${step.from}`,
      rate: String(step.rate),
      leftover,
      text: `Step ${index + 1}: Buy ${step.out} ${step.to} for ${step.executed} ${step.from} @ ${step.rate}${leftover ? ` (leftover ${leftover})` : ''}`,
    };
  });

  const net = {
    text: `Net: ${analysis.profit > 0n ? '+' : ''}${analysis.profit} ${labels.c1} (${header.edge} %)`,
    profit: analysis.profit,
    roi: analysis.roi,
  };

  return { header, steps, net, planWarning: analysis.plan?.warning ?? null };
}
