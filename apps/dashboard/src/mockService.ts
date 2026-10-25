export const sampleAdapter = {
  source: "local-fixtures" as const,
  startBaseline: (onTick: (value: number) => void) =>
    simulate([18, 42, 68, 84, 100], onTick),
  testCandidate: (onTick: (value: number) => void) =>
    simulate([20, 50, 78, 100], onTick),
}

function simulate(steps: number[], onTick: (value: number) => void) {
  let stopped = false
  const timers = steps.map((step, index) =>
    window.setTimeout(() => !stopped && onTick(step), 340 * (index + 1)),
  )
  return () => {
    stopped = true
    timers.forEach(window.clearTimeout)
  }
}
