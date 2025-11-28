import logger from '@/lib/logger'
import { getServerSupabase } from '@/lib/supabase/server'
import {
  PREFIX_CUSTOMER_PORTAL_INVOICE_INFO_CACHE,
  type RedisCache,
  customerPortalInvoiceInfoCache,
} from './redis-cache'

/**
 * Customer invoice information type
 */
export interface CustomerInvoiceInfo {
  info_id: number
  customer_id: number | null
  email: string
  first_name: string | null
  middle_name: string | null
  last_name: string | null
  phone: string | null
  mobile: string | null
  shipping_address1: string | null
  shipping_address2: string | null
  shipping_city: string | null
  shipping_state: string | null
  shipping_zip: string | null
  shipping_country: string | null
  billing_address1: string | null
  billing_address2: string | null
  billing_city: string | null
  billing_state: string | null
  billing_zip: string | null
  billing_country: string | null
  shipping_verified: boolean | null
  billing_verified: boolean | null
  terms_compliance: boolean | null
  terms_agreed_at: string | null
  user_id: string | null
  hubspot_id: string | null
  check_invoice: boolean | null
  check_invoice_range: any | null
}

/**
 * Customer cache for caching customer information by email
 * Uses Redis as the backing store with configurable TTL
 */
export class CustomerCache {
  private cache: RedisCache<CustomerInvoiceInfo | null>

  constructor() {
    // Use pre-configured customer cache
    this.cache = customerPortalInvoiceInfoCache as RedisCache<CustomerInvoiceInfo | null>
  }

  /**
   * Get customer information by email with caching
   * Implements cache-aside pattern
   */
  async getCustomerByEmail(email: string): Promise<CustomerInvoiceInfo | null> {
    if (!email || typeof email !== 'string') {
      logger.warn({
        message: 'Invalid email provided to customer cache',
        data: { email },
      })
      return null
    }

    const normalizedEmail = email.toLowerCase().trim()

    logger.debug('Fetching customer info with cache', {
      email: normalizedEmail,
    })

    return this.cache.getOrSet(normalizedEmail, async () => {
      logger.info('Customer info not in cache, fetching from Supabase', {
        email: normalizedEmail,
      })
      return await getCustomerInformationByEmail(normalizedEmail)
    })
  }

  /**
   * Manually set customer information in cache
   */
  async setCustomerByEmail(
    email: string,
    customerInfo: CustomerInvoiceInfo | null,
    ttl?: number,
  ): Promise<boolean> {
    if (!email || typeof email !== 'string') {
      logger.warn({
        message: 'Invalid email provided to customer cache set',
        data: { email },
      })
      return false
    }

    const normalizedEmail = email.toLowerCase().trim()

    logger.debug('Manually setting customer info in cache', {
      email: normalizedEmail,
    })

    return this.cache.set(normalizedEmail, customerInfo, ttl)
  }

  /**
   * Remove customer information from cache
   */
  async invalidateCustomerByEmail(email: string): Promise<boolean> {
    if (!email || typeof email !== 'string') {
      logger.warn({
        message: 'Invalid email provided to customer cache invalidate',
        data: { email },
      })
      return false
    }

    const normalizedEmail = email.toLowerCase().trim()

    logger.debug('Invalidating customer info in cache', {
      email: normalizedEmail,
    })

    return this.cache.delete(normalizedEmail)
  }

  /**
   * Check if customer information exists in cache
   */
  async hasCustomerByEmail(email: string): Promise<boolean> {
    if (!email || typeof email !== 'string') {
      return false
    }

    const normalizedEmail = email.toLowerCase().trim()
    return this.cache.exists(normalizedEmail)
  }

  /**
   * Clear all customer cache entries
   */
  async clearAll(): Promise<boolean> {
    logger.info('Clearing all customer cache entries', {
      prefix: PREFIX_CUSTOMER_PORTAL_INVOICE_INFO_CACHE,
    })
    return this.cache.clear()
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return this.cache.getStats()
  }

  /**
   * Get cache hit rate
   */
  getHitRate(): number {
    return this.cache.getHitRate()
  }

  /**
   * Reset cache statistics
   */
  resetStats(): void {
    this.cache.resetStats()
  }
}

// Singleton instance for application-wide use
let customerCacheInstance: CustomerCache | null = null

/**
 * Get the singleton customer cache instance
 */
export function getCustomerCache(): CustomerCache {
  if (!customerCacheInstance) {
    customerCacheInstance = new CustomerCache()
  }
  return customerCacheInstance
}

/**
 * Create a new customer cache instance (useful for testing)
 */
export function createCustomerCache(): CustomerCache {
  return new CustomerCache()
}

/**
 * Get customer information by email from database
 */
export async function getCustomerInformationByEmail(
  email: string,
): Promise<CustomerInvoiceInfo | null> {
  if (!email || typeof email !== 'string') {
    logger.warn({
      message: 'Invalid email provided to getCustomerInformationByEmail',
      data: { email },
    })
    return null
  }

  const normalizedEmail = email.toLowerCase().trim()

  try {
    const supabase = await getServerSupabase()

    const { data, error } = await supabase
      .from('customer_information')
      .select(`
        info_id,
        customer_id,
        email,
        first_name,
        middle_name,
        last_name,
        phone,
        mobile,
        shipping_address1,
        shipping_address2,
        shipping_city,
        shipping_state,
        shipping_zip,
        shipping_country,
        billing_address1,
        billing_address2,
        billing_city,
        billing_state,
        billing_zip,
        billing_country,
        shipping_verified,
        billing_verified,
        terms_compliance,
        terms_agreed_at,
        user_id,
        hubspot_id,
        check_invoice,
        check_invoice_range
      `)
      .eq('email', normalizedEmail)
      .limit(1)
      .maybeSingle()

    if (error) {
      logger.error({
        message: 'Error fetching customer information by email',
        data: { email: normalizedEmail, error: error.message },
      })
      return null
    }

    return data
  } catch (error) {
    logger.error({
      message: 'Exception fetching customer information by email',
      data: { email: normalizedEmail, error },
    })
    return null
  }
}

/**
 * Cached version of getCustomerInformationByEmail for drop-in replacement
 * This maintains the same API as the original function but adds caching
 */
export async function getCachedCustomerInformationByEmail(
  email: string,
): Promise<CustomerInvoiceInfo | null> {
  const cache = getCustomerCache()
  return cache.getCustomerByEmail(email)
}
