import { desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { xsmbScenarios } from '@/lib/db/schema'
import { DEFAULT_ANALYSIS_SCENARIOS } from '@/lib/default-analysis-scenarios'
import { FORMULA_SCENARIOS } from '@/lib/xsmb-position-rules'

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

  const [latest] = await db
    .select({ sortOrder: xsmbScenarios.sortOrder })
    .from(xsmbScenarios)
    .where(eq(xsmbScenarios.userId, 'shared'))
    .orderBy(desc(xsmbScenarios.sortOrder))
    .limit(1)

  await db
    .insert(xsmbScenarios)
    .values(FORMULA_SCENARIOS.map((scenario, index) => ({
      ...scenario,
      userId: 'shared',
      provider: 'formula' as const,
      modelId: null,
      sortOrder: (latest?.sortOrder ?? -1) + index + 1,
      isBuiltin: true,
      isActive: true,
    })))
    .onConflictDoNothing()
}
