import axios from 'axios';
import { getRedisClient } from '../../config/redis';

// Types
import type { SearchResult } from '../../types/search';

const GOOGLE_API_KEY = process.env['SEARCH_API_KEY'];
const GOOGLE_SEARCH_ENGINE_ID = process.env['SEARCH_ENGINE_ID']!;

if (!GOOGLE_API_KEY) {
    throw new Error('Missing GOOGLE_API_KEY in environment variables');
}

// Cache duration in seconds (2 hours)
const CACHE_DURATION = 2 * 60 * 60;

const generateCacheKey = (query: string): string => {
    return `search:${query.toLowerCase().replace(/\s+/g, '-')}`;
};

const searchGoogle = async (queries: string[]): Promise<SearchResult[]> => {
    const redis = getRedisClient();

    const searchResults = await Promise.all(
        queries.map(async (query) => {
            const cacheKey = generateCacheKey(query);

            // Try to get cached results first
            try {
                const cachedResults = await redis.get(cacheKey);
                if (cachedResults) {
                    return JSON.parse(cachedResults) as SearchResult[];
                }
            } catch (error) {
                console.error(`Error reading from cache for "${query}":`, error);
            }

            // If no cache hit, perform the search
            const url = 'https://customsearch.googleapis.com/customsearch/v1';
            const params = {
                key: GOOGLE_API_KEY,
                cx: GOOGLE_SEARCH_ENGINE_ID,
                q: query
            };

            try {
                const response = await axios.get<{ items?: SearchResult[] }>(url, { params });
                const results = response.data.items || [];

                // Cache the results for 2 hours
                try {
                    await redis.setEx(cacheKey, CACHE_DURATION, JSON.stringify(results));
                    console.log(`Cached results for query: "${query}"`);
                } catch (cacheError) {
                    console.error(`Error caching results for "${query}":`, cacheError);
                }

                return results;
            } catch (error) {
                console.error(`Error searching for "${query}":`, error);
                return [];
            }
        })
    );

    return searchResults.flat();
};

export default searchGoogle;