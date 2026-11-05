import {
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import type { ScenarioProvider } from '@/lib/xsmb-types'

export const xsmbScenarios = pgTable('xsmb_scenarios', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().default('shared'),
  name: text('name').notNull(),
  provider: text('provider').$type<ScenarioProvider>().notNull(),
  modelId: text('model_id'),
  prompt: text('prompt').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  isBuiltin: boolean('is_builtin').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const xsmbDraws = pgTable('xsmb_draws', {
  drawDate: date('draw_date', { mode: 'string' }).primaryKey(),
  userId: text('user_id').notNull().default('shared'),
  day: text('day').notNull().default(''),
  special: text('special').notNull(),
  tail: text('tail').notNull(),
  prizes: jsonb('prizes').$type<string[][]>().notNull().default([]),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
})

export const xsmbPredictions = pgTable(
  'xsmb_predictions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull().default('shared'),
    targetDate: date('target_date', { mode: 'string' }).notNull(),
    scenarioId: text('scenario_id').notNull(),
    scenarioName: text('scenario_name').notNull(),
    provider: text('provider').$type<ScenarioProvider>().notNull(),
    modelId: text('model_id'),
    promptSnapshot: text('prompt_snapshot').notNull(),
    prediction: text('prediction').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userDateScenarioUnique: uniqueIndex('xsmb_predictions_user_date_scenario_unique').on(
      table.userId,
      table.targetDate,
      table.scenarioId,
    ),
  }),
)

export const xsmbAiReports = pgTable(
  'xsmb_ai_reports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull().default('shared'),
    targetDate: date('target_date', { mode: 'string' }).notNull(),
    scenarioId: text('scenario_id').notNull(),
    scenarioName: text('scenario_name').notNull(),
    provider: text('provider').$type<ScenarioProvider>().notNull(),
    modelId: text('model_id').notNull(),
    promptSnapshot: text('prompt_snapshot').notNull(),
    analysis: text('analysis').notNull(),
    prediction: text('prediction').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userDateScenarioUnique: uniqueIndex('xsmb_ai_reports_user_date_scenario_unique').on(
      table.userId,
      table.targetDate,
      table.scenarioId,
    ),
  }),
)
