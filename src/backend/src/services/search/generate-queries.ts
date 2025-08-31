import { openaiClient } from '../../config/openai';
import { readFile } from 'fs/promises';
import { join } from 'path';

// Types
import type { SearchQueryResponse } from '../../types/search';


export async function generateSearchQueries(naturalLanguageQuery: string): Promise<SearchQueryResponse> {
    try {
        // Load the prompt from file
        const promptPath = join(process.cwd(), 'src', 'prompts', 'search-query.txt');
        const prompt = await readFile(promptPath, 'utf-8');

        const response = await openaiClient.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                {
                    role: 'system',
                    content: prompt,
                },
                {
                    role: 'user',
                    content: naturalLanguageQuery,
                }
            ],
            temperature: 0.2, 
        });

        const text = response.choices[0]?.message?.content?.trim() || '';

        // Check for unfulfilled requests first
        if (text === "Unfulfilled" || text === "UNDEFINED") {
            return { queries: ['Unfulfilled'] };
        }

        // Extract JSON from the response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('Failed to extract JSON from OpenAI response');
        }

        const parsedResponse: SearchQueryResponse = JSON.parse(jsonMatch[0]);

        // Validate the response structure
        if (!parsedResponse.queries || !Array.isArray(parsedResponse.queries)) {
            throw new Error('Invalid response structure from OpenAI');
        }

        // Ensure we have no more than 4 queries
        if (parsedResponse.queries.length > 4) {
            throw new Error(`Expected at most 4 queries, got ${parsedResponse.queries.length}`);
        }
        return parsedResponse;
    } catch (error) {
        if (error instanceof Error) {
            throw new Error(`Failed to generate search queries: ${error.message}`);
        }
        throw new Error('Failed to generate search queries: Unknown error');
    }
}