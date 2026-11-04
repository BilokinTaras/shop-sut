/**
 * shop-sut: idempotent QA bootstrap.
 *
 * Runs after `medusa db:migrate` (which applies the starter's own seed as a
 * migration script) and adds everything the test projects rely on:
 *
 *   1. QA region in USD ("QA North America": us, ca) with a shipping option
 *   2. QA products with stable handles: qa-tee, qa-mug, qa-sold-out, in collection "QA Picks"
 *   3. a test admin user
 *   4. the publishable API key of the default sales channel (looked up)
 *   5. the read-only database role `qa_readonly`
 *   6. the contract file /generated/sut.env and /generated/publishable-key
 *
 * Every step checks for existing data first, so re-running it is safe.
 *
 *   npx medusa exec ./src/scripts/qa-bootstrap.js   (inside .medusa/server)
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { ExecArgs } from '@medusajs/framework/types'
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from '@medusajs/framework/utils'
import {
  createCollectionsWorkflow,
  createInventoryLevelsWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  createShippingOptionsWorkflow,
  createTaxRegionsWorkflow,
  createUserAccountWorkflow,
  updateProductsWorkflow,
} from '@medusajs/medusa/core-flows'

const QA_REGION_NAME = 'QA North America'
const QA_REGION_COUNTRIES = ['us', 'ca']
const QA_SHIPPING_OPTION = 'QA Standard Shipping (US/CA)'
const QA_IN_STOCK = 1_000_000
// The storefront home page lists products by collection; the starter seed has none.
const QA_COLLECTION = { title: 'QA Picks', handle: 'qa-picks' }

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`qa-bootstrap: environment variable ${name} is required`)
  }
  return value
}

type QaProduct = {
  handle: string
  title: string
  description: string
  stock: number
  option: { title: string; values: string[] }
  variants: { title: string; sku: string; value: string; eur: number; usd: number }[]
}

// Prices are major units (Medusa v2 stores amounts as decimals, 25 = EUR 25.00).
const QA_PRODUCTS: QaProduct[] = [
  {
    handle: 'qa-tee',
    title: 'QA Tee',
    description: 'Deterministic test product with three size variants.',
    stock: QA_IN_STOCK,
    option: { title: 'Size', values: ['S', 'M', 'L'] },
    variants: [
      { title: 'S', sku: 'QA-TEE-S', value: 'S', eur: 25, usd: 30 },
      { title: 'M', sku: 'QA-TEE-M', value: 'M', eur: 25, usd: 30 },
      { title: 'L', sku: 'QA-TEE-L', value: 'L', eur: 25, usd: 30 },
    ],
  },
  {
    handle: 'qa-mug',
    title: 'QA Mug',
    description: 'Deterministic test product with a single variant.',
    stock: QA_IN_STOCK,
    option: { title: 'Default option', values: ['Default option value'] },
    variants: [
      { title: 'Default', sku: 'QA-MUG', value: 'Default option value', eur: 12.5, usd: 14 },
    ],
  },
  {
    handle: 'qa-sold-out',
    title: 'QA Sold Out',
    description: 'Deterministic test product that is always out of stock.',
    stock: 0,
    option: { title: 'Default option', values: ['Default option value'] },
    variants: [
      { title: 'Default', sku: 'QA-SOLD-OUT', value: 'Default option value', eur: 40, usd: 45 },
    ],
  },
]

export default async function qaBootstrap({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const fulfillment = container.resolve(Modules.FULFILLMENT)

  const generatedDir = process.env.QA_GENERATED_DIR || '/generated'
  const adminEmail = required('QA_ADMIN_EMAIL')
  const adminPassword = required('QA_ADMIN_PASSWORD')
  const roPassword = required('QA_DB_READONLY_PASSWORD')

  // ---- Shared objects created by the starter seed --------------------------
  const { data: salesChannels } = await query.graph({
    entity: 'sales_channel',
    fields: ['id', 'name'],
    filters: { name: 'Default Sales Channel' },
  })
  const salesChannel = salesChannels[0]
  if (!salesChannel) {
    throw new Error('qa-bootstrap: starter seed missing (no "Default Sales Channel"); did db:migrate run?')
  }

  const { data: europeRegions } = await query.graph({
    entity: 'region',
    fields: ['id', 'name', 'currency_code'],
    filters: { name: 'Europe' },
  })
  const europe = europeRegions[0]

  const { data: stockLocations } = await query.graph({
    entity: 'stock_location',
    fields: ['id', 'name', 'fulfillment_sets.id', 'fulfillment_sets.service_zones.id', 'fulfillment_sets.service_zones.name'],
    filters: { name: 'European Warehouse' },
  })
  const stockLocation = stockLocations[0]
  const fulfillmentSet = stockLocation.fulfillment_sets?.[0]
  if (!fulfillmentSet) {
    throw new Error('qa-bootstrap: starter fulfillment set not found')
  }

  const { data: shippingProfiles } = await query.graph({
    entity: 'shipping_profile',
    fields: ['id'],
  })
  const shippingProfile = shippingProfiles[0]

  // ---- 1. QA region in USD -------------------------------------------------
  const { data: existingQaRegions } = await query.graph({
    entity: 'region',
    fields: ['id'],
    filters: { name: QA_REGION_NAME },
  })
  let qaRegionId = existingQaRegions[0]?.id as string | undefined
  if (!qaRegionId) {
    const { result } = await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            name: QA_REGION_NAME,
            currency_code: 'usd',
            countries: QA_REGION_COUNTRIES,
            payment_providers: ['pp_system_default'],
          },
        ],
      },
    })
    qaRegionId = result[0].id
    logger.info(`qa-bootstrap: created region ${QA_REGION_NAME}`)
  }

  const { data: taxRegions } = await query.graph({
    entity: 'tax_region',
    fields: ['id', 'country_code'],
  })
  const missingTaxCountries = QA_REGION_COUNTRIES.filter(
    (code) => !taxRegions.some((tr) => tr.country_code === code),
  )
  if (missingTaxCountries.length) {
    await createTaxRegionsWorkflow(container).run({
      input: missingTaxCountries.map((country_code) => ({ country_code, provider_id: 'tp_system' })),
    })
  }

  let qaZone: { id: string } | undefined = fulfillmentSet.service_zones?.find(
    (zone) => zone?.name === QA_REGION_NAME,
  ) ?? undefined
  if (!qaZone) {
    qaZone = await fulfillment.createServiceZones({
      name: QA_REGION_NAME,
      fulfillment_set_id: fulfillmentSet.id,
      geo_zones: QA_REGION_COUNTRIES.map((country_code) => ({ type: 'country' as const, country_code })),
    })
  }

  const { data: shippingOptions } = await query.graph({
    entity: 'shipping_option',
    fields: ['id'],
    filters: { name: QA_SHIPPING_OPTION },
  })
  if (!shippingOptions.length) {
    await createShippingOptionsWorkflow(container).run({
      input: [
        {
          name: QA_SHIPPING_OPTION,
          price_type: 'flat',
          provider_id: 'manual_manual',
          service_zone_id: qaZone!.id,
          shipping_profile_id: shippingProfile.id,
          type: { label: 'QA Standard', description: 'Ships in 3-5 days.', code: 'qa-standard' },
          prices: [
            { currency_code: 'usd', amount: 8 },
            { region_id: qaRegionId, amount: 8 },
          ],
          rules: [
            { attribute: 'enabled_in_store', value: 'true', operator: 'eq' },
            { attribute: 'is_return', value: 'false', operator: 'eq' },
          ],
        },
      ],
    })
  }

  // ---- 2. QA products --------------------------------------------------------
  const { data: existingProducts } = await query.graph({
    entity: 'product',
    fields: ['id', 'handle'],
    filters: { handle: QA_PRODUCTS.map((p) => p.handle) },
  })
  const existingHandles = new Set(existingProducts.map((p) => p.handle))
  const toCreate = QA_PRODUCTS.filter((p) => !existingHandles.has(p.handle))

  if (toCreate.length) {
    const { result: created } = await createProductsWorkflow(container).run({
      input: {
        products: toCreate.map((p) => ({
          title: p.title,
          handle: p.handle,
          description: p.description,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          // Served by the storefront itself (apps/storefront/public/qa) so pages
          // render identically on any machine and without internet access.
          thumbnail: `/qa/${p.handle}.png`,
          images: [{ url: `/qa/${p.handle}.png` }],
          options: [{ title: p.option.title, values: p.option.values, is_exclusive: true }],
          variants: p.variants.map((v) => ({
            title: v.title,
            sku: v.sku,
            manage_inventory: true,
            allow_backorder: false,
            options: { [p.option.title]: v.value },
            prices: [
              { amount: v.eur, currency_code: 'eur' },
              { amount: v.usd, currency_code: 'usd' },
            ],
          })),
          sales_channels: [{ id: salesChannel.id }],
        })),
      },
    })
    logger.info(`qa-bootstrap: created products ${created.map((p) => p.handle).join(', ')}`)
  }

  // Collection shown on the storefront home page.
  const { data: collections } = await query.graph({
    entity: 'product_collection',
    fields: ['id'],
    filters: { handle: QA_COLLECTION.handle },
  })
  let collectionId = collections[0]?.id as string | undefined
  if (!collectionId) {
    const { result } = await createCollectionsWorkflow(container).run({
      input: { collections: [QA_COLLECTION] },
    })
    collectionId = result[0].id
  }
  const { data: qaWithCollection } = await query.graph({
    entity: 'product',
    fields: ['id', 'collection_id'],
    filters: { handle: QA_PRODUCTS.map((p) => p.handle) },
  })
  const outsideCollection = qaWithCollection.filter((p) => p.collection_id !== collectionId).map((p) => p.id)
  if (outsideCollection.length) {
    await updateProductsWorkflow(container).run({
      input: { selector: { id: outsideCollection }, update: { collection_id: collectionId } },
    })
  }

  // Inventory levels: every QA variant gets a level at the starter warehouse.
  const { data: qaVariants } = await query.graph({
    entity: 'product_variant',
    fields: ['id', 'sku', 'inventory_items.inventory_item_id', 'product.handle'],
    filters: { sku: QA_PRODUCTS.flatMap((p) => p.variants.map((v) => v.sku)) },
  })
  const inventoryItemIds = qaVariants.flatMap((v) =>
    (v.inventory_items ?? []).map((ii) => ({ id: ii!.inventory_item_id as string, handle: v.product!.handle as string })),
  )
  const { data: levels } = await query.graph({
    entity: 'inventory_level',
    fields: ['inventory_item_id', 'location_id'],
    filters: { inventory_item_id: inventoryItemIds.map((i) => i.id), location_id: stockLocation.id },
  })
  const withLevel = new Set(levels.map((l) => l.inventory_item_id))
  const missingLevels = inventoryItemIds.filter((i) => !withLevel.has(i.id))
  if (missingLevels.length) {
    await createInventoryLevelsWorkflow(container).run({
      input: {
        inventory_levels: missingLevels.map((i) => ({
          inventory_item_id: i.id,
          location_id: stockLocation.id,
          stocked_quantity: QA_PRODUCTS.find((p) => p.handle === i.handle)!.stock,
        })),
      },
    })
  }

  // The search index is fed by events handled asynchronously by the server;
  // replay ingestion for QA products so search works right after bootstrap.
  const { data: qaProducts } = await query.graph({
    entity: 'product',
    fields: ['id'],
    filters: { handle: QA_PRODUCTS.map((p) => p.handle) },
  })
  const search = container.resolve(Modules.SEARCH)
  await search.ingest({
    name: 'product.created',
    data: qaProducts.map((p) => ({ id: p.id })),
  } as never)

  // ---- 3. Test admin user ----------------------------------------------------
  const userModule = container.resolve(Modules.USER)
  const [existingAdmin] = await userModule.listUsers({ email: adminEmail })
  if (!existingAdmin) {
    const authModule = container.resolve(Modules.AUTH)
    const { authIdentity, error } = await authModule.register('emailpass', {
      body: { email: adminEmail, password: adminPassword },
    } as never)
    if (error || !authIdentity) {
      throw new Error(`qa-bootstrap: could not register admin identity: ${error}`)
    }
    await createUserAccountWorkflow(container).run({
      input: { userData: { email: adminEmail }, authIdentityId: authIdentity.id },
    })
    logger.info(`qa-bootstrap: created admin ${adminEmail}`)
  }

  // ---- 4. Publishable API key ------------------------------------------------
  const { data: apiKeys } = await query.graph({
    entity: 'api_key',
    fields: ['id', 'token', 'title', 'revoked_at', 'sales_channels.id'],
    filters: { type: 'publishable', title: 'Default Publishable API Key' },
  })
  const publishableKey = apiKeys.find((k) => !k.revoked_at)
  if (!publishableKey) {
    throw new Error('qa-bootstrap: default publishable API key not found')
  }

  // ---- 5. Read-only database role -------------------------------------------
  const dbName = (await pg.raw('select current_database() as db')).rows[0].db as string
  // Identifiers cannot be bound as parameters; both values come from this file
  // or from a validated environment variable, never from user input.
  if (!/^[A-Za-z0-9_-]+$/.test(roPassword)) {
    throw new Error('qa-bootstrap: QA_DB_READONLY_PASSWORD may contain only [A-Za-z0-9_-]')
  }
  await pg.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'qa_readonly') THEN
        CREATE ROLE qa_readonly LOGIN PASSWORD '${roPassword}';
      ELSE
        ALTER ROLE qa_readonly LOGIN PASSWORD '${roPassword}';
      END IF;
    END
    $$;
  `)
  await pg.raw(`GRANT CONNECT ON DATABASE "${dbName}" TO qa_readonly`)
  await pg.raw('GRANT USAGE ON SCHEMA public TO qa_readonly')
  await pg.raw('GRANT SELECT ON ALL TABLES IN SCHEMA public TO qa_readonly')
  await pg.raw('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO qa_readonly')
  await pg.raw('ALTER ROLE qa_readonly SET default_transaction_read_only = on')
  // postgres_exporter (shop-performance-k6) reads pg_stat_* views through this role.
  await pg.raw('GRANT pg_monitor TO qa_readonly')

  // ---- 6. Contract file --------------------------------------------------------
  const hostBackend = process.env.QA_HOST_BACKEND_URL || 'http://localhost:9000'
  const hostStorefront = process.env.QA_HOST_STOREFRONT_URL || 'http://localhost:8000'
  const hostDbPort = process.env.QA_HOST_POSTGRES_PORT || '55432'
  const hostRedisPort = process.env.QA_HOST_REDIS_PORT || '56379'
  const internalBackend = process.env.QA_INTERNAL_BACKEND_URL || 'http://medusa:9000'
  const country = process.env.QA_STOREFRONT_COUNTRY || 'dk'

  const contract: Record<string, string> = {
    SUT_MEDUSA_VERSION: process.env.QA_MEDUSA_VERSION || 'unknown',
    SUT_BACKEND_URL: hostBackend,
    SUT_ADMIN_URL: `${hostBackend}/app`,
    SUT_STOREFRONT_URL: hostStorefront,
    SUT_STOREFRONT_COUNTRY: country,
    SUT_PUBLISHABLE_KEY: publishableKey.token as string,
    SUT_ADMIN_EMAIL: adminEmail,
    SUT_ADMIN_PASSWORD: adminPassword,
    SUT_REGION_ID: europe.id,
    SUT_REGION_CURRENCY: europe.currency_code,
    SUT_REGION_USD_ID: qaRegionId!,
    SUT_SALES_CHANNEL_ID: salesChannel.id,
    SUT_STOCK_LOCATION_ID: stockLocation.id,
    // Postgres and Redis are published on 127.0.0.1 only. "localhost" resolves to ::1 first, and libpq on
    // Windows does not notice the refused IPv6 connection: without connect_timeout it waits forever.
    SUT_DB_READONLY_URL: `postgres://qa_readonly:${roPassword}@127.0.0.1:${hostDbPort}/${dbName}`,
    SUT_REDIS_URL: `redis://127.0.0.1:${hostRedisPort}`,
    SUT_DOCKER_NETWORK: process.env.QA_DOCKER_NETWORK || 'qa-shop-net',
    SUT_INTERNAL_BACKEND_URL: internalBackend,
    SUT_INTERNAL_DB_READONLY_URL: `postgres://qa_readonly:${roPassword}@postgres:5432/${dbName}`,
    SUT_INTERNAL_REDIS_URL: 'redis://redis:6379',
    // Test-only signing secret of this local stand (from .env.example). Lets negative tests build
    // expired or tampered tokens that are otherwise valid; never a real secret.
    SUT_JWT_SECRET: process.env.JWT_SECRET ?? '',
  }

  await mkdir(generatedDir, { recursive: true })
  const lines = [
    '# Generated by shop-sut qa-bootstrap. Do not edit; re-run `make bootstrap`.',
    '# Test-only credentials for a local stand. Not secrets.',
    ...Object.entries(contract).map(([k, v]) => `${k}=${v}`),
    '',
  ]
  await writeFile(path.join(generatedDir, 'sut.env'), lines.join('\n'), 'utf8')
  await writeFile(path.join(generatedDir, 'publishable-key'), `${publishableKey.token}\n`, 'utf8')
  logger.info(`qa-bootstrap: contract written to ${path.join(generatedDir, 'sut.env')}`)
}
