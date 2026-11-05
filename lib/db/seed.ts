import { db } from '@/lib/db'
import { xsmbScenarios } from '@/lib/db/schema'
import { DEFAULT_ANALYSIS_SCENARIOS } from '@/lib/default-analysis-scenarios'

export async function ensureDefaultAnalysisScenarios() {
  await db
    .insert(xsmbScenarios)
    .values(
      DEFAULT_ANALYSIS_SCENARIOS.map((scenario) => ({
        ...scenario,
        userId: 'shared',
        isBuiltin: false,
        isActive: true,
      })),
    )
    .onConflictDoNothing()
}
