import { openaiClient } from '../../config/openai';
// Types
import { SearchResult } from '../../types/search';

interface RankedResult extends SearchResult {
    similarity: number;
}

interface EmbeddingCache {
    [key: string]: number[];
}

// Configuration
const EMBEDDING_MODEL = 'text-embedding-3-small';

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

const getEmbedding = async (text: string): Promise<number[]> => {
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

        return embedding;
    } catch (error) {
        console.error('Error getting embedding:', error);
        throw error;
    }
};

const getEmbeddingsBatch = async (texts: string[]): Promise<number[][]> => {
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
        cache?: EmbeddingCache;
    } = {}
): Promise<RankedResult[]> => {
    if (results.length === 0) {
        return [];
    }

    const { useCache = false, cache = {} } = options;

    try {
        // Get query embedding
        let queryEmbedding: number[];
        if (useCache && cache[query]) {
            queryEmbedding = cache[query];
        } else {
            queryEmbedding = await getEmbedding(query);
            if (useCache) {
                cache[query] = queryEmbedding;
            }
        }

        // Extract text content from results
        const resultTexts = results.map(extractTextContent);

        // Get embeddings for results (batch for efficiency)
        const resultEmbeddings = await getEmbeddingsBatch(resultTexts);

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
    return rankSearchResults(query, results);
};

// Function to get top N results
export const getTopResults = async (
    query: string,
    results: SearchResult[],
    topN: number = 10
): Promise<RankedResult[]> => {
    const ranked = await rankSearchResults(query, results);
    return ranked.slice(0, topN);
};
