import { loadEnv, defineConfig } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

// shop-sut patch (see docs/upstream-patches.md): Redis-backed infrastructure
// modules as in Medusa's production deployment guide, plus settings that make
// a production build usable over plain HTTP on localhost.
const REDIS_URL = process.env.REDIS_URL

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    databaseDriverOptions: {
      ssl: false,
      sslmode: 'disable',
    },
    redisUrl: REDIS_URL,
    workerMode: (process.env.MEDUSA_WORKER_MODE as 'shared' | 'worker' | 'server') || 'shared',
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET,
      cookieSecret: process.env.COOKIE_SECRET,
    },
    // The local stand is served over http://localhost. Production mode would
    // otherwise mark the admin session cookie `Secure`, which WebKit rejects
    // on plain HTTP. Never copy this to a real deployment.
    cookieOptions: {
      secure: false,
      sameSite: 'lax',
    },
  },
  modules: REDIS_URL
    ? [
        {
          resolve: '@medusajs/medusa/caching',
          options: {
            providers: [
              {
                resolve: '@medusajs/medusa/caching-redis',
                id: 'caching-redis',
                is_default: true,
                options: { redisUrl: REDIS_URL },
              },
            ],
          },
        },
        {
          resolve: '@medusajs/medusa/event-bus-redis',
          options: { redisUrl: REDIS_URL },
        },
        {
          resolve: '@medusajs/medusa/workflow-engine-redis',
          options: { redis: { redisUrl: REDIS_URL } },
        },
        {
          resolve: '@medusajs/medusa/locking',
          options: {
            providers: [
              {
                resolve: '@medusajs/medusa/locking-redis',
                id: 'locking-redis',
                is_default: true,
                options: { redisUrl: REDIS_URL },
              },
            ],
          },
        },
      ]
    : [],
})
