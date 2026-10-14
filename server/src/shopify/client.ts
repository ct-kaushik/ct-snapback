import { setTimeout as sleep } from 'node:timers/promises';

export interface ShopifyCreds {
  domain: string; // xxx.myshopify.com
  token: string;
  apiVersion: string;
}

export interface GraphQLCost {
  requestedQueryCost: number;
  actualQueryCost: number;
  throttleStatus: { maximumAvailable: number; currentlyAvailable: number; restoreRate: number };
}

export class ShopifyError extends Error {
  constructor(message: string, readonly detail?: unknown) {
    super(message);
    this.name = 'ShopifyError';
  }
}

/**
 * Thin GraphQL Admin API client. Handles the leaky-bucket throttle by backing off
 * and retrying when Shopify reports THROTTLED or returns 429.
 */
export class ShopifyClient {
  private endpoint: string;

  constructor(private creds: ShopifyCreds) {
    this.endpoint = `https://${creds.domain}/admin/api/${creds.apiVersion}/graphql.json`;
  }

  async graphql<T = any>(query: string, variables?: Record<string, unknown>): Promise<{ data: T; cost?: GraphQLCost }> {
    const maxAttempts = 6;
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      attempt++;
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': this.creds.token,
          Accept: 'application/json',
        },
        body: JSON.stringify({ query, variables }),
      });

      if (res.status === 429) {
        if (attempt >= maxAttempts) throw new ShopifyError('Rate limited (429) after retries');
        const retryAfter = Number(res.headers.get('Retry-After') ?? '2');
        await sleep(retryAfter * 1000);
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        const detail = (await res.text().catch(() => '')).slice(0, 300);
        throw new ShopifyError(`Authentication failed (${res.status}). Check the Admin API token and scopes.${detail ? ` Shopify said: ${detail}` : ''}`);
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new ShopifyError(`HTTP ${res.status} from Shopify`, text.slice(0, 500));
      }

      const body = (await res.json()) as {
        data?: T;
        errors?: Array<{ message: string; extensions?: { code?: string } }>;
        extensions?: { cost?: GraphQLCost };
      };
      const cost = body.extensions?.cost;

      const throttled = body.errors?.some((e) => e.extensions?.code === 'THROTTLED');
      if (throttled) {
        if (attempt >= maxAttempts) throw new ShopifyError('THROTTLED after retries');
        const need = cost?.requestedQueryCost ?? 100;
        const avail = cost?.throttleStatus.currentlyAvailable ?? 0;
        const rate = cost?.throttleStatus.restoreRate ?? 50;
        const waitMs = Math.max(1000, ((need - avail) / rate) * 1000);
        await sleep(waitMs);
        continue;
      }

      if (body.errors?.length) {
        throw new ShopifyError(body.errors.map((e) => e.message).join('; '), body.errors);
      }
      if (!body.data) throw new ShopifyError('Empty response from Shopify');
      return { data: body.data, cost };
    }
  }

  /** Pace mutations so we don't exhaust the bucket. Waits when little budget remains. */
  async paceAfter(cost?: GraphQLCost): Promise<void> {
    if (!cost) return;
    const { currentlyAvailable, restoreRate } = cost.throttleStatus;
    if (currentlyAvailable < 100) {
      const waitMs = ((100 - currentlyAvailable) / restoreRate) * 1000;
      await sleep(Math.min(waitMs, 5000));
    }
  }
}
