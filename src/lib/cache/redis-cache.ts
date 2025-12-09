import logger from '@/lib/logger'
import { getRedisClient } from '@/lib/redis'
import { createClient, RedisClientType } from 'redis'

export interface CacheOptions {
  ttl?: number // Time to live in seconds
  prefix?: string // Cache key prefix
  compress?: boolean // Whether to compress data (for large objects)
  redisUrl?: string // Custom Redis URL (uses REDIS_URL by default)
  useTls?: boolean // Whether to use TLS for custom Redis connection
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
  private customClient: RedisClientType | null = null
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    errors: 0,
  }

  constructor(options: CacheOptions = {}) {
    this.prefix = options.prefix || 'cache'
    this.defaultTtl = options.ttl || 43200 // 12 hours default

    // Create custom Redis client if a custom URL is provided
    if (options.redisUrl) {
      this.customClient = createClient({
        url: options.redisUrl,
        socket: {
          tls: options.useTls ? true : undefined,
          connectTimeout: 10000,
          keepAlive: true,
        },
        commandsQueueMaxLength: 5000, // Similar to commandTimeout
      })

      this.customClient.on('ready', () => {
        logger.info(`Redis cache client ready for prefix: ${this.prefix}`)
      })

      this.customClient.on('error', error => {
        logger.error({
          message: `Redis cache client error for prefix: ${this.prefix}`,
          error: error instanceof Error ? error : String(error),
        })
      })

      // Connect to Redis
      this.customClient.connect().catch((err) => {
        logger.error({
          message: `Failed to connect to custom Redis for prefix: ${this.prefix}`,
          error: err.message,
          data: { redisUrl: options.redisUrl },
        })
      })
    }
  }

  /**
   * Get the Redis client (custom or default)
   */
  private getClient(): RedisClientType {
    return this.customClient || getRedisClient()
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
      const redis = this.getClient()
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
      const redis = this.getClient()
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
      const redis = this.getClient()
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
      const redis = this.getClient()
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
      const redis = this.getClient()
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

  /**
   * Disconnect custom Redis client (if using custom URL)
   */
  async disconnect(): Promise<void> {
    if (this.customClient) {
      await this.customClient.quit()
      this.customClient = null
      logger.info(`Redis cache client disconnected for prefix: ${this.prefix}`)
    }
  }
}

/**
 * Create a typed cache instance
 */
export function createCache<T = any>(options: CacheOptions = {}): RedisCache<T> {
  const redisUrl = process.env.REDIS_CACHE_URL

  if (redisUrl) {
    return new RedisCache<T>({ ...options, redisUrl })
  }

  return new RedisCache<T>(options)
}

