import { createClient, RedisClientType } from 'redis'
import logger from './logger'

let redisClient: RedisClientType | null = null

/**
 * Get Redis client instance (singleton pattern)
 */
export function getRedisClient(): RedisClientType {
  if (!redisClient) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'

    redisClient = createClient({
      url: redisUrl,
    })

    redisClient.on('error', (err) => {
      logger.error({
        message: 'Redis client error',
        error: err.message,
        data: { redisUrl },
      })
    })

    redisClient.on('connect', () => {
      logger.info('Redis client connected', { redisUrl })
    })

    redisClient.on('ready', () => {
      logger.info('Redis client ready')
    })

    redisClient.on('end', () => {
      logger.info('Redis client connection ended')
    })

    // Connect to Redis
    redisClient.connect().catch((err) => {
      logger.error({
        message: 'Failed to connect to Redis',
        error: err.message,
        data: { redisUrl },
      })
    })
  }

  return redisClient
}

/**
 * Close Redis client connection
 */
export async function closeRedisClient(): Promise<void> {
  if (redisClient) {
    await redisClient.quit()
    redisClient = null
    logger.info('Redis client connection closed')
  }
}

/**
 * Check if Redis client is connected
 */
export function isRedisConnected(): boolean {
  return redisClient?.isOpen === true
}
