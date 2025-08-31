import { openaiClient } from '../../config/openai';
import { getRedisClient } from '../../config/redis';
import crypto from 'crypto';

// Types
import { SearchResult } from '../../types/search';

interface RankedResult extends SearchResult {
    similarity: number;
}

// Configuration
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_CACHE_DURATION = 7 * 24 * 60 * 60; // 7 days since embeddings dont go stale

// Utility functions
const cosineSimilarity = (a: number[], b: number[]): number => {
    if (a.length !== b.length) {
        throw new Error('Vectors must have the same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i]! * b[i]!;
        normA += a[i]! * a[i]!;
        normB += b[i]! * b[i]!;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
};

const generateEmbeddingCacheKey = (text: string): string => {
    const hash = crypto.createHash('sha256').update(text.trim()).digest('hex').substring(0, 16);
    return `embedding:${EMBEDDING_MODEL}:${hash}`;
};

const extractTextContent = (result: SearchResult): string => {
    // Combine title and snippet for semantic comparison
    // Remove HTML tags from snippet
    if (result.pagemap.metatags && result.pagemap.metatags.length > 0) {
        const ogDescription = result.pagemap.metatags[0]['og:description'];
        const description = ogDescription ? ogDescription.substring(0, 800) : result.snippet;
        return `Title: ${result.title} Description: ${description}`;
    } else {
        const cleanSnippet = result.snippet;
        return `Title: ${result.title} Description: ${cleanSnippet}`;
    }
};

const getCachedEmbedding = async (text: string): Promise<number[] | null> => {
    const redis = getRedisClient();
    const cacheKey = generateEmbeddingCacheKey(text);

    try {
        const cached = await redis.get(cacheKey);
        if (cached) {
            return JSON.parse(cached) as number[];
        }
    } catch (error) {
        console.error(`Error reading embedding from cache for key ${cacheKey}:`, error);
    }

    return null;
};

const setCachedEmbedding = async (text: string, embedding: number[]): Promise<void> => {
    const redis = getRedisClient();
    const cacheKey = generateEmbeddingCacheKey(text);

    try {
        await redis.setEx(cacheKey, EMBEDDING_CACHE_DURATION, JSON.stringify(embedding));
    } catch (error) {
        console.error(`Error caching embedding for key ${cacheKey}:`, error);
    }
};

const getEmbedding = async (text: string, useCache: boolean = true): Promise<number[]> => {
    if (!text || text.trim().length === 0) {
        throw new Error('Text cannot be empty for embedding');
    }
    // Try cache first if enabled
    if (useCache) {
        const cached = await getCachedEmbedding(text);
        if (cached) {
            return cached;
        }
    }

    try {
        const response = await openaiClient.embeddings.create({
            model: EMBEDDING_MODEL,
            input: text,
            encoding_format: 'float'
        });

        const embedding = response.data[0]?.embedding;
        if (!embedding) {
            throw new Error('No embedding returned from OpenAI API');
        }

        // Cache the result if caching is enabled
        if (useCache) {
            await setCachedEmbedding(text, embedding);
        }

        return embedding;
    } catch (error) {
        console.error('Error getting embedding:', error);
        throw error;
    }
};

const getEmbeddingsBatch = async (texts: string[], useCache: boolean = true): Promise<number[][]> => {
    if (!useCache) {
        return getBatchEmbeddingsFromAPI(texts);
    }

    // Check cache for each text
    const embeddings: (number[] | null)[] = await Promise.all(
        texts.map(text => getCachedEmbedding(text))
    );

    const uncachedIndices: number[] = [];
    const uncachedTexts: string[] = [];

    embeddings.forEach((embedding, index) => {
        if (embedding === null) {
            uncachedIndices.push(index);
            uncachedTexts.push(texts[index]!);
        }
    });

    if (uncachedTexts.length > 0) {
        const freshEmbeddings = await getBatchEmbeddingsFromAPI(uncachedTexts);

        await Promise.all(
            uncachedTexts.map((text, i) =>
                setCachedEmbedding(text, freshEmbeddings[i]!)
            )
        );

        // Fill in the fresh embeddings
        uncachedIndices.forEach((originalIndex, i) => {
            embeddings[originalIndex] = freshEmbeddings[i]!;
        });
    }

    return embeddings as number[][];
};

const getBatchEmbeddingsFromAPI = async (texts: string[]): Promise<number[][]> => {
    try {
        const response = await openaiClient.embeddings.create({
            model: EMBEDDING_MODEL,
            input: texts,
            encoding_format: 'float'
        });

        const embeddings = response.data.map(item => {
            if (!item.embedding) {
                throw new Error('Missing embedding in batch response');
            }
            return item.embedding;
        });

        return embeddings;
    } catch (error) {
        console.error('Error getting batch embeddings:', error);
        throw error;
    }
};

// Main ranking function
export const rankSearchResults = async (
    query: string,
    results: SearchResult[],
    options: {
        useCache?: boolean;
    } = {}
): Promise<RankedResult[]> => {
    if (results.length === 0) {
        return [];
    }

    const { useCache = true } = options;

    try {
        const queryEmbedding = await getEmbedding(query, useCache);

        // Extract text content from results
        const resultTexts = results.map(extractTextContent);

        // Get embeddings for results 
        const resultEmbeddings = await getEmbeddingsBatch(resultTexts, useCache);

        // Calculate similarities and create ranked results
        const rankedResults: RankedResult[] = results.map((result, index) => ({
            ...result,
            similarity: cosineSimilarity(queryEmbedding, resultEmbeddings[index]!)
        }));

        // Sort by similarity (highest first)
        return rankedResults.sort((a, b) => b.similarity - a.similarity);

    } catch (error) {
        console.error('Error ranking search results:', error);
        throw error;
    }
};

// Convenience function for quick ranking without caching
export const quickRank = async (
    query: string,
    results: SearchResult[]
): Promise<RankedResult[]> => {
    return rankSearchResults(query, results, { useCache: false });
};

// Function to get top N results
export const getTopResults = async (
    query: string,
    results: SearchResult[],
    topN: number = 10,
    useCache: boolean = true
): Promise<RankedResult[]> => {
    const ranked = await rankSearchResults(query, results, { useCache });
    return ranked.slice(0, topN);
};
