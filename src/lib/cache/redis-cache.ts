import logger from '@/lib/logger'
import { getRedisClient } from '@/lib/redis'

export interface CacheOptions {
  ttl?: number // Time to live in seconds
  prefix?: string // Cache key prefix
  compress?: boolean // Whether to compress data (for large objects)
}

export interface CacheStats {
  hits: number
  misses: number
  sets: number
  deletes: number
  errors: number
}

export class RedisCache<T = any> {
  private prefix: string
  private defaultTtl: number
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    errors: 0,
  }

  constructor(options: CacheOptions = {}) {
    this.prefix = options.prefix || 'cache'
    this.defaultTtl = options.ttl || 300 // 5 minutes default
  }

  /**
   * Generate a cache key with prefix
   */
  private generateKey(key: string): string {
    return `${this.prefix}:${key}`
  }

  /**
   * Get cached value by key
   */
  async get(key: string): Promise<T | null> {
    try {
      const redis = getRedisClient()
      const cacheKey = this.generateKey(key)
      const cached = await redis.get(cacheKey)

      if (cached) {
        this.stats.hits++
        try {
          return JSON.parse(cached)
        } catch (parseError) {
          logger.warn({
            message: 'Failed to parse cached data',
            data: { key, cacheKey, error: parseError },
          })
          // Remove corrupted data
          await this.delete(key)
          this.stats.errors++
          return null
        }
      }

      this.stats.misses++
      return null
    } catch (error) {
      this.stats.errors++
      logger.error({
        message: 'Redis cache get error',
        error: error instanceof Error ? error : String(error),
        data: { key },
      })
      return null
    }
  }

  /**
   * Set cache value with optional TTL
   */
  async set(key: string, value: T, ttl?: number): Promise<boolean> {
    try {
      const redis = getRedisClient()
      const cacheKey = this.generateKey(key)
      const serializedValue = JSON.stringify(value)
      const expiry = ttl || this.defaultTtl

      await redis.setEx(cacheKey, expiry, serializedValue)
      this.stats.sets++

      logger.info('Cache set', { key, cacheKey, ttl: expiry })

      return true
    } catch (error) {
      this.stats.errors++
      logger.error({
        message: 'Redis cache set error',
        error: error instanceof Error ? error : String(error),
        data: { key },
      })
      return false
    }
  }

  /**
   * Delete cached value
   */
  async delete(key: string): Promise<boolean> {
    try {
      const redis = getRedisClient()
      const cacheKey = this.generateKey(key)
      await redis.del(cacheKey)
      this.stats.deletes++

      logger.debug('Cache deleted', { key, cacheKey })

      return true
    } catch (error) {
      this.stats.errors++
      logger.error({
        message: 'Redis cache delete error',
        error: error instanceof Error ? error : String(error),
        data: { key },
      })
      return false
    }
  }

  /**
   * Check if key exists in cache
   */
  async exists(key: string): Promise<boolean> {
    try {
      const redis = getRedisClient()
      const cacheKey = this.generateKey(key)
      const result = await redis.exists(cacheKey)
      return result === 1
    } catch (error) {
      this.stats.errors++
      logger.error({
        message: 'Redis cache exists error',
        error: error instanceof Error ? error : String(error),
        data: { key },
      })
      return false
    }
  }

  /**
   * Get or set cache value (cache-aside pattern)
   */
  async getOrSet(key: string, fetcher: () => Promise<T | null>, ttl?: number): Promise<T | null> {
    // Try to get from cache first
    const cached = await this.get(key)
    if (cached !== null) {
      return cached
    }

    // Fetch from source
    try {
      const value = await fetcher()
      if (value !== null) {
        // Cache the result
        await this.set(key, value, ttl)
      }
      return value
    } catch (error) {
      logger.error({
        message: 'Error fetching data for cache',
        error: error instanceof Error ? error : String(error),
        data: { key },
      })
      return null
    }
  }

  /**
   * Clear all cache entries with this prefix
   */
  async clear(): Promise<boolean> {
    try {
      const redis = getRedisClient()
      const pattern = `${this.prefix}:*`
      const keys = await redis.keys(pattern)

      if (keys.length > 0) {
        await redis.del(keys)
        logger.info('Cache cleared', { prefix: this.prefix, keysCleared: keys.length })
      }

      return true
    } catch (error) {
      this.stats.errors++
      logger.error({
        message: 'Redis cache clear error',
        error: error instanceof Error ? error : String(error),
        data: { prefix: this.prefix },
      })
      return false
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats }
  }

  /**
   * Reset cache statistics
   */
  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0,
    }
  }

  /**
   * Get cache hit rate
   */
  getHitRate(): number {
    const total = this.stats.hits + this.stats.misses
    return total > 0 ? this.stats.hits / total : 0
  }
}

/**
 * Create a typed cache instance
 */
export function createCache<T = any>(options: CacheOptions = {}): RedisCache<T> {
  return new RedisCache<T>(options)
}

/**
 * Pre-configured customer cache
 */
export const PREFIX_CUSTOMER_PORTAL_INVOICE_INFO_CACHE =
  process.env.REDIS_KEY_PREFIX_CUSTOMER_PORTAL_INVOICE_INFO || 'customer-portal-invoice-info'

export const customerPortalInvoiceInfoCache = createCache({
  prefix: PREFIX_CUSTOMER_PORTAL_INVOICE_INFO_CACHE,
  ttl: 3600 * 5, // 5 hours
})
