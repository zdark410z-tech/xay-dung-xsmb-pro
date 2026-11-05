import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL is not configured')
}

const globalForDb = globalThis as unknown as { xsmbPool?: Pool }
const pool = globalForDb.xsmbPool ?? new Pool({ connectionString, max: 5 })

if (process.env.NODE_ENV !== 'production') {
  globalForDb.xsmbPool = pool
}

export const db = drizzle(pool, { schema })
